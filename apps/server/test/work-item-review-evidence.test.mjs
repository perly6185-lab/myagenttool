import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { projectWorkItemReviewEvidence } from "../src/services/work-item-review-evidence.mjs";

test("development evidence resolves the live review invocation without mutating the run", () => {
  const latestRun = {
    id: "aur_1",
    invocationId: "inv_work",
    deliveryReview: { invocationId: "inv_review", status: "queued", verdict: null },
    localDelivery: { worktreeId: "wtr_1", branchName: "feature/review" },
  };
  const result = projectWorkItemReviewEvidence({
    item: { id: "wi_1", projectId: "prj_1", taskKind: "software_implementation" },
    state: {
      projects: [{ id: "prj_1", git: { remoteUrl: "https://github.com/example/repo.git" } }],
      invocations: [
        { id: "inv_work", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "inv_review", status: "running", createdAt: "2026-01-01T00:01:00.000Z", options: { metadata: { autoRunId: "aur_1", role: "delivery_review" } } },
      ],
    },
    boundRuns: [latestRun],
    latestRun,
    pendingLocalDelivery: true,
    deliveryWorktree: { id: "wtr_1", branchName: "feature/review" },
    outcomeWorktreeId: "wtr_1",
  });

  assert.equal(result.deliveryMode, "pull_request");
  assert.equal(result.projectedDeliveryReview.status, "running");
  assert.equal(latestRun.deliveryReview.status, "queued", "projection does not mutate durable run state");
  assert.equal(result.runInvocations.length, 1);
});

test("an uncommitted worktree stays a local delivery even when the project has GitHub", () => {
  const latestRun = {
    id: "aur_uncommitted",
    invocationId: "inv_work",
    status: "done",
    localDelivery: { worktreeId: "wtr_1", branchName: "local-work", mode: "uncommitted_worktree", commitCreated: false },
    deliveryReport: { changedFiles: ["docs/result.md"] },
    deliveryReview: { status: "completed", verdict: "approved", findings: [], summary: "No findings." },
  };
  const result = projectWorkItemReviewEvidence({
    item: {
      id: "wi_uncommitted", projectId: "prj_1", taskKind: "software_implementation",
      intentStatement: "新增 docs/result.md，不创建提交、不创建 PR、不推送远程。",
      acceptanceCriteria: ["文档正确"], verificationSop: ["检查内容"],
    },
    state: {
      projects: [{ id: "prj_1", git: { remoteUrl: "https://github.com/example/repo.git" } }],
      invocations: [{ id: "inv_work", createdAt: "2026-01-01T00:00:00.000Z" }],
    },
    boundRuns: [latestRun], latestRun, pendingLocalDelivery: true,
    deliveryWorktree: { id: "wtr_1", branchName: "local-work" }, outcomeWorktreeId: "wtr_1",
  });

  assert.equal(result.deliveryMode, "local_merge");
  assert.equal(result.deliveryEvidence.actionPreview.operation, "apply_local_changes");
  assert.equal(result.deliveryEvidence.actionPreview.canProceed, false);
  assert.ok(result.deliveryEvidence.blockingReasonCodes.includes("delivery_action_forbidden_by_intent"));
});

test("office evidence resolves the live batch and reports missing children as unknown", () => {
  const item = {
    id: "wi_office",
    ownerTeamId: "team_1",
    projectId: "prj_1",
    taskKind: "business_spreadsheet",
    ledgerMutationPreview: { id: "lbp_1", kind: "batch", state: "pending" },
  };
  const result = projectWorkItemReviewEvidence({
    item,
    state: {
      projects: [{ id: "prj_1" }],
      invocations: [],
      ledgerBatchUpsertPreviews: [{
        id: "lbp_1", kind: "batch", state: "partial", ownerTeamId: "team_1", projectId: "prj_1",
        targetCount: 2, childPreviewIds: ["lup_1", "lup_missing"],
      }],
      ledgerUpsertPreviews: [{ id: "lup_1", ownerTeamId: "team_1", projectId: "prj_1", state: "committed" }],
      ledgerBatchMutationJournals: [],
    },
  });

  const batch = result.deliveryEvidence.actionPreview.officeDetails.batch;
  assert.equal(result.deliveryEvidence.status, "office_batch_attention");
  assert.equal(batch.successCount, 1);
  assert.equal(batch.unknownCount, 1);
  assert.equal(batch.details[1].state, "unknown");
});

test("work-item use case delegates review evidence instead of reading delivery stores directly", () => {
  const source = readFileSync(new URL("../src/services/work-items.mjs", import.meta.url), "utf8");
  assert.match(source, /projectWorkItemReviewEvidence/);
  assert.doesNotMatch(source, /buildDeliveryEvidence/);
  assert.doesNotMatch(source, /ledgerBatchMutationJournals/);
  assert.doesNotMatch(source, /ledgerBatchUpsertPreviews/);
});
