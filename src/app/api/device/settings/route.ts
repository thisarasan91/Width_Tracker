import { NextResponse } from "next/server";
import { authenticateDeviceRequest } from "@/lib/deviceApi";
import { mergeDeviceSettings } from "@/lib/deviceSettings";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authenticateDeviceRequest(request);

  if (!auth.ok) {
    return NextResponse.json(
      {
        success: false,
        message: auth.message
      },
      { status: auth.status }
    );
  }

  const { data, error } = await auth.admin
    .from("device_settings")
    .select("device_id, edge_settings, app_settings, updated_at")
    .eq("device_id", auth.device.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        message: error.message
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    device: auth.device,
    has_settings: Boolean(data),
    settings: mergeDeviceSettings(data),
    updated_at: data?.updated_at ?? null
  });
}
