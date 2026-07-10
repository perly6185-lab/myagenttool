import { describe, expect, it } from "vitest";
import { applicationOnboardingGuide } from "@/features/applications/application-onboarding-guide";

describe("applicationOnboardingGuide", () => {
  it("marks a fresh registration as needing source and onboarding inputs", () => {
    const guide = applicationOnboardingGuide({
      sourceType: "git",
      sourceReady: false,
      hasIntegrationBrief: false,
      hasDescriptorDraft: false,
      smokeTests: [],
      autoProbeAfterRegister: false,
    });

    expect(guide.readinessLabel).toBe("capture onboarding inputs");
    expect(guide.readinessTone).toBe("neutral");
    expect(guide.steps.map((step) => [step.id, step.status])).toEqual([
      ["source", "current"],
      ["brief", "pending"],
      ["descriptors", "pending"],
      ["smoke", "pending"],
    ]);
  });

  it("summarizes a reviewed registration with brief, descriptors, and smoke tests", () => {
    const guide = applicationOnboardingGuide({
      sourceType: "npm",
      sourceReady: true,
      hasIntegrationBrief: true,
      hasDescriptorDraft: true,
      smokeTests: ["register", "probe", "invoke"],
      autoProbeAfterRegister: false,
    });

    expect(guide.readinessLabel).toBe("ready for reviewed registration");
    expect(guide.readinessTone).toBe("success");
    expect(guide.steps.every((step) => step.status === "done")).toBe(true);
    expect(guide.steps.find((step) => step.id === "smoke")?.detail).toBe("3 smoke check(s) captured.");
  });

  it("treats auto-probe as a smoke path signal", () => {
    const guide = applicationOnboardingGuide({
      sourceType: "local",
      sourceReady: true,
      hasIntegrationBrief: true,
      hasDescriptorDraft: false,
      smokeTests: [],
      autoProbeAfterRegister: true,
    });

    expect(guide.readinessLabel).toBe("3/4 onboarding inputs ready");
    expect(guide.steps.find((step) => step.id === "smoke")).toEqual(expect.objectContaining({
      status: "done",
      detail: "Probe will run after registration. Auto-probe is enabled.",
    }));
  });
});
