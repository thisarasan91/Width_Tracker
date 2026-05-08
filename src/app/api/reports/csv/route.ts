import { NextResponse } from "next/server";
import { readMeasurementFilters } from "@/lib/measurementFilters";
import { reportPayloadToCsv } from "@/lib/reportCsv";
import { getReportPayload } from "@/lib/reportData";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filters = readMeasurementFilters(Object.fromEntries(new URL(request.url).searchParams.entries()));

  try {
    const payload = await getReportPayload(supabase, filters);
    const csv = reportPayloadToCsv(payload);
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="tb-meter-report-${new Date().toISOString().slice(0, 10)}.csv"`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not export CSV.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
