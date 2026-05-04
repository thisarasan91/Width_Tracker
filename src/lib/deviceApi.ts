import { createAdminClient } from "@/lib/supabase/admin";
import { hashDeviceToken } from "@/lib/deviceTokens";
import type { Device } from "@/lib/types";

export type DeviceApiAuthResult =
  | {
      ok: true;
      admin: ReturnType<typeof createAdminClient>;
      device: Device;
      tokenId: string;
    }
  | {
      ok: false;
      status: number;
      message: string;
    };

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || request.headers.get("x-device-token")?.trim() || "";
}

export async function authenticateDeviceRequest(request: Request): Promise<DeviceApiAuthResult> {
  const rawToken = getBearerToken(request);

  if (!rawToken) {
    return {
      ok: false,
      status: 401,
      message: "Missing device token."
    };
  }

  const admin = createAdminClient();
  const tokenHash = hashDeviceToken(rawToken);

  const { data: tokenRow, error: tokenError } = await admin
    .from("device_api_tokens")
    .select("id, device_id")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (tokenError) {
    return {
      ok: false,
      status: 500,
      message: tokenError.message
    };
  }

  if (!tokenRow) {
    return {
      ok: false,
      status: 401,
      message: "Invalid or revoked device token."
    };
  }

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .select("*")
    .eq("id", tokenRow.device_id)
    .maybeSingle();

  if (deviceError) {
    return {
      ok: false,
      status: 500,
      message: deviceError.message
    };
  }

  if (!device) {
    return {
      ok: false,
      status: 401,
      message: "Device not found."
    };
  }

  const now = new Date().toISOString();
  await Promise.all([
    admin.from("device_api_tokens").update({ last_used_at: now }).eq("id", tokenRow.id),
    admin.from("devices").update({ status: "online", last_seen_at: now }).eq("id", device.id)
  ]);

  return {
    ok: true,
    admin,
    device: {
      ...(device as Device),
      status: "online",
      last_seen_at: now
    },
    tokenId: tokenRow.id
  };
}
