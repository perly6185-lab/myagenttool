import { workResourceId } from "./work-resource-directory.mjs";

const EVIDENCE_SCHEMA_VERSION = 1;
const FINDING_SEVERITIES = new Set(["low", "medium", "high"]);

const DEVELOPMENT_TASK_RE = /(?:^|_)software_(?:analysis|implementation|verification|deployment)(?:$|_)/i;
const OFFICE_TASK_RE = /(?:^|_)(?:business|office|document|spreadsheet|procurement|legal|mail)_[a-z0-9_]+$/i;
const OFFICE_TEXT_RE = /(?:台账|表格|工作簿|报价|订单|合同|发货|回款|客户|联系人|报表|清单|名单|邮件|文档|演示文稿|excel|xlsx?|docx?|pptx?|spreadsheet|workbook|quotation|contract|invoice)/i;
const CLEAN_RE = /(?:no\s+(?:actionable\s+)?(?:findings?|issues?|bugs?|regressions?)|tests?\s+pass|looks\s+good|consistent|no\s+observable\s+regressions|未发现|没有发现|(?:结果|改动|补丁).{0,10}(?:相互)?一致|未引入明显回归)/i;

function boundedText(value, max = 2_000) {
  if (value == null) return null;
  return String(value).trim().slice(0, max) || null;
}

function deliveryDomain({ item = null, autoRun = null } = {}) {
  const taskKind = String(item?.taskKind ?? "").toLowerCase();
  const text = `${item?.title ?? ""}\n${item?.body ?? ""}`;
  if (DEVELOPMENT_TASK_RE.test(taskKind) || autoRun?.decision?.workKind === "development" || autoRun?.decision?.path === "develop") {
    return "development";
  }
  if (OFFICE_TASK_RE.test(taskKind) || autoRun?.decision?.workKind === "office" || autoRun?.decision?.path === "office" || OFFICE_TEXT_RE.test(`${taskKind}\n${text}`)) {
    return "office";
  }
  return "other";
}

function normalizeFinding(finding) {
  if (!finding || typeof finding !== "object") return null;
  const severity = FINDING_SEVERITIES.has(String(finding.severity)) ? String(finding.severity) : "medium";
  const file = boundedText(finding.file ?? finding.path, 500);
  const message = boundedText(finding.message ?? finding.body, 2_000);
  if (!message) return null;
  const line = Number.isInteger(finding.line) ? finding.line : null;
  return {
    severity,
    file,
    line,
    message,
    suggestion: boundedText(finding.suggestion, 2_000),
    confidence: FINDING_SEVERITIES.has(String(finding.confidence)) ? String(finding.confidence) : null,
  };
}

function reviewEvidence(review) {
  const source = review?.source
    ?? (review?.invocationId || review?.reviewInvocationId ? "ai" : review?.reviewedBy || review?.reviewer ? "human" : "unknown");
  const findings = (Array.isArray(review?.findings) ? review.findings : Array.isArray(review?.comments) ? review.comments : [])
    .map(normalizeFinding)
    .filter(Boolean)
    .slice(0, 100);
  const counts = findings.reduce((result, finding) => {
    result[finding.severity] += 1;
    return result;
  }, { low: 0, medium: 0, high: 0 });
  const verdict = review?.verdict === "approved" || review?.verdict === "changes_requested" ? review.verdict : null;
  const status = ["queued", "running", "completed", "failed", "unavailable"].includes(review?.status)
    ? review.status
    : verdict ? "completed" : "unavailable";
  const summary = boundedText(review?.summary);
  const blockingCount = counts.medium + counts.high;
  const consistency = verdict == null
    ? "unknown"
    : verdict === "changes_requested" && findings.length === 0 && CLEAN_RE.test(summary ?? "")
      ? "inconsistent"
      : verdict === "approved" && blockingCount > 0
        ? "inconsistent"
        : "consistent";
  return {
    status,
    source,
    verdict,
    summary,
    structured: review?.structured !== false,
    findings,
    findingCounts: { ...counts, total: findings.length },
    blockingCount,
    consistency,
    reviewedCommit: boundedText(review?.reviewedCommit, 200),
    reviewer: boundedText(review?.reviewer ?? review?.reviewerName, 200),
    invocationId: boundedText(review?.invocationId ?? review?.reviewInvocationId, 200),
    completedAt: review?.completedAt ?? review?.createdAt ?? null,
  };
}

