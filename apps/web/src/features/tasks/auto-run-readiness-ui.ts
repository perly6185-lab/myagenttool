import type { SectionKey } from "@/store/ui-store";

export type AutoRunReadinessCheck = {
  key: string;
  label: string;
  status: "ok" | "warn" | "blocked";
  detail: string;
};

export type AutoRunReadiness = {
  ready: boolean;
  checks: AutoRunReadinessCheck[];
};

export function readinessSetupSection(readiness: AutoRunReadiness | null): SectionKey {
  const keys = new Set((readiness?.checks ?? [])
    .filter((check) => check.status === "blocked")
    .map((check) => check.key));
  if (keys.has("agent")) return "agents";
  if (keys.has("bridge")) return "devices";
  if (keys.has("git") || keys.has("project") || keys.has("verify")) return "projects";
  if (keys.has("budget")) return "economics";
  if (keys.has("killSwitch") || keys.has("breaker") || keys.has("capacity")) return "autoRuns";
  return "settings";
}
