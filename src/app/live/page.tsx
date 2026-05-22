import { LiveClient, type LiveProgramOption, type LiveStationOption } from "@/components/LiveClient";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LiveReadingRow } from "@/lib/liveData";
import type { Device, Program } from "@/lib/types";

type LivePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

function assignmentProgram(value: Program | Program[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function LivePage({ searchParams }: LivePageProps) {
  const params = await searchParams;
  const requestedProgramId = typeof params.programId === "string" ? params.programId : "";
  const requestedReadingLabel = typeof params.readingLabel === "string" ? params.readingLabel : "";
  const supabase = createAdminClient();
  const { data: stationData } = await supabase.from("devices").select("*").eq("serial_number", "1").maybeSingle();
  const station = stationData as Device | null;
  const { data: assignmentData } = station
    ? await supabase
        .from("device_program_assignments")
        .select("program:programs(*)")
        .eq("device_id", station.id)
        .eq("is_active", true)
    : { data: [] };
  const programs = ((assignmentData ?? []) as unknown as Array<{ program: Program | Program[] | null }>)
    .map((assignment) => assignmentProgram(assignment.program))
    .filter((program): program is Program => Boolean(program?.is_active))
    .map((program): LiveProgramOption => ({ ...program, stationIds: station ? [station.id] : [] }));
  const programIds = programs.map((program) => program.id);
  const { data: measurementData } =
    station && programIds.length > 0
      ? await supabase
          .from("measurements")
          .select("device_id, program_id, sent_at, reading_label, reading_value, unit")
          .eq("device_id", station.id)
          .in("program_id", programIds)
          .order("sent_at", { ascending: false })
          .limit(2000)
      : { data: [] };
  const rows = ((measurementData ?? []) as any[])
    .map((row): LiveReadingRow => ({
      device_id: row.device_id,
      program_id: row.program_id,
      timestamp: row.sent_at,
      reading_label: row.reading_label ?? "Reading",
      width: Math.round((Number(row.reading_value) + Number.EPSILON) * 100) / 100,
      unit: row.unit ?? "mm"
    }))
    .filter((row) => Number.isFinite(row.width));
  const stations: LiveStationOption[] = station
    ? [{ id: station.id, name: station.device_name || "Station 1", serialNumber: station.serial_number }]
    : [];
  const initialProgramId = programs.some((program) => program.id === requestedProgramId)
    ? requestedProgramId
    : programs[0]?.id ?? "";
  const initialProgram = programs.find((program) => program.id === initialProgramId);
  const initialReadingLabel = initialProgram?.labels_for_each_reading.includes(requestedReadingLabel)
    ? requestedReadingLabel
    : "";

  return (
    <main className="public-live-page">
      <div className="page-stack">
        <header className="page-header">
          <div>
            <p className="eyebrow">Live</p>
            <h1>Program Readings</h1>
          </div>
        </header>

        <LiveClient
          stations={stations}
          programs={programs}
          rows={rows}
          initialStationId={station?.id ?? ""}
          initialProgramId={initialProgramId}
          initialReadingLabel={initialReadingLabel}
          showStationSelect={false}
          basePath="/live"
        />
      </div>
    </main>
  );
}
