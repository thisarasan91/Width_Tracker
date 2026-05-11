import { notFound } from "next/navigation";
import Link from "next/link";
import { XCircle } from "lucide-react";
import { AssignmentForm } from "@/components/AssignmentForm";
import { DeviceForm } from "@/components/DeviceForm";
import { RotateTokenForm } from "@/components/RotateTokenForm";
import { StatusBadge } from "@/components/StatusBadge";
import { deactivateAssignmentAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { effectiveDeviceStatus, formatDateTime, formatNumber } from "@/lib/format";
import type { Device, Measurement, Program } from "@/lib/types";

type DeviceDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function DeviceDetailPage({ params }: DeviceDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const [deviceResult, assignmentsResult, programsResult, measurementsResult] = await Promise.all([
    supabase.from("devices").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("device_program_assignments")
      .select("*, program:programs(*)")
      .eq("device_id", id)
      .eq("is_active", true)
      .order("assigned_at", { ascending: false }),
    supabase.from("programs").select("*").eq("is_active", true).order("program_name"),
    supabase
      .from("measurements")
      .select("*, program:programs(program_name)")
      .eq("device_id", id)
      .order("stored_at", { ascending: false })
      .limit(50)
  ]);

  if (!deviceResult.data) {
    notFound();
  }

  const device = deviceResult.data as Device;
  const stationNumber =
    device.device_name.match(/\d+/)?.[0] ?? device.serial_number.match(/\d+/)?.[0] ?? device.serial_number;
  const assignments = (
    (assignmentsResult.data ?? []) as Array<{
      id: string;
      assigned_at: string;
      is_active: boolean;
      program_id: string;
      program: Program | null;
    }>
  ).filter((assignment) => assignment.is_active && assignment.program?.is_active);
  const programs = (programsResult.data ?? []) as Program[];
  const measurements = (measurementsResult.data ?? []) as Array<
    Measurement & {
      program: { program_name: string } | null;
    }
  >;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Device</p>
          <h1>{device.device_name}</h1>
        </div>
        <StatusBadge status={effectiveDeviceStatus(device)} />
      </header>

      <section className="panel">
        <dl className="detail-list">
          <div>
            <dt>Serial number</dt>
            <dd>{device.serial_number}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{device.location ?? "Not set"}</dd>
          </div>
          <div>
            <dt>Loom</dt>
            <dd>{device.loom_name ?? "Not set"}</dd>
          </div>
          <div>
            <dt>Last seen</dt>
            <dd>{formatDateTime(device.last_seen_at)}</dd>
          </div>
        </dl>
      </section>

      <DeviceForm device={device} />
      <RotateTokenForm deviceId={device.id} />
      <AssignmentForm deviceId={device.id} programs={programs} />

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Assigned Programs</p>
            <h2>Programs available to Station #{stationNumber}</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Program</th>
                <th>Readings</th>
                <th>Assigned</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td>
                    {assignment.program ? (
                      <Link href={`/programs/${assignment.program.id}`}>{assignment.program.program_name}</Link>
                    ) : (
                      "Unknown"
                    )}
                  </td>
                  <td>{assignment.program?.required_data_points_per_measurement ?? "-"}</td>
                  <td>{formatDateTime(assignment.assigned_at)}</td>
                  <td>
                    <form action={deactivateAssignmentAction}>
                      <input type="hidden" name="assignment_id" value={assignment.id} />
                      <input type="hidden" name="device_id" value={device.id} />
                      <button className="button danger" type="submit">
                        <XCircle aria-hidden="true" className="icon" />
                        Deactivate
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {assignments.length === 0 ? <p className="empty-state">No active programs are assigned to this device yet.</p> : null}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent Measurements</p>
            <h2>Last 50 readings</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stored</th>
                <th>Program</th>
                <th>Session</th>
                <th>Reading</th>
                <th>Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {measurements.map((measurement) => (
                <tr key={measurement.id}>
                  <td>{formatDateTime(measurement.stored_at)}</td>
                  <td>{measurement.program?.program_name ?? "Unknown"}</td>
                  <td>{measurement.measurement_session_id.slice(0, 8)}</td>
                  <td>{measurement.reading_label}</td>
                  <td>
                    {formatNumber(measurement.reading_value)} {measurement.unit}
                  </td>
                  <td>
                    <StatusBadge status={measurement.cloud_verification_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {measurements.length === 0 ? <p className="empty-state">This device has not uploaded measurements yet.</p> : null}
      </section>
    </div>
  );
}
