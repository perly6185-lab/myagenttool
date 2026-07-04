/*
 * The promotion-push gate decision: buildLoopPromotionPushPlanRisks turns the
 * observed remote/branch state into the risk list a human reviews before a loop
 * run pushes its integration branch. Pure and hermetic (no git). A regression
 * here either hides a real risk (unconfigured remote, wrong branch) from the
 * gate or invents a false one that blocks a safe push.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLoopPromotionPushPlanRisks } from "../src/loop/promotion-push.mjs";

const OK = {
  remote: "origin",
  remoteUrl: "git@github.com:acme/repo.git",
  remoteNames: ["origin"],
  branch: "loop/promotion/issue-42",
};

test("a fully-configured push has no risks", () => {
  assert.deepEqual(buildLoopPromotionPushPlanRisks(OK), []);
});

test("an unconfigured remote is a risk", () => {
  const risks = buildLoopPromotionPushPlanRisks({ ...OK, remoteNames: ["upstream"] });
  assert.deepEqual(risks, ["Remote not configured: origin"]);
});

test("a missing/blank remote URL is a risk", () => {
  assert.deepEqual(
    buildLoopPromotionPushPlanRisks({ ...OK, remoteUrl: "   " }),
    ["Remote URL not available for origin"],
  );
});

test("a branch with unusual characters is flagged (prefix still ok)", () => {
  const risks = buildLoopPromotionPushPlanRisks({ ...OK, branch: "loop/promotion/bad branch!" });
  assert.deepEqual(risks, ["Integration branch has unusual characters: loop/promotion/bad branch!"]);
});

test("a branch without the loop/promotion prefix is flagged (chars still ok)", () => {
  const risks = buildLoopPromotionPushPlanRisks({ ...OK, branch: "feature/x" });
  assert.deepEqual(risks, ["Integration branch does not use loop/promotion prefix: feature/x"]);
});

test("a null branch fails both branch checks and reports as missing", () => {
  const risks = buildLoopPromotionPushPlanRisks({ ...OK, branch: null });
  assert.equal(risks.length, 2);
  assert.ok(risks.every((r) => r.endsWith("missing")), "both branch risks name the missing branch");
});

test("risks accumulate across independent problems", () => {
  const risks = buildLoopPromotionPushPlanRisks({
    remote: "origin",
    remoteUrl: "",
    remoteNames: [],
    branch: "feature/x",
  });
  assert.equal(risks.length, 3, "remote-not-configured + no-url + wrong-prefix");
});
