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
  for (const render of state.applicationRenderResults ?? []) {
    records.push({
      id: render.id,
      type: render.evidenceType ?? "rendered_markdown",
      source: "application_render_result",
      redactionState: "summary_with_result_ref",
      invocationId: render.invocationId,
      codexSessionRegistryId: null,
      agentId: render.agentId ?? findInvocation(render.invocationId)?.agentId ?? null,
      repoPath: null,
      summary: `${render.artifactType === "html" ? "Rendered HTML" : "Rendered artifact"} ${render.theme ? `with ${render.theme}` : "artifact"}: ${render.htmlSummary ?? render.id}`,
      detail: [
        render.resultRef?.id ? `resultRef=${render.resultRef.id}` : `resultId=${render.id}`,
        render.markdownHash ? `markdownHash=${render.markdownHash}` : null,
        render.htmlHash ? `htmlHash=${render.htmlHash}` : null,
        Number.isFinite(Number(render.htmlByteLength)) ? `htmlBytes=${render.htmlByteLength}` : null,
      ].filter(Boolean).join(" · "),
      marker: "imported",
      createdAt: render.createdAt,
    });
  }
  for (const artifact of state.applicationResultArtifacts ?? []) {
    records.push({
      id: artifact.id,
      type: artifact.evidenceType ?? "mcp_result",
      source: "application_result_artifact",
      redactionState: "summary_with_result_ref",
      invocationId: artifact.invocationId,
      codexSessionRegistryId: null,
      agentId: artifact.agentId ?? findInvocation(artifact.invocationId)?.agentId ?? null,
      repoPath: null,
      summary: artifact.summary ?? `${artifact.artifactType ?? "artifact"} result ${artifact.id}`,
      detail: [
        artifact.resultRef?.id ? `resultRef=${artifact.resultRef.id}` : `artifactId=${artifact.id}`,
        artifact.mcpToolName ? `mcpTool=${artifact.mcpToolName}` : null,
        artifact.dataHash ? `dataHash=${artifact.dataHash}` : null,
        artifact.dataShape?.type ? `shape=${artifact.dataShape.type}` : null,
        artifact.dataShape?.catalogKey ? `catalog=${artifact.dataShape.catalogKey}` : null,
        Number.isFinite(Number(artifact.byteLength)) ? `bytes=${artifact.byteLength}` : null,
      ].filter(Boolean).join(" · "),
      marker: "imported",
      createdAt: artifact.createdAt,
    });
  }
  for (const smoke of state.applicationSmokeEvidenceRecords ?? []) {
    records.push({
      id: smoke.id,
      type: "application_smoke_evidence",
      source: "application_smoke_evidence",
      redactionState: "summary_with_checklist",
      invocationId: null,
      codexSessionRegistryId: null,
      agentId: null,
      repoPath: smoke.repoPath ?? null,
      applicationId: smoke.applicationId,
      summary: smoke.summary,
      detail: applicationSmokeEvidenceDetail(smoke),
      marker: "managed",
      createdAt: smoke.createdAt,
    });
  }
  for (const audit of state.auditSummaries ?? []) {
    const applicationResult = audit.applicationResult;
    if (!applicationResult?.applicationId || !audit.invocationId) continue;
    const invocation = findInvocation(audit.invocationId);
    records.push({
      id: `${audit.invocationId}:application_result`,
      type: "application_result",
      source: "application_capability_result",
      redactionState: "summary_only",
      invocationId: audit.invocationId,
      codexSessionRegistryId: null,
      agentId: audit.agentId ?? invocation?.agentId ?? null,
      repoPath: null,
      summary: applicationResultSummary(applicationResult, audit),
      detail: applicationResultDetail(applicationResult, audit),
      marker: "managed",
      createdAt: audit.completedAt ?? invocation?.completedAt ?? invocation?.updatedAt
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

function applicationResultSummary(applicationResult, audit) {
  const capability = applicationResult.capability ?? applicationResult.applicationAction ?? applicationResult.applicationId;
  const tool = applicationResult.mcpToolName ? ` (${applicationResult.mcpToolName})` : "";
  const status = applicationResult.status ?? audit.status ?? "completed";
  return `${capability}${tool}: ${status}`;
}

function applicationResultDetail(applicationResult, audit) {
  const parts = [
    `applicationId=${applicationResult.applicationId}`,
    applicationResult.capability ? `capability=${applicationResult.capability}` : null,
    applicationResult.mcpToolName ? `mcpTool=${applicationResult.mcpToolName}` : null,
    applicationResult.outputCollection ? `outputCollection=${applicationResult.outputCollection}` : null,
    applicationResult.resultRef?.id ? `resultRef=${applicationResult.resultRef.id}` : null,
    Number.isFinite(Number(applicationResult.importedRecordCount)) ? `importedRecordCount=${applicationResult.importedRecordCount}` : null,
    audit.resultSummary ? `summary=${audit.resultSummary}` : null,
    audit.errorSummary ? `error=${audit.errorSummary}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
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

function applicationSmokeEvidenceDetail(smoke) {
  const completed = Number(smoke.completedCount ?? 0);
  const total = Number(smoke.stepCount ?? 0);
  const completedSteps = (smoke.steps ?? [])
    .filter((step) => step?.completed)
    .map((step) => step.step)
    .filter(Boolean)
    .join(", ");
  const parts = [
    `applicationId=${smoke.applicationId}`,
    `completed=${Number.isFinite(completed) ? completed : 0}/${Number.isFinite(total) ? total : 0}`,
    smoke.descriptorOperationAt ? `descriptorOperationAt=${smoke.descriptorOperationAt}` : null,
    completedSteps ? `completedSteps=${completedSteps}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
