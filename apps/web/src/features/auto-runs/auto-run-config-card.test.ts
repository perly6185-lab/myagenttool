import { describe, expect, it } from "vitest";
import { canManageAutoRunConfig, canReplaceTeamWebhook } from "@/features/auto-runs/auto-run-config-card";

describe("team alert webhook replacement guard", () => {
  it("requires a non-empty replacement so Save cannot silently clear a configured target", () => {
    expect(canReplaceTeamWebhook("")).toBe(false);
    expect(canReplaceTeamWebhook("   ")).toBe(false);
    expect(canReplaceTeamWebhook("https://hooks.example.test/team")).toBe(true);
  });

  it("keeps the global configuration form editable only for owners and admins", () => {
    expect(canManageAutoRunConfig("owner")).toBe(true);
    expect(canManageAutoRunConfig("admin")).toBe(true);
    expect(canManageAutoRunConfig("operator")).toBe(false);
    expect(canManageAutoRunConfig("viewer")).toBe(false);
    expect(canManageAutoRunConfig(undefined)).toBe(false);
  });
});
