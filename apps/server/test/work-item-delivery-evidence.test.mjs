import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDeliveryEvidence } from "../src/services/work-item-delivery-evidence.mjs";

test("projects a verified development delivery into a confirmable action preview", () => {
  const evidence = buildDeliveryEvidence({
    item: { taskKind: "software_implementation", title: "Update API", body: "" },
    autoRun: { decision: { path: "develop", workKind: "development" } },
    deliveryReport: {
      changedFiles: ["apps/server/src/routes/agents.mjs"],
      verification: { passed: true, verified: true, command: "pnpm test:unit", exitCode: 0, summary: "passed" },
    },
    deliveryReview: { status: "completed", verdict: "approved", summary: "No findings.", findings: [], reviewedCommit: "abc123" },
    deliveryMode: "pull_request",
    worktreeId: "wtr_1",
    branchName: "feature/api",
    remoteUrl: "https://github.com/example/repo.git",
  });

  assert.equal(evidence.status, "ready");
  assert.equal(evidence.risk, "low");
  assert.equal(evidence.domain, "development");
  assert.equal(evidence.verification.command, "pnpm test:unit");
  assert.equal(evidence.actionPreview.operation, "create_pull_request");
  assert.equal(evidence.actionPreview.canProceed, true);
  assert.deepEqual(evidence.actionPreview.blockedReasonCodes, []);
});

test("keeps missing verification separate from a confirmed defect", () => {
  const evidence = buildDeliveryEvidence({
    item: { taskKind: "software_verification", title: "Run checks", body: "" },
    autoRun: { decision: { path: "develop", workKind: "development" } },
    deliveryReport: { changedFiles: [], verification: { passed: true, verified: false, commands: [], summary: "No verification command configured." } },
    deliveryReview: { status: "completed", verdict: "approved", summary: "No issues found.", findings: [] },
    deliveryMode: "local_merge",
  });

  assert.equal(evidence.status, "verification_missing");
  assert.equal(evidence.risk, "medium");
  assert.deepEqual(evidence.blockingReasonCodes, ["verification_required"]);
  assert.equal(evidence.actionPreview.canProceed, false);
});

test("does not infer verified evidence from passed alone", () => {
  const evidence = buildDeliveryEvidence({
    item: { taskKind: "software_verification", title: "Run checks", body: "" },
    deliveryReport: { changedFiles: [], verification: { passed: true, summary: "claimed success" } },
    deliveryReview: { status: "completed", verdict: "approved", summary: "No findings.", findings: [] },
    deliveryMode: "local_merge",
  });

  assert.equal(evidence.verification.status, "missing");
  assert.equal(evidence.status, "verification_missing");
  assert.equal(evidence.actionPreview.canProceed, false);
});

test("uses passed document result verification and blocks delivery actions forbidden by intent", () => {
  const evidence = buildDeliveryEvidence({
    item: {
      taskKind: "software_implementation",
      title: "软件实现",
      intentStatement: "新增 docs/result.md，不创建提交、不创建 PR、不推送远程。",
      artifactContract: { produces: ["software_change"], requirements: [{ kind: "software_change", minCount: 1 }] },
      resultVerification: { status: "passed", summary: "目标文档及内容检查通过。", checks: [{ kind: "software_change", status: "passed" }] },
      acceptanceCriteria: ["文档正确"],
      verificationSop: ["检查内容"],
    },
    autoRun: { decision: { path: "develop", workKind: "development" }, localDelivery: { mode: "uncommitted_worktree" } },
    deliveryReport: { changedFiles: ["docs/result.md"], verification: { passed: true, verified: false, summary: "No verification command configured." } },
    deliveryReview: { status: "completed", verdict: "approved", summary: "No findings.", findings: [] },
    deliveryMode: "local_merge",
  });

  assert.equal(evidence.status, "ready");
  assert.equal(evidence.verification.status, "passed");
  assert.equal(evidence.verification.source, "result_verification");
  assert.equal(evidence.actionPreview.operation, "apply_local_changes");
  assert.equal(evidence.actionPreview.canProceed, false);
  assert.deepEqual(evidence.blockingReasonCodes, ["delivery_action_forbidden_by_intent"]);
});

test("does not allow an explicitly unstructured review to become approval evidence", () => {
  const evidence = buildDeliveryEvidence({
    item: { taskKind: "software_implementation", title: "Update API", body: "" },
    deliveryReport: { changedFiles: [], verification: { passed: true, verified: true, summary: "passed" } },
    deliveryReview: { status: "completed", structured: false, verdict: "approved", summary: "Looks good.", findings: [] },
    deliveryMode: "pull_request",
  });

  assert.equal(evidence.status, "evidence_incomplete");
  assert.deepEqual(evidence.blockingReasonCodes, ["structured_review_required"]);
  assert.equal(evidence.actionPreview.canProceed, false);
});

