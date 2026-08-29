import { buildDeliveryEvidence } from "./work-item-delivery-evidence.mjs";

// Read-only evidence assembler for the task review screen. It resolves live
// development review state and live office-batch journals into one normalized
// projection, keeping mutable-state lookup out of the HTTP-facing work-item use
// case. No source record is mutated or exposed directly.
export function projectWorkItemReviewEvidence({
  item,
  state,
  boundRuns = [],
  latestRun = null,
  pendingLocalDelivery = false,
  deliveryWorktree = null,
  deliveryReview = null,
  outcomeWorktreeId = null,
} = {}) {
  const deliveryProject = (state?.projects ?? []).find((project) => project.id === item?.projectId) ?? null;
  const deliveryRemoteUrl = deliveryProject?.git?.remoteUrl ?? null;
  const localDeliveryMode = latestRun?.localDelivery?.mode ?? null;
  const deliveryMode = ["uncommitted_worktree", "committed_worktree"].includes(localDeliveryMode)
    ? "local_merge"
    : deliveryRemoteUrl && /github\.com[/:]/i.test(deliveryRemoteUrl)
      ? "pull_request"
      : "local_merge";
  const runIds = new Set(boundRuns.map((run) => run.id));
  const currentInvocationIds = new Set(boundRuns
    .filter((run) => run.invocationId)
    .map((run) => run.invocationId));
  const relatedInvocations = (state?.invocations ?? [])
    .filter((invocation) => {
      const autoRunId = invocation.options?.metadata?.autoRunId;
      return (autoRunId && runIds.has(autoRunId)) || currentInvocationIds.has(invocation.id);
    })
    .sort((left, right) =>
      String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""))
      || String(left.id).localeCompare(String(right.id)));
  const runInvocations = relatedInvocations.filter(
    (invocation) => invocation.options?.metadata?.role !== "delivery_review",
  );
  const latestExecutionInvocation = runInvocations.find(
    (invocation) => invocation.id === latestRun?.invocationId,
  ) ?? null;
  const reviewInvocation = latestRun?.deliveryReview?.invocationId
    ? relatedInvocations.find((invocation) => invocation.id === latestRun.deliveryReview.invocationId) ?? null
    : null;
  const projectedDeliveryReview = latestRun?.deliveryReview
    ? {
        ...latestRun.deliveryReview,
        status: latestRun.deliveryReview.status === "queued" && reviewInvocation?.status === "running"
          ? "running"
          : latestRun.deliveryReview.status,
      }
    : null;
  const projectedDeliveryReport = latestRun?.deliveryReport ?? (pendingLocalDelivery ? {
    summary: latestExecutionInvocation?.result?.output?.latestMessage
      ?? latestExecutionInvocation?.result?.output?.summary
      ?? latestExecutionInvocation?.result?.summary
      ?? null,
    verification: latestRun?.verification ? { ...latestRun.verification } : null,
    changedFiles: [],
    completedAt: latestExecutionInvocation?.completedAt ?? latestRun?.updatedAt ?? null,
  } : null);

  const storedLedgerPreview = item?.channelTaskContract?.ledgerMutationPreview ?? item?.ledgerMutationPreview ?? null;
  const liveLedgerBatch = storedLedgerPreview?.kind === "batch" && storedLedgerPreview.id
    ? (state?.ledgerBatchUpsertPreviews ?? []).find((batch) =>
      batch.id === storedLedgerPreview.id
      && batch.ownerTeamId === item.ownerTeamId
      && batch.projectId === item.projectId) ?? null
    : null;
  const liveLedgerJournal = liveLedgerBatch
    ? (state?.ledgerBatchMutationJournals ?? [])
      .filter((journal) => journal.batchPreviewId === liveLedgerBatch.id && journal.ownerTeamId === item.ownerTeamId)
      .sort((left, right) => String(left.updatedAt ?? "").localeCompare(String(right.updatedAt ?? "")))
      .at(-1) ?? null
    : null;
  const liveLedgerChildren = liveLedgerBatch
    ? (liveLedgerBatch.childPreviewIds ?? []).map((previewId) =>
      (state?.ledgerUpsertPreviews ?? []).find((preview) =>
        preview.id === previewId && preview.ownerTeamId === item.ownerTeamId && preview.projectId === item.projectId)
        ?? { id: previewId, state: "unknown", missing: true })
    : [];
  const staleLedgerBatch = Boolean(storedLedgerPreview?.kind === "batch" && storedLedgerPreview.id && !liveLedgerBatch);
  const resolvedLedgerPreview = liveLedgerBatch || staleLedgerBatch
    ? {
        ...(liveLedgerBatch ?? storedLedgerPreview),
        kind: "batch",
        state: staleLedgerBatch ? "needs_attention" : liveLedgerBatch.state,
        children: staleLedgerBatch ? [] : liveLedgerChildren,
        journal: staleLedgerBatch ? null : liveLedgerJournal,
        evidenceStale: staleLedgerBatch,
      }
    : null;
  const evidenceItem = resolvedLedgerPreview
    ? {
        ...item,
        // Legacy records may keep this preview at the task root while Channel
        // contracts keep it nested. Project the same live batch into both read
        // locations so source shape cannot make stale evidence win.
        ledgerMutationPreview: resolvedLedgerPreview,
        channelTaskContract: {
          ...(item?.channelTaskContract ?? {}),
          ledgerMutationPreview: resolvedLedgerPreview,
        },
      }
    : item;
  const hasOfficeActionEvidence = Boolean(
    evidenceItem?.channelTaskContract?.ledgerMutationPreview
    ?? evidenceItem?.ledgerMutationPreview
    ?? evidenceItem?.channelTaskContract?.dataMutationPreview
    ?? evidenceItem?.dataMutationPreview,
  );
  const deliveryEvidence = pendingLocalDelivery || hasOfficeActionEvidence
    ? buildDeliveryEvidence({
        item: evidenceItem,
        autoRun: latestRun,
        deliveryReport: projectedDeliveryReport,
        deliveryReview: deliveryReview ?? projectedDeliveryReview,
        deliveryMode: hasOfficeActionEvidence ? "local_merge" : deliveryMode,
        worktreeId: latestRun?.localDelivery?.worktreeId ?? outcomeWorktreeId,
        branchName: latestRun?.localDelivery?.branchName ?? deliveryWorktree?.branchName ?? null,
        remoteUrl: deliveryRemoteUrl,
      })
    : null;

  return {
    deliveryProject,
    deliveryRemoteUrl,
    deliveryMode,
    relatedInvocations,
    runInvocations,
    latestExecutionInvocation,
    projectedDeliveryReview,
    projectedDeliveryReport,
    deliveryEvidence,
  };
}
