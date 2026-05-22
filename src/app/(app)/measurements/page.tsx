import { Download } from "lucide-react";
import {
  MeasurementsFilterForm,
  type MeasurementDeviceOption,
  type MeasurementProgramOption
} from "@/components/MeasurementsFilterForm";
import { MeasurementsTableClient } from "@/components/MeasurementsTableClient";
import { MeasurementsAutoRefresh } from "@/components/MeasurementsAutoRefresh";
import { createClient } from "@/lib/supabase/server";
import {
  buildFilterQueryString,
  localInputToTimestamptz,
  readMeasurementFilters
} from "@/lib/measurementFilters";
import type { Device, Measurement, Program } from "@/lib/types";

type MeasurementsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MeasurementsPage({ searchParams }: MeasurementsPageProps) {
  const filters = readMeasurementFilters(await searchParams);
  const exportQuery = buildFilterQueryString({ ...filters, readingLabels: [], readingFilterActive: false });
  const exportHref = exportQuery ? `/api/measurements/export?${exportQuery}` : "/api/measurements/export";
  const supabase = await createClient();

  let measurementsQuery = supabase
    .from("measurements")
    .select("*, device:devices(device_name, serial_number, loom_name), program:programs(program_name, batch_name)")
    .order("sent_at", { ascending: false });

  if (filters.deviceId) {
    measurementsQuery = measurementsQuery.eq("device_id", filters.deviceId);
  }

  if (filters.programId) {
    measurementsQuery = measurementsQuery.eq("program_id", filters.programId);
  }

  if (filters.from) {
    measurementsQuery = measurementsQuery.gte("sent_at", localInputToTimestamptz(filters.from));
  }

  if (filters.to) {
    measurementsQuery = measurementsQuery.lte("sent_at", localInputToTimestamptz(filters.to, true));
  }

  const [measurementsResult, devicesResult, programsResult, assignmentsResult] = await Promise.all([
    measurementsQuery.limit(1000),
    supabase.from("devices").select("*").order("device_name"),
    supabase.from("programs").select("*").order("program_name"),
    supabase.from("device_program_assignments").select("device_id, program_id")
  ]);

  const measurements = (measurementsResult.data ?? []) as Array<
    Measurement & {
      device: {
        device_name: string;
        serial_number: string;
        loom_name: string | null;
      } | null;
      program: {
        program_name: string;
        batch_name: string | null;
      } | null;
    }
  >;
  const devices = (devicesResult.data ?? []) as Device[];
  const programs = (programsResult.data ?? []) as Program[];
  const deviceOptions: MeasurementDeviceOption[] = devices.map((device) => ({
    id: device.id,
    label: `${device.device_name}${device.loom_name ? ` (${device.loom_name})` : ""}`
  }));
  const deviceIdsByProgram = new Map<string, Set<string>>();
  for (const assignment of (assignmentsResult.data ?? []) as Array<{ device_id: string; program_id: string }>) {
    const deviceIds = deviceIdsByProgram.get(assignment.program_id) ?? new Set<string>();
    deviceIds.add(assignment.device_id);
    deviceIdsByProgram.set(assignment.program_id, deviceIds);
  }
  const programOptions: MeasurementProgramOption[] = programs.map((program) => ({
    id: program.id,
    name: program.program_name,
    deviceIds: Array.from(deviceIdsByProgram.get(program.id) ?? [])
  }));
  const measurementRows = measurements.map((measurement) => ({
    id: measurement.id,
    sent_at: measurement.sent_at,
    station: measurement.device?.device_name ?? "Unknown",
    program: measurement.program?.program_name ?? "Unknown",
    reading_label: measurement.reading_label,
    reading_value: measurement.reading_value,
    unit: measurement.unit
  }));

  return (
    <div className="page-stack">
      <MeasurementsAutoRefresh channelName="measurements-page-live-refresh" />
      <header className="page-header">
        <div>
          <p className="eyebrow">Cloud Verification</p>
          <h1>Measurements</h1>
        </div>
        <a className="button primary" href={exportHref}>
          <Download aria-hidden="true" className="icon" />
          Export CSV
        </a>
      </header>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Filters</p>
            <h2>Machine, program, and period</h2>
          </div>
        </div>
        <MeasurementsFilterForm
          devices={deviceOptions}
          programs={programOptions}
          filters={{
            deviceId: filters.deviceId,
            programId: filters.programId,
            from: filters.from,
            to: filters.to
          }}
        />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Uploaded Readings</p>
            <h2>Filtered readings</h2>
          </div>
        </div>
        <MeasurementsTableClient rows={measurementRows} />
        {measurements.length === 0 ? <p className="empty-state">No readings have been stored in Supabase yet.</p> : null}
      </section>
    </div>
  );
}
