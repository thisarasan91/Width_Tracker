import { Download } from "lucide-react";
import { DateRangePicker } from "@/components/DateRangePicker";
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

  const [measurementsResult, devicesResult, programsResult] = await Promise.all([
    measurementsQuery.limit(1000),
    supabase.from("devices").select("*").order("device_name"),
    supabase.from("programs").select("*").order("program_name")
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
        <form className="form-grid two-column" method="get" action="/measurements">
          <label>
            Machine / Device
            <select name="device_id" defaultValue={filters.deviceId}>
              <option value="">All machines</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.device_name} {device.loom_name ? `(${device.loom_name})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Program
            <select name="program_id" defaultValue={filters.programId}>
              <option value="">All programs</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.program_name}
                </option>
              ))}
            </select>
          </label>
          <DateRangePicker from={filters.from} to={filters.to} idPrefix="measurements-date-range" />
          <div className="form-actions">
            <button className="button primary" type="submit">
              Apply filters
            </button>
            <a className="button secondary" href="/measurements">
              Clear
            </a>
          </div>
        </form>
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
