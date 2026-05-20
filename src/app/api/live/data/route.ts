import { NextResponse } from "next/server";
import { getLivePayload } from "@/lib/liveData";
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

  const programId = new URL(request.url).searchParams.get("programId")?.trim();
  const readingLabel = new URL(request.url).searchParams.get("readingLabel")?.trim() ?? "";
  if (!programId) {
    return NextResponse.json({ error: "Program is required." }, { status: 400 });
  }

  try {
    const payload = await getLivePayload(supabase, programId, readingLabel);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load live data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
