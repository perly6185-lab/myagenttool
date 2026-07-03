import { describe, expect, it } from "vitest";
import { ccusageSourcesFor } from "@/features/tools/tools-view";

// Regression for the #240 review fix: a provider-specific source is only offered
// for a matching provider report, so the UI can't build a request the backend
// rejects with source_report_mismatch.
describe("ccusageSourcesFor", () => {
  it("offers only 'all' for a generic report", () => {
    expect(ccusageSourcesFor("daily")).toEqual(["all"]);
    expect(ccusageSourcesFor("weekly")).toEqual(["all"]);
    expect(ccusageSourcesFor("monthly")).toEqual(["all"]);
    expect(ccusageSourcesFor("session")).toEqual(["all"]);
  });

  it("adds 'codex' only for a codex_ report", () => {
    expect(ccusageSourcesFor("codex_daily")).toEqual(["all", "codex"]);
  });

  it("adds 'claude' only for a claude_ report", () => {
    expect(ccusageSourcesFor("claude_daily")).toEqual(["all", "claude"]);
  });

  it("never mixes provider sources across providers", () => {
    expect(ccusageSourcesFor("codex_daily")).not.toContain("claude");
    expect(ccusageSourcesFor("claude_daily")).not.toContain("codex");
  });
});