test("normalizes a historical clean review contradiction and uses office action language", () => {
  const evidence = buildDeliveryEvidence({
    item: { taskKind: "business_document", title: "整理客户台账", body: "" },
    autoRun: { decision: { path: "office", workKind: "office" } },
    deliveryReport: { changedFiles: ["客户台账.xlsx"], verification: null },
    deliveryReview: { status: "completed", verdict: "changes_requested", summary: "The result is consistent and has no observable regressions.", findings: [] },
    deliveryMode: "local_merge",
  });

  assert.equal(evidence.status, "verification_missing");
  assert.equal(evidence.review.verdict, "approved");
  assert.equal(evidence.review.reportedVerdict, "changes_requested");
  assert.equal(evidence.review.consistency, "corrected_clean_summary");
  assert.equal(evidence.domain, "office");
  assert.equal(evidence.actionPreview.operation, "apply_office_result");
  assert.equal(evidence.actionPreview.targetType, "office_artifact");
  assert.equal(evidence.actionPreview.canProceed, false);
});

test("projects office batch counts, rollback state, and bounded item details", () => {
  const evidence = buildDeliveryEvidence({
    item: {
      taskKind: "business_spreadsheet",
      title: "更新客户台账",
      body: "",
      ledgerMutationPreview: {
        kind: "batch",
        targetCount: 3,
        operationCount: 3,
        state: "partial",
        journal: {
          appliedCount: 2,
          snapshotCount: 2,
          rollback: { restoredTargets: 1, blockedTargets: 1 },
        },
        children: [
          { id: "op_1", businessKey: "CUS-001", action: "update", rowNumber: 2, state: "committed", changedCells: [{ field: "status", column: "C", before: "new", after: "ready" }] },
          { id: "op_2", businessKey: "CUS-002", action: "update", rowNumber: 3, state: "committed", changedCells: [{ field: "status", column: "C" }] },
          { id: "op_3", businessKey: "CUS-003", action: "update", rowNumber: 4, state: "invalidated", changedCells: [{ field: "status", column: "C" }] },
        ],
      },
    },
    autoRun: { decision: { path: "office", workKind: "office" } },
    deliveryReport: { changedFiles: ["客户台账.xlsx"], verification: { passed: true, verified: true, summary: "文件已生成" } },
    deliveryReview: { status: "completed", verdict: "approved", summary: "结果一致", findings: [] },
    deliveryMode: "local_merge",
  });

  assert.equal(evidence.actionPreview.officeDetails.batch.successCount, 2);
  assert.equal(evidence.actionPreview.officeDetails.batch.failedCount, 1);
  assert.equal(evidence.actionPreview.officeDetails.batch.rollback.status, "partial");
  assert.equal(evidence.status, "office_batch_attention");
  assert.equal(evidence.risk, "high");
  assert.equal(evidence.actionPreview.canProceed, false);
  assert.deepEqual(evidence.actionPreview.officeDetails.batch.rollback, {
    status: "partial",
    protectedTargets: 2,
    restoredTargets: 1,
    blockedTargets: 1,
    unknownTargets: 0,
    countConsistent: true,
  });
  assert.equal(evidence.actionPreview.officeDetails.batch.countConsistent, true);
  assert.equal(evidence.actionPreview.officeDetails.batch.details[0].businessKey, "CUS-001");
  assert.deepEqual(evidence.actionPreview.officeDetails.batch.details[0].changedFields, ["status"]);
});

test("links an office target to the same stable work-resource identity", () => {
  const evidence = buildDeliveryEvidence({
    item: {
      ownerTeamId: "team_1",
      taskKind: "business_spreadsheet",
      title: "更新客户台账",
      dataMutationPreview: {
        operation: "update",
        targetSources: [{ sourceId: "source_1", fileName: "客户台账.xlsx" }],
      },
    },
  });

  assert.equal(evidence.actionPreview.officeDetails.targetResources.length, 1);
  assert.match(evidence.actionPreview.officeDetails.targetResources[0].resourceId, /^wres_[a-f0-9]{32}$/);
  assert.equal(evidence.actionPreview.officeDetails.targetResources[0].displayName, "客户台账.xlsx");
  assert.equal(evidence.actionPreview.officeDetails.targetResources[0].locality, "local");
});

