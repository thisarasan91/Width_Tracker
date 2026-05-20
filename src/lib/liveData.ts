import type { Program } from "@/lib/types";

type SupabaseClientLike = {
  from: (table: string) => any;
};

export type LiveReadingRow = {
  timestamp: string;
  reading_label: string;
  width: number;
  unit: string;
};

export type LivePayload = {
  program: Pick<
    Program,
    "id" | "program_name" | "nominal_width" | "upper_tolerance" | "lower_tolerance" | "labels_for_each_reading"
  >;
  lowerLimit: number | null;
  upperLimit: number | null;
  labels: string[];
  rows: LiveReadingRow[];
};

function asNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMeasurementValue(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function programLabels(program: Pick<Program, "labels_for_each_reading">) {
  return Array.isArray(program.labels_for_each_reading)
    ? program.labels_for_each_reading.map((label) => String(label)).filter(Boolean)
    : [];
}

export async function getLivePayload(
  supabase: SupabaseClientLike,
  programId: string,
  readingLabel = ""
): Promise<LivePayload> {
  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("id, program_name, nominal_width, upper_tolerance, lower_tolerance, labels_for_each_reading")
    .eq("id", programId)
    .eq("is_active", true)
    .maybeSingle();

  if (programError) {
    throw new Error(programError.message);
  }

  if (!program) {
    throw new Error("Active program not found.");
  }

  const allLabels = programLabels(program as Program);
  const labels = readingLabel ? [readingLabel] : allLabels;
  const targetLabels = new Set(labels);
  let query = supabase
    .from("measurements")
    .select("sent_at, reading_label, reading_value, unit")
    .eq("program_id", programId)
    .order("sent_at", { ascending: false });

  if (readingLabel) {
    query = query.eq("reading_label", readingLabel);
  }

  const { data, error } = await query.limit(readingLabel ? 10 : 600);

  if (error) {
    throw new Error(error.message);
  }

  const countByLabel = new Map<string, number>();
  const rows: LiveReadingRow[] = [];

  for (const row of data ?? []) {
    const label = String(row.reading_label ?? "Reading");
    if (targetLabels.size > 0 && !targetLabels.has(label)) {
      continue;
    }

    const currentCount = countByLabel.get(label) ?? 0;
    if (currentCount >= 10) {
      continue;
    }

    const width = roundMeasurementValue(Number(row.reading_value));
    if (!Number.isFinite(width)) {
      continue;
    }

    countByLabel.set(label, currentCount + 1);
    rows.push({
      timestamp: row.sent_at,
      reading_label: label,
      width,
      unit: row.unit ?? "mm"
    });

    if (targetLabels.size > 0 && labels.every((item) => (countByLabel.get(item) ?? 0) >= 10)) {
      break;
    }
  }

  rows.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());

  const nominal = asNumber(program.nominal_width);
  const lowerTolerance = asNumber(program.lower_tolerance) ?? 0;
  const upperTolerance = asNumber(program.upper_tolerance) ?? 0;
  const lowerLimit = nominal === null ? null : roundMeasurementValue(nominal - lowerTolerance);
  const upperLimit = nominal === null ? null : roundMeasurementValue(nominal + upperTolerance);
  const observedLabels = Array.from(new Set(rows.map((row) => row.reading_label)));

  return {
    program: program as LivePayload["program"],
    lowerLimit,
    upperLimit,
    labels: labels.length > 0 ? labels : observedLabels,
    rows
  };
}
