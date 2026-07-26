import { describe, expect, it } from "vitest";
import { deriveApplicationDependencyState } from "./application-dependency-state";
import type { ApplicationSnapshot, ConsoleSnapshot } from "@/lib/console-state";

const app = (patch: Partial<ApplicationSnapshot> = {}) => ({ id: "app_1", name: "Docs", kind: "local", source: { type: "local", path: "/docs" }, status: "draft", ...patch }) as ApplicationSnapshot;

describe("Application dependency lifecycle", () => {
  it("distinguishes declared, configured, verified, used, and unavailable", () => {
    expect(deriveApplicationDependencyState(app(), undefined).lifecycle).toBe("declared");
    expect(deriveApplicationDependencyState(app({ status: "active" }), undefined).lifecycle).toBe("configured");
    expect(deriveApplicationDependencyState(app({ localReadiness: { state: "ready", summary: "ready", action: null, scope: "local" } }), undefined).lifecycle).toBe("verified");
    const state = { invocations: [{ id: "inv_1", agentId: "agent_1", options: { metadata: { applicationId: "app_1" } } }] } as ConsoleSnapshot;
    expect(deriveApplicationDependencyState(app(), state)).toMatchObject({ lifecycle: "used", invocationIds: ["inv_1"], agentIds: ["agent_1"] });
    expect(deriveApplicationDependencyState(app({ status: "offline" }), state).lifecycle).toBe("unavailable");
  });
});