test("office batch failures outrank a pending review and read the real channel contract shape", () => {
  const evidence = buildDeliveryEvidence({
    item: {
      taskKind: "business_spreadsheet",
      title: "更新客户台账",
      channelTaskContract: {
        dataMutationPreview: { operation: "update", estimatedAffectedRows: 2, requiredFields: ["status"] },
        ledgerMutationPreview: {
          kind: "batch",
          state: "partial",
          targetCount: 2,
          operationCount: 2,
          journal: { appliedCount: 1, snapshotCount: 2, rollback: { restoredTargets: 1, blockedTargets: 1 } },
          children: [
            { id: "op_1", businessKey: "CUS-001", state: "rolled_back", changedCells: [{ field: "status" }] },
            { id: "op_2", businessKey: "CUS-002", state: "invalidated", changedCells: [{ field: "status" }] },
          ],
        },
      },
    },
    deliveryReview: { status: "running", verdict: null, summary: "Reviewing", findings: [] },
    deliveryReport: { changedFiles: ["客户台账.xlsx"], verification: null },
  });

  assert.equal(evidence.status, "office_batch_attention");
  assert.equal(evidence.risk, "high");
  assert.equal(evidence.actionPreview.officeDetails.estimatedAffectedRows, 2);
  assert.deepEqual(evidence.actionPreview.officeDetails.fields, ["status"]);
  assert.ok(evidence.blockingReasonCodes.includes("office_batch_attention"));
  assert.ok(evidence.blockingReasonCodes.includes("review_required"));
});

test("keeps review waiting, confirmed defects, and failed verification as distinct states", () => {
  const base = {
    item: { taskKind: "software_implementation", title: "Update API", body: "" },
    autoRun: { decision: { path: "develop", workKind: "development" } },
    deliveryReport: { changedFiles: ["src/api.ts"], verification: { passed: true, verified: true, summary: "passed" } },
    deliveryMode: "local_merge",
  };
  const waiting = buildDeliveryEvidence({
    ...base,
    deliveryReview: { status: "running", verdict: null, summary: "Reviewing", findings: [] },
  });
  assert.equal(waiting.status, "review_pending");
  assert.equal(waiting.risk, "unknown");

  const changes = buildDeliveryEvidence({
    ...base,
    deliveryReview: {
      status: "completed",
      verdict: "changes_requested",
      summary: "Persistence is missing.",
      findings: [{ severity: "high", file: "src/api.ts", line: 12, message: "The update is not persisted." }],
    },
  });
  assert.equal(changes.status, "changes_requested");
  assert.equal(changes.risk, "high");
  assert.deepEqual(changes.blockingReasonCodes, ["review_changes_requested"]);

  const changesWithoutStructuredFindings = buildDeliveryEvidence({
    ...base,
    deliveryReview: { status: "completed", verdict: "changes_requested", summary: "The requested behavior is incomplete.", findings: [] },
  });
  assert.equal(changesWithoutStructuredFindings.status, "changes_requested");
  assert.equal(changesWithoutStructuredFindings.actionPreview.canProceed, false);

  const failedVerification = buildDeliveryEvidence({
    ...base,
    deliveryReport: { changedFiles: ["src/api.ts"], verification: { passed: false, verified: true, summary: "tests failed" } },
    deliveryReview: { status: "completed", verdict: "approved", summary: "No review findings.", findings: [] },
  });
  assert.equal(failedVerification.status, "verification_failed");
  assert.equal(failedVerification.risk, "high");
  assert.deepEqual(failedVerification.blockingReasonCodes, ["verification_failed"]);
});

test("projects all-success and fully rolled-back office batches without conflating them", () => {
  const base = {
    taskKind: "business_spreadsheet",
    title: "更新客户台账",
    body: "",
  };
  const allSuccess = buildDeliveryEvidence({
    item: {
      ...base,
      ledgerMutationPreview: {
        kind: "batch", state: "committed", targetCount: 2, operationCount: 2,
        children: [
          { id: "op_1", state: "committed", changedCells: [] },
          { id: "op_2", state: "committed", changedCells: [] },
        ],
      },
    },
  });
  assert.equal(allSuccess.actionPreview.officeDetails.batch.successCount, 2);
  assert.equal(allSuccess.actionPreview.officeDetails.batch.failedCount, 0);
  assert.equal(allSuccess.actionPreview.officeDetails.batch.rollback.status, "not_available");

  const rolledBack = buildDeliveryEvidence({
    item: {
      ...base,
      ledgerMutationPreview: {
        kind: "batch", state: "rolled_back", targetCount: 2, operationCount: 2,
        journal: { appliedCount: 2, snapshotCount: 2, rollback: { restoredTargets: 2, blockedTargets: 0 } },
        children: [
          { id: "op_1", state: "rolled_back", changedCells: [] },
          { id: "op_2", state: "rolled_back", changedCells: [] },
        ],
      },
    },
    deliveryReport: { changedFiles: ["客户台账.xlsx"], verification: { passed: true, verified: true, summary: "文件已验证" } },
    deliveryReview: { status: "completed", verdict: "approved", summary: "结果结构正确", findings: [] },
  });
  assert.equal(rolledBack.actionPreview.officeDetails.batch.successCount, 0);
  assert.equal(rolledBack.actionPreview.officeDetails.batch.restoredCount, 2);
  assert.equal(rolledBack.actionPreview.officeDetails.batch.failedCount, 0);
  assert.equal(rolledBack.actionPreview.officeDetails.batch.rollback.status, "rolled_back");
  assert.equal(rolledBack.actionPreview.officeDetails.batch.rollback.restoredTargets, 2);
  assert.equal(rolledBack.status, "office_batch_rolled_back");
  assert.equal(rolledBack.actionPreview.canProceed, false);
});

