/*
 * The worktree-promotion PR body — the pipeline's OTHER PR-producing path —
 * carries the Change Impact & Risk Assessment, generated from the promotion's
 * changed-file list (parallel to run-work). Path-based judgment, so a services
 * change reads as on-the-business-flow.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { formatLoopWorktreePromotionPrBody } from "../src/loop/formatters.mjs";

function baseResult(changedFiles) {
  return {
    issue: "42",
    parentRunId: "p1",
    childRunId: "c1",
    integrationBranch: "loop/promotion/x",
    integrationWorktreePath: "/tmp/wt",
    summary: "promote the child run",
    changedFiles,
    diffStat: "1 file changed",
    verifyCommand: "repo-test",
    verifyExitCode: 0,
    verifyStatus: "passed",
    evidenceRefs: {
      promotionApply: "a.json",
      promotionVerify: "v.json",
      promotionPatch: "p.patch",
      promotionReview: "r.md",
    },
  };
}

test("promotion PR body carries the Change Impact & Risk Assessment section", () => {
  const body = formatLoopWorktreePromotionPrBody(baseResult(["apps/server/src/services/agents.mjs"]));
  assert.ok(body.includes("## Change Impact & Risk Assessment"));
  assert.ok(body.includes("apps/server/src/services/agents.mjs"));
  assert.ok(body.includes("Touches business flow: yes"));
  // Section sits before Evidence, matching the PR template order.
  assert.ok(body.indexOf("## Change Impact & Risk Assessment") < body.indexOf("## Evidence"));
});

test("promotion PR body handles an empty changed-file list", () => {
  const body = formatLoopWorktreePromotionPrBody(baseResult([]));
  assert.ok(body.includes("## Change Impact & Risk Assessment"));
  assert.ok(body.includes("- (none)"));
});
