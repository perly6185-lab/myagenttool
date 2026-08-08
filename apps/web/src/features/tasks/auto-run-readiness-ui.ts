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
  // The readiness check covers the project's agent assignment, not merely
  // agent registration. Auto-run setup is where ordinary users can choose the
  // project default and immediately re-check readiness.
  if (keys.has("agent")) return "autoRuns";
  if (keys.has("bridge")) return "devices";
  if (keys.has("git") || keys.has("project") || keys.has("verify")) return "projects";
  if (keys.has("budget")) return "economics";
  if (keys.has("killSwitch") || keys.has("breaker") || keys.has("capacity")) return "autoRuns";
  return "settings";
}
