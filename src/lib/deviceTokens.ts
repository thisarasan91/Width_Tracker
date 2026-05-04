import "server-only";

import { createHash, randomBytes } from "node:crypto";

export function generateDeviceToken() {
  return `wtk_${randomBytes(32).toString("base64url")}`;
}

export function hashDeviceToken(token: string) {
  const pepper = process.env.DEVICE_TOKEN_PEPPER ?? "";
  return createHash("sha256").update(`${pepper}:${token}`).digest("hex");
}
