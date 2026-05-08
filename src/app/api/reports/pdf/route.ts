import { NextResponse } from "next/server";
import { readMeasurementFilters } from "@/lib/measurementFilters";
import { reportPayloadToPdf } from "@/lib/reportPdf";
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
    const pdf = reportPayloadToPdf(payload);
    return new NextResponse(pdf, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="tb-meter-report-${new Date().toISOString().slice(0, 10)}.pdf"`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not export PDF.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