test("treats a not-yet-expanded office batch as pending rather than missing evidence", () => {
  const evidence = buildDeliveryEvidence({
    item: {
      taskKind: "business_spreadsheet",
      title: "更新客户台账",
      ledgerMutationPreview: { kind: "batch", state: "pending", targetCount: 3, operationCount: 3, children: [] },
    },
    deliveryReport: { changedFiles: ["客户台账.xlsx"], verification: { passed: true, verified: true, summary: "文件已验证" } },
    deliveryReview: { status: "completed", verdict: "approved", summary: "结果结构正确", findings: [] },
  });

  assert.equal(evidence.actionPreview.officeDetails.batch.pendingCount, 3);
  assert.equal(evidence.actionPreview.officeDetails.batch.unknownCount, 0);
  assert.equal(evidence.status, "office_batch_in_progress");
  assert.equal(evidence.risk, "medium");
});

test("fails closed when a terminal office batch omits operation receipts", () => {
  const evidence = buildDeliveryEvidence({
    item: {
      taskKind: "business_spreadsheet",
      title: "更新客户台账",
      ledgerMutationPreview: {
        kind: "batch",
        state: "committed",
        targetCount: 2,
        operationCount: 3,
        children: [
          { id: "op_1", state: "committed", changedCells: [] },
          { id: "op_2", state: "committed", changedCells: [] },
        ],
      },
    },
    deliveryReport: { changedFiles: ["客户台账.xlsx"], verification: { passed: true, verified: true, summary: "文件已验证" } },
    deliveryReview: { status: "completed", verdict: "approved", summary: "结果结构正确", findings: [] },
  });

  const batch = evidence.actionPreview.officeDetails.batch;
  assert.equal(batch.operationCount, 3);
  assert.equal(batch.accountedCount, 2);
  assert.equal(batch.unknownCount, 1);
  assert.equal(batch.countConsistent, false);
  assert.ok(batch.anomalyCodes.includes("operation_count_mismatch"));
  assert.equal(evidence.status, "office_batch_attention");
  assert.equal(evidence.risk, "high");
  assert.ok(evidence.blockingReasonCodes.includes("office_batch_evidence_inconsistent"));
  assert.equal(evidence.actionPreview.canProceed, false);
});

test("uses declared office targets and models pull request transport independently from artifact type", () => {
  const evidence = buildDeliveryEvidence({
    item: {
      taskKind: "business_spreadsheet",
      title: "更新客户台账",
      inputAssets: [{ originalName: "参考说明.docx" }],
      outputAssets: [{ originalName: "临时导出.xlsx" }],
      channelTaskContract: {
        dataMutationPreview: {
          operation: "update",
          targetSources: [{ fileName: "客户台账.xlsx" }],
        },
      },
    },
    autoRun: {
      decision: { path: "office", workKind: "office" },
      localDelivery: { existingPullRequest: { number: 42, url: "https://github.com/example/repo/pull/42" } },
    },
    deliveryReport: { changedFiles: ["客户台账.xlsx"], verification: { passed: true, verified: true, summary: "validated" } },
    deliveryReview: { status: "completed", verdict: "approved", summary: "结果一致", findings: [] },
    deliveryMode: "pull_request",
  });

  assert.deepEqual(evidence.actionPreview.officeDetails.targetFiles, ["客户台账.xlsx"]);
  assert.equal(evidence.actionPreview.operation, "update_pull_request");
  assert.equal(evidence.actionPreview.targetType, "pull_request");
  assert.equal(evidence.actionPreview.artifactKind, "office_artifact");
});
