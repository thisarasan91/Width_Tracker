import { LiveClient, type LiveProgramOption, type LiveStationOption } from "@/components/LiveClient";
import type { LiveReadingRow } from "@/lib/liveData";
import { createClient } from "@/lib/supabase/server";
import type { Device, Program } from "@/lib/types";

type LiveMonitorPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

function assignmentProgram(value: Program | Program[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function LiveMonitorPage({ searchParams }: LiveMonitorPageProps) {
  const params = await searchParams;
  const requestedStationId = typeof params.stationId === "string" ? params.stationId : "";
  const requestedProgramId = typeof params.programId === "string" ? params.programId : "";
  const requestedReadingLabel = typeof params.readingLabel === "string" ? params.readingLabel : "";
  const supabase = await createClient();

  const [devicesResult, assignmentsResult, measurementsResult] = await Promise.all([
    supabase.from("devices").select("*").order("device_name"),
    supabase.from("device_program_assignments").select("device_id, program:programs(*)").eq("is_active", true),
    supabase
      .from("measurements")
      .select("device_id, program_id, sent_at, reading_label, reading_value, unit")
      .order("sent_at", { ascending: false })
      .limit(5000)
  ]);

  const devices = (devicesResult.data ?? []) as Device[];
  const stations: LiveStationOption[] = devices.map((device) => ({
    id: device.id,
    name: `${device.device_name}${device.loom_name ? ` (${device.loom_name})` : ""}`,
    serialNumber: device.serial_number
  }));
  const programById = new Map<string, LiveProgramOption>();
  for (const assignment of (assignmentsResult.data ?? []) as unknown as Array<{ device_id: string; program: Program | Program[] | null }>) {
    const program = assignmentProgram(assignment.program);
    if (!program?.is_active) {
      continue;
    }
    const existing = programById.get(program.id);
    if (existing) {
      existing.stationIds.push(assignment.device_id);
    } else {
      programById.set(program.id, { ...program, stationIds: [assignment.device_id] });
    }
  }
  const programs = Array.from(programById.values()).sort((left, right) => left.program_name.localeCompare(right.program_name));
  const rows = ((measurementsResult.data ?? []) as any[])
    .map((row): LiveReadingRow => ({
      device_id: row.device_id,
      program_id: row.program_id,
      timestamp: row.sent_at,
      reading_label: row.reading_label ?? "Reading",
      width: Math.round((Number(row.reading_value) + Number.EPSILON) * 100) / 100,
      unit: row.unit ?? "mm"
    }))
    .filter((row) => Number.isFinite(row.width));
  const initialStationId = stations.some((station) => station.id === requestedStationId)
    ? requestedStationId
    : stations[0]?.id ?? "";
  const availablePrograms = programs.filter((program) => !initialStationId || program.stationIds.includes(initialStationId));
  const initialProgramId = availablePrograms.some((program) => program.id === requestedProgramId)
    ? requestedProgramId
    : availablePrograms[0]?.id ?? "";
  const initialProgram = programs.find((program) => program.id === initialProgramId);
  const initialReadingLabel = initialProgram?.labels_for_each_reading.includes(requestedReadingLabel)
    ? requestedReadingLabel
    : "";

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Live</p>
          <h1>Station Readings</h1>
        </div>
      </header>

      <LiveClient
        stations={stations}
        programs={programs}
        rows={rows}
        initialStationId={initialStationId}
        initialProgramId={initialProgramId}
        initialReadingLabel={initialReadingLabel}
        showStationSelect
        basePath="/live-monitor"
      />
    </div>
  );
}
