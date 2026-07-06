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
  statusTransitionLabels,
} from "../src/services/issue-status.mjs";

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