function verificationEvidence(report, autoRun) {
  const verification = report?.verification ?? autoRun?.verification ?? null;
  const commands = Array.isArray(verification?.commands)
    ? verification.commands.map((command) => boundedText(command, 500)).filter(Boolean).slice(0, 20)
    : [];
  const command = boundedText(verification?.command, 500) ?? commands[commands.length - 1] ?? null;
  const verified = verification?.verified === true;
  const passed = verification?.passed === true;
  const status = !verification || !verified
    ? "missing"
    : !passed
      ? "failed"
      : "passed";
  return {
    status,
    passed: verification ? passed : null,
    verified,
    command,
    commands,
    exitCode: Number.isInteger(verification?.exitCode) ? verification.exitCode : null,
    summary: boundedText(verification?.summary),
  };
}

function officeActionDetails(item) {
  const contract = item?.channelTaskContract ?? item;
  const mutation = item?.dataMutationPreview ?? contract?.dataMutationPreview;
  const ledger = item?.ledgerMutationPreview ?? contract?.ledgerMutationPreview;
  const declaredTargets = Array.isArray(mutation?.targetSources) ? mutation.targetSources : [];
  const fallbackTargets = [
    ...(Array.isArray(item?.outputAssets) ? item.outputAssets : []),
    ...(Array.isArray(item?.fileDiscoveries) ? item.fileDiscoveries : []),
  ];
  const targetFiles = (declaredTargets.length ? declaredTargets : fallbackTargets)
    .map((asset) => boundedText(typeof asset === "string" ? asset : asset?.originalName ?? asset?.fileName ?? asset?.name ?? asset?.path, 300))
    .filter(Boolean);
  const targetResources = declaredTargets
    .filter((source) => source && typeof source === "object" && source.sourceId)
    .map((source) => ({
      resourceId: workResourceId(item?.ownerTeamId ?? "local", "channel_file_source", String(source.sourceId)),
      displayName: boundedText(source.fileName ?? source.name ?? source.path, 300) ?? "业务台账",
      locality: "local",
    }));
  const fields = [
    ...(Array.isArray(mutation?.requiredFields) ? mutation.requiredFields : []),
    ...(Array.isArray(mutation?.fieldChanges) ? mutation.fieldChanges.map((change) => change?.field) : []),
    ...(Array.isArray(item?.channelTaskContract?.executionPreview?.requiredFields)
      ? item.channelTaskContract.executionPreview.requiredFields : []),
  ].map((field) => boundedText(field, 160)).filter(Boolean);
  const rollbackAvailable = Boolean(ledger?.journal?.rollback)
    || Boolean(ledger?.journal?.snapshots?.length)
    || Number(ledger?.journal?.snapshotCount) > 0;
  const operation = mutation?.operation ?? ledger?.operation ?? null;
  const children = Array.isArray(ledger?.children) ? ledger.children : [];
  const failedChildren = children.filter((child) => ["invalidated", "expired"].includes(child?.state)).length;
  const committedChildren = children.filter((child) => child?.state === "committed").length;
  const restoredChildren = children.filter((child) => child?.state === "rolled_back").length;
  const unknownChildren = children.filter((child) => child?.state === "unknown").length;
  const pendingChildren = children.filter((child) => !["committed", "rolled_back", "invalidated", "expired", "unknown"].includes(child?.state)).length;
  const rollback = ledger?.journal?.rollback ?? null;
  const journalAppliedCount = Math.max(0, Number(ledger?.journal?.appliedCount)
    || (Array.isArray(ledger?.journal?.appliedPreviewIds) ? ledger.journal.appliedPreviewIds.length : 0));
  const successCount = children.length
    ? committedChildren
    : ledger?.state === "committed" ? journalAppliedCount : 0;
  const failedCount = Math.max(0, Number(rollback?.blockedTargets) || 0, failedChildren);
  const restoredCount = Math.max(0, Number(rollback?.restoredTargets) || 0, restoredChildren);
  const rollbackStatus = ledger?.state === "rolled_back"
    ? "rolled_back"
    : rollback && failedCount > 0
      ? "partial"
      : rollback || ledger?.journal?.snapshotCount > 0 || ledger?.journal?.snapshots?.length > 0
        ? "prepared"
        : "not_available";
  const batch = ledger?.kind === "batch"
    ? (() => {
      const targetCount = Number.isInteger(ledger.targetCount) ? ledger.targetCount : children.length;
      const pendingCount = children.length
        ? pendingChildren
        : ["pending", "waiting", "committing"].includes(ledger?.state) ? targetCount : 0;
      const unknownCount = Math.max(unknownChildren, targetCount - successCount - failedCount - restoredCount - pendingCount);
      return {
        state: boundedText(ledger.state, 40) || "pending",
        targetCount,
        operationCount: Number.isInteger(ledger.operationCount) ? ledger.operationCount : children.length,
        successCount,
        failedCount,
        restoredCount,
        pendingCount,
        unknownCount,
        rollback: {
          status: rollbackStatus,
          restoredTargets: Math.max(0, Number(rollback?.restoredTargets) || 0),
          blockedTargets: Math.max(0, Number(rollback?.blockedTargets) || 0),
        },
        details: children.slice(0, 20).map((child) => ({
          id: boundedText(child?.id, 200),
          businessKey: boundedText(child?.businessKey, 300),
          action: boundedText(child?.action, 40),
          rowNumber: Number.isInteger(child?.rowNumber) ? child.rowNumber : null,
          state: boundedText(child?.state, 40) || "pending",
          changedFields: Array.isArray(child?.changedCells)
            ? [...new Set(child.changedCells.map((cell) => boundedText(cell?.field, 120)).filter(Boolean))].slice(0, 20)
            : [],
        })),
      };
    })()
    : null;
  return {
    targetFiles: [...new Set(targetFiles)].slice(0, 50),
    targetResources: targetResources.slice(0, 50),
    estimatedAffectedRows: Number.isInteger(mutation?.estimatedAffectedRows)
      ? mutation.estimatedAffectedRows
      : Number.isInteger(ledger?.targetCount) ? ledger.targetCount : null,
    fields: [...new Set(fields)].slice(0, 40),
    operation: boundedText(operation, 80),
    writeMode: boundedText(mutation?.writeMode, 80),
    reversible: rollbackAvailable ? true : operation === "delete" ? false : null,
    batch,
  };
}

