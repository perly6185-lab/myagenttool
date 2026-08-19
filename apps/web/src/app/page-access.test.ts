import { describe, expect, it } from "vitest";
import { canDiscoverProfessionalPage, canManageProfessionalSettings } from "./page-access";

describe("professional page discovery policy", () => {
  it("keeps local or not-yet-resolved sessions compatible", () => {
    expect(canDiscoverProfessionalPage("agents")).toBe(true);
    expect(canManageProfessionalSettings()).toBe(true);
  });

  it("allows owners and administrators to discover management pages", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(canDiscoverProfessionalPage("agents", role)).toBe(true);
      expect(canManageProfessionalSettings(role)).toBe(true);
    }
  });

  it("keeps management pages out of operator and viewer discovery", () => {
    for (const role of ["operator", "viewer"] as const) {
      expect(canDiscoverProfessionalPage("agents", role)).toBe(false);
      expect(canManageProfessionalSettings(role)).toBe(false);
      expect(canDiscoverProfessionalPage("invocations", role)).toBe(true);
    }
  });

  it("does not advertise operational decisions to viewers", () => {
    for (const section of ["approvals", "autoRuns", "compare"] as const) {
      expect(canDiscoverProfessionalPage(section, "operator")).toBe(true);
      expect(canDiscoverProfessionalPage(section, "viewer")).toBe(false);
    }
  });
});
