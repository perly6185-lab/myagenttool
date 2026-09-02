import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { projectWorkItemReviewIntent } from "../src/work-item-review-intent.mjs";

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/work-item-review-intent-read-only.json", import.meta.url),
  "utf8",
));
const { frozenIntent, deliveryEvidence } = fixture;

test("projects review facts only from a frozen execution intent", () => {
  const projection = projectWorkItemReviewIntent({
    intentContract: frozenIntent,
    deliveryEvidence,
  });

  assert.equal(projection.source, "frozen_execution_contract");
  assert.equal(projection.intentDigest, "intent:frozen:analysis");
  assert.equal(projection.goal, "只分析 src 目录，不修改文件");
  assert.deepEqual(projection.materials.changeTargetTitles, []);
  assert.deepEqual(projection.confirmation, {
    requestedOperation: "apply_local_changes",
    operation: "review_result",
    effectCode: "result_only",
    riskCode: "uncommitted_worktree_retained",
    riskLevel: "low",
    resultOnly: true,
  });
});

test("fails closed instead of projecting mutable or incomplete intent", () => {
  assert.equal(projectWorkItemReviewIntent({ intentContract: { ...frozenIntent, snapshotKind: "current" } }).source, "unavailable");
  assert.equal(projectWorkItemReviewIntent({ intentContract: { ...frozenIntent, readOnly: false } }).confirmation.effectCode, "unavailable");
});