function evidenceStatus(review, verification) {
  if (review.consistency === "inconsistent") return { status: "review_inconsistent", risk: "unknown" };
  if (review.structured === false) return { status: "evidence_incomplete", risk: "unknown" };
  if (["queued", "running"].includes(review.status)) return { status: "review_pending", risk: "unknown" };
  if (review.status === "failed" || review.status === "unavailable") return { status: "review_pending", risk: "unknown" };
  if (review.verdict === "changes_requested") return { status: "changes_requested", risk: "high" };
  if (verification.status === "failed") return { status: "verification_failed", risk: "high" };
  if (review.verdict == null) return { status: "evidence_incomplete", risk: "unknown" };
  if (review.status !== "completed" || review.verdict !== "approved") return { status: "review_pending", risk: "unknown" };
  if (verification.status === "missing") return { status: "verification_missing", risk: "medium" };
  return { status: "ready", risk: "low" };
}

export function buildDeliveryEvidence({
  item = null,
  autoRun = null,
  deliveryReport = null,
  deliveryReview = null,
  deliveryMode = null,
  worktreeId = null,
  branchName = null,
  remoteUrl = null,
} = {}) {
  const domain = deliveryDomain({ item, autoRun });
  const review = reviewEvidence(deliveryReview);
  const verification = verificationEvidence(deliveryReport, autoRun);
  const officeDetails = domain === "office" ? officeActionDetails(item) : null;
  const existingPullRequest = autoRun?.localDelivery?.existingPullRequest ?? null;
  const pullRequestExists = Boolean(existingPullRequest?.number || existingPullRequest?.url
    || autoRun?.localDelivery?.existingPrNumber || autoRun?.localDelivery?.existingPrUrl);
  const evidenceDecision = evidenceStatus(review, verification);
  let decision = evidenceDecision;
  if (officeDetails?.batch) {
    const batchState = officeDetails.batch.state;
    if (officeDetails.batch.failedCount > 0 || officeDetails.batch.unknownCount > 0 || ["partial", "needs_attention", "invalidated"].includes(batchState)) {
      decision = { status: "office_batch_attention", risk: "high" };
    } else if (batchState === "rolled_back") {
      decision = { status: "office_batch_rolled_back", risk: "medium" };
    } else if (["pending", "waiting", "committing"].includes(batchState) && officeDetails.batch.pendingCount > 0) {
      decision = { status: "office_batch_in_progress", risk: "medium" };
    }
  }
  const changedFileNames = Array.isArray(deliveryReport?.changedFiles)
    ? deliveryReport.changedFiles.map((file) => boundedText(file, 500)).filter(Boolean)
    : [];
  const changedFiles = changedFileNames.slice(0, 100);
  const blockedReasonCodes = [];
  for (const status of new Set([evidenceDecision.status, decision.status])) {
    if (status === "review_inconsistent") blockedReasonCodes.push("review_inconsistent");
    if (status === "review_pending") blockedReasonCodes.push("review_required");
    if (status === "evidence_incomplete") blockedReasonCodes.push(review.structured === false ? "structured_review_required" : "review_required");
    if (status === "changes_requested") blockedReasonCodes.push("review_changes_requested");
    if (status === "verification_failed") blockedReasonCodes.push("verification_failed");
    if (status === "verification_missing") blockedReasonCodes.push("verification_required");
    if (status === "office_batch_attention") blockedReasonCodes.push("office_batch_attention");
    if (status === "office_batch_rolled_back") blockedReasonCodes.push("office_batch_rolled_back");
    if (status === "office_batch_in_progress") blockedReasonCodes.push("office_batch_in_progress");
  }
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    status: decision.status,
    risk: decision.risk,
    domain,
    review,
    verification,
    blockingReasonCodes: blockedReasonCodes,
    actionPreview: {
      mode: deliveryMode,
      operation: deliveryMode === "pull_request"
        ? pullRequestExists ? "update_pull_request" : "create_pull_request"
        : domain === "office" ? "apply_office_result" : "apply_local_changes",
      targetType: deliveryMode === "pull_request" ? "pull_request" : domain === "office" ? "office_artifact" : "local_project",
      artifactKind: domain === "office" ? "office_artifact" : "source_code",
      deliveryTransport: deliveryMode,
      worktreeId: boundedText(worktreeId, 200),
      branchName: boundedText(branchName, 500),
      remoteUrl: boundedText(remoteUrl, 1_000),
      changedFileCount: changedFileNames.length,
      changedFiles,
      officeDetails,
      reviewedCommit: review.reviewedCommit,
      requiresConfirmation: true,
      canProceed: decision.status === "ready",
      blockedReasonCodes,
    },
  };
}

export { EVIDENCE_SCHEMA_VERSION };
