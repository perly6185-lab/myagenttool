import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "@/app/sections";
import { MY_SETTINGS_SECTION_KEYS } from "./my-settings-model";

describe("My settings information architecture", () => {
  it("lists each professional destination once", () => {
    expect(new Set(MY_SETTINGS_SECTION_KEYS).size).toBe(MY_SETTINGS_SECTION_KEYS.length);
  });

  it("contains every Settings and Trace destination behind the overview", () => {
    const expected = PAGE_REGISTRY
      .filter((page) => page.key !== "settings" && (page.surface === "settings" || page.surface === "trace"))
      .map((page) => page.key);
    expect(MY_SETTINGS_SECTION_KEYS).toEqual(expect.arrayContaining(expected));
  });

  it("also exposes low-frequency automation and governance pages", () => {
    expect(MY_SETTINGS_SECTION_KEYS).toEqual(expect.arrayContaining([
      "autoRuns",
      "approvals",
    ]));
    expect(MY_SETTINGS_SECTION_KEYS).not.toContain("workflowMemory");
  });
});
