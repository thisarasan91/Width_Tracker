import { ReportClient } from "@/components/ReportClient";
import { createClient } from "@/lib/supabase/server";
import { readMeasurementFilters } from "@/lib/measurementFilters";
import type { Device, Program } from "@/lib/types";

type ReportsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const filters = readMeasurementFilters(await searchParams);
  const supabase = await createClient();
  const [devicesResult, programsResult] = await Promise.all([
    supabase.from("devices").select("*").order("device_name"),
    supabase.from("programs").select("*").order("program_name")
  ]);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>Width vs Time</h1>
        </div>
      </header>

      <ReportClient
        devices={(devicesResult.data ?? []) as Device[]}
        programs={(programsResult.data ?? []) as Program[]}
        initialFilters={filters}
      />
    </div>
  );
}
