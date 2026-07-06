import { describe, expect, it } from "vitest";
import { applicationNextStep, applicationTriageBucket, applicationTriageCounts, sourceSummary } from "@/features/applications/applications-view";
import type { ApplicationSnapshot } from "@/lib/console-state";

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
