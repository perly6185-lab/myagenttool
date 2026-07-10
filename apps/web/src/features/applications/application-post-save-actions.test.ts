import { describe, expect, it } from "vitest";
import { applicationPostSaveActions } from "@/features/applications/application-post-save-actions";
import type { ApplicationSnapshot } from "@/lib/console-state";

describe("applicationPostSaveActions", () => {
  it("returns no actions when descriptors were not the latest lifecycle operation", () => {
    expect(applicationPostSaveActions(application({ lifecycle: { lastOperation: "probe" } }))).toEqual([]);
  });

  it("guides the operator through probe, consent, orchestration, and smoke plan after descriptor save", () => {
    const actions = applicationPostSaveActions(application({
      lifecycle: {
        lastOperation: "update_descriptors",
        lastOperationAt: "2026-07-08T02:00:00.000Z",
      },
      probe: {
        status: "completed",
        checkedAt: "2026-07-08T01:00:00.000Z",
      },
      wrapper: {
        mode: "installed-wrapper",
        installState: "installed",
        commands: [{
          id: "deploy",
          status: "approved",
          filePolicy: "workspace_write",
          networkPolicy: "network",
        }],
      },
      integrationBrief: {
        version: "application-intake.v1",
        status: "draft",
        smokeTests: ["register", "probe", "invoke"],
      },
      orchestrationIds: [],
    }));

    expect(actions.map((action) => action.kind)).toEqual(["probe", "consent", "orchestration", "smoke_plan"]);
    expect(actions.find((action) => action.kind === "consent")?.tone).toBe("danger");
    expect(actions.find((action) => action.kind === "smoke_plan")?.detail).toBe("register, probe, invoke");
    expect(actions.find((action) => action.kind === "smoke_plan")?.steps).toEqual(["register", "probe", "invoke"]);
  });

  it("does not request orchestration for offline applications", () => {
    const actions = applicationPostSaveActions(application({
      status: "offline",
      lifecycle: { lastOperation: "update_descriptors", lastOperationAt: "2026-07-08T02:00:00.000Z" },
      probe: { status: "completed", checkedAt: "2026-07-08T02:01:00.000Z" },
      orchestrationIds: [],
    }));

    expect(actions.some((action) => action.kind === "orchestration")).toBe(false);
  });
});

function application(overrides: Partial<ApplicationSnapshot>): ApplicationSnapshot {
  return {
    id: "app_fixture",
    name: "Fixture",
    kind: "npm",
    source: { type: "npm", package: "fixture" },
    status: "active",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}
