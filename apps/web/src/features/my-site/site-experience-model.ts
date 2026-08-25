import type { Site } from "./site-types";

export type SiteExperienceState = "draft" | "changes" | "local" | "public";
export type SiteJourneyAction = "preview" | "publish" | "go_live" | "open_site";
export type PublicationRecoveryKind = "retry" | "configuration" | "manual_recovery";

export interface GoLiveHandoff {
  siteId: string;
  audience: "global" | "mainland";
  address: "platform" | "custom";
  assistance: "self" | "technical";
}

export function siteExperienceState(site: Site): SiteExperienceState {
  const publiclyReachable = site.visibility === "public" && Boolean(site.publicUrl);
  if (site.unpublishedCount > 0 && site.activePublication) return "changes";
  if (publiclyReachable) return "public";
  if (site.activePublication) return "local";
  return "draft";
}

export function siteJourney(site: Site, previewSeen: boolean) {
  const hasRelease = Boolean(site.activePublication);
  const publiclyReachable = site.visibility === "public" && Boolean(site.publicUrl);
  const previewComplete = previewSeen || hasRelease;
  const publishComplete = hasRelease && site.unpublishedCount === 0;
  const steps = {
    content: true,
    preview: previewComplete,
    publish: publishComplete,
    online: publiclyReachable,
  };
  const nextAction: SiteJourneyAction = !previewComplete
    ? "preview"
    : !publishComplete
      ? "publish"
      : !publiclyReachable
        ? "go_live"
        : "open_site";
  return { steps, nextAction, completed: Object.values(steps).filter(Boolean).length, total: 4 };
}

const CONFIGURATION_ERRORS = new Set([
  "site_deployment_target_not_ready",
  "site_deployment_credential_unavailable",
  "site_deployment_region_required",
  "site_deployment_domain_required",
  "site_deployment_verification_failed",
  "site_deployment_ssh_scope_not_found",
  "site_deployment_ssh_scope_not_ready",
  "site_deployment_ssh_host_not_ready",
  "site_deployment_ssh_atomic_capability_required",
  "site_deployment_ssh_fingerprint_changed",
  "site_deployment_ssh_credential_unavailable",
  "site_deployment_healthcheck_failed",
  "site_deployment_content_mismatch",
]);

export function publicationRecoveryKind(code: string | null | undefined): PublicationRecoveryKind {
  if (code === "site_deployment_recovery_failed") return "manual_recovery";
  if (code && CONFIGURATION_ERRORS.has(code)) return "configuration";
  return "retry";
}

export const GO_LIVE_HANDOFF_KEY = "myagenttool-site-go-live-handoff";

export function recommendedDeploymentKind(handoff: GoLiveHandoff | null) {
  return handoff?.audience === "mainland" ? "aliyun_oss_cdn" as const : handoff ? "cloudflare_pages" as const : null;
}

export function readGoLiveHandoff(siteId: string): GoLiveHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(GO_LIVE_HANDOFF_KEY) ?? "null") as Partial<GoLiveHandoff> | null;
    if (!value || value.siteId !== siteId || !["global", "mainland"].includes(String(value.audience))
      || !["platform", "custom"].includes(String(value.address)) || !["self", "technical"].includes(String(value.assistance))) return null;
    return value as GoLiveHandoff;
  } catch {
    return null;
  }
}

export function writeGoLiveHandoff(handoff: GoLiveHandoff) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(GO_LIVE_HANDOFF_KEY, JSON.stringify(handoff));
  } catch {
    // The handoff only improves navigation; publishing never depends on browser storage.
  }
}

export function clearGoLiveHandoff() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(GO_LIVE_HANDOFF_KEY);
  } catch {
    // Ignore unavailable session storage.
  }
}
