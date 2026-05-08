import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ProgramForm } from "@/components/ProgramForm";
import { StatusBadge } from "@/components/StatusBadge";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import type { Program } from "@/lib/types";

export default async function ProgramsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("programs").select("*").order("created_at", { ascending: false });
  const programs = (data ?? []) as Program[];

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Measurement Tasks</p>
          <h1>Programs</h1>
        </div>
      </header>

      <ProgramForm />

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Program Library</p>
            <h2>All programs</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Program</th>
                <th>Batch</th>
                <th>EDR</th>
                <th>Required readings</th>
                <th>Nominal</th>
                <th>Status</th>
                <th>Created</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {programs.map((program) => (
                <tr key={program.id}>
                  <td>{program.program_name}</td>
                  <td>{program.batch_name ?? "Not set"}</td>
                  <td>{program.elastic_development_reference ?? "Not set"}</td>
                  <td>{program.required_data_points_per_measurement}</td>
                  <td>{program.nominal_width ?? "Not set"}</td>
                  <td>
                    <StatusBadge status={program.is_active ? "active" : "inactive"} />
                  </td>
                  <td>{formatDateTime(program.created_at)}</td>
                  <td>
                    <Link className="button secondary" href={`/programs/${program.id}`}>
                      Edit
                      <ArrowRight aria-hidden="true" className="icon" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {programs.length === 0 ? <p className="empty-state">Create a program with the exact labels the Pi should display.</p> : null}
      </section>
    </div>
  );
}
