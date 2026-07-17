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
  // Claude apply/rollback shares the SAME trust-ledger vocabulary as codex.exec:
  // an AI-authored change that reached the worktree is a governed `file_change`,
  // whichever write path produced it. One record per applied file, scoped to the
  // proposal invocation; a rolled-back authorization keeps its records with the
  // final state in the summary — evidence of a write does not vanish on undo.
  for (const authorization of state.claudeApplyAuthorizations ?? []) {
    const appliedFiles = Array.isArray(authorization.appliedFiles) ? authorization.appliedFiles : [];
    if (!appliedFiles.length) continue; // nothing reached the worktree
    const worktree = authorization.worktreeId ? (state.worktrees ?? []).find((item) => item.id === authorization.worktreeId) : null;
    const verb = authorization.status === "rolled_back"
      ? "rolled back"
      : authorization.status === "rolling_back"
        ? "rolling back"
        : "applied";
    for (const [index, file] of appliedFiles.entries()) {
      records.push({
        id: `${authorization.id}_f${index}`,
        type: "file_change",
        source: "governed_claude_apply",
        redactionState: "summary_only",
        invocationId: authorization.invocationId ?? authorization.proposalInvocationId,
        codexSessionRegistryId: null,
        agentId: findInvocation(authorization.executionInvocationId)?.agentId ?? null,
        repoPath: worktree?.worktreePath ?? null,
        summary: `${verb}: ${file.path}`,
        detail: authorization.resultSummary ?? authorization.summary ?? `${verb}: ${file.path}`,
        marker: "governed",
        createdAt: authorization.rolledBackAt ?? authorization.appliedAt ?? authorization.createdAt
      });
    }
  }
  // #913: the proposal ARTIFACT itself is trust-ledger evidence — the provenance
  // of an AI-authored change proposal (what it was generated from, under which
  // descriptor contract) plus how to verify it before the approval-bound apply.
  // One record per completed proposal; it survives the raw payload being reaped
  // (redactionState then says so) — provenance must not vanish with the payload.
  for (const invocation of state.invocations ?? []) {
    const meta = invocation?.options?.metadata ?? {};
    if (meta.tool !== "claude.propose.patch" || invocation.status !== "succeeded") continue;
    const output = invocation.result?.output ?? {};
    const payloadReaped = output.patchRedacted === true;
    if (typeof output.patch !== "string" && !payloadReaped) continue;
    const files = Array.isArray(output.files) ? output.files : [];
    const worktree = meta.worktreeId ? (state.worktrees ?? []).find((item) => item.id === meta.worktreeId) : null;
    records.push({
      id: `${invocation.id}_proposal`,
      type: "patch_proposal",
      source: "governed_claude_propose",
      redactionState: payloadReaped ? "payload_reaped" : "summary_only",
      invocationId: invocation.id,
      codexSessionRegistryId: null,
      agentId: invocation.agentId ?? null,
      repoPath: worktree?.worktreePath ?? null,
      summary: `proposed: ${files.length} file(s)${output.summary ? ` — ${String(output.summary).slice(0, 200)}` : ""}`,
      detail: [
        output.contentHash ? `contentHash ${output.contentHash}` : "no content hash (pre-stamp artifact)",
        output.baseCommit ? `base ${output.baseCommit}` : null,
        output.descriptorRevision != null ? `descriptor r${output.descriptorRevision}` : null,
      ].filter(Boolean).join(" · "),
      provenance: {
        contentHash: output.contentHash ?? null,
        baseCommit: output.baseCommit ?? null,
        descriptorRevision: output.descriptorRevision ?? null,
        applicationId: output.applicationId ?? null,
      },
      verificationGuidance: "Review the bounded patch preview and file list; the apply gate revalidates the content hash and descriptor lineage server-side and the worktree base commit device-side before any write.",
      marker: "governed",
      createdAt: invocation.completedAt ?? invocation.createdAt
    });
  }
  // A human's review of an exec changeset — the governance decision that gates a
  // later promote — is itself trust-ledger evidence.
  for (const review of state.codexExecChangeReviews ?? []) {
    records.push({
      id: review.id,
      type: "change_review",
      source: "governed_codex_exec_review",
      redactionState: "summary_only",
      invocationId: review.invocationId,
      codexSessionRegistryId: null,
      agentId: findInvocation(review.invocationId)?.agentId ?? null,
      repoPath: null,
      summary: `${review.decision}: ${review.action} ${review.file}`,
      detail: review.comment || `${review.action} ${review.file}`,
      marker: "governed",
      createdAt: review.createdAt
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
  for (const result of state.applicationResults ?? []) {
    records.push({
      id: result.id,
      type: "application_result",
      source: "imported_application_result",
      redactionState: "summary_only",
      invocationId: result.invocationId,
      codexSessionRegistryId: null,
      agentId: findInvocation(result.invocationId)?.agentId ?? null,
      repoPath: null,
      summary: applicationResultSummary(result),
      detail: applicationResultDetail(result),
      marker: "imported",
      createdAt: result.createdAt
    });
  }
  // Lineage row: a compact "this application produced a result" record for every
  // application invocation whose detailed result lands somewhere OTHER than the
  // durable `applicationResults` ledger — claude/codex review findings, ccusage
  // usage estimates, and no-import results all reach here. Source it from
  // `auditSummaries` (uncapped, persisted), NOT the `application_result_recorded`
  // event: `state.events` is a 500-row ring buffer, so an event-sourced lineage
  // row silently vanished once evicted even though the invocation, audit summary,
  // and `application.latestResult` all still held the link. The audit summary
  // carries the same final `applicationResult` object and outlives the event.
  const importedApplicationInvocationIds = new Set((state.applicationResults ?? []).map((result) => result.invocationId));
  const seenLineageInvocationIds = new Set();
  for (const auditSummary of state.auditSummaries ?? []) {
    const result = auditSummary.applicationResult;
    if (!result) continue;
    const invocationId = auditSummary.invocationId;
    if (importedApplicationInvocationIds.has(invocationId)) continue;
    if (seenLineageInvocationIds.has(invocationId)) continue;
    seenLineageInvocationIds.add(invocationId);
    records.push({
      id: `applineage_${invocationId}`,
      type: "application_result",
      source: "imported_application_result",
      redactionState: "summary_only",
      invocationId,
      codexSessionRegistryId: null,
      agentId: auditSummary.agentId ?? findInvocation(invocationId)?.agentId ?? null,
      repoPath: null,
      summary: applicationResultLineageSummary(result),
      detail: applicationResultLineageDetail(result),
      marker: "imported",
      createdAt: result.completedAt ?? auditSummary.completedAt ?? null
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

function applicationResultSummary(result) {
  const source = result.source || "application";
  const kind = result.kind || "result";
  const capability = result.capability ? ` from ${result.capability}` : "";
  return `${source} ${kind}${capability}`;
}

function applicationResultDetail(result) {
  return [
    result.status ? `status=${result.status}` : null,
    result.applicationId ? `application=${result.applicationId}` : null,
    result.projectId ? `project=${result.projectId}` : null,
    result.truncated ? "truncated=true" : "truncated=false",
  ].filter(Boolean).join(" · ");
}

function applicationResultLineageSummary(result) {
  const application = result.applicationId || "application";
  const capability = result.capability ? ` from ${result.capability}` : "";
  return `${application} result${capability}`;
}

function applicationResultLineageDetail(result) {
  return [
    result.status ? `status=${result.status}` : null,
    result.outputCollection ? `collection=${result.outputCollection}` : null,
    Number.isFinite(Number(result.importedRecordCount)) ? `records=${result.importedRecordCount}` : null,
    result.applicationAction ? `action=${result.applicationAction}` : null,
  ].filter(Boolean).join(" · ");
}
