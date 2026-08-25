import { NextResponse } from "next/server";
import { authenticateDeviceRequest } from "@/lib/deviceApi";
import { cleanSettingsObject, mergeDeviceSettings } from "@/lib/deviceSettings";

export const runtime = "nodejs";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function settingsPatch(body: Record<string, unknown>, key: "edge_settings" | "app_settings") {
  if (!(key in body)) {
    return {};
  }

  const value = body[key];
  if (!isJsonObject(value)) {
    throw new Error(`${key} must be a JSON object.`);
  }

  return value;
}

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

export async function PATCH(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid JSON body."
      },
      { status: 400 }
    );
  }

  if (!isJsonObject(body)) {
    return NextResponse.json(
      {
        success: false,
        message: "Settings update body must be a JSON object."
      },
      { status: 400 }
    );
  }

  let edgeSettingsPatch: Record<string, unknown>;
  let appSettingsPatch: Record<string, unknown>;
  try {
    edgeSettingsPatch = settingsPatch(body, "edge_settings");
    appSettingsPatch = settingsPatch(body, "app_settings");
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Invalid settings payload."
      },
      { status: 400 }
    );
  }

  if (!Object.keys(edgeSettingsPatch).length && !Object.keys(appSettingsPatch).length) {
    return NextResponse.json(
      {
        success: false,
        message: "Provide edge_settings or app_settings to update."
      },
      { status: 400 }
    );
  }

  const { data: existingSettings, error: existingError } = await auth.admin
    .from("device_settings")
    .select("edge_settings, app_settings")
    .eq("device_id", auth.device.id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json(
      {
        success: false,
        message: existingError.message
      },
      { status: 500 }
    );
  }

  const edgeSettings = {
    ...cleanSettingsObject(existingSettings?.edge_settings),
    ...edgeSettingsPatch
  };
  const appSettings = {
    ...cleanSettingsObject(existingSettings?.app_settings),
    ...appSettingsPatch
  };

  const { data, error } = await auth.admin
    .from("device_settings")
    .upsert(
      {
        device_id: auth.device.id,
        edge_settings: edgeSettings,
        app_settings: appSettings
      },
      {
        onConflict: "device_id"
      }
    )
    .select("device_id, edge_settings, app_settings, updated_at")
    .single();

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
    settings: mergeDeviceSettings(data),
    updated_at: data.updated_at
  });
}
