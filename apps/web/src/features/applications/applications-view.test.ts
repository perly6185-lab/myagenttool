import { describe, expect, it } from "vitest";
import { applicationNextStep, sourceSummary } from "@/features/applications/applications-view";
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
