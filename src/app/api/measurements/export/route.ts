import { NextResponse } from "next/server";
import { measurementsToCsv } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";
import type { Measurement } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("measurements")
    .select(
      "*, device:devices(device_name, serial_number, loom_name), program:programs(program_name, batch_name, elastic_development_reference)"
    )
    .order("stored_at", { ascending: false })
    .limit(10000);

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
