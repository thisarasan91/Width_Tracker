import { notFound } from "next/navigation";
import { ProgramForm } from "@/components/ProgramForm";
import { StatusBadge } from "@/components/StatusBadge";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import type { Program } from "@/lib/types";

type ProgramDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ProgramDetailPage({ params }: ProgramDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const [programResult, assignmentsResult] = await Promise.all([
    supabase.from("programs").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("device_program_assignments")
      .select("*, device:devices(device_name, serial_number, loom_name)")
      .eq("program_id", id)
      .order("assigned_at", { ascending: false })
  ]);

  if (!programResult.data) {
    notFound();
  }

  const program = programResult.data as Program;
  const assignments = (assignmentsResult.data ?? []) as Array<{
    id: string;
    assigned_at: string;
    is_active: boolean;
    device: {
      device_name: string;
      serial_number: string;
      loom_name: string | null;
    } | null;
  }>;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Program</p>
          <h1>{program.program_name}</h1>
        </div>
        <StatusBadge status={program.is_active ? "active" : "inactive"} />
      </header>

      <section className="panel">
        <dl className="detail-list">
          <div>
            <dt>Batch</dt>
            <dd>{program.batch_name ?? "Not set"}</dd>
          </div>
          <div>
            <dt>EDR</dt>
            <dd>{program.elastic_development_reference ?? "Not set"}</dd>
          </div>
          <div>
            <dt>Required readings</dt>
            <dd>{program.required_data_points_per_measurement}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDateTime(program.created_at)}</dd>
          </div>
        </dl>
      </section>

      <ProgramForm program={program} />

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Pi Display Sequence</p>
            <h2>Reading labels</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Step</th>
                <th>Label shown on Pi</th>
              </tr>
            </thead>
            <tbody>
              {program.labels_for_each_reading.map((label, index) => (
                <tr key={`${label}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Assignments</p>
            <h2>Devices using this program</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>Serial</th>
                <th>Loom</th>
                <th>Assigned</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td>{assignment.device?.device_name ?? "Unknown"}</td>
                  <td>{assignment.device?.serial_number ?? "Unknown"}</td>
                  <td>{assignment.device?.loom_name ?? "Not set"}</td>
                  <td>{formatDateTime(assignment.assigned_at)}</td>
                  <td>
                    <StatusBadge status={assignment.is_active ? "active" : "inactive"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {assignments.length === 0 ? <p className="empty-state">No devices are assigned to this program yet.</p> : null}
      </section>
    </div>
  );
}
