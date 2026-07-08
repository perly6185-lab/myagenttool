/*
 * Phase 4 issue status writeback: the gh label transition and its config gate.
 * Fake gh so no network; asserts the exact args and that failures never throw.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveStatusWritebackConfig,
  runIssueBodyFetch,
  runIssueComment,
  runIssueStatusTransition,
  runPrChecks,
  statusTransitionLabels,
} from "../src/services/issue-status.mjs";

const ghChecks = (rollup) => async (args) => {
  assert.deepEqual(args, ["pr", "view", "7", "--json", "statusCheckRollup"]);
  return { stdout: JSON.stringify({ statusCheckRollup: rollup }) };
};

// Route gh calls by a substring of the joined args — exercises the Actions
// fallback (statusCheckRollup empty/forbidden → read Actions runs by head SHA).
const ghRoute = (routes) => async (args) => {
  const key = args.join(" ");
  for (const [pat, resp] of routes) {
    if (key.includes(pat)) {
      if (resp instanceof Error) throw resp;
      return { stdout: resp };
    }
  }
  throw new Error(`unexpected gh call: ${key}`);
};

test("runPrChecks: rollup empty + no Actions runs → NONE", async () => {
  const gh = ghRoute([
    ["statusCheckRollup", JSON.stringify({ statusCheckRollup: [] })],
    ["nameWithOwner", JSON.stringify({ nameWithOwner: "o/r" })],
    ["headRefOid", JSON.stringify({ headRefOid: "sha1" })],
    ["actions/runs", JSON.stringify({ workflow_runs: [] })],
  ]);
  assert.deepEqual(await runPrChecks({ cwd: "/r", prNumber: 7, gh }), { total: 0, passed: 0, failed: 0, pending: 0, state: "NONE" });
});

test("runPrChecks: statusCheckRollup forbidden → Actions fallback (success + in-progress → PENDING)", async () => {
  const gh = ghRoute([
    ["statusCheckRollup", new Error("GraphQL: Resource not accessible by personal access token")],
    ["nameWithOwner", JSON.stringify({ nameWithOwner: "o/r" })],
    ["headRefOid", JSON.stringify({ headRefOid: "sha1" })],
    ["actions/runs", JSON.stringify({ workflow_runs: [{ status: "completed", conclusion: "success" }, { status: "in_progress", conclusion: null }] })],
  ]);
  assert.deepEqual(await runPrChecks({ cwd: "/r", prNumber: 7, gh }), { total: 2, passed: 1, failed: 0, pending: 1, state: "PENDING" });
});

test("runPrChecks: Actions fallback dedups re-runs — failed-then-rerun-green → SUCCESS (audit)", async () => {
  const gh = ghRoute([
    ["statusCheckRollup", new Error("forbidden")],
    ["nameWithOwner", JSON.stringify({ nameWithOwner: "o/r" })],
    ["headRefOid", JSON.stringify({ headRefOid: "s" })],
    ["actions/runs", JSON.stringify({ workflow_runs: [
      { workflow_id: 1, event: "pull_request", run_number: 1, status: "completed", conclusion: "failure" },
      { workflow_id: 1, event: "pull_request", run_number: 2, status: "completed", conclusion: "success" },
    ] })],
    ["/status", JSON.stringify({ state: "success", total_count: 0 })],
  ]);
  const r = await runPrChecks({ cwd: "/r", prNumber: 7, gh });
  assert.equal(r.state, "SUCCESS", "only the latest run per workflow counts");
});

test("runPrChecks: Actions fallback folds in a red external commit-status → FAILURE (audit)", async () => {
  const gh = ghRoute([
    ["statusCheckRollup", new Error("forbidden")],
    ["nameWithOwner", JSON.stringify({ nameWithOwner: "o/r" })],
    ["headRefOid", JSON.stringify({ headRefOid: "s" })],
    ["actions/runs", JSON.stringify({ workflow_runs: [{ workflow_id: 1, run_number: 1, status: "completed", conclusion: "success" }] })],
    ["/status", JSON.stringify({ state: "failure", total_count: 1 })],
  ]);
  const r = await runPrChecks({ cwd: "/r", prNumber: 7, gh });
  assert.equal(r.state, "FAILURE", "a red external status downgrades an Actions-only SUCCESS");
});

test("runPrChecks: Actions fallback with a failed run → FAILURE", async () => {
  const gh = ghRoute([
    ["statusCheckRollup", new Error("forbidden")],
    ["nameWithOwner", JSON.stringify({ nameWithOwner: "o/r" })],
    ["headRefOid", JSON.stringify({ headRefOid: "s" })],
    ["actions/runs", JSON.stringify({ workflow_runs: [{ status: "completed", conclusion: "failure" }, { status: "completed", conclusion: "success" }] })],
  ]);
  assert.equal((await runPrChecks({ cwd: "/r", prNumber: 7, gh })).state, "FAILURE");
});

test("runPrChecks: all green → SUCCESS", async () => {
  const r = await runPrChecks({ cwd: "/r", prNumber: 7, gh: ghChecks([{ conclusion: "SUCCESS" }, { conclusion: "SKIPPED" }]) });
  assert.deepEqual(r, { total: 2, passed: 2, failed: 0, pending: 0, state: "SUCCESS" });
});

test("runPrChecks: any failure → FAILURE (even with pending)", async () => {
  const r = await runPrChecks({ cwd: "/r", prNumber: 7, gh: ghChecks([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }, { status: "IN_PROGRESS" }]) });
  assert.deepEqual(r, { total: 3, passed: 1, failed: 1, pending: 1, state: "FAILURE" });
});

test("runPrChecks: some pending, none failed → PENDING", async () => {
  const r = await runPrChecks({ cwd: "/r", prNumber: 7, gh: ghChecks([{ conclusion: "SUCCESS" }, { state: "PENDING" }]) });
  assert.deepEqual(r, { total: 2, passed: 1, failed: 0, pending: 1, state: "PENDING" });
});

test("runPrChecks: gh failure → null (never throws)", async () => {
  assert.equal(await runPrChecks({ cwd: "/r", prNumber: 7, gh: async () => { throw new Error("x"); } }), null);
});

test("resolveStatusWritebackConfig is off unless explicitly enabled", () => {
  assert.deepEqual(resolveStatusWritebackConfig({}), { enabled: false });
  assert.deepEqual(resolveStatusWritebackConfig({ MYAGENTTOOL_AUTORUN_STATUS_WRITEBACK: "1" }), { enabled: true });
  assert.deepEqual(resolveStatusWritebackConfig({ MYAGENTTOOL_AUTORUN_STATUS_WRITEBACK: "true" }), { enabled: true });
});

test("statusTransitionLabels maps the forward transitions", () => {
  assert.deepEqual(statusTransitionLabels("in-progress"), { add: ["status/in-progress"], remove: ["status/ready", "status/backlog"] });
  assert.deepEqual(statusTransitionLabels("review"), { add: ["status/review"], remove: ["status/in-progress"] });
  assert.equal(statusTransitionLabels("bogus"), null);
});

test("runIssueStatusTransition issues the right gh edit for in-progress", async () => {
  const calls = [];
  const gh = async (args, cwd) => calls.push({ args, cwd });
  const result = await runIssueStatusTransition({ cwd: "/repo", issueNumber: 42, to: "in-progress", gh });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, "/repo");
  assert.deepEqual(calls[0].args, [
    "issue", "edit", "42",
    "--add-label", "status/in-progress",
    "--remove-label", "status/ready",
    "--remove-label", "status/backlog",
  ]);
});

test("runIssueStatusTransition review transition removes in-progress, adds review", async () => {
  const calls = [];
  const gh = async (args) => calls.push(args);
  await runIssueStatusTransition({ cwd: "/repo", issueNumber: 7, to: "review", gh });
  assert.deepEqual(calls[0], ["issue", "edit", "7", "--add-label", "status/review", "--remove-label", "status/in-progress"]);
});

test("runIssueStatusTransition never throws — a gh failure is a structured result", async () => {
  const gh = async () => {
    throw Object.assign(new Error("boom"), { stderr: "gh: not authenticated" });
  };
  const result = await runIssueStatusTransition({ cwd: "/repo", issueNumber: 1, to: "review", gh });
  assert.equal(result.ok, false);
  assert.match(result.error, /not authenticated/);
});

test("runIssueBodyFetch reads the body via gh; failures and empties yield null", async () => {
  const gh = async (args, cwd) => {
    assert.deepEqual(args, ["issue", "view", "12", "--json", "body", "--jq", ".body"]);
    assert.equal(cwd, "/repo");
    return { stdout: "The body.\n" };
  };
  assert.equal(await runIssueBodyFetch({ cwd: "/repo", issueNumber: 12, gh }), "The body.");
  assert.equal(await runIssueBodyFetch({ cwd: "/repo", issueNumber: 12, gh: async () => ({ stdout: "  " }) }), null);
  assert.equal(await runIssueBodyFetch({ cwd: "/repo", issueNumber: 12, gh: async () => { throw new Error("x"); } }), null);
});

test("runPrStateFetch reads OPEN/MERGED/CLOSED; junk and failures yield null", async () => {
  const gh = async (args) => {
    assert.deepEqual(args, ["pr", "view", "7", "--json", "state", "--jq", ".state"]);
    return { stdout: "merged\n" };
  };
  assert.equal(await import("../src/services/issue-status.mjs").then((m) => m.runPrStateFetch({ cwd: "/r", prNumber: 7, gh })), "MERGED");
  const { runPrStateFetch } = await import("../src/services/issue-status.mjs");
  assert.equal(await runPrStateFetch({ cwd: "/r", prNumber: 7, gh: async () => ({ stdout: "weird" }) }), null);
  assert.equal(await runPrStateFetch({ cwd: "/r", prNumber: 7, gh: async () => { throw new Error("x"); } }), null);
});

test("runIssueComment posts a comment via gh and never throws", async () => {
  const calls = [];
  const gh = async (args, cwd) => calls.push({ args, cwd });
  const ok = await runIssueComment({ cwd: "/repo", issueNumber: 9, body: "Findings: use Redis.", gh });
  assert.equal(ok.ok, true);
  assert.deepEqual(calls[0].args, ["issue", "comment", "9", "--body", "Findings: use Redis."]);

  const bad = await runIssueComment({ cwd: "/repo", issueNumber: 9, body: "x", gh: async () => { throw new Error("boom"); } });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /boom/);
});

test("runIssueStatusTransition skips an unknown status without calling gh", async () => {
  let called = false;
  const gh = async () => { called = true; };
  const result = await runIssueStatusTransition({ cwd: "/repo", issueNumber: 1, to: "done", gh });
  assert.equal(result.skipped, true);
  assert.equal(called, false);
});
