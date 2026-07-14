export function buildEvidenceCenterRecords({
  state,
  findInvocation,
  codexSessionForInvocation,
  repoPathForEvidence,
}) {
  const records = [];
  for (const evidence of state.codexEvidenceRecords ?? []) {
    records.push({
      id: evidence.id,
      type: evidence.fileChangeSummary ? "file_change" : evidence.commandSummary ? "command" : "jsonl_event",
      source: "managed_codex_jsonl",
      redactionState: evidence.redactionState,
      invocationId: evidence.invocationId,
      codexSessionRegistryId: evidence.codexSessionRegistryId,
      agentId: findInvocation(evidence.invocationId)?.agentId ?? null,
      repoPath: repoPathForEvidence(evidence.codexSessionRegistryId),
      summary: evidence.fileChangeSummary ?? evidence.commandSummary ?? evidence.summary,
      detail: evidence.diffPreview ?? evidence.summary,
      marker: "managed",
      createdAt: evidence.createdAt
    });
  }
  for (const hook of state.codexHookEvents ?? []) {
    records.push({
      id: hook.id,
      type: "hook_event",
      source: "managed_codex_hook",
      redactionState: hook.redactionState,
      invocationId: hook.invocationId,
      codexSessionRegistryId: hook.codexSessionRegistryId,
      agentId: findInvocation(hook.invocationId)?.agentId ?? null,
      repoPath: repoPathForEvidence(hook.codexSessionRegistryId),
      summary: `${hook.eventName}: ${hook.policyDecision}`,
      detail: hook.summary,
      marker: "managed",
      createdAt: hook.createdAt
    });
  }
  for (const request of state.codexApprovalBrokerRequests ?? []) {
    const session = request.codexSessionRegistryId ? state.codexSessions.find((item) => item.id === request.codexSessionRegistryId) : null;
    records.push({
      id: request.id,
      type: "approval",
      source: "managed_codex_approval_broker",
      redactionState: "summary_only",
      invocationId: request.invocationId,
      codexSessionRegistryId: request.codexSessionRegistryId,
      agentId: findInvocation(request.invocationId)?.agentId ?? null,
      repoPath: repoPathForEvidence(session?.id),
      summary: `${request.status}: ${request.toolName}`,
      detail: request.summary,
      marker: "managed",
      createdAt: request.createdAt
    });
  }
  for (const review of state.codexChangeReviews ?? []) {
    records.push({
      id: review.id,
      type: "change_review",
      source: "managed_codex_review",
      redactionState: "summary_only",
      invocationId: review.invocationId,
      codexSessionRegistryId: review.codexSessionRegistryId,
      agentId: findInvocation(review.invocationId)?.agentId ?? null,
      repoPath: repoPathForEvidence(review.codexSessionRegistryId),
      summary: `${review.decision}: ${review.fileChangeSummary}`,
      detail: review.comment || review.followUpPrompt || review.fileChangeSummary,
      marker: "managed",
      createdAt: review.createdAt
    });
  }
  // Governed codex.exec changesets are a first-class trust-ledger artifact: an AI
  // that WROTE code is exactly what a supervisor needs to see. Each git-derived
  // change row surfaces as a file_change record, scoped to its invocation.
  for (const change of state.codexExecChanges ?? []) {
    const worktree = change.worktreeId ? (state.worktrees ?? []).find((item) => item.id === change.worktreeId) : null;
    records.push({
      id: change.id,
      type: "file_change",
      source: "governed_codex_exec",
      redactionState: "summary_only",
      invocationId: change.invocationId,
      codexSessionRegistryId: null,
      agentId: change.agentId ?? findInvocation(change.invocationId)?.agentId ?? null,
      repoPath: worktree?.worktreePath ?? null,
      summary: `${change.action}: ${change.file}`,
      detail: change.changeSummary ?? change.diffPreview ?? change.file,
      marker: "governed",
      createdAt: change.createdAt
    });
  }
  for (const usage of state.importedUsageEstimates ?? []) {
    records.push({
      id: usage.id,
      type: "usage_estimate",
      source: "imported_ccusage_report",
      redactionState: "summary_only",
      invocationId: usage.invocationId,
      codexSessionRegistryId: null,
      agentId: usage.agentId ?? findInvocation(usage.invocationId)?.agentId ?? null,
      repoPath: null,
      summary: usageEstimateSummary(usage),
      detail: usageEstimateDetail(usage),
      marker: "imported",
      createdAt: usage.createdAt
    });
  }
  for (const event of (state.events ?? []).filter((item) => item.type === "codex_runtime_warning")) {
    records.push({
      id: event.id,
      type: "runtime_warning",
      source: "codex_stderr_summary",
      redactionState: "summary_only",
      invocationId: event.invocationId,
      codexSessionRegistryId: codexSessionForInvocation(event.invocationId)?.id ?? null,
      agentId: findInvocation(event.invocationId)?.agentId ?? null,
      repoPath: repoPathForEvidence(codexSessionForInvocation(event.invocationId)?.id),
      summary: event.message,
      detail: event.data?.summary ?? event.message,
      marker: "managed",
      createdAt: event.createdAt
    });
  }
  for (const evidence of state.terminalEvidenceRecords ?? []) {
    records.push({
      id: evidence.id,
      type: evidence.type,
      source: evidence.source,
      redactionState: evidence.redactionState,
      invocationId: evidence.ownerInvocationId === "manual_terminal_surface" ? null : evidence.ownerInvocationId,
      codexSessionRegistryId: evidence.ownerCodexSessionId,
      agentId: null,
      repoPath: evidence.repoPath,
      summary: evidence.summary,
      detail: evidence.detail,
      marker: evidence.marker,
      createdAt: evidence.createdAt
    });
  }
  for (const imported of state.codexImportedEvidenceRecords ?? []) {
    records.push({
      id: imported.id,
      type: "imported_evidence",
      source: imported.source,
      redactionState: imported.redactionState,
      invocationId: null,
      codexSessionRegistryId: imported.linkedManagedSessionId,
      agentId: null,
      repoPath: imported.repoPath,
      summary: imported.summary,
      detail: imported.summary,
      marker: imported.marker,
      createdAt: imported.createdAt
    });
  }
  return records.sort((a, b) => Date.parse(b.createdAt ?? 0) - Date.parse(a.createdAt ?? 0));
}

function usageEstimateSummary(usage) {
  const report = usage.reportId ? `ccusage ${usage.reportId}` : "ccusage";
  const model = [usage.provider, usage.model].filter(Boolean).join("/");
  const cost = Number.isFinite(Number(usage.estimatedCostUsd))
    ? `$${Number(usage.estimatedCostUsd).toFixed(6)}`
    : "unknown cost";
  return `${report}${model ? ` ${model}` : ""}: ${cost}`;
}

function usageEstimateDetail(usage) {
  const parts = [
    usage.periodStart ? `periodStart=${usage.periodStart}` : null,
    usage.periodEnd ? `periodEnd=${usage.periodEnd}` : null,
    usage.date ? `date=${usage.date}` : null,
    usage.month ? `month=${usage.month}` : null,
    usage.week ? `week=${usage.week}` : null,
    usage.sessionId ? `session=${usage.sessionId}` : null,
    Number.isFinite(Number(usage.totalTokens)) ? `tokens=${usage.totalTokens}` : null,
    Number.isFinite(Number(usage.estimatedCostUsd)) ? `estimatedCostUsd=${usage.estimatedCostUsd}` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "Imported ccusage usage estimate.";
}
