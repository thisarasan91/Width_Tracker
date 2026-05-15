import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MeasurementsAutoRefresh } from "@/components/MeasurementsAutoRefresh";
import { StatusBadge } from "@/components/StatusBadge";
import { createClient } from "@/lib/supabase/server";
import { effectiveDeviceStatus, formatCompactDateTime, formatDateTime, formatNumber } from "@/lib/format";
import type { Device, Measurement, Program } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const [devicesResult, programsResult, assignmentsResult, measurementsResult] = await Promise.all([
    supabase.from("devices").select("*").order("device_name"),
    supabase.from("programs").select("*").order("created_at", { ascending: false }),
    supabase.from("device_program_assignments").select("id,is_active"),
    supabase
      .from("measurements")
      .select("*, device:devices(device_name, serial_number), program:programs(program_name)")
      .order("sent_at", { ascending: false })
      .limit(8)
  ]);

  const devices = (devicesResult.data ?? []) as Device[];
  const programs = (programsResult.data ?? []) as Program[];
  const assignments = assignmentsResult.data ?? [];
  const measurements = (measurementsResult.data ?? []) as Array<
    Measurement & {
      device: { device_name: string; serial_number: string } | null;
      program: { program_name: string } | null;
    }
  >;

  const onlineDevices = devices.filter((device) => effectiveDeviceStatus(device) === "online").length;
  const activePrograms = programs.filter((program) => program.is_active).length;
  const activeAssignments = assignments.filter((assignment) => assignment.is_active).length;
  const storedReadings = measurements.filter((measurement) => measurement.cloud_verification_status === "stored").length;

  return (
    <div className="page-stack">
      <MeasurementsAutoRefresh channelName="dashboard-measurements-live-refresh" />
      <header className="page-header">
        <div>
          <p className="eyebrow">Factory Overview</p>
          <h1>Dashboard</h1>
        </div>
      </header>

      <section className="grid metric-grid" aria-label="Dashboard metrics">
        <div className="metric-card">
          <span>Devices online</span>
          <strong>
            {onlineDevices}/{devices.length}
          </strong>
        </div>
        <div className="metric-card">
          <span>Active programs</span>
          <strong>{activePrograms}</strong>
        </div>
        <div className="metric-card">
          <span>Active assignments</span>
          <strong>{activeAssignments}</strong>
        </div>
        <div className="metric-card">
          <span>Stored readings shown</span>
          <strong>{storedReadings}</strong>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Connected Devices</p>
            <h2>Device status</h2>
          </div>
          <Link className="button secondary" href="/devices">
            Manage devices
            <ArrowRight aria-hidden="true" className="icon" />
          </Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>Status</th>
                <th>Serial</th>
                <th>Loom</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td>
                    <Link href={`/devices/${device.id}`}>{device.device_name}</Link>
                  </td>
                  <td>
                    <StatusBadge status={effectiveDeviceStatus(device)} />
                  </td>
                  <td>{device.serial_number}</td>
                  <td>{device.loom_name ?? "Not set"}</td>
                  <td>{formatDateTime(device.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {devices.length === 0 ? <p className="empty-state">No devices have been registered yet.</p> : null}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent Uploads</p>
            <h2>Measurement readings</h2>
          </div>
          <Link className="button secondary" href="/measurements">
            View all
            <ArrowRight aria-hidden="true" className="icon" />
          </Link>
        </div>
        <div className="table-wrap report-table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>Station</th>
                <th>Programme</th>
                <th>Reading</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {measurements.map((measurement) => (
                <tr key={measurement.id}>
                  <td>{formatCompactDateTime(measurement.sent_at)}</td>
                  <td>{measurement.device?.device_name ?? "Unknown"}</td>
                  <td>{measurement.program?.program_name ?? "Unknown"}</td>
                  <td>{measurement.reading_label}</td>
                  <td>
                    {formatNumber(measurement.reading_value)} {measurement.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {measurements.length === 0 ? <p className="empty-state">No measurements have been uploaded yet.</p> : null}
      </section>
    </div>
  );
}
