import { afterEach, describe, expect, it } from "vitest";
import type { Site } from "./site-types";
import {
  GO_LIVE_HANDOFF_KEY,
  publicationRecoveryKind,
  readGoLiveHandoff,
  recommendedDeploymentKind,
  siteExperienceState,
  siteJourney,
  writeGoLiveHandoff,
} from "./site-experience-model";

const base: Site = {
  id: "sit_1", name: "Luna", description: "", audience: "", primaryAction: "Contact", defaultLocale: "en-US",
  status: "setup", visibility: "private_preview", activePublicationId: null, settings: {}, navigation: {}, revision: 1,
  updatedAt: "2026-08-24T00:00:00.000Z", entries: [], unpublishedCount: 5, activePublication: null, deploymentTarget: null,
};

afterEach(() => window.sessionStorage.clear());

describe("site experience model", () => {
  it("keeps the ordinary journey aligned with draft, release, and public states", () => {
    expect(siteExperienceState(base)).toBe("draft");
    expect(siteJourney(base, false)).toMatchObject({ completed: 1, nextAction: "preview" });
    expect(siteJourney(base, true)).toMatchObject({ completed: 2, nextAction: "publish" });

    const local = { ...base, activePublicationId: "spb_1", activePublication: { id: "spb_1", version: 1, status: "active" as const, bundleHash: "a", createdAt: base.updatedAt, activatedAt: base.updatedAt, previousPublicationId: null, verification: { status: "healthy", checkedAt: base.updatedAt } }, unpublishedCount: 0 };
    expect(siteExperienceState(local)).toBe("local");
    expect(siteJourney(local, false)).toMatchObject({ completed: 3, nextAction: "go_live" });

    const changed = { ...local, unpublishedCount: 1 };
    expect(siteExperienceState(changed)).toBe("changes");
    expect(siteJourney(changed, true).nextAction).toBe("publish");

    const live = { ...local, visibility: "public" as const, publicUrl: "https://example.com" };
    expect(siteExperienceState(live)).toBe("public");
    expect(siteJourney(live, true)).toMatchObject({ completed: 4, nextAction: "open_site" });
  });

  it("maps publication errors to one clear recovery path", () => {
    expect(publicationRecoveryKind("site_publication_plan_stale")).toBe("retry");
    expect(publicationRecoveryKind("site_deployment_credential_unavailable")).toBe("configuration");
    expect(publicationRecoveryKind("site_deployment_healthcheck_failed")).toBe("configuration");
    expect(publicationRecoveryKind("site_deployment_ssh_fingerprint_changed")).toBe("configuration");
    expect(publicationRecoveryKind("site_deployment_recovery_failed")).toBe("manual_recovery");
  });

  it("hands ordinary go-live choices to professional settings without credentials", () => {
    const handoff = { siteId: "sit_1", audience: "mainland" as const, address: "custom" as const, assistance: "technical" as const };
    writeGoLiveHandoff(handoff);
    expect(window.sessionStorage.getItem(GO_LIVE_HANDOFF_KEY)).not.toContain("AccessKey");
    expect(readGoLiveHandoff("sit_1")).toEqual(handoff);
    expect(recommendedDeploymentKind(handoff)).toBe("aliyun_oss_cdn");
    expect(readGoLiveHandoff("sit_other")).toBeNull();
  });
});
