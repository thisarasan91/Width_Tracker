import type { DeviceStatus, VerificationStatus } from "@/lib/types";
import { verificationLabel } from "@/lib/format";

type StatusBadgeProps = {
  status: DeviceStatus | VerificationStatus | "active" | "inactive";
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const label =
    status === "online"
      ? "Online"
      : status === "offline"
        ? "Offline"
        : status === "active"
          ? "Active"
          : status === "inactive"
            ? "Inactive"
            : verificationLabel(status);

  return <span className={`status-badge ${status}`}>{label}</span>;
}
