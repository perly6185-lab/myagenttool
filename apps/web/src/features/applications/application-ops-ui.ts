import type { ApplicationSnapshot } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";

// Pure helpers for the applications ops UI (auto-recovery / health probe):
// confirm-dialog copy derived from the application's ACTUAL config — never a
// hard-coded default that goes stale the moment the API changed a value — and
// the list-card badge set.

export const AUTO_RECOVERY_DEFAULT_MAX_ATTEMPTS = 2;
export const HEALTH_PROBE_DEFAULT_INTERVAL_MINUTES = 5;

export function autoRecoveryMaxAttempts(app: ApplicationSnapshot): number {
  return app.autoRecovery?.maxAttempts ?? AUTO_RECOVERY_DEFAULT_MAX_ATTEMPTS;
}

export function healthProbeIntervalMinutes(app: ApplicationSnapshot): number {
  return app.healthProbe?.intervalMinutes ?? HEALTH_PROBE_DEFAULT_INTERVAL_MINUTES;
}

export interface ConfirmCopy {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
}

export function autoRecoveryConfirmCopy(app: ApplicationSnapshot, next: { enabled: boolean; maxAttempts?: number }): ConfirmCopy {
  if (!next.enabled) {
    return {
      title: `Disable auto-recovery for "${app.name}"?`,
      description: "Failed orchestration runs will wait for a human recovery decision again.",
      confirmLabel: "Disable auto-recovery",
      destructive: false,
    };
  }
  const attempts = next.maxAttempts ?? autoRecoveryMaxAttempts(app);
  return {
    title: app.autoRecovery?.enabled ? `Change auto-recovery cap for "${app.name}"?` : `Enable auto-recovery for "${app.name}"?`,
    description: `Failed orchestration runs (runtime error / dispatch timeout) auto-rerun, capped at ${attempts} consecutive attempt(s) per routine. Approval-gated recoveries always wait for a human.`,
    confirmLabel: app.autoRecovery?.enabled ? `Set cap to ${attempts}` : "Enable auto-recovery",
    destructive: !app.autoRecovery?.enabled,
  };
}

export function healthProbeConfirmCopy(app: ApplicationSnapshot, next: { enabled: boolean; intervalMinutes?: number }): ConfirmCopy {
  if (!next.enabled) {
    return {
      title: `Disable health probe for "${app.name}"?`,
      description: "The source will no longer be checked periodically.",
      confirmLabel: "Disable health probe",
      destructive: false,
    };
  }
  const interval = next.intervalMinutes ?? healthProbeIntervalMinutes(app);
  return {
    title: app.healthProbe?.enabled ? `Change health-probe interval for "${app.name}"?` : `Enable health probe for "${app.name}"?`,
    description: `Checks source availability every ${interval} minute(s). After 2 consecutive failures an active application is taken offline automatically; bringing it back online always needs a human.`,
    confirmLabel: app.healthProbe?.enabled ? `Set interval to ${interval}m` : "Enable health probe",
    destructive: !app.healthProbe?.enabled,
  };
}

/** Ops badges for the list card: health verdict + which autonomy is on. */
export function applicationOpsBadges(app: ApplicationSnapshot): { label: string; tone: Tone }[] {
  const badges: { label: string; tone: Tone }[] = [];
  if (app.health?.status) {
    badges.push({
      label: `health ${app.health.status}`,
      tone: app.health.status === "healthy" ? "success" : app.health.status === "unhealthy" ? "danger" : "neutral",
    });
  }
  if (app.autoRecovery?.enabled) badges.push({ label: "auto-recovery", tone: "warning" });
  if (app.healthProbe?.enabled) badges.push({ label: "health probe", tone: "warning" });
  return badges;
}
