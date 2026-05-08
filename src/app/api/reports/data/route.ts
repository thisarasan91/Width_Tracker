import { NextResponse } from "next/server";
import { readMeasurementFilters } from "@/lib/measurementFilters";
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
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load report data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
