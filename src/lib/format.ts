import type { Device, DeviceStatus, VerificationStatus } from "@/lib/types";

const OFFLINE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_DISPLAY_TIME_ZONE = "Asia/Colombo";

export function getDisplayTimeZone() {
  const configuredTimeZone = process.env.NEXT_PUBLIC_DISPLAY_TIME_ZONE?.trim() || DEFAULT_DISPLAY_TIME_ZONE;

  try {
    new Intl.DateTimeFormat("en", { timeZone: configuredTimeZone }).format(new Date());
    return configuredTimeZone;
  } catch {
    return DEFAULT_DISPLAY_TIME_ZONE;
  }
}

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
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: getDisplayTimeZone(),
    timeZoneName: "short"
  }).format(new Date(value));
}

export function formatCompactDateTime(value: string | null | undefined) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: getDisplayTimeZone()
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
