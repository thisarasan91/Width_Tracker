import { Download } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { updateMeasurementStatusAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { Measurement, VerificationStatus } from "@/lib/types";

export default async function MeasurementsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("measurements")
    .select("*, device:devices(device_name, serial_number, loom_name), program:programs(program_name, batch_name)")
    .order("stored_at", { ascending: false })
    .limit(1000);

  const measurements = (data ?? []) as Array<
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

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Cloud Verification</p>
          <h1>Measurements</h1>
        </div>
        <a className="button primary" href="/api/measurements/export">
          <Download aria-hidden="true" className="icon" />
          Export CSV
        </a>
      </header>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Uploaded Readings</p>
            <h2>Latest 1,000 readings</h2>
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
