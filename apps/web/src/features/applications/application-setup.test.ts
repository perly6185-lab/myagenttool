import { describe, expect, it } from "vitest";
import { applicationSetupState, setupNextHint } from "@/features/applications/application-setup";
import type { ApplicationSnapshot, InvocationSnapshot } from "@/lib/console-state";

const app = (over: Partial<ApplicationSnapshot> = {}): ApplicationSnapshot => ({
  id: "app_1",
  name: "demo",
  kind: "repository",
  source: { type: "local", path: "/x" },
  status: "active",
  ...over,
});

const orchestrationRun = (applicationId: string): InvocationSnapshot => ({
  id: "inv_1",
  status: "succeeded",
  options: { metadata: { applicationId, source: "application_orchestration" } },
});

describe("applicationSetupState", () => {
  it("fresh registration → next step is probe", () => {
    const s = applicationSetupState(app(), []);
    expect(s).toMatchObject({ probed: false, hasOrchestration: false, hasRun: false, nextStep: "probe", completed: 0 });
  });

  it("probed (via capabilities or checkedAt) → next is generate", () => {
    expect(applicationSetupState(app({ probe: { capabilities: [{ name: "x" }] } as never }), []).nextStep).toBe("generate");
    expect(applicationSetupState(app({ probe: { checkedAt: "2026-07-12T00:00:00Z" } as never }), []).nextStep).toBe("generate");
  });

  it("probed + orchestration but no run → next is run", () => {
    const s = applicationSetupState(app({ probe: { checkedAt: "t" } as never, orchestrationIds: ["rt_1"] }), []);
    expect(s).toMatchObject({ nextStep: "run", completed: 2 });
  });

  it("a run for THIS app's orchestration completes setup", () => {
    const s = applicationSetupState(
      app({ probe: { checkedAt: "t" } as never, orchestrations: [{ routineId: "rt_1" } as never] }),
      [orchestrationRun("app_1")],
    );
    expect(s).toMatchObject({ nextStep: "done", completed: 3, hasRun: true });
  });

  it("another app's run does not count", () => {
    const s = applicationSetupState(app({ probe: { checkedAt: "t" } as never, orchestrationIds: ["rt_1"] }), [orchestrationRun("app_other")]);
    expect(s.hasRun).toBe(false);
    expect(s.nextStep).toBe("run");
  });
});

describe("setupNextHint", () => {
  it("gives an actionable hint per step", () => {
    expect(setupNextHint("probe")).toMatch(/Probe/);
    expect(setupNextHint("generate")).toMatch(/orchestration/);
    expect(setupNextHint("run")).toMatch(/Run/);
    expect(setupNextHint("done")).toMatch(/complete/);
  });
});
