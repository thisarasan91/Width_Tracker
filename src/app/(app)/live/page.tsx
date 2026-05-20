import { LiveClient } from "@/components/LiveClient";
import { createClient } from "@/lib/supabase/server";
import type { Program } from "@/lib/types";

type LivePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LivePage({ searchParams }: LivePageProps) {
  const params = await searchParams;
  const requestedProgramId = typeof params.programId === "string" ? params.programId : "";
  const requestedReadingLabel = typeof params.readingLabel === "string" ? params.readingLabel : "";
  const supabase = await createClient();
  const { data } = await supabase.from("programs").select("*").eq("is_active", true).order("program_name");
  const programs = (data ?? []) as Program[];
  const initialProgramId = programs.some((program) => program.id === requestedProgramId)
    ? requestedProgramId
    : programs[0]?.id ?? "";
  const initialProgram = programs.find((program) => program.id === initialProgramId);
  const initialReadingLabel = initialProgram?.labels_for_each_reading.includes(requestedReadingLabel)
    ? requestedReadingLabel
    : "";

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Live</p>
          <h1>Program Readings</h1>
        </div>
      </header>

      <LiveClient programs={programs} initialProgramId={initialProgramId} initialReadingLabel={initialReadingLabel} />
    </div>
  );
}
