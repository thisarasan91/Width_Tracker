import { Download } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { updateMeasurementStatusAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  buildFilterQueryString,
  localInputToTimestamptz,
  readMeasurementFilters
} from "@/lib/measurementFilters";
import type { Device, Measurement, Program, VerificationStatus } from "@/lib/types";

type MeasurementsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MeasurementsPage({ searchParams }: MeasurementsPageProps) {
  const filters = readMeasurementFilters(await searchParams);
  const exportQuery = buildFilterQueryString(filters);
  const exportHref = exportQuery ? `/api/measurements/export?${exportQuery}` : "/api/measurements/export";
  const supabase = await createClient();

  let measurementsQuery = supabase
    .from("measurements")
    .select("*, device:devices(device_name, serial_number, loom_name), program:programs(program_name, batch_name)")
    .order("stored_at", { ascending: false });

  if (filters.deviceId) {
    measurementsQuery = measurementsQuery.eq("device_id", filters.deviceId);
  }

  if (filters.programId) {
    measurementsQuery = measurementsQuery.eq("program_id", filters.programId);
  }

  if (filters.from) {
    measurementsQuery = measurementsQuery.gte("stored_at", localInputToTimestamptz(filters.from));
  }

  if (filters.to) {
    measurementsQuery = measurementsQuery.lte("stored_at", localInputToTimestamptz(filters.to, true));
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

  return (
    <div className="page-stack">
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
          <label>
            From
            <input name="from" type="datetime-local" defaultValue={filters.from} />
          </label>
          <label>
            To
            <input name="to" type="datetime-local" defaultValue={filters.to} />
          </label>
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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stored</th>
                <th>Sent</th>
                <th>Device</th>
                <th>Program</th>
                <th>Session</th>
                <th>Reading</th>
                <th>Value</th>
                <th>Operator</th>
                <th>Status</th>
                <th>Verify</th>
              </tr>
            </thead>
            <tbody>
              {measurements.map((measurement) => (
                <tr key={measurement.id}>
                  <td>{formatDateTime(measurement.stored_at)}</td>
                  <td>{formatDateTime(measurement.sent_at)}</td>
                  <td>{measurement.device?.device_name ?? "Unknown"}</td>
                  <td>{measurement.program?.program_name ?? "Unknown"}</td>
                  <td>{measurement.measurement_session_id.slice(0, 8)}</td>
                  <td>{measurement.reading_label}</td>
                  <td>
                    {formatNumber(measurement.reading_value)} {measurement.unit}
                  </td>
                  <td>{measurement.operator_name ?? "Not set"}</td>
                  <td>
                    <StatusBadge status={measurement.cloud_verification_status} />
                  </td>
                  <td>
                    <form action={updateMeasurementStatusAction}>
                      <input type="hidden" name="measurement_id" value={measurement.id} />
                      <select
                        aria-label="Cloud verification status"
                        name="cloud_verification_status"
                        defaultValue={measurement.cloud_verification_status}
                      >
                        {(["stored", "pending", "failed"] satisfies VerificationStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                      <button className="button secondary" type="submit">
                        Save
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {measurements.length === 0 ? <p className="empty-state">No readings have been stored in Supabase yet.</p> : null}
      </section>
    </div>
  );
}
