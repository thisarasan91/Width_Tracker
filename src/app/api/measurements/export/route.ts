import { NextResponse } from "next/server";
import { measurementsToCsv } from "@/lib/csv";
import { localInputToTimestamptz, readMeasurementFilters } from "@/lib/measurementFilters";
import { createClient } from "@/lib/supabase/server";
import type { Measurement } from "@/lib/types";

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

  const searchParams = Object.fromEntries(new URL(request.url).searchParams.entries());
  const filters = readMeasurementFilters(searchParams);

  let query = supabase
    .from("measurements")
    .select(
      "*, device:devices(device_name, serial_number, loom_name), program:programs(program_name, batch_name, elastic_development_reference)"
    )
    .order("sent_at", { ascending: false });

  if (filters.deviceId) {
    query = query.eq("device_id", filters.deviceId);
  }

  if (filters.programId) {
    query = query.eq("program_id", filters.programId);
  }

  if (filters.from) {
    query = query.gte("sent_at", localInputToTimestamptz(filters.from));
  }

  if (filters.to) {
    query = query.lte("sent_at", localInputToTimestamptz(filters.to, true));
  }

  const { data, error } = await query.limit(10000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const csv = measurementsToCsv((data ?? []) as Measurement[]);
  const timestamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="width-measurements-${timestamp}.csv"`
    }
  });
}
