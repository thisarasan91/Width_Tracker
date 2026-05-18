import { localInputToTimestamptz, type MeasurementFilters } from "@/lib/measurementFilters";

type SupabaseClientLike = {
  from: (table: string) => any;
};

export type ReportRow = {
  timestamp: string;
  width: number;
  reading_label: string;
  device_name: string;
  program_name: string;
};

export type ReportPayload = {
  title: string;
  programName: string;
  dateRange: string;
  rows: ReportRow[];
};

function formatRange(filters: MeasurementFilters) {
  if (filters.from && filters.to) {
    return `${filters.from} to ${filters.to}`;
  }
  if (filters.from) {
    return `From ${filters.from}`;
  }
  if (filters.to) {
    return `To ${filters.to}`;
  }
  return "All dates";
}

function roundMeasurementValue(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function getReportPayload(supabase: SupabaseClientLike, filters: MeasurementFilters): Promise<ReportPayload> {
  let query = supabase
    .from("measurements")
    .select("sent_at, reading_label, reading_value, device:devices(device_name), program:programs(program_name)")
    .order("sent_at", { ascending: true });

  if (filters.deviceId) {
    query = query.eq("device_id", filters.deviceId);
  }
  if (filters.programId) {
    query = query.eq("program_id", filters.programId);
  }
  if (filters.from) {
    query = query.gte("sent_at", localInputToTimestamptz(filters.from));
  }
  if (filters.to) {
    query = query.lte("sent_at", localInputToTimestamptz(filters.to, true));
  }

  const { data, error } = await query.limit(5000);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? [])
    .map((row: any) => ({
      timestamp: row.sent_at,
      width: roundMeasurementValue(Number(row.reading_value)),
      reading_label: row.reading_label ?? "",
      device_name: row.device?.device_name ?? "Unknown station",
      program_name: row.program?.program_name ?? "Unknown program"
    }))
    .filter((row: ReportRow) => Number.isFinite(row.width));

  const uniquePrograms = Array.from(new Set<string>(rows.map((row: ReportRow) => row.program_name)));
  const programName =
    uniquePrograms.length === 1
      ? uniquePrograms[0]
      : filters.programId
        ? uniquePrograms[0] ?? "Selected program"
        : "Multiple programs";
  const dateRange = formatRange(filters);

  return {
    title: `${programName} | ${dateRange}`,
    programName,
    dateRange,
    rows
  };
}
