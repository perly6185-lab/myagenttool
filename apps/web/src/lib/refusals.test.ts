import { describe, expect, it } from "vitest";
import type { RefusalRow } from "@/lib/console-state";
import {
  groupRefusals,
  readableAppealTo,
  readableRefusalCategory,
  readableRefusalCode,
  summarizeRefusals,
} from "@/lib/refusals";

function refusal(over: Partial<RefusalRow>): RefusalRow {
  return {
    id: "ref_1",
    at: "2026-07-12T00:00:00.000Z",
    subject: { kind: "invocation", id: "inv_1" },
    requester: { kind: "local_user", id: "usr_local" },
    category: "policy",
    code: "command_not_allowlisted",
    decidedBy: { kind: "policy_engine", id: "gate" },
    summary: "Command not allowlisted.",
    evidence: {},
    remedy: "Adjust the command.",
    retryAfter: null,
    appealTo: "device_owner",
    invocationId: "inv_1",
    ...over,
  };
}

describe("readable labels", () => {
  it("humanizes categories, codes, and appeal targets", () => {
    expect(readableRefusalCategory("not_granted")).toBe("Not granted");
    expect(readableRefusalCode("cwd_outside_approved_root")).toBe("Cwd outside approved root");
    expect(readableAppealTo("device_owner")).toBe("the device owner");
    expect(readableAppealTo(null)).toBeNull();
  });
});

describe("groupRefusals", () => {
  it("orders categories not_granted → policy → state → human and skips empty ones", () => {
    const groups = groupRefusals([
      refusal({ category: "human", code: "approval_denied" }),
      refusal({ category: "not_granted", code: "capability_not_granted" }),
      refusal({ category: "state", code: "over_budget" }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["not_granted", "state", "human"]);
  });

  it("groups by code within a category, most-used first, newest-first inside a code", () => {
    const groups = groupRefusals([
      refusal({ id: "a", code: "cwd_outside_approved_root", at: "2026-07-12T01:00:00.000Z" }),
      refusal({ id: "b", code: "command_not_allowlisted", at: "2026-07-12T02:00:00.000Z" }),
      refusal({ id: "c", code: "command_not_allowlisted", at: "2026-07-12T03:00:00.000Z" }),
    ]);
    const policy = groups.find((g) => g.category === "policy")!;
    expect(policy.count).toBe(3);
    expect(policy.codes[0].code).toBe("command_not_allowlisted"); // 2 beats 1
    expect(policy.codes[0].refusals.map((r) => r.id)).toEqual(["c", "b"]); // newest first
  });

  it("returns nothing for an empty list", () => {
    expect(groupRefusals([])).toEqual([]);
  });
});

describe("summarizeRefusals", () => {
  const NOW = Date.parse("2026-07-13T12:00:00.000Z");

  it("counts totals, categories, top codes, and a zero-filled 7-day trend", () => {
    const rows = [
      refusal({ category: "policy", code: "command_not_allowlisted", at: "2026-07-13T01:00:00.000Z" }),
      refusal({ category: "policy", code: "command_not_allowlisted", at: "2026-07-12T01:00:00.000Z" }),
      refusal({ category: "policy", code: "cwd_outside_approved_root", at: "2026-07-13T02:00:00.000Z" }),
      refusal({ category: "human", code: "approval_denied", at: "2026-07-11T02:00:00.000Z" }),
      refusal({ category: "state", code: "over_budget", at: "2026-07-13T03:00:00.000Z" }),
    ];
    const s = summarizeRefusals(rows, { nowMs: NOW });
    expect(s.total).toBe(5);
    expect(s.byCategory).toEqual({ not_granted: 0, policy: 3, state: 1, human: 1 });
    expect(s.topCodes[0]).toEqual({ code: "command_not_allowlisted", label: "Command not allowlisted", count: 2 });
    expect(s.daily).toHaveLength(7);
    expect(s.daily[s.daily.length - 1]).toEqual({ date: "2026-07-13", count: 3 }); // today
    expect(s.daily[s.daily.length - 2].count).toBe(1); // 07-12
    expect(s.daily.reduce((n, d) => n + d.count, 0)).toBe(5); // all within the window
  });

  it("flags a loop source and ignores rows outside the window in the trend (not the total)", () => {
    const rows = [
      refusal({ code: "gate_rejected", category: "human", source: "loop", at: "2026-07-13T00:00:00.000Z" }),
      refusal({ code: "over_budget", category: "state", at: "2026-01-01T00:00:00.000Z" }), // old
    ];
    const s = summarizeRefusals(rows, { nowMs: NOW });
    expect(s.total).toBe(2);
    expect(s.hasLoopSource).toBe(true);
    expect(s.daily.reduce((n, d) => n + d.count, 0)).toBe(1); // the January row is outside the 7-day trend
  });

  it("is safe on an empty list", () => {
    const s = summarizeRefusals([], { nowMs: NOW });
    expect(s.total).toBe(0);
    expect(s.topCodes).toEqual([]);
    expect(s.daily).toHaveLength(7);
    expect(s.hasLoopSource).toBe(false);
  });
});
