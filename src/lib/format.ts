import type { Device, DeviceStatus, VerificationStatus } from "@/lib/types";

const OFFLINE_AFTER_MS = 5 * 60 * 1000;
export const DISPLAY_TIME_ZONE = process.env.NEXT_PUBLIC_DISPLAY_TIME_ZONE ?? "Asia/Colombo";

export function effectiveDeviceStatus(device: Pick<Device, "status" | "last_seen_at">): DeviceStatus {
  if (device.status !== "online" || !device.last_seen_at) {
    return "offline";
  }

  const lastSeen = new Date(device.last_seen_at).getTime();
  if (Number.isNaN(lastSeen)) {
    return "offline";
  }

  return Date.now() - lastSeen <= OFFLINE_AFTER_MS ? "online" : "offline";
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
    timeZoneName: "short"
  }).format(new Date(value));
}

export function formatNumber(value: string | number) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return String(value);
  }

  return numberValue.toLocaleString(undefined, {
    maximumFractionDigits: 4
  });
}

export function verificationLabel(status: VerificationStatus) {
  if (status === "stored") {
    return "Stored";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "Pending";
}
