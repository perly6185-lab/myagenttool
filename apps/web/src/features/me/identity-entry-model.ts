import type { IdentityChallenge } from "@/lib/api-client";

export type IdentityEntryStage =
  | "entry"
  | "password"
  | "waiting"
  | "confirmed"
  | "expired"
  | "rejected"
  | "recovery";

export function stageForChallenge(state: IdentityChallenge["state"]): IdentityEntryStage {
  if (state === "pending") return "waiting";
  if (state === "authorized") return "confirmed";
  if (state === "expired") return "expired";
  if (["cancelled", "rejected", "failed"].includes(state)) return "rejected";
  return "confirmed";
}

export function safeAuthorizationUri(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
