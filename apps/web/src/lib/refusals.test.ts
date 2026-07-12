import { describe, expect, it } from "vitest";
import type { RefusalRow } from "@/lib/console-state";
import {
  groupRefusals,
  readableAppealTo,
  readableRefusalCategory,
  readableRefusalCode,
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
