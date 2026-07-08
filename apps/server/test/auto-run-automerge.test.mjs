/*
 * Risk-based auto-merge (slice 3). The sweep may merge a PR with NO human in the
 * loop, so its gates are safety-critical: off by default, strict bar (standard
 * signals green + AI review pass + diff under cap), and halted by the kill switch
 * / breaker. Also the review verdict normalization (slice 2).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createAutoRunService } from "../src/services/auto-run.mjs";
import { normalizeReview } from "../src/services/auto-run-review.mjs";

const greenRun = () => ({
  id: "aur_1",
  status: "pr_open",
  prNumber: 5,
  prState: null,
  projectId: "p1",
  worktreeId: "w1",
  invocationId: "inv_1",
  verification: { verified: true, passed: true },
  judgment: { solved: true, confidence: 0.9 },
  prChecks: { total: 1, passed: 1, failed: 0, pending: 0, state: "SUCCESS" },
  promptInjection: null,
});

function makeSweep({ settings = {}, run = greenRun(), reviewDiff, fetchPrChecks, breaker = null, budgetStatusFor, worktreeHeadSha } = {}) {
  const alerts = [];
  const events = [];
  const merges = [];
  const state = {
    projects: [{ id: "p1", path: "/tmp/repo" }],
    worktrees: [{ id: "w1", repoPath: "/tmp/repo" }],
    autoRuns: [run],
    autoRunSettings: settings,
    autoRunBreaker: breaker,
  };
  const svc = createAutoRunService({
    state,
    now: () => "2026-07-07T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: (e) => events.push(e),
    persistStateSoon: () => {},
    sendAlert: (a) => alerts.push(a),
    reviewDiff,
    budgetStatusFor,
    worktreeHeadSha,
    fetchPrChecks: fetchPrChecks ?? (async () => run.prChecks),
    mergePr: async ({ prNumber }) => {
      merges.push(prNumber);
      return { ok: true, prNumber, method: "squash" };
    },
  });
  return { svc, state, alerts, events, merges, run };
}

const ON = { autoMergeLowRisk: true, autoMergeMaxDiffLines: 400 };
const passReview = async () => ({ review: { status: "pass", risk: "low", summary: "", issues: [] }, diffLines: 10, files: ["src/Hello.java"] });

test("default OFF: a perfectly green run is NOT auto-merged", async () => {
  const { svc, merges } = makeSweep({ settings: {}, reviewDiff: passReview });
  await svc.autoMergeSweep();
  assert.deepEqual(merges, []);
});

test("ON + green + review pass + small diff => auto-merged, audited, alerted", async () => {
  const { svc, merges, events, alerts, run } = makeSweep({ settings: ON, reviewDiff: passReview });
  const r = await svc.autoMergeSweep();
  assert.deepEqual(merges, [5]);
  assert.equal(run.prState, "MERGED");
  assert.deepEqual(r.merged, ["aur_1"]);
  assert.ok(events.some((e) => e.type === "auto_run_auto_merged"));
  assert.ok(alerts.some((a) => a.kind === "auto_merged"));
});

test("ON but NO review command => review 'missing' => NOT merged (strict bar)", async () => {
  const { svc, merges } = makeSweep({ settings: ON, reviewDiff: undefined });
  await svc.autoMergeSweep();
  assert.deepEqual(merges, [], "auto-merge requires the AI review to pass");
});

test("ON + review FAIL => NOT merged", async () => {
  const { svc, merges } = makeSweep({
    settings: ON,
    reviewDiff: async () => ({ review: { status: "fail", risk: "high", summary: "unsafe", issues: [] }, diffLines: 10 }),
  });
  await svc.autoMergeSweep();
  assert.deepEqual(merges, []);
});

test("ON + diff over the cap => NOT merged", async () => {
  const { svc, merges } = makeSweep({
    settings: { autoMergeLowRisk: true, autoMergeMaxDiffLines: 5 },
    reviewDiff: async () => ({ review: { status: "pass", risk: "low", summary: "", issues: [] }, diffLines: 500 }),
  });
  await svc.autoMergeSweep();
  assert.deepEqual(merges, []);
});

test("ON + fresh checks come back FAILING => NOT merged (never trusts stale green)", async () => {
  const { svc, merges } = makeSweep({
    settings: ON,
    reviewDiff: passReview,
    fetchPrChecks: async () => ({ total: 2, passed: 1, failed: 1, pending: 0, state: "FAILURE" }),
  });
  await svc.autoMergeSweep();
  assert.deepEqual(merges, []);
});

test("ON + diff touches a sensitive path => NOT merged (guard)", async () => {
  const { svc, merges } = makeSweep({
    settings: { ...ON, autoMergeSensitivePaths: [".github/workflows/**"] },
    reviewDiff: async () => ({ review: { status: "pass", risk: "low", summary: "", issues: [] }, diffLines: 10, files: [".github/workflows/ci.yml"] }),
  });
  await svc.autoMergeSweep();
  assert.deepEqual(merges, [], "a change to a sensitive path is never auto-merged");
});

test("kill switch halts the sweep", async () => {
  const { svc, merges } = makeSweep({ settings: { ...ON, autonomyKillSwitch: true }, reviewDiff: passReview });
  const r = await svc.autoMergeSweep();
  assert.deepEqual(merges, []);
  assert.equal(r.halted, "kill-switch");
});

test("open breaker halts the sweep", async () => {
  const { svc, merges } = makeSweep({ settings: ON, reviewDiff: passReview, breaker: { openUntil: "2026-07-07T01:00:00.000Z", consecutiveFailures: 3 } });
  const r = await svc.autoMergeSweep();
  assert.deepEqual(merges, []);
  assert.equal(r.halted, "breaker-open");
});

test("normalizeReview maps approve/risk to pass/fail", () => {
  assert.equal(normalizeReview({ approve: true }).status, "pass");
  assert.equal(normalizeReview({ approve: false }).status, "fail");
  assert.equal(normalizeReview({ risk: "low" }).status, "pass");
  assert.equal(normalizeReview({ risk: "high" }).status, "fail");
  assert.equal(normalizeReview({ risk: "medium" }).status, "fail");
  assert.equal(normalizeReview({ summary: "no verdict" }), null, "unusable => null");
  assert.equal(normalizeReview(null), null);
});

test("fail-closed: an UNCONFIRMED fresh check fetch (null) never auto-merges over stale green", async () => {
  const { svc, merges } = makeSweep({ settings: ON, reviewDiff: passReview, fetchPrChecks: async () => null });
  await svc.autoMergeSweep();
  assert.deepEqual(merges, [], "stale cached SUCCESS is not trusted when the fresh fetch can't confirm");
});

test("budget brake: an over-budget project is not auto-merged (or reviewed)", async () => {
  let reviewed = 0;
  const { svc, merges } = makeSweep({
    settings: ON,
    reviewDiff: async () => { reviewed += 1; return { review: { status: "pass" }, diffLines: 5, files: ["src/x.js"] }; },
    budgetStatusFor: () => ({ over: true }),
  });
  await svc.autoMergeSweep();
  assert.deepEqual(merges, []);
  assert.equal(reviewed, 0, "no review spend on an over-budget project");
});

test("review invalidation: a changed PR head re-runs the review", async () => {
  let calls = 0;
  const run = { ...greenRun(), review: { status: "pass" }, diffFiles: ["src/x.js"], diffLines: 5, reviewedHeadSha: "OLD", worktreeId: "w1" };
  const { svc, merges } = makeSweep({
    settings: ON,
    run,
    worktreeHeadSha: async () => "NEW",
    reviewDiff: async () => { calls += 1; return { review: { status: "pass" }, diffLines: 5, files: ["src/x.js"] }; },
  });
  await svc.autoMergeSweep();
  assert.equal(calls, 1, "head moved OLD→NEW → cached review invalidated + re-run");
  assert.deepEqual(merges, [5]);
});
