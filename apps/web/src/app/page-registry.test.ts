import { describe, expect, it } from "vitest";
import { ENTRY_SECTIONS, PAGE_REGISTRY, pageRegistration } from "@/app/sections";
import { SECTION_KEYS } from "@/store/ui-store";

describe("page ownership registry (#1505)", () => {
  it("registers every routable section exactly once", () => {
    expect(PAGE_REGISTRY.map((page) => page.key).sort()).toEqual([...SECTION_KEYS].sort());
    expect(new Set(PAGE_REGISTRY.map((page) => page.key)).size).toBe(SECTION_KEYS.length);
  });

  it("keeps the ordinary shell focused while exposing email and My templates as first-class destinations", () => {
    expect(ENTRY_SECTIONS.map((page) => page.key)).toEqual([
      "dashboard",
      "mail",
      "task",
      "workflowMemory",
      "projects",
      "me",
    ]);
  });

  it("keeps contextual work reachable without promoting it to global navigation", () => {
    for (const key of ["workBoard", "externalWork", "planning", "workspace", "documents", "canvas"] as const) {
      expect(pageRegistration(key)).toMatchObject({ surface: "entry", visibility: "contextual" });
    }
    expect(pageRegistration("workflowMemory")).toMatchObject({ surface: "entry", visibility: "primary" });
  });

  it("assigns configuration to Settings and execution records to Trace", () => {
    expect(pageRegistration("applications")).toMatchObject({ surface: "settings", authority: "manage" });
    expect(pageRegistration("channels")).toMatchObject({ surface: "settings", authority: "manage" });
    expect(pageRegistration("invocations")).toMatchObject({ surface: "trace", authority: "audit" });
    expect(pageRegistration("audit")).toMatchObject({ surface: "trace", authority: "audit" });
  });

  it("declares a canonical deep link and collision-free legacy aliases", () => {
    const aliases = PAGE_REGISTRY.flatMap((page) => page.legacyAliases);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const page of PAGE_REGISTRY) {
      expect(page.deepLink).toBe(`?section=${page.key}`);
      expect(["ordinary", "manage", "audit"]).toContain(page.authority);
    }
  });
});
