/*
 * The merge-gate posture logic — the one human decision in the autonomous loop.
 * A regression here would show "green / safe" over an unverified or failing PR,
 * so the human merges blind. Pure functions, no render.
 */

import { describe, expect, it } from "vitest";

import { mergeRisk, postureRows, type AutoRunRecord } from "./auto-run-model";

const run = (over: Partial<AutoRunRecord> = {}): AutoRunRecord => ({ id: "aur_1", status: "pr_open", prNumber: 9, ...over });

const green: Partial<AutoRunRecord> = {
  verification: { verified: true, passed: true },
  judgment: { solved: true, confidence: 1 },
  prChecks: { total: 3, passed: 3, failed: 0, pending: 0, state: "SUCCESS" },
};

describe("mergeRisk", () => {
  it("no warn only when verified + judged-solved + checks green", () => {
    expect(mergeRisk(run(green)).warn).toBe(false);
  });

  it("warns when verification not run", () => {
    expect(mergeRisk(run({ ...green, verification: null })).warn).toBe(true);
  });

  it("warns when verification ran but failed", () => {
    expect(mergeRisk(run({ ...green, verification: { verified: true, passed: false } })).warn).toBe(true);
  });

  it("warns when the judge did not confirm (false or errored)", () => {
    expect(mergeRisk(run({ ...green, judgment: { solved: false, confidence: 0.9 } })).warn).toBe(true);
    expect(mergeRisk(run({ ...green, judgment: { solved: null, confidence: null } })).warn).toBe(true);
    expect(mergeRisk(run({ ...green, judgment: null })).warn).toBe(true);
  });

  it("warns when PR checks are missing, failing, or pending", () => {
    expect(mergeRisk(run({ ...green, prChecks: null })).warn).toBe(true);
    expect(mergeRisk(run({ ...green, prChecks: { total: 2, passed: 1, failed: 1, pending: 0, state: "FAILURE" } })).warn).toBe(true);
    expect(mergeRisk(run({ ...green, prChecks: { total: 2, passed: 1, failed: 0, pending: 1, state: "PENDING" } })).warn).toBe(true);
  });
});

describe("postureRows", () => {
  it("renders three rows: verify, judge, checks", () => {
    const rows = postureRows(run(green));
    expect(rows.map((r) => r.key)).toEqual(["verify", "judge", "checks"]);
    expect(rows.every((r) => r.state === "ok")).toBe(true);
  });

  it("maps each signal to the right state + detail", () => {
    const rows = postureRows(
      run({
        verification: { verified: true, passed: false },
        judgment: { solved: null, confidence: null },
        prChecks: { total: 4, passed: 2, failed: 2, pending: 0, state: "FAILURE" },
      }),
    );
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.verify.state).toBe("bad");
    expect(by.verify.detail).toBe("FAILED");
    expect(by.judge.state).toBe("warn"); // errored — no verdict
    expect(by.checks.state).toBe("bad");
    expect(by.checks.detail).toBe("2 failing");
  });

  it("shows muted 'not run' / 'none' when signals are absent", () => {
    const rows = postureRows(run({ verification: null, judgment: null, prChecks: null }));
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.verify).toMatchObject({ state: "muted", detail: "not run" });
    expect(by.judge).toMatchObject({ state: "muted", detail: "not run" });
    expect(by.checks).toMatchObject({ state: "muted", detail: "none" });
  });

  it("shows judge confidence when solved", () => {
    const rows = postureRows(run({ ...green, judgment: { solved: true, confidence: 0.98 } }));
    expect(rows.find((r) => r.key === "judge")?.detail).toBe("solved (98%)");
  });
});
