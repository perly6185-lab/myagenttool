import { describe, expect, it } from "vitest";
import {
  applicationMatchesSearch,
  applicationNextStep,
  applicationTriageBucket,
  applicationTriageCounts,
  latestApplicationRecoveryAction,
  sortApplicationsForTriage,
  sourceSummary,
} from "@/features/applications/application-health";
import type { ApplicationRecoveryActionRequest, ApplicationSnapshot } from "@/lib/console-state";

describe("sourceSummary", () => {
  it("summarizes each application source type", () => {
    expect(sourceSummary({ type: "git", url: "github.com/acme/web" })).toBe("github.com/acme/web");
    expect(sourceSummary({ type: "local", path: "/path/to/app" })).toBe("/path/to/app");
    expect(sourceSummary({ type: "npm", package: "@scope/pkg", version: "1.0.0" })).toBe("@scope/pkg@1.0.0");
    expect(sourceSummary({ type: "npm", package: "left-pad" })).toBe("left-pad");
    expect(sourceSummary({ type: "manual", uri: "https://example.com" })).toBe("https://example.com");
    expect(sourceSummary({ type: "manual" })).toBe("manual manifest");
  });
});

describe("applicationNextStep", () => {
  it("prioritizes actionable application guidance", () => {
    expect(applicationNextStep(application({ status: "failed", lifecycle: { error: "Clone failed." } })).title).toBe("Needs attention");
    expect(applicationNextStep(application({ status: "active", probe: null })).title).toBe("Probe recommended");
    expect(applicationNextStep(application({
      status: "active",
      probe: { warnings: ["README not readable."], capabilities: [] },
    })).detail).toBe("README not readable.");
    expect(applicationNextStep(application({
      status: "active",
      probe: { capabilities: [] },
      orchestrationIds: ["routine"],
    })).title).toBe("Ready");
  });
});

describe("application triage", () => {
  it("buckets applications by their current operator next step", () => {
    expect(applicationTriageBucket(application({ status: "failed" }))).toBe("attention");
    expect(applicationTriageBucket(application({ status: "active", probe: null }))).toBe("warning");
    expect(applicationTriageBucket(application({
      status: "active",
      probe: { capabilities: [] },
      orchestrationIds: ["routine"],
    }))).toBe("ready");
  });

  it("counts triage buckets for the current application scope", () => {
    expect(applicationTriageCounts([
      application({ id: "app_failed", status: "failed" }),
      application({ id: "app_probe", status: "active", probe: null }),
      application({ id: "app_ready", status: "active", probe: { capabilities: [] }, orchestrationIds: ["routine"] }),
      application({ id: "app_archived", status: "archived" }),
    ])).toEqual({
      attention: 2,
      warning: 1,
      ready: 1,
    });
  });
});

describe("application search and ordering", () => {
  it("matches application search across name, id, source, path, and guidance", () => {
    const app = application({
      id: "app_ccusage",
      name: "ccusage Reports",
      kind: "npm",
      source: { type: "npm", package: "@acme/ccusage", version: "2.0.0" },
      path: "/apps/ccusage",
      status: "failed",
      lifecycle: { error: "Package metadata missing." },
    });

    expect(applicationMatchesSearch(app, "ccusage")).toBe(true);
    expect(applicationMatchesSearch(app, "@acme 2.0.0")).toBe(true);
    expect(applicationMatchesSearch(app, "/apps metadata")).toBe(true);
    expect(applicationMatchesSearch(app, "needs attention")).toBe(true);
    expect(applicationMatchesSearch(app, "doocs")).toBe(false);
  });

  it("sorts attention first, then newest updates within each triage bucket", () => {
    const ordered = sortApplicationsForTriage([
      application({
        id: "app_ready_new",
        name: "Ready New",
        status: "active",
        probe: { capabilities: [] },
        orchestrationIds: ["routine"],
        updatedAt: "2026-07-06T03:00:00.000Z",
      }),
      application({
        id: "app_watch",
        name: "Watch",
        status: "active",
        probe: null,
        updatedAt: "2026-07-06T01:00:00.000Z",
      }),
      application({
        id: "app_attention_old",
        name: "Attention Old",
        status: "failed",
        updatedAt: "2026-07-06T00:00:00.000Z",
      }),
      application({
        id: "app_attention_new",
        name: "Attention New",
        status: "failed",
        updatedAt: "2026-07-06T02:00:00.000Z",
      }),
    ]);

    expect(ordered.map((app) => app.id)).toEqual([
      "app_attention_new",
      "app_attention_old",
      "app_watch",
      "app_ready_new",
    ]);
  });
});

describe("latestApplicationRecoveryAction", () => {
  it("selects the newest recovery action for one application", () => {
    const latest = latestApplicationRecoveryAction("app_docs", [
      recoveryAction({ id: "rec_old", applicationId: "app_docs", updatedAt: "2026-07-06T01:00:00.000Z" }),
      recoveryAction({ id: "rec_other", applicationId: "app_other", updatedAt: "2026-07-06T04:00:00.000Z" }),
      recoveryAction({ id: "rec_new", applicationId: "app_docs", updatedAt: "2026-07-06T03:00:00.000Z" }),
    ]);

    expect(latest?.id).toBe("rec_new");
  });
});

function application(overrides: Partial<ApplicationSnapshot>): ApplicationSnapshot {
  return {
    id: "app_docs",
    name: "Docs",
    kind: "repository",
    source: { type: "local", path: "/repo" },
    status: "active",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}

function recoveryAction(overrides: Partial<ApplicationRecoveryActionRequest>): ApplicationRecoveryActionRequest {
  return {
    id: "rec",
    applicationId: "app_docs",
    routineId: "routine_docs",
    invocationId: "inv_docs",
    actionType: "rerun",
    status: "executed",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}
