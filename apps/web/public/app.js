const defaultApiBase = "http://127.0.0.1:3001";
const apiBase = resolveApiBase();

const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  modeTabs: document.querySelector(".mode-tabs"),
  modeButtons: [...document.querySelectorAll("[data-workspace-mode]")],
  modeSummary: document.querySelector("#modeSummary"),
  connectAgentPanel: document.querySelector("#connectAgentPanel"),
  managedCodexContext: document.querySelector("#managedCodexContext"),
  managedPolicyContext: document.querySelector("#managedPolicyContext"),
  managedEvidenceContext: document.querySelector("#managedEvidenceContext"),
  evidenceCenterContext: document.querySelector("#evidenceCenterContext"),
  evidenceTypeFilter: document.querySelector("#evidenceTypeFilter"),
  evidenceSourceFilter: document.querySelector("#evidenceSourceFilter"),
  evidenceRedactionFilter: document.querySelector("#evidenceRedactionFilter"),
  evidenceAgentFilter: document.querySelector("#evidenceAgentFilter"),
  evidenceSessionFilter: document.querySelector("#evidenceSessionFilter"),
  evidenceInvocationFilter: document.querySelector("#evidenceInvocationFilter"),
  evidenceRepoFilter: document.querySelector("#evidenceRepoFilter"),
  evidenceCenterList: document.querySelector("#evidenceCenterList"),
  evidenceDetailTitle: document.querySelector("#evidenceDetailTitle"),
  evidenceDetailType: document.querySelector("#evidenceDetailType"),
  evidenceDetailSource: document.querySelector("#evidenceDetailSource"),
  evidenceDetailRedaction: document.querySelector("#evidenceDetailRedaction"),
  evidenceDetailMarker: document.querySelector("#evidenceDetailMarker"),
  evidenceDetailBody: document.querySelector("#evidenceDetailBody"),
  exportEvidenceSummaryButton: document.querySelector("#exportEvidenceSummaryButton"),
  evidenceExportSummary: document.querySelector("#evidenceExportSummary"),
  managedApprovalContext: document.querySelector("#managedApprovalContext"),
  importSessionContext: document.querySelector("#importSessionContext"),
  managedSessionId: document.querySelector("#managedSessionId"),
  managedThreadId: document.querySelector("#managedThreadId"),
  managedRepoPath: document.querySelector("#managedRepoPath"),
  managedSessionStatus: document.querySelector("#managedSessionStatus"),
  managedSessionHistoryContext: document.querySelector("#managedSessionHistoryContext"),
  managedSessionHistoryFilters: document.querySelector(".session-history-filters"),
  managedSessionHistoryList: document.querySelector("#managedSessionHistoryList"),
  managedSessionDetail: document.querySelector("#managedSessionDetail"),
  managedSessionDetailTitle: document.querySelector("#managedSessionDetailTitle"),
  managedSessionDetailSummary: document.querySelector("#managedSessionDetailSummary"),
  managedSessionDetailAgent: document.querySelector("#managedSessionDetailAgent"),
  managedSessionDetailMode: document.querySelector("#managedSessionDetailMode"),
  managedSessionDetailRepo: document.querySelector("#managedSessionDetailRepo"),
  managedSessionDetailWorktree: document.querySelector("#managedSessionDetailWorktree"),
  managedSessionDetailBranch: document.querySelector("#managedSessionDetailBranch"),
  managedSessionDetailDirty: document.querySelector("#managedSessionDetailDirty"),
  managedSessionDetailCommit: document.querySelector("#managedSessionDetailCommit"),
  managedSessionDetailEvidence: document.querySelector("#managedSessionDetailEvidence"),
  managedSessionDetailApprovals: document.querySelector("#managedSessionDetailApprovals"),
  managedSessionDetailContinue: document.querySelector("#managedSessionDetailContinue"),
  managedChangeReviewPanel: document.querySelector("#managedChangeReviewPanel"),
  managedChangeList: document.querySelector("#managedChangeList"),
  managedChangeDiff: document.querySelector("#managedChangeDiff"),
  managedChangeReviewComment: document.querySelector("#managedChangeReviewComment"),
  approveChangeButton: document.querySelector("#approveChangeButton"),
  rejectChangeButton: document.querySelector("#rejectChangeButton"),
  feedbackChangeButton: document.querySelector("#feedbackChangeButton"),
  managedChangeReviewStatus: document.querySelector("#managedChangeReviewStatus"),
  managedPolicySandbox: document.querySelector("#managedPolicySandbox"),
  managedPolicyApproval: document.querySelector("#managedPolicyApproval"),
  managedPolicyNetwork: document.querySelector("#managedPolicyNetwork"),
  managedPolicyHooks: document.querySelector("#managedPolicyHooks"),
  managedEvidenceJsonl: document.querySelector("#managedEvidenceJsonl"),
  managedEvidenceHooks: document.querySelector("#managedEvidenceHooks"),
  managedEvidenceFiles: document.querySelector("#managedEvidenceFiles"),
  managedEvidenceApproval: document.querySelector("#managedEvidenceApproval"),
  approvalAttentionSummary: document.querySelector("#approvalAttentionSummary"),
  approvalQueueList: document.querySelector("#approvalQueueList"),
  managedApprovalSummary: document.querySelector("#managedApprovalSummary"),
  managedApproveButton: document.querySelector("#managedApproveButton"),
  managedDenyButton: document.querySelector("#managedDenyButton"),
  importEvidenceSummary: document.querySelector("#importEvidenceSummary"),
  importEvidenceButton: document.querySelector("#importEvidenceButton"),
  importSource: document.querySelector("#importSource"),
  importRedaction: document.querySelector("#importRedaction"),
  importMarker: document.querySelector("#importMarker"),
  importBoundary: document.querySelector("#importBoundary"),
  deviceName: document.querySelector("#deviceName"),
  deviceStatus: document.querySelector("#deviceStatus"),
  devicePlatform: document.querySelector("#devicePlatform"),
  deviceLastSeen: document.querySelector("#deviceLastSeen"),
  agentName: document.querySelector("#agentName"),
  agentStatus: document.querySelector("#agentStatus"),
  agentHealth: document.querySelector("#agentHealth"),
  agentCapability: document.querySelector("#agentCapability"),
  agentCost: document.querySelector("#agentCost"),
  agentCostOwner: document.querySelector("#agentCostOwner"),
  agentUsage: document.querySelector("#agentUsage"),
  agentNextAction: document.querySelector("#agentNextAction"),
  deviceSelect: document.querySelector("#deviceSelect"),
  agentSelect: document.querySelector("#agentSelect"),
  deviceSelectValue: document.querySelector("#deviceSelectValue"),
  agentSelectValue: document.querySelector("#agentSelectValue"),
  agentChoiceList: document.querySelector("#agentChoiceList"),
  taskInput: document.querySelector("#taskInput"),
  codexSessionControl: document.querySelector("#codexSessionControl"),
  codexSessionMode: document.querySelector("#codexSessionMode"),
  codexWorkspaceControl: document.querySelector("#codexWorkspaceControl"),
  codexWorkspacePolicy: document.querySelector("#codexWorkspacePolicy"),
  compareAgentList: document.querySelector("#compareAgentList"),
  comparePanel: document.querySelector("#comparePanel"),
  compareList: document.querySelector("#compareList"),
  runButton: document.querySelector("#runButton"),
  cancelButton: document.querySelector("#cancelButton"),
  healthCheckButton: document.querySelector("#healthCheckButton"),
  toggleAgentButton: document.querySelector("#toggleAgentButton"),
  runBlockReason: document.querySelector("#runBlockReason"),
  discoverButton: document.querySelector("#discoverButton"),
  addCodexButton: document.querySelector("#addCodexButton"),
  discoveryPaths: document.querySelector("#discoveryPaths"),
  discoveryEndpoints: document.querySelector("#discoveryEndpoints"),
  discoverySummary: document.querySelector("#discoverySummary"),
  candidateList: document.querySelector("#candidateList"),
  integrationIntent: document.querySelector("#integrationIntent"),
  integrationAdapter: document.querySelector("#integrationAdapter"),
  integrationCommand: document.querySelector("#integrationCommand"),
  integrationUrl: document.querySelector("#integrationUrl"),
  integrationWorkingDirectory: document.querySelector("#integrationWorkingDirectory"),
  integrationEnvironment: document.querySelector("#integrationEnvironment"),
  integrationCancellation: document.querySelector("#integrationCancellation"),
  integrationCostOwner: document.querySelector("#integrationCostOwner"),
  integrationEconomicModel: document.querySelector("#integrationEconomicModel"),
  integrationStreaming: document.querySelector("#integrationStreaming"),
  createIntegrationButton: document.querySelector("#createIntegrationButton"),
  builderDraftButton: document.querySelector("#builderDraftButton"),
  generateIntegrationButton: document.querySelector("#generateIntegrationButton"),
  integrationSummary: document.querySelector("#integrationSummary"),
  artifactList: document.querySelector("#artifactList"),
  approvalPanel: document.querySelector("#approvalPanel"),
  approvalTitle: document.querySelector("#approvalTitle"),
  approvalRisk: document.querySelector("#approvalRisk"),
  approvalData: document.querySelector("#approvalData"),
  approvalCost: document.querySelector("#approvalCost"),
  approvalCancellation: document.querySelector("#approvalCancellation"),
  approvalTags: document.querySelector("#approvalTags"),
  approveButton: document.querySelector("#approveButton"),
  denyButton: document.querySelector("#denyButton"),
  activityTitle: document.querySelector("#activityTitle"),
  taskState: document.querySelector("#taskState"),
  safetySummary: document.querySelector("#safetySummary"),
  dataSummary: document.querySelector("#dataSummary"),
  costSummary: document.querySelector("#costSummary"),
  cancellationSummary: document.querySelector("#cancellationSummary"),
  adapterName: document.querySelector("#adapterName"),
  agentLifecycle: document.querySelector("#agentLifecycle"),
  invocationId: document.querySelector("#invocationId"),
  traceId: document.querySelector("#traceId"),
  technicalState: document.querySelector("#technicalState"),
  sessionMode: document.querySelector("#sessionMode"),
  taskPreview: document.querySelector("#taskPreview"),
  executionPreview: document.querySelector("#executionPreview"),
  auditDecision: document.querySelector("#auditDecision"),
  deliveryStatus: document.querySelector("#deliveryStatus"),
  cancelStatus: document.querySelector("#cancelStatus"),
  quotaSummary: document.querySelector("#quotaSummary"),
  retentionSummary: document.querySelector("#retentionSummary"),
  builderSummary: document.querySelector("#builderSummary"),
  eventList: document.querySelector("#eventList"),
  resultTitle: document.querySelector("#resultTitle"),
  resultSummary: document.querySelector("#resultSummary"),
  troubleshootButton: document.querySelector("#troubleshootButton"),
  troubleshooterPanel: document.querySelector("#troubleshooterPanel"),
  troubleshooterTitle: document.querySelector("#troubleshooterTitle"),
  troubleshooterSummary: document.querySelector("#troubleshooterSummary"),
  troubleshooterBridge: document.querySelector("#troubleshooterBridge"),
  troubleshooterError: document.querySelector("#troubleshooterError"),
  troubleshooterLogs: document.querySelector("#troubleshooterLogs"),
  troubleshooterFixes: document.querySelector("#troubleshooterFixes")
};

let currentInvocationId = null;
let selectedAgentId = null;
let selectedArtifactId = null;
let activeMode = "run_task";
let selectedCodexApprovalRequestId = null;
let selectedManagedSessionId = null;
let selectedManagedChangeEvidenceId = null;
let selectedEvidenceRecordId = null;
let managedSessionFilter = "all";
const selectedCompareAgentIds = new Set();

els.modeTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-workspace-mode]");
  if (!button) return;

  activeMode = button.dataset.workspaceMode;
  if (activeMode === "managed_codex") {
    const codexAgent = codexAgentInState(lastState);
    if (codexAgent) selectedAgentId = codexAgent.id;
  }
  render(lastState);
});

els.runButton.addEventListener("click", async () => {
  const task = els.taskInput.value.trim();
  if (!task) return;

  els.runButton.disabled = true;
  try {
    const compareAgentIds = [...selectedCompareAgentIds].filter((id) => id !== selectedAgentId);
    const isCompareRun = compareAgentIds.length > 0;
    const response = await fetch(`${apiBase}${isCompareRun ? "/api/compare-runs" : "/api/invocations"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isCompareRun ? {
        task,
        agentIds: [selectedAgentId, ...compareAgentIds],
        options: {
          codexSessionMode: els.codexSessionMode.value,
          codexWorkspacePolicy: els.codexWorkspacePolicy.value
        }
      } : {
        task,
        agentId: selectedAgentId,
        options: {
          codexSessionMode: els.codexSessionMode.value,
          codexWorkspacePolicy: els.codexWorkspacePolicy.value
        }
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message ?? data.error ?? "Unable to start task.");
    }
    currentInvocationId = data.invocation?.id ?? data.compareRun?.childInvocationIds?.[0] ?? null;
    await refresh();
  } catch (error) {
    els.resultTitle.textContent = "Could not start";
    els.resultSummary.textContent = error instanceof Error ? error.message : "Unable to start the task.";
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.taskInput.addEventListener("input", () => updateActions(lastState, currentInvocation()));
els.importEvidenceSummary.addEventListener("input", () => updateActions(lastState, currentInvocation()));
els.codexSessionMode.addEventListener("change", () => updateActions(lastState, currentInvocation()));
els.codexWorkspacePolicy.addEventListener("change", () => updateActions(lastState, currentInvocation()));
els.agentSelect.addEventListener("change", () => {
  selectedAgentId = els.agentSelect.value || null;
  render(lastState);
});

els.agentChoiceList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-agent-id]");
  if (!button) return;

  selectedAgentId = button.dataset.agentId;
  render(lastState);
});

els.compareAgentList.addEventListener("change", () => {
  selectedCompareAgentIds.clear();
  for (const input of els.compareAgentList.querySelectorAll("input[data-compare-agent-id]:checked")) {
    selectedCompareAgentIds.add(input.dataset.compareAgentId);
  }
  updateActions(lastState, currentInvocation());
});

els.managedSessionHistoryFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-session-filter]");
  if (!button) return;

  managedSessionFilter = button.dataset.sessionFilter;
  render(lastState);
});

els.managedSessionHistoryList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-session-id]");
  if (!button) return;

  selectedManagedSessionId = button.dataset.sessionId;
  selectedManagedChangeEvidenceId = null;
  render(lastState);
});

els.evidenceTypeFilter.addEventListener("change", () => {
  selectedEvidenceRecordId = null;
  render(lastState);
});

els.evidenceSourceFilter.addEventListener("change", () => {
  selectedEvidenceRecordId = null;
  render(lastState);
});

for (const filter of [
  els.evidenceRedactionFilter,
  els.evidenceAgentFilter,
  els.evidenceSessionFilter,
  els.evidenceInvocationFilter,
  els.evidenceRepoFilter
]) {
  filter.addEventListener("change", () => {
    selectedEvidenceRecordId = null;
    render(lastState);
  });
}

els.evidenceCenterList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-evidence-record-id]");
  if (!button) return;

  selectedEvidenceRecordId = button.dataset.evidenceRecordId;
  render(lastState);
});

els.exportEvidenceSummaryButton.addEventListener("click", () => {
  const record = selectedEvidenceRecord(lastState);
  els.evidenceExportSummary.value = record ? evidenceExportText(record) : "";
});

els.managedChangeList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-change-evidence-id]");
  if (!button) return;

  selectedManagedChangeEvidenceId = button.dataset.changeEvidenceId;
  render(lastState);
});

els.approvalQueueList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-approval-request-id]");
  if (!button) return;

  selectedCodexApprovalRequestId = button.dataset.approvalRequestId;
  render(lastState);
});

els.approveChangeButton.addEventListener("click", () => submitSelectedChangeReview("approved"));
els.rejectChangeButton.addEventListener("click", () => submitSelectedChangeReview("rejected"));
els.feedbackChangeButton.addEventListener("click", () => submitSelectedChangeReview("feedback"));

els.cancelButton.addEventListener("click", async () => {
  if (!currentInvocationId) return;

  els.cancelButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/invocations/${currentInvocationId}/cancel`, {
      method: "POST"
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.healthCheckButton.addEventListener("click", async () => {
  if (!selectedAgentId) return;

  els.healthCheckButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/agents/${encodeURIComponent(selectedAgentId)}/health-check`, {
      method: "POST"
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.toggleAgentButton.addEventListener("click", async () => {
  const agent = selectedAgent(lastState);
  if (!agent) return;

  const action = agent.status === "disabled" ? "enable" : "disable";
  els.toggleAgentButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/agents/${encodeURIComponent(agent.id)}/${action}`, {
      method: "POST"
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.discoverButton.addEventListener("click", async () => {
  els.discoverButton.disabled = true;
  try {
    await createDiscovery({
      scope: [
        "known_command_allowlist",
        "known_local_endpoint",
        "user_provided_path",
        "user_provided_endpoint",
        "bridge_managed_config"
      ],
      userProvidedPaths: parseList(els.discoveryPaths.value),
      userProvidedEndpoints: parseList(els.discoveryEndpoints.value)
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.addCodexButton.addEventListener("click", async () => {
  const codexAgent = codexAgentInState(lastState);
  if (codexAgent) {
    const alreadySelected = selectedAgentId === codexAgent.id;
    selectedAgentId = codexAgent.id;

    if (!alreadySelected) {
      render(lastState);
      els.runBlockReason.textContent = "Codex CLI selected. MyAgentTool will record activity and evidence while Codex CLI keeps its native permissions.";
      return;
    }

    if (codexAgent.health?.status !== "healthy") {
      els.addCodexButton.disabled = true;
      await fetch(`${apiBase}/api/agents/${encodeURIComponent(codexAgent.id)}/health-check`, {
        method: "POST"
      });
      els.discoverySummary.textContent = "Checking Codex CLI setup with a restricted help probe.";
      await refresh();
      return;
    }

    render(lastState);
    return;
  }

  els.addCodexButton.disabled = true;
  els.discoverySummary.textContent = "Checking explicit Codex CLI entry. No broad scan, install, authorization, or sandbox override will run.";
  try {
    ensureListValue(els.discoveryPaths, "codex");
    await createDiscovery({
      scope: ["user_provided_path"],
      userProvidedPaths: ["codex"],
      userProvidedEndpoints: []
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.candidateList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-discovery-run-id][data-candidate-id]");
  if (!button) return;

  button.disabled = true;
  try {
    const runId = encodeURIComponent(button.dataset.discoveryRunId);
    const candidateId = encodeURIComponent(button.dataset.candidateId);
    await fetch(`${apiBase}/api/discovery/${runId}/candidates/${candidateId}/register`, {
      method: "POST"
    });
    const state = await fetchState();
    const run = state.discoveryRuns?.find((item) => item.id === button.dataset.discoveryRunId);
    const candidate = run?.candidates?.find((item) => item.id === button.dataset.candidateId);
    if (candidate?.registration?.registeredAgentId) {
      selectedAgentId = candidate.registration.registeredAgentId;
    }
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.createIntegrationButton.addEventListener("click", async () => {
  els.createIntegrationButton.disabled = true;
  try {
    const data = await postIntegrationArtifact({ artifactType: "integration_plan", reviewState: "draft", generatedByAi: false });
    selectedArtifactId = data.artifact.id;
    await refresh();
  } catch (error) {
    els.integrationSummary.textContent = error instanceof Error ? error.message : "Unable to save integration draft.";
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.generateIntegrationButton.addEventListener("click", async () => {
  const artifact = selectedIntegrationArtifact(lastState);
  if (!artifact) return;

  els.generateIntegrationButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/integration-artifacts/${encodeURIComponent(artifact.id)}/generate`, {
      method: "POST"
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.builderDraftButton.addEventListener("click", async () => {
  els.builderDraftButton.disabled = true;
  try {
    const response = await fetch(`${apiBase}/api/integration-builder/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(integrationPayload())
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message ?? data.error ?? "Unable to draft integration plan.");
    }
    selectedArtifactId = data.artifact.id;
    await refresh();
  } catch (error) {
    els.integrationSummary.textContent = error instanceof Error ? error.message : "Unable to draft integration plan.";
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.artifactList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-artifact-id][data-artifact-action]");
  if (!button) return;

  button.disabled = true;
  selectedArtifactId = button.dataset.artifactId;
  try {
    const artifactId = encodeURIComponent(button.dataset.artifactId);
    const action = button.dataset.artifactAction;
    await fetch(`${apiBase}/api/integration-artifacts/${artifactId}/${action}`, {
      method: "POST"
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.approveButton.addEventListener("click", async () => {
  const approval = currentApproval(lastState, currentInvocation());
  if (!approval) return;

  els.approveButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/approvals/${encodeURIComponent(approval.id)}/approve`, {
      method: "POST"
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.denyButton.addEventListener("click", async () => {
  const approval = currentApproval(lastState, currentInvocation());
  if (!approval) return;

  els.denyButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/approvals/${encodeURIComponent(approval.id)}/deny`, {
      method: "POST"
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.managedApproveButton.addEventListener("click", async () => {
  await resolveSelectedCodexApproval("approve");
});

els.managedDenyButton.addEventListener("click", async () => {
  await resolveSelectedCodexApproval("deny");
});

els.importEvidenceButton.addEventListener("click", async () => {
  const summary = els.importEvidenceSummary.value.trim();
  if (!summary) return;

  els.importEvidenceButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/codex/imported-evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "user_selected_local_preview",
        summary
      })
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.troubleshootButton.addEventListener("click", async () => {
  const invocation = currentInvocation();
  if (!invocation) return;

  els.troubleshootButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/invocations/${encodeURIComponent(invocation.id)}/troubleshoot`, {
      method: "POST"
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

setInterval(refresh, 700);
refresh();

let lastState = null;

async function refresh() {
  try {
    const response = await fetch(`${apiBase}/api/state`);
    const state = await response.json();
    lastState = state;
    els.connectionStatus.textContent = "Connected";
    els.connectionStatus.dataset.state = "ok";
    render(state);
  } catch {
    els.connectionStatus.textContent = "Server offline";
    els.connectionStatus.dataset.state = "bad";
    renderOffline();
  }
}

function render(state) {
  if (!state) {
    return;
  }
  const agents = state.agents?.length ? state.agents : [state.agent].filter(Boolean);
  if (!selectedAgentId || !agents.some((agent) => agent.id === selectedAgentId)) {
    selectedAgentId = preferredAgentId(state, agents);
  }

  renderSelectors(state, agents);
  renderCompareAgentChoices(agents);

  const invocation = currentInvocation() ?? state.invocations[0] ?? null;
  const audit = invocation
    ? state.auditSummaries.find((item) => item.invocationId === invocation.id)
    : null;
  let agent = agents.find((item) => item.id === selectedAgentId) ?? state.agent ?? agents[0];
  if (activeMode === "managed_codex" && !isCodexAgent(agent)) {
    const codexAgent = codexAgentInState(state);
    if (codexAgent) {
      selectedAgentId = codexAgent.id;
      agent = codexAgent;
      renderSelectors(state, agents);
    }
  }
  const selectedAgentForMode = agents.find((item) => item.id === selectedAgentId) ?? agent;
  const lifecycleAudit = state.lifecycleAuditRecords?.find((item) => item.agentId === agent?.id) ?? null;
  const discoveryRun = state.discoveryRuns?.[0] ?? null;
  const approval = currentApproval(state, invocation);
  const usage = agent ? state.agentUsageSummaries?.find((item) => item.agentId === agent.id) : null;
  const troubleshootingReport = currentTroubleshootingReport(state, invocation);
  const selectedArtifact = selectedIntegrationArtifact(state) ?? state.integrationArtifacts?.[0] ?? null;
  if (selectedArtifact) selectedArtifactId = selectedArtifact.id;

  if (invocation) currentInvocationId = invocation.id;
  const executionEvent = latestExecutionPreview(state, invocation);
  renderMode(state, selectedAgentForMode, invocation, approval);

  const readableTaskState = readableStatus(invocation?.status);
  els.taskState.textContent = readableTaskState;
  els.taskState.dataset.state = invocation?.status ?? "waiting";
  els.activityTitle.textContent = activityTitle(invocation?.status);

  els.deviceName.textContent = state.device.name;
  els.deviceStatus.textContent = readableDeviceStatus(state.device.status);
  els.devicePlatform.textContent = `${state.device.platform} / ${state.device.architecture}`;
  els.deviceLastSeen.textContent = state.device.lastSeenAt ? shortTime(state.device.lastSeenAt) : "Not seen yet";

  els.agentName.textContent = agent?.name ?? "No agent registered";
  els.agentStatus.textContent = readableAgentStatus(agent?.status);
  els.agentHealth.textContent = readableHealth(agent?.health);
  els.agentCapability.textContent = agent?.capabilities?.[0]?.description ?? "No capability selected";
  els.agentCost.textContent = agentCostText(agent);
  els.agentCostOwner.textContent = costOwnerText(agent?.economics, usage);
  els.agentUsage.textContent = usageText(usage);
  els.agentNextAction.textContent = agent?.health?.nextAction ?? agentNextAction(agent, state);

  els.safetySummary.textContent = agent?.registrationNotes?.risk ?? "Review the selected agent before running.";
  els.dataSummary.textContent = agent?.registrationNotes?.data ?? "Task input and result are recorded.";
  els.costSummary.textContent = agent?.registrationNotes?.cost ?? costText(agent?.economics);
  els.cancellationSummary.textContent = agent?.registrationNotes?.cancellation ?? cancellationText(agent?.adapter);
  els.adapterName.textContent = adapterText(agent?.adapter);
  els.agentLifecycle.textContent = lifecycleText(agent);

  els.invocationId.textContent = invocation?.id ?? "No task yet";
  els.traceId.textContent = invocation?.traceId ?? "No trace yet";
  els.technicalState.textContent = invocation ? `${invocation.status} / ${invocation.delivery?.state ?? "no delivery"}` : "No task yet";
  els.sessionMode.textContent = sessionModeText(invocation?.options?.codexSessionMode, executionEvent?.data?.sessionMode);
  els.taskPreview.textContent = executionEvent?.data?.taskSummary ?? taskSummary(invocation?.input?.task) ?? "No task yet";
  els.executionPreview.textContent = executionEvent?.data?.commandLine ?? "Not dispatched yet";
  els.auditDecision.textContent = audit ? readableAudit(audit) : lifecycleAudit ? readableLifecycleAudit(lifecycleAudit) : "Nothing recorded yet";
  els.deliveryStatus.textContent = readableDelivery(invocation?.delivery?.state);
  els.cancelStatus.textContent = readableCancellation(invocation?.cancellation?.state);
  els.quotaSummary.textContent = quotaSummary(state);
  els.retentionSummary.textContent = retentionSummary(state.retentionSettings);
  els.builderSummary.textContent = builderSummary(state.integrationArtifacts);
  els.toggleAgentButton.textContent = agent?.status === "disabled" ? "Enable agent" : "Disable agent";

  els.resultTitle.textContent = resultTitle(invocation?.status);
  els.resultSummary.textContent = resultSummary(invocation, audit);
  renderTroubleshooter(troubleshootingReport);

  const visibleEvents = invocation
    ? state.events.filter((event) => event.invocationId === invocation.id || event.data?.agentId === agent?.id).slice(0, 30)
    : state.events.slice(0, 30);
  renderApproval(approval);
  renderTimeline(visibleEvents);
  renderComparePanel(state);
  renderDiscovery(discoveryRun);
  renderIntegrationArtifacts(state.integrationArtifacts ?? [], state.integrationProbeRuns ?? []);
  updateActions(state, invocation);
}

function renderMode(state, agent, invocation = null, approval = null) {
  const modeLabels = {
    run_task: "Describe the task, choose the computer and agent, then run it.",
    managed_codex: "Review the Codex supervision chain for the selected run.",
    evidence_center: "Inspect managed and imported evidence without entering the task workflow.",
    import_session: "Record user-authorized Codex evidence after the fact. This is not a managed session.",
    connect_agent: "Discover local agents or draft an unsupported-agent integration."
  };
  const normalizedMode = modeLabels[activeMode] ? activeMode : "run_task";
  activeMode = normalizedMode;
  const isCodex = isCodexAgent(agent);
  const showCodexContext = isCodex || activeMode === "managed_codex";

  for (const button of els.modeButtons) {
    const isActive = button.dataset.workspaceMode === activeMode;
    button.dataset.active = String(isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }

  els.modeSummary.textContent = modeLabels[activeMode];
  els.connectAgentPanel.hidden = activeMode !== "connect_agent";
  els.managedCodexContext.hidden = !showCodexContext;
  els.managedSessionHistoryContext.hidden = activeMode !== "managed_codex";
  els.managedPolicyContext.hidden = activeMode !== "managed_codex";
  els.managedEvidenceContext.hidden = activeMode !== "managed_codex";
  els.evidenceCenterContext.hidden = activeMode !== "evidence_center";
  els.managedApprovalContext.hidden = activeMode !== "managed_codex";
  els.importSessionContext.hidden = activeMode !== "import_session";

  const showsCodexSession = showCodexContext;
  els.codexSessionControl.hidden = !showsCodexSession;
  els.codexWorkspaceControl.hidden = !showsCodexSession;

  if (activeMode === "managed_codex" && state && !codexAgentInState(state)) {
    els.modeSummary.textContent = "Codex CLI is not registered yet. Use Connect agent or start Desktop Bridge, then select Codex CLI.";
  } else if (activeMode === "managed_codex" && !isCodex) {
    els.modeSummary.textContent = "Select Codex CLI to inspect session registry, policy, evidence, and approval details.";
  }

  renderManagedCodexContext(state, agent, invocation, approval);
  renderManagedSessionHistory(state);
  renderEvidenceCenter(state);
  renderImportedEvidenceContext(state);
}

function renderImportedEvidenceContext(state) {
  const latest = state?.codexImportedEvidenceRecords?.[0];
  els.importEvidenceButton.disabled = activeMode !== "import_session" || !els.importEvidenceSummary.value.trim();
  els.importSource.textContent = latest?.source ?? "User-selected local evidence only";
  els.importRedaction.textContent = latest?.redactionState ?? "Preview required before retention";
  els.importMarker.textContent = latest?.marker ?? "imported_after_the_fact";
  els.importBoundary.textContent = latest
    ? "Recorded as imported evidence, not a managed compliance session"
    : "Not a managed compliance session";
}

function renderEvidenceCenter(state) {
  renderEvidenceFilterOptions(state);
  const records = filteredEvidenceRecords(state);
  if (!records.some((record) => record.id === selectedEvidenceRecordId)) {
    selectedEvidenceRecordId = records[0]?.id ?? null;
  }
  const selected = records.find((record) => record.id === selectedEvidenceRecordId) ?? records[0] ?? null;
  els.evidenceCenterList.replaceChildren(
    ...(records.length ? records.slice(0, 40).map((record) => evidenceRecordItem(record, selected?.id)) : [emptyMiniCard("No evidence records match the current filters.")])
  );
  renderEvidenceDetail(selected);
}

function filteredEvidenceRecords(state) {
  const typeFilter = els.evidenceTypeFilter.value;
  const sourceFilter = els.evidenceSourceFilter.value;
  const redactionFilter = els.evidenceRedactionFilter.value;
  const agentFilter = els.evidenceAgentFilter.value;
  const sessionFilter = els.evidenceSessionFilter.value;
  const invocationFilter = els.evidenceInvocationFilter.value;
  const repoFilter = els.evidenceRepoFilter.value;
  return (state?.evidenceCenterRecords ?? []).filter((record) => {
    if (typeFilter !== "all" && record.type !== typeFilter) return false;
    if (sourceFilter === "managed" && record.marker !== "managed") return false;
    if (sourceFilter === "imported_after_the_fact" && record.marker !== "imported_after_the_fact") return false;
    if (redactionFilter !== "all" && record.redactionState !== redactionFilter) return false;
    if (agentFilter !== "all" && record.agentId !== agentFilter) return false;
    if (sessionFilter !== "all" && record.codexSessionRegistryId !== sessionFilter) return false;
    if (invocationFilter !== "all" && record.invocationId !== invocationFilter) return false;
    if (repoFilter !== "all" && record.repoPath !== repoFilter) return false;
    return true;
  });
}

function renderEvidenceFilterOptions(state) {
  const records = state?.evidenceCenterRecords ?? [];
  syncSelectOptions(els.evidenceRedactionFilter, "all", "All redaction states", uniqueRecordValues(records, "redactionState"));
  syncSelectOptions(els.evidenceAgentFilter, "all", "All agents", uniqueRecordValues(records, "agentId"), (id) => {
    const agent = state?.agents?.find((item) => item.id === id);
    return agent ? agent.name : id;
  });
  syncSelectOptions(els.evidenceSessionFilter, "all", "All sessions", uniqueRecordValues(records, "codexSessionRegistryId"));
  syncSelectOptions(els.evidenceInvocationFilter, "all", "All invocations", uniqueRecordValues(records, "invocationId"));
  syncSelectOptions(els.evidenceRepoFilter, "all", "All repos", uniqueRecordValues(records, "repoPath"));
}

function uniqueRecordValues(records, key) {
  return [...new Set(records.map((record) => record[key]).filter(Boolean))].sort();
}

function syncSelectOptions(select, allValue, allLabel, values, labelFor = (value) => value) {
  const previous = select.value || allValue;
  select.replaceChildren(
    new Option(allLabel, allValue),
    ...values.map((value) => new Option(labelFor(value), value))
  );
  select.value = values.includes(previous) ? previous : allValue;
}

function evidenceRecordItem(record, selectedId) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "evidence-record-item";
  item.dataset.evidenceRecordId = record.id;
  item.dataset.selected = String(record.id === selectedId);
  item.dataset.marker = record.marker ?? "unknown";

  const top = document.createElement("span");
  top.className = "evidence-record-top";
  const title = document.createElement("strong");
  title.textContent = readableEvidenceType(record.type);
  const marker = document.createElement("span");
  marker.textContent = record.marker ?? "unknown";
  top.append(title, marker);

  const summary = document.createElement("span");
  summary.textContent = [record.summary, record.repoPath, record.createdAt ? shortTime(record.createdAt) : null].filter(Boolean).join(" · ");
  item.append(top, summary);
  return item;
}

function renderEvidenceDetail(record) {
  els.exportEvidenceSummaryButton.disabled = !record;
  if (!record) {
    els.evidenceDetailTitle.textContent = "Evidence detail";
    els.evidenceDetailType.textContent = "-";
    els.evidenceDetailSource.textContent = "-";
    els.evidenceDetailRedaction.textContent = "-";
    els.evidenceDetailMarker.textContent = "-";
    els.evidenceDetailBody.textContent = "Select an evidence record to inspect the summary.";
    els.evidenceExportSummary.value = "";
    return;
  }
  els.evidenceDetailTitle.textContent = record.summary ?? record.id;
  els.evidenceDetailType.textContent = readableEvidenceType(record.type);
  els.evidenceDetailSource.textContent = record.source ?? "unknown";
  els.evidenceDetailRedaction.textContent = record.redactionState ?? "unknown";
  els.evidenceDetailMarker.textContent = record.marker ?? "managed";
  els.evidenceDetailBody.textContent = record.detail ?? record.summary ?? "No detail recorded.";
}

function selectedEvidenceRecord(state) {
  return filteredEvidenceRecords(state).find((record) => record.id === selectedEvidenceRecordId) ?? null;
}

function evidenceExportText(record) {
  return [
    `Evidence ${record.id}`,
    `Type: ${readableEvidenceType(record.type)}`,
    `Source: ${record.source ?? "unknown"}`,
    `Marker: ${record.marker ?? "managed"}`,
    `Redaction: ${record.redactionState ?? "unknown"}`,
    record.invocationId ? `Invocation: ${record.invocationId}` : null,
    record.codexSessionRegistryId ? `Session: ${record.codexSessionRegistryId}` : null,
    record.repoPath ? `Repo: ${record.repoPath}` : null,
    `Summary: ${record.summary ?? ""}`,
    `Detail: ${record.detail ?? ""}`
  ].filter(Boolean).join("\n");
}

function readableEvidenceType(type) {
  const labels = {
    jsonl_event: "JSONL event",
    hook_event: "Hook event",
    approval: "Approval",
    command: "Command",
    file_change: "File change",
    change_review: "Change review",
    runtime_warning: "Runtime warning",
    imported_evidence: "Imported evidence"
  };
  return labels[type] ?? type ?? "Evidence";
}

function renderManagedCodexContext(state, agent, invocation, approval) {
  const isCodex = isCodexAgent(agent);
  const managedSession = managedCodexSessionForInvocation(state, invocation);
  const evidenceRecords = codexEvidenceForSession(state, managedSession, invocation);
  const hookEvents = codexHooksForSession(state, managedSession, invocation);
  const brokerRequest = codexApprovalForSession(state, managedSession, invocation);
  const executionEvent = latestExecutionPreview(state, invocation);
  const codexEvents = state?.events?.filter((event) => {
    return event.invocationId === invocation?.id && (
      event.type === "execution_preview" ||
      event.type === "agent_output" ||
      event.type === "codex_runtime_warning" ||
      event.type === "log" ||
      event.type === "invocation_succeeded" ||
      event.type === "invocation_failed"
    );
  }) ?? [];

  els.managedSessionId.textContent = managedSession?.id ?? (isCodex && invocation ? "Pending registry" : "Not registered yet");
  els.managedThreadId.textContent = managedSession?.codexThreadId ?? executionEvent?.data?.threadId ?? "Unknown until Codex JSONL is parsed";
  els.managedRepoPath.textContent = managedSession?.repoPath === "bridge_default"
    ? "Desktop Bridge workspace"
    : agent?.adapter?.workingDirectoryPolicy === "bridge_default" ? "Desktop Bridge workspace" : "Unknown";
  els.managedSessionStatus.textContent = isCodex
    ? managedSession?.status ?? managedSessionStatus(invocation)
    : "Select Codex CLI to prepare a managed session";

  els.managedPolicySandbox.textContent = agent?.adapter?.sandbox ?? "Codex CLI native setting";
  els.managedPolicyApproval.textContent = "Codex CLI native approval today";
  els.managedPolicyNetwork.textContent = "Unknown until effective Codex policy is reported";
  els.managedPolicyHooks.textContent = hookEvents.length ? "Hook bridge recording" : "Hook bridge ready; no events yet";

  els.managedEvidenceJsonl.textContent = agent?.adapter?.outputFormat === "codex_jsonl"
    ? `${evidenceRecords.length || managedSession?.evidenceIds?.length || codexEvents.filter((item) => item.type === "agent_output" && item.data?.source === "codex_jsonl").length} evidence record(s)`
    : "Not configured for JSONL evidence";
  els.managedEvidenceHooks.textContent = hookEvents.length ? `${hookEvents.length} hook event(s)` : "No hook events recorded yet";
  els.managedEvidenceFiles.textContent = evidenceRecords.find((item) => item.fileChangeSummary)?.fileChangeSummary
    ?? executionEvent?.data?.fileChangesSummary
    ?? "No file-change summary yet";
  els.managedEvidenceApproval.textContent = approval
    ? `${approval.status}: ${approval.summary?.risk ?? approval.riskLevel ?? "approval request"}`
    : brokerRequest ? `${brokerRequest.status}: ${brokerRequest.toolName}` : "No approval request recorded";

  renderApprovalQueue(state, brokerRequest, approval);
}

function renderManagedSessionHistory(state) {
  const allSessions = state?.codexSessions ?? [];
  const sessions = allSessions.filter((session) => sessionMatchesHistoryFilter(state, session));
  for (const button of els.managedSessionHistoryFilters.querySelectorAll("button[data-session-filter]")) {
    button.dataset.active = String(button.dataset.sessionFilter === managedSessionFilter);
  }

  if (!sessions.length) {
    const empty = document.createElement("p");
    empty.className = "session-history-empty";
    empty.textContent = allSessions.length
      ? "No managed Codex sessions match this filter."
      : "No managed Codex sessions recorded yet.";
    els.managedSessionHistoryList.replaceChildren(empty);
    renderManagedSessionDetail(state, null);
    return;
  }

  if (!selectedManagedSessionId || !sessions.some((session) => session.id === selectedManagedSessionId)) {
    selectedManagedSessionId = sessions[0]?.id ?? null;
  }

  els.managedSessionHistoryList.replaceChildren(
    ...sessions.map((session) => {
      const summary = managedSessionSummary(state, session);
      const item = document.createElement("button");
      item.type = "button";
      item.className = "session-history-item";
      item.dataset.sessionId = session.id;
      item.dataset.selected = String(session.id === selectedManagedSessionId);

      const top = document.createElement("div");
      top.className = "session-history-top";
      const title = document.createElement("strong");
      title.textContent = session.codexThreadId ?? session.codexSessionId ?? session.id;
      const status = document.createElement("span");
      status.className = "session-history-badge";
      status.textContent = readableStatus(session.status);
      top.append(title, status);

      const meta = document.createElement("p");
      meta.textContent = [
        sessionModeText(session.sessionMode),
        session.startedAt ? shortTime(session.startedAt) : null,
        sessionRepoText(session),
        `${summary.evidenceCount} evidence`,
        `${summary.approvalCount} approval`
      ].filter(Boolean).join(" · ");

      const result = document.createElement("p");
      result.className = "session-history-result";
      result.textContent = summary.resultSummary;

      item.append(top, meta, result);
      return item;
    })
  );
  renderManagedSessionDetail(
    state,
    sessions.find((session) => session.id === selectedManagedSessionId) ?? sessions[0]
  );
}

function renderManagedSessionDetail(state, session) {
  if (!session) {
    els.managedSessionDetailTitle.textContent = "Session detail";
    els.managedSessionDetailSummary.textContent = "Select a session to inspect its evidence and state.";
    els.managedSessionDetailAgent.textContent = "-";
    els.managedSessionDetailMode.textContent = "-";
    els.managedSessionDetailRepo.textContent = "-";
    els.managedSessionDetailWorktree.textContent = "-";
    els.managedSessionDetailBranch.textContent = "-";
    els.managedSessionDetailDirty.textContent = "-";
    els.managedSessionDetailCommit.textContent = "-";
    els.managedSessionDetailEvidence.textContent = "-";
    els.managedSessionDetailApprovals.textContent = "-";
    els.managedSessionDetailContinue.textContent = "-";
    renderManagedChangeReview(state, null, []);
    return;
  }

  const summary = managedSessionSummary(state, session);
  const agent = state?.agents?.find((item) => item.id === session.agentId);
  const workspace = managedWorkspaceForSession(state, session);
  const changes = codexChangeEvidenceForSession(state, session, summary.invocation);
  els.managedSessionDetailTitle.textContent = session.codexThreadId ?? session.codexSessionId ?? session.id;
  els.managedSessionDetailSummary.textContent = summary.resultSummary;
  els.managedSessionDetailAgent.textContent = agent?.name ?? session.agentId ?? "Unknown agent";
  els.managedSessionDetailMode.textContent = sessionModeText(session.sessionMode);
  els.managedSessionDetailRepo.textContent = workspace?.repoPath ?? sessionRepoText(session);
  els.managedSessionDetailWorktree.textContent = workspace?.worktreePath ?? "Not isolated";
  els.managedSessionDetailBranch.textContent = workspace?.branchName ?? workspace?.baseBranch ?? "Unknown";
  els.managedSessionDetailDirty.textContent = workspace?.dirtyState ?? "Unknown";
  els.managedSessionDetailCommit.textContent = workspace?.lastCommit ?? "Unknown";
  els.managedSessionDetailEvidence.textContent = `${summary.evidenceCount} JSONL record(s), ${summary.hookCount} hook event(s)`;
  els.managedSessionDetailApprovals.textContent = summary.approvalCount
    ? `${summary.approvalCount} request(s): ${summary.approvalStatuses}`
    : "No approval request recorded";
  els.managedSessionDetailContinue.textContent = session.status === "completed" || session.status === "observing"
    ? "Use Continue last session from the task composer when Codex CLI is selected."
    : "Continuation is available after a managed Codex session is established.";
  renderManagedChangeReview(state, session, changes);
}

function managedSessionSummary(state, session) {
  const invocation = state?.invocations?.find((item) => item.id === session.invocationId);
  const evidence = codexEvidenceForSession(state, session, invocation);
  const hooks = codexHooksForSession(state, session, invocation);
  const approvals = (state?.codexApprovalBrokerRequests ?? []).filter((record) => {
    if (record.codexSessionRegistryId === session.id) return true;
    return invocation && record.invocationId === invocation.id;
  });
  const audit = invocation
    ? state?.auditSummaries?.find((item) => item.invocationId === invocation.id)
    : null;
  return {
    invocation,
    evidenceCount: evidence.length || session.evidenceIds?.length || 0,
    hookCount: hooks.length,
    approvalCount: approvals.length,
    approvalStatuses: approvals.map((item) => item.status).join(", ") || "none",
    resultSummary: invocation
      ? resultSummary(invocation, audit)
      : session.status === "imported" ? "Imported after-the-fact evidence." : "No linked invocation summary yet."
  };
}

function sessionMatchesHistoryFilter(state, session) {
  if (managedSessionFilter === "all") return true;
  if (managedSessionFilter === "imported") return session.sessionMode === "imported" || session.status === "imported";
  const summary = managedSessionSummary(state, session);
  if (managedSessionFilter === "needs_approval") {
    return (state?.codexApprovalBrokerRequests ?? []).some((record) => {
      const matchesSession = record.codexSessionRegistryId === session.id || record.invocationId === session.invocationId;
      return matchesSession && record.status === "pending";
    });
  }
  if (managedSessionFilter === "running") {
    return ["registered", "observing", "running", "queued", "dispatching"].includes(session.status)
      || ["queued", "dispatching", "running", "waiting_for_local_approval"].includes(summary.invocation?.status);
  }
  if (managedSessionFilter === "completed") {
    return session.status === "completed" || summary.invocation?.status === "succeeded";
  }
  if (managedSessionFilter === "failed") {
    return ["failed", "cancelled", "timed_out", "expired", "rejected"].includes(session.status)
      || ["failed", "cancelled", "timed_out", "expired", "rejected"].includes(summary.invocation?.status);
  }
  return true;
}

function sessionRepoText(session) {
  return session?.repoPath === "bridge_default" ? "Desktop Bridge workspace" : session?.repoPath ?? "Repo unknown";
}

function managedWorkspaceForSession(state, session) {
  if (!state?.codexWorkspaces?.length || !session?.workspaceId) {
    return null;
  }
  return state.codexWorkspaces.find((workspace) => workspace.id === session.workspaceId) ?? null;
}

function managedCodexSessionForInvocation(state, invocation) {
  if (!state?.codexSessions?.length || !invocation) {
    return null;
  }
  return state.codexSessions.find((session) => session.invocationId === invocation.id)
    ?? state.codexSessions.find((session) => session.id === invocation.options?.metadata?.managedCodexSessionId)
    ?? null;
}

function codexEvidenceForSession(state, managedSession, invocation) {
  const records = state?.codexEvidenceRecords ?? [];
  if (!records.length) {
    return [];
  }
  return records.filter((record) => {
    if (managedSession && record.codexSessionRegistryId === managedSession.id) return true;
    return invocation && record.invocationId === invocation.id;
  });
}

function codexHooksForSession(state, managedSession, invocation) {
  const records = state?.codexHookEvents ?? [];
  if (!records.length) {
    return [];
  }
  return records.filter((record) => {
    if (managedSession && record.codexSessionRegistryId === managedSession.id) return true;
    return invocation && record.invocationId === invocation.id;
  });
}

function codexApprovalForSession(state, managedSession, invocation) {
  const records = state?.codexApprovalBrokerRequests ?? [];
  if (!records.length) {
    return null;
  }
  return records.find((record) => {
    if (managedSession && record.codexSessionRegistryId === managedSession.id) return true;
    return invocation && record.invocationId === invocation.id;
  }) ?? null;
}

function renderApprovalQueue(state, brokerRequest, approval) {
  const queue = state?.codexApprovalQueue ?? state?.codexApprovalBrokerRequests ?? [];
  const pending = queue.filter((request) => request.status === "pending");
  if (pending.length && !pending.some((request) => request.id === selectedCodexApprovalRequestId)) {
    selectedCodexApprovalRequestId = pending[0].id;
  } else if (!queue.some((request) => request.id === selectedCodexApprovalRequestId)) {
    selectedCodexApprovalRequestId = brokerRequest?.id ?? null;
  }
  const selected = queue.find((request) => request.id === selectedCodexApprovalRequestId)
    ?? brokerRequest
    ?? pending[0]
    ?? null;

  els.approvalAttentionSummary.textContent = pending.length
    ? `${pending.length} Codex approval request(s) need attention.`
    : "No approval request needs attention.";
  els.approvalQueueList.replaceChildren(
    ...(queue.length ? queue.slice(0, 8).map((request) => approvalQueueItem(request, selected?.id)) : [emptyMiniCard("No broker request has been recorded yet.")])
  );
  els.managedApproveButton.disabled = selected?.status !== "pending";
  els.managedDenyButton.disabled = selected?.status !== "pending";
  els.managedApprovalSummary.textContent = selected
    ? approvalRequestSummary(selected)
    : approval
    ? `Local approval: ${approval.status}. Codex broker requests appear here when hooks raise PermissionRequest.`
    : "No Codex approval request is pending.";
}

function approvalQueueItem(request, selectedId) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "approval-queue-item";
  item.dataset.approvalRequestId = request.id;
  item.dataset.selected = String(request.id === selectedId);
  item.dataset.status = request.status ?? "unknown";

  const top = document.createElement("span");
  top.className = "approval-queue-top";
  const title = document.createElement("strong");
  title.textContent = `${request.toolName ?? "Tool"} · ${readableStatus(request.status)}`;
  const badge = document.createElement("span");
  badge.textContent = request.riskLevel ?? "risk unknown";
  top.append(title, badge);

  const summary = document.createElement("span");
  summary.textContent = [
    request.summary,
    request.timeoutAt ? `timeout ${shortTime(request.timeoutAt)}` : null,
    request.repoPath ? `repo ${request.repoPath}` : null
  ].filter(Boolean).join(" · ");

  item.append(top, summary);
  return item;
}

function approvalRequestSummary(request) {
  return [
    `${readableStatus(request.status)}: ${request.summary}`,
    request.taskSummary ? `Task: ${request.taskSummary}` : null,
    request.timeoutAt && request.status === "pending" ? `Timeout: ${shortTime(request.timeoutAt)}` : null
  ].filter(Boolean).join(" ");
}

function codexChangeEvidenceForSession(state, managedSession, invocation) {
  return codexEvidenceForSession(state, managedSession, invocation).filter((record) => record.fileChangeSummary);
}

function codexChangeReviewsForEvidence(state, evidenceId) {
  return (state?.codexChangeReviews ?? []).filter((review) => review.evidenceId === evidenceId);
}

function renderManagedChangeReview(state, session, changes) {
  const visibleChanges = Array.isArray(changes) ? changes : [];
  if (!session || visibleChanges.length === 0) {
    selectedManagedChangeEvidenceId = null;
    els.managedChangeList.replaceChildren(emptyMiniCard("No file changes recorded for this managed session."));
    els.managedChangeDiff.textContent = "No diff evidence has been captured for this session yet.";
    els.managedChangeReviewComment.value = "";
    els.managedChangeReviewStatus.textContent = "Review decisions are recorded once Codex emits file-change evidence.";
    setChangeReviewButtonsDisabled(true);
    return;
  }

  if (!visibleChanges.some((record) => record.id === selectedManagedChangeEvidenceId)) {
    selectedManagedChangeEvidenceId = visibleChanges[0].id;
  }
  const selected = visibleChanges.find((record) => record.id === selectedManagedChangeEvidenceId) ?? visibleChanges[0];
  const latestReview = codexChangeReviewsForEvidence(state, selected.id)[0] ?? null;

  els.managedChangeList.replaceChildren(
    ...visibleChanges.map((record) => {
      const reviews = codexChangeReviewsForEvidence(state, record.id);
      const latest = reviews[0] ?? null;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "change-item";
      item.dataset.changeEvidenceId = record.id;
      item.dataset.selected = String(record.id === selected.id);

      const title = document.createElement("strong");
      title.textContent = record.fileChangePath ?? record.fileChangeSummary;
      const meta = document.createElement("span");
      meta.textContent = [
        record.fileChangeAction ?? "changed",
        `risk: ${record.changeRisk ?? "unknown"}`,
        latest ? `review: ${latest.decision}` : "unreviewed"
      ].join(" · ");
      item.append(title, meta);
      return item;
    })
  );
  els.managedChangeDiff.textContent = selected.diffPreview ?? selected.summary ?? "Diff preview was not included in this JSONL event.";
  els.managedChangeReviewStatus.textContent = latestReview
    ? `Last review: ${latestReview.decision}${latestReview.comment ? ` - ${latestReview.comment}` : ""}`
    : "No review decision recorded for this change.";
  setChangeReviewButtonsDisabled(false);
}

function emptyMiniCard(text) {
  const empty = document.createElement("p");
  empty.className = "mini-empty";
  empty.textContent = text;
  return empty;
}

function setChangeReviewButtonsDisabled(disabled) {
  els.approveChangeButton.disabled = disabled;
  els.rejectChangeButton.disabled = disabled;
  els.feedbackChangeButton.disabled = disabled;
}

async function submitSelectedChangeReview(decision) {
  if (!selectedManagedChangeEvidenceId) {
    return;
  }
  setChangeReviewButtonsDisabled(true);
  try {
    const response = await fetch(`${apiBase}/api/codex/change-reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        evidenceId: selectedManagedChangeEvidenceId,
        decision,
        comment: els.managedChangeReviewComment.value.trim()
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message ?? data.error ?? "Unable to record change review.");
    }
    els.managedChangeReviewComment.value = "";
    await refresh();
  } catch (error) {
    els.managedChangeReviewStatus.textContent = error instanceof Error ? error.message : "Unable to record change review.";
  } finally {
    updateActions(lastState, currentInvocation());
  }
}

async function resolveSelectedCodexApproval(action) {
  if (!selectedCodexApprovalRequestId) {
    return;
  }
  els.managedApproveButton.disabled = true;
  els.managedDenyButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/codex/approval-broker/${encodeURIComponent(selectedCodexApprovalRequestId)}/${action}`, {
      method: "POST"
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
}

function preferredAgentId(state, agents) {
  const defaultAgentId = state.agent?.id;
  if (defaultAgentId && agents.some((agent) => agent.id === defaultAgentId)) {
    return defaultAgentId;
  }
  return agents.find((agent) => agent.status === "available" && agent.location?.type === "local_device")?.id ?? agents[0]?.id ?? null;
}

function currentInvocation() {
  if (!lastState || !currentInvocationId) {
    return null;
  }
  return lastState.invocations.find((item) => item.id === currentInvocationId) ?? null;
}

function currentApproval(state, invocation) {
  if (!state || !invocation?.approvalRequestId) {
    return null;
  }
  return state.approvalRequests?.find((item) => item.id === invocation.approvalRequestId) ?? null;
}

function currentTroubleshootingReport(state, invocation) {
  if (!state || !invocation) {
    return null;
  }
  return state.troubleshootingReports?.find((item) => item.invocationId === invocation.id) ?? null;
}

function renderTroubleshooter(report) {
  if (!report) {
    els.troubleshooterPanel.hidden = true;
    return;
  }

  els.troubleshooterPanel.hidden = false;
  els.troubleshooterTitle.textContent = `Troubleshooting ${report.invocationId}`;
  els.troubleshooterSummary.textContent = report.summary;
  els.troubleshooterBridge.textContent = report.bridgeState;
  els.troubleshooterError.textContent = report.adapterError ?? "No adapter error text recorded.";
  els.troubleshooterLogs.textContent = report.logSummary;
  els.troubleshooterFixes.textContent = report.suggestedFixes?.join(" ") ?? "Review the event timeline and retry safely.";
}

function renderApproval(approval) {
  if (!approval) {
    els.approvalPanel.hidden = true;
    return;
  }

  els.approvalPanel.hidden = false;
  els.approvalTitle.textContent = approval.status === "pending"
    ? "Review before running"
    : approval.status === "approved"
      ? "Approval granted"
      : "Approval denied";
  els.approvalRisk.textContent = approval.summary?.risk ?? `${approval.riskLevel} risk`;
  els.approvalData.textContent = approval.summary?.data ?? "Task input and result are recorded.";
  els.approvalCost.textContent = approval.summary?.cost ?? "Cost is unknown.";
  els.approvalCancellation.textContent = approval.summary?.cancellation ?? "Cancellation behavior is unknown.";
  els.approvalTags.textContent = approval.riskTags?.length ? approval.riskTags.join(", ") : "No tags declared";
}

function renderSelectors(state, agents) {
  const deviceLabel = `${state.device.name} - ${readableDeviceStatus(state.device.status)}`;
  if (els.deviceSelect.options.length !== 1 || els.deviceSelect.value !== state.device.id) {
    els.deviceSelect.replaceChildren(new Option(deviceLabel, state.device.id));
  } else {
    els.deviceSelect.options[0].textContent = deviceLabel;
  }
  els.deviceSelectValue.textContent = deviceLabel;
  els.deviceSelect.disabled = true;

  const previous = selectedAgentId || els.agentSelect.value;
  els.agentSelect.replaceChildren(
    ...agents.map((agent) => new Option(agentOptionLabel(agent), agent.id))
  );
  els.agentSelect.value = agents.some((agent) => agent.id === previous) ? previous : selectedAgentId ?? "";
  selectedAgentId = els.agentSelect.value || selectedAgentId;
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  els.agentSelectValue.textContent = selectedAgent ? agentOptionLabel(selectedAgent) : "Select an agent";
  renderAgentChoices(state, agents);
}

function renderAgentChoices(state, agents) {
  els.agentChoiceList.replaceChildren(
    ...agents
      .filter((agent) => agent.location?.type !== "platform_agent")
      .map((agent) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "agent-choice";
        button.dataset.agentId = agent.id;
        button.dataset.selected = String(agent.id === selectedAgentId);
        button.dataset.status = agent.status ?? "unknown";

        const top = document.createElement("span");
        top.className = "agent-choice-top";
        const name = document.createElement("strong");
        name.textContent = agent.name;
        const badge = document.createElement("span");
        badge.className = "agent-choice-badge";
        badge.textContent = agentChoiceBadge(agent);
        top.append(name, badge);

        const summary = document.createElement("span");
        summary.className = "agent-choice-summary";
        summary.textContent = agentChoiceSummary(agent, state);

        button.append(top, summary);
        return button;
      })
  );
}

function renderCompareAgentChoices(agents) {
  const comparableAgents = agents.filter((agent) => agent.location?.type !== "platform_agent" && agent.status !== "disabled");
  els.compareAgentList.replaceChildren(
    ...comparableAgents.map((agent) => {
      const label = document.createElement("label");
      label.className = "compare-agent-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.compareAgentId = agent.id;
      input.checked = selectedCompareAgentIds.has(agent.id);
      input.disabled = agent.id === selectedAgentId;
      const text = document.createElement("span");
      text.textContent = agent.id === selectedAgentId ? `${agent.name} (primary)` : agent.name;
      label.append(input, text);
      return label;
    })
  );
}

function renderComparePanel(state) {
  const compareRun = currentCompareRun(state);
  if (!compareRun) {
    els.comparePanel.hidden = true;
    els.compareList.replaceChildren();
    return;
  }
  els.comparePanel.hidden = false;
  els.compareList.replaceChildren(
    ...compareRun.childInvocationIds.map((id) => {
      const invocation = state.invocations.find((item) => item.id === id);
      const agent = state.agents.find((item) => item.id === invocation?.agentId);
      const session = state.codexSessions?.find((item) => item.invocationId === id);
      const evidenceCount = state.codexEvidenceRecords?.filter((item) => item.invocationId === id).length ?? 0;
      const workspace = session ? managedWorkspaceForSession(state, session) : null;
      const card = document.createElement("article");
      card.className = "compare-card";
      const title = document.createElement("h3");
      title.textContent = agent?.name ?? invocation?.agentId ?? id;
      const meta = document.createElement("p");
      meta.textContent = [
        `Status: ${readableStatus(invocation?.status)}`,
        workspace ? `Workspace: ${workspace.dirtyState}` : "Workspace: not tracked",
        `Evidence: ${evidenceCount}`,
        compareRun.preferredInvocationId === id ? "Preferred" : null
      ].filter(Boolean).join(" · ");
      const result = document.createElement("p");
      result.textContent = invocation ? resultSummary(invocation, state.auditSummaries.find((item) => item.invocationId === invocation.id)) : "Invocation is not available.";
      card.append(title, meta, result);
      return card;
    })
  );
}

function currentCompareRun(state) {
  if (!state?.compareRuns?.length || !currentInvocationId) {
    return null;
  }
  return state.compareRuns.find((run) => run.childInvocationIds.includes(currentInvocationId)) ?? null;
}

function renderOffline() {
  renderMode(null, null);
  els.taskState.textContent = "Offline";
  els.taskState.dataset.state = "failed";
  els.activityTitle.textContent = "Connect the local demo server";
  els.deviceStatus.textContent = "Offline";
  els.deviceLastSeen.textContent = "-";
  els.agentStatus.textContent = "Unavailable";
  els.agentHealth.textContent = "-";
  els.agentCapability.textContent = "-";
  els.agentCostOwner.textContent = "-";
  els.agentUsage.textContent = "-";
  els.agentNextAction.textContent = "-";
  els.agentLifecycle.textContent = "-";
  els.deliveryStatus.textContent = "Not delivered";
  els.cancelStatus.textContent = "No task";
  els.auditDecision.textContent = "Nothing recorded";
  els.resultTitle.textContent = "Waiting for server";
  els.resultSummary.textContent = "Start the local demo server, then this workspace can show your computer and agent status.";
  els.runButton.disabled = true;
  els.cancelButton.disabled = true;
  els.healthCheckButton.disabled = true;
  els.toggleAgentButton.disabled = true;
  els.discoverButton.disabled = true;
  els.createIntegrationButton.disabled = true;
  els.builderDraftButton.disabled = true;
  els.generateIntegrationButton.disabled = true;
  els.importEvidenceButton.disabled = true;
  els.approvalPanel.hidden = true;
  els.approveButton.disabled = true;
  els.denyButton.disabled = true;
  els.managedApproveButton.disabled = true;
  els.managedDenyButton.disabled = true;
  els.troubleshootButton.disabled = true;
  els.troubleshooterPanel.hidden = true;
  els.runBlockReason.textContent = "Server is offline.";
  els.discoverySummary.textContent = "Server is offline.";
  els.integrationSummary.textContent = "Server is offline.";
  els.candidateList.replaceChildren();
  els.artifactList.replaceChildren();
  renderTimeline([]);
}

function renderTimeline(events) {
  if (events.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timeline-empty";
    empty.innerHTML = "<strong>No activity yet</strong><span>Run a task to watch local progress here.</span>";
    els.eventList.replaceChildren(empty);
    return;
  }

  els.eventList.replaceChildren(
    ...events.map((event) => {
      const item = document.createElement("article");
      item.className = "timeline-item";

      const time = document.createElement("time");
      time.className = "timeline-time";
      time.dateTime = event.createdAt;
      time.textContent = shortTime(event.createdAt);

      const copy = document.createElement("div");
      copy.className = "timeline-copy";

      const title = document.createElement("strong");
      title.textContent = readableEventType(event.type);

      const message = document.createElement("p");
      message.textContent = timelineMessage(event);

      copy.append(title, message);
      item.append(time, copy);
      return item;
    })
  );
}

function updateActions(state, invocation) {
  const hasServer = Boolean(state);
  const hasTask = els.taskInput.value.trim().length > 0;
  const hasAgent = Boolean(selectedAgentId);
  const isRunning = ["queued", "dispatching", "waiting_for_local_approval", "running", "cancelling"].includes(invocation?.status);
  const agent = selectedAgent(state);
  const isCodex = isCodexAgent(agent);
  const localAgent = agent?.location?.type === "local_device";
  const disabled = agent?.status === "disabled";
  const unhealthy = agent?.health?.status === "unhealthy";
  const approval = currentApproval(state, invocation);
  const approvalPending = approval?.status === "pending";
  const canTroubleshoot = ["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation?.status);
  els.runButton.textContent = localAgent && state?.device?.status !== "online" ? "Queue for this computer" : "Run on this computer";
  els.runButton.disabled = !hasServer || !hasTask || !hasAgent || isRunning || disabled || unhealthy;
  els.codexSessionMode.disabled = !isCodex || isRunning;
  els.cancelButton.disabled = !invocation || !["queued", "dispatching", "waiting_for_local_approval", "running"].includes(invocation.status);
  els.approveButton.disabled = !approvalPending;
  els.denyButton.disabled = !approvalPending;
  els.troubleshootButton.disabled = !canTroubleshoot;
  els.healthCheckButton.disabled = !hasServer || !hasAgent || agent?.health?.status === "checking";
  els.toggleAgentButton.disabled = !hasServer || !hasAgent;
  const discoveryBusy = state?.discoveryRuns?.[0]?.status === "queued" || state?.discoveryRuns?.[0]?.status === "running";
  els.discoverButton.disabled = !hasServer || state?.device?.status !== "online" || discoveryBusy;
  const codexAgent = codexAgentInState(state);
  els.addCodexButton.disabled = !hasServer || (!codexAgent && (state?.device?.status !== "online" || discoveryBusy)) || codexAgent?.health?.status === "checking";
  els.addCodexButton.textContent = codexActionText(codexAgent);
  const artifact = selectedIntegrationArtifact(state);
  els.createIntegrationButton.disabled = !hasServer || els.integrationIntent.value.trim().length === 0;
  els.builderDraftButton.disabled = !hasServer || els.integrationIntent.value.trim().length === 0;
  els.generateIntegrationButton.disabled = !hasServer || !artifact || artifact.artifactType !== "integration_plan" || ["archived", "rejected"].includes(artifact.reviewState);
  els.importEvidenceButton.disabled = !hasServer || activeMode !== "import_session" || !els.importEvidenceSummary.value.trim();
  els.runBlockReason.textContent = runBlockReason({ hasServer, hasTask, hasAgent, isRunning, disabled, unhealthy, agent });
}

function renderDiscovery(discoveryRun) {
  if (!discoveryRun) {
    els.discoverySummary.textContent = "Discovery is conservative and only checks known or user-provided sources.";
    els.candidateList.replaceChildren();
    return;
  }

  els.discoverySummary.textContent = discoverySummary(discoveryRun);
  if (!discoveryRun.candidates?.length) {
    const empty = document.createElement("div");
    empty.className = "timeline-empty";
    empty.innerHTML = "<strong>No candidates yet</strong><span>Run discovery while Desktop Bridge is online.</span>";
    els.candidateList.replaceChildren(empty);
    return;
  }

  els.candidateList.replaceChildren(
    ...discoveryRun.candidates.map((candidate) => {
      const card = document.createElement("article");
      card.className = "candidate-card";

      const title = document.createElement("h3");
      title.textContent = candidate.name;

      const description = document.createElement("p");
      description.textContent = candidate.description;

      const meta = document.createElement("div");
      meta.className = "candidate-meta";
      meta.replaceChildren(
        metaSpan(`Adapter: ${readableAdapterType(candidate.adapter?.type)}`),
        metaSpan(`Source: ${readableDiscoverySource(candidate.source)}`),
        metaSpan(`Confidence: ${candidate.confidence}`),
        metaSpan(`Risk: ${candidate.riskLevel}`),
        metaSpan(candidate.healthProbeAvailable ? "Health probe available" : "No health probe")
      );

      const risk = document.createElement("p");
      risk.textContent = candidate.riskHints?.join(" ") ?? "Review this candidate before registering.";

      const codexReview = codexCandidateReview(candidate);
      if (codexReview.length > 0) {
        const review = document.createElement("dl");
        review.className = "codex-review";
        review.replaceChildren(
          ...codexReview.map(([label, value]) => {
            const row = document.createElement("div");
            const term = document.createElement("dt");
            const definition = document.createElement("dd");
            term.textContent = label;
            definition.textContent = value;
            row.append(term, definition);
            return row;
          })
        );
        card.append(title, description, meta, risk, review);
      } else {
        card.append(title, description, meta, risk);
      }

      const action = document.createElement("button");
      action.type = "button";
      action.className = "secondary";
      action.dataset.discoveryRunId = discoveryRun.id;
      action.dataset.candidateId = candidate.id;
      action.textContent = candidate.registration?.status === "registered" ? "Registered disabled" : "Register disabled";
      action.disabled = candidate.registration?.status === "registered";

      card.append(action);
      return card;
    })
  );
}

function renderIntegrationArtifacts(artifacts, probeRuns) {
  if (!artifacts.length) {
    els.integrationSummary.textContent = "Save an unsupported-agent draft before generating reviewable artifacts.";
    const empty = document.createElement("div");
    empty.className = "timeline-empty";
    empty.innerHTML = "<strong>No artifacts yet</strong><span>Draft an unsupported integration to begin review.</span>";
    els.artifactList.replaceChildren(empty);
    return;
  }

  const latest = artifacts[0];
  els.integrationSummary.textContent = `${latest.summary} is ${readableReviewState(latest.reviewState)}. Generated work stays disabled until explicit registration.`;
  els.artifactList.replaceChildren(
    ...artifacts.slice(0, 12).map((artifact) => {
      const probe = probeRuns.find((item) => item.artifactId === artifact.id);
      const card = document.createElement("article");
      card.className = "artifact-card";
      if (artifact.id === selectedArtifactId) {
        card.dataset.selected = "true";
      }

      const title = document.createElement("h3");
      title.textContent = artifact.summary;

      const description = document.createElement("p");
      description.textContent = artifact.payload?.adapterGuidance ?? "Review this generated integration artifact before use.";

      const meta = document.createElement("div");
      meta.className = "candidate-meta";
      meta.replaceChildren(
        metaSpan(`Type: ${artifact.artifactType.replaceAll("_", " ")}`),
        metaSpan(`Adapter: ${readableAdapterType(artifact.targetType)}`),
        metaSpan(`Review: ${readableReviewState(artifact.reviewState)}`),
        metaSpan(artifact.generatedByAi ? "Generated by AI" : "User draft"),
        metaSpan(`Cost: ${artifact.governance?.economics?.model ?? "unknown"}`),
        metaSpan(`Quota: ${artifact.governance?.quota?.decision ?? "record only"}`)
      );

      const probeText = document.createElement("p");
      probeText.textContent = probe ? `${probe.summary} (${probe.status})` : "Probe has not run.";

      const actions = document.createElement("div");
      actions.className = "artifact-actions";
      actions.replaceChildren(
        artifactButton(artifact, "review", "Review"),
        artifactButton(artifact, "approve", "Approve"),
        artifactButton(artifact, "reject", "Reject"),
        artifactButton(artifact, "archive", "Archive"),
        artifactButton(artifact, "probe", "Probe"),
        artifactButton(artifact, "register", "Register disabled")
      );

      card.append(title, description, meta, probeText, actions);
      return card;
    })
  );
}

function artifactButton(artifact, action, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.dataset.artifactId = artifact.id;
  button.dataset.artifactAction = action;
  button.textContent = label;
  const disabledByState =
    (action === "probe" && (artifact.artifactType !== "adapter_config" || !["approved", "tested"].includes(artifact.reviewState))) ||
    (action === "register" && (artifact.artifactType !== "adapter_config" || artifact.reviewState !== "tested")) ||
    (action === "approve" && ["approved", "tested", "enabled", "archived"].includes(artifact.reviewState)) ||
    (action === "review" && ["needs_review", "tested", "enabled", "archived"].includes(artifact.reviewState)) ||
    (action === "reject" && ["rejected", "enabled", "archived"].includes(artifact.reviewState)) ||
    (action === "archive" && artifact.reviewState === "archived");
  button.disabled = disabledByState;
  return button;
}

function metaSpan(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function discoverySummary(discoveryRun) {
  if (discoveryRun.status === "queued") return "Discovery is queued for Desktop Bridge. It will only check known or user-provided sources.";
  if (discoveryRun.status === "running") return "Desktop Bridge is checking conservative discovery sources.";
  if (discoveryRun.status === "failed") return discoveryRun.message;
  return `${discoveryRun.message} Candidates are not auto-enabled.`;
}

function readableDiscoverySource(source) {
  const map = {
    known_command_allowlist: "known command allowlist",
    user_provided_path: "user-provided path",
    known_local_endpoint: "known local endpoint",
    user_provided_endpoint: "user-provided endpoint",
    bridge_managed_config: "bridge-managed config"
  };
  return map[source] ?? source;
}

function readableAdapterType(type) {
  if (type === "cli") return "CLI";
  if (type === "http") return "HTTP";
  return type ?? "Unknown";
}

async function postIntegrationArtifact(overrides = {}) {
  const response = await fetch(`${apiBase}/api/integration-artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...integrationPayload(), ...overrides })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? "Unable to create integration artifact.");
  }
  return data;
}

async function createDiscovery(payload) {
  const response = await fetch(`${apiBase}/api/discovery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message ?? data.error ?? "Unable to start discovery.");
  }
  return response.json();
}

function resolveApiBase() {
  const override = new URLSearchParams(window.location.search).get("api");
  if (!override) {
    return defaultApiBase;
  }

  try {
    const url = new URL(override);
    if (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)) {
      return url.origin;
    }
  } catch {
    return defaultApiBase;
  }

  return defaultApiBase;
}

async function fetchState() {
  const response = await fetch(`${apiBase}/api/state`);
  if (!response.ok) {
    throw new Error("Unable to refresh state.");
  }
  return response.json();
}

function ensureListValue(input, value) {
  const items = parseList(input.value);
  if (!items.includes(value)) {
    input.value = [...items, value].join(", ");
  }
}

function isCodexCandidate(candidate) {
  const command = String(candidate?.adapter?.command ?? "").toLowerCase();
  return command === "codex" || command.endsWith("/codex") || command.endsWith("\\codex") || candidate?.adapter?.outputFormat === "codex_jsonl";
}

function codexCandidateReview(candidate) {
  if (!isCodexCandidate(candidate)) {
    return [];
  }
  return [
    ["Command", [candidate.adapter?.command, ...(candidate.adapter?.args ?? [])].filter(Boolean).join(" ")],
    ["Evidence", candidate.adapter?.outputFormat === "codex_jsonl" ? "Codex JSONL events" : "Review output format"],
    ["Permissions", "Handled by Codex CLI native controls"],
    ["Sandbox", candidate.adapter?.sandbox ?? "Codex CLI default"],
    ["Cost", "External or unknown to this demo"]
  ];
}

function timelineMessage(event) {
  if (event.type === "execution_preview" && event.data?.commandLine) {
    const task = event.data.taskSummary ? ` Task: ${event.data.taskSummary}` : "";
    const session = event.data.sessionMode ? ` Session: ${sessionModeText(event.data.sessionMode)}` : "";
    return `${event.data.commandLine}${session}${task}`;
  }
  if (event.type === "codex_runtime_warning") {
    return event.message ?? "Codex CLI reported a runtime warning.";
  }
  return event.message ?? "Activity recorded.";
}

function isCodexAgent(agent) {
  const command = String(agent?.adapter?.command ?? "").toLowerCase();
  return Boolean(agent && (
    agent.id === "agt_codex_cli"
      || agent.adapter?.outputFormat === "codex_jsonl"
      || command === "codex"
      || command.endsWith("/codex")
      || command.endsWith("\\codex")
      || command.endsWith("\\codex.cmd")
      || command.endsWith("\\codex.exe")
  ));
}

function sessionModeText(...values) {
  const mode = values.find((value) => value && value !== "not_applicable");
  if (mode === "continue_last") return "Continue last Codex session";
  if (mode === "new") return "Start new Codex session";
  return "Not applicable";
}

function managedSessionStatus(invocation) {
  if (!invocation) return "Ready to launch through MyAgentTool";
  if (invocation.status === "waiting_for_local_approval") return "Waiting for approval";
  if (["queued", "dispatching", "running", "cancelling"].includes(invocation.status)) return "Active";
  if (invocation.status === "succeeded") return "Completed";
  if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation.status)) return "Closed with attention needed";
  return readableStatus(invocation.status);
}

function integrationPayload() {
  return {
    targetType: els.integrationAdapter.value,
    title: "Unsupported agent integration",
    description: els.integrationIntent.value.trim(),
    command: els.integrationCommand.value.trim(),
    baseUrl: els.integrationUrl.value.trim(),
    workingDirectory: els.integrationWorkingDirectory.value.trim(),
    environmentNeeds: els.integrationEnvironment.value.trim(),
    cancellation: els.integrationCancellation.value,
    streaming: els.integrationStreaming.checked,
    costOwner: els.integrationCostOwner.value.trim() || "usr_local",
    economicModel: els.integrationEconomicModel.value
  };
}

function selectedIntegrationArtifact(state) {
  if (!state?.integrationArtifacts?.length) {
    return null;
  }
  return state.integrationArtifacts.find((item) => item.id === selectedArtifactId) ?? state.integrationArtifacts[0];
}

function parseList(value) {
  return String(value ?? "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readableReviewState(state) {
  const map = {
    draft: "draft",
    generated: "generated",
    needs_review: "needs review",
    approved: "approved",
    tested: "tested",
    enabled: "registered",
    rejected: "rejected",
    archived: "archived"
  };
  return map[state] ?? state ?? "unknown";
}

function quotaSummary(state) {
  const latest = state?.quotaDecisionRecords?.[0];
  if (!latest) return "No quota decision recorded yet";
  return `${latest.decision}: ${latest.reason}`;
}

function retentionSummary(settings) {
  if (!settings) return "Retention is not configured";
  return `Logs ${settings.logsDays}d, prompts ${settings.promptsDays}d, responses ${settings.responsesDays}d, artifacts ${settings.artifactsDays}d`;
}

function builderSummary(artifacts = []) {
  if (!artifacts.length) return "Integration Builder drafts plans only";
  const generated = artifacts.filter((item) => item.generatedByAi).length;
  return `${artifacts.length} artifact(s), ${generated} AI-generated, advisory until explicit action`;
}

function readableStatus(status) {
  const map = {
    queued: "Queued",
    dispatching: "Sending",
    waiting_for_local_approval: "Needs approval",
    running: "Running",
    cancelling: "Stopping",
    succeeded: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
    timed_out: "Timed out",
    expired: "Expired"
  };
  return map[status] ?? "Waiting";
}

function activityTitle(status) {
  const map = {
    queued: "Task is waiting for the local agent",
    dispatching: "Task is being sent to the computer",
    waiting_for_local_approval: "Task needs local approval",
    running: "The local agent is working",
    cancelling: "Stop request sent",
    succeeded: "Task finished",
    failed: "Task could not finish",
    cancelled: "Task was cancelled",
    timed_out: "Task timed out",
    expired: "Task expired"
  };
  return map[status] ?? "Ready to run";
}

function readableDeviceStatus(status) {
  if (status === "online") return "Online and ready";
  if (status === "offline") return "Offline";
  return status ?? "-";
}

function readableAgentStatus(status) {
  if (status === "available") return "Ready";
  if (status === "unavailable") return "Waiting for computer";
  if (status === "disabled") return "Disabled";
  return status ?? "-";
}

function readableHealth(health) {
  if (!health) return "Not checked";
  const checkedAt = health.checkedAt ? ` at ${shortTime(health.checkedAt)}` : "";
  if (health.status === "healthy") return `Healthy${checkedAt} - ${health.message}`;
  if (health.status === "unhealthy") return `Needs attention${checkedAt} - ${health.message}`;
  if (health.status === "checking") return "Checking health";
  return "Not checked";
}

function readableHealthLabel(health) {
  if (health?.status === "healthy") return "Healthy";
  if (health?.status === "unhealthy") return "Needs attention";
  if (health?.status === "checking") return "Checking health";
  return "Not checked";
}

function agentOptionLabel(agent) {
  const setup = agent.status === "disabled" ? "Enable first" : readableAgentStatus(agent.status);
  const risk = highestRiskLevel(agent) === "high" ? "High risk" : "Low risk";
  return `${agent.name} - ${setup} - ${risk}`;
}

function agentChoiceBadge(agent) {
  if (agent.status === "disabled") return "Enable first";
  if (agent.health?.status === "healthy") return "Ready";
  if (agent.health?.status === "unhealthy") return "Needs attention";
  if (agent.health?.status === "checking") return "Checking";
  return readableAgentStatus(agent.status);
}

function agentChoiceSummary(agent, state) {
  if (isCodexAgent(agent)) {
    if (agent.health?.status !== "healthy") return "Run a health check before the first Codex task.";
    return "Uses local Codex CLI permissions, sandbox, and authentication.";
  }
  if (agent.status === "disabled") return "Disabled agents are visible here but cannot run until enabled.";
  if (agent.location?.type === "local_device" && state?.device?.status !== "online") return "Start Desktop Bridge to use this local agent.";
  return agent.capabilities?.[0]?.description ?? "Ready for local tasks.";
}

function agentNextAction(agent, state) {
  if (!agent) return "-";
  if (agent.status === "disabled") {
    return isCodexAgent(agent)
      ? "Codex CLI is disabled only if you explicitly disabled this local entry."
      : "Enable the agent before running a task.";
  }
  if (agent.health?.status === "unhealthy") return agent.health.nextAction ?? "Run another health check after fixing the agent.";
  if (agent.health?.status === "unknown" || !agent.health) return isCodexAgent(agent) ? "Run a health check before the first Codex task." : "Run a health check when setup changes.";
  if (agent.location?.type === "local_device" && state?.device?.status !== "online") return "Start Desktop Bridge to run local work.";
  return "Ready for tasks.";
}

function lifecycleText(agent) {
  if (!agent) return "-";
  return `${agent.lifecycle?.state ?? "unknown"} / ${agent.lifecycle?.installState ?? "unknown"}`;
}

function selectedAgent(state) {
  return state?.agents?.find((agent) => agent.id === selectedAgentId) ?? state?.agent ?? null;
}

function codexAgentInState(state) {
  return state?.agents?.find((agent) => isCodexAgent(agent)) ?? null;
}

function codexActionText(agent) {
  if (!agent) return "Find Codex CLI";
  if (selectedAgentId !== agent.id) return "Select Codex CLI";
  if (agent.health?.status === "checking") return "Checking Codex CLI";
  if (agent.health?.status !== "healthy") return "Check Codex health";
  return "Codex CLI selected";
}

function highestRiskLevel(agent) {
  const riskOrder = { low: 1, medium: 2, high: 3, critical: 4 };
  return agent?.capabilities?.reduce((highest, capability) => {
    return (riskOrder[capability.riskLevel] ?? 0) > (riskOrder[highest] ?? 0) ? capability.riskLevel : highest;
  }, "low") ?? "low";
}

function runBlockReason({ hasServer, hasTask, hasAgent, isRunning, disabled, unhealthy, agent }) {
  if (!hasServer) return "Server is offline.";
  if (!hasTask) return "Enter a task before running.";
  if (!hasAgent) return "Select an agent before running.";
  if (disabled) return isCodexAgent(agent)
    ? "Codex CLI was disabled from this console. Re-enable the local entry or use Codex CLI directly."
    : `${agent?.name ?? "This agent"} is disabled. Enable it before running a new task.`;
  if (unhealthy) return `${agent?.name ?? "This agent"} is unhealthy. Run a health check after fixing it.`;
  if (isRunning) return "Wait for the current task to finish or cancel it.";
  return "";
}

function costText(economics) {
  if (!economics) return "Unknown";
  if (economics.model === "unknown") return "No billing in demo";
  return `${economics.model} (${economics.unknownCostPolicy})`;
}

function agentCostText(agent) {
  if (isCodexAgent(agent)) return "External or unknown";
  return costText(agent?.economics);
}

function costOwnerText(economics, usage) {
  const owner = usage?.costOwner ?? economics?.costOwner ?? "unknown";
  const model = usage?.economicModel ?? economics?.model ?? "unknown";
  if (owner === "unknown") return `Unknown owner (${model})`;
  return `${owner} (${model})`;
}

function usageText(usage) {
  if (!usage) return "No completed invocations yet";
  return `${usage.invocationCount} completed: ${usage.succeededCount} succeeded, ${usage.failedCount} failed, ${usage.cancelledCount} cancelled`;
}

function readableDelivery(state) {
  const map = {
    not_required: "Runs without computer delivery",
    queued: "Waiting",
    dispatching: "Sending to computer",
    delivered: "Sent to computer",
    acknowledged: "Received by computer",
    redelivering: "Trying again",
    delivery_failed: "Delivery failed",
    expired: "Expired"
  };
  return map[state] ?? "Not delivered";
}

function readableCancellation(state) {
  const map = {
    none: "No stop request",
    requested: "Stop requested",
    queued_cancelled: "Cancelled before running",
    dispatched: "Stop sent",
    acknowledged: "Stop acknowledged",
    applied: "Stopped",
    failed: "Stop failed",
    not_supported: "Stop not supported"
  };
  return map[state] ?? "No stop request";
}

function resultTitle(status) {
  if (status === "succeeded") return "Answer returned";
  if (status === "failed") return "Needs attention";
  if (status === "cancelled") return "Stopped";
  if (status === "timed_out") return "Timed out";
  if (status === "expired") return "Expired";
  if (status === "rejected") return "Rejected";
  if (status === "running") return "Working locally";
  if (status === "waiting_for_local_approval") return "Needs approval";
  if (status === "queued") return "Waiting";
  return "No result yet";
}

function resultSummary(invocation, audit) {
  if (!invocation) return "Run a task to see the answer here.";
  if (invocation.result?.summary) return invocation.result.summary;
  if (invocation.status === "waiting_for_local_approval") return "Review the local approval request before this task can run.";
  if (invocation.status === "rejected") return audit?.errorSummary ?? "Local approval was denied, so the task did not run.";
  if (invocation.status === "running") return "The agent is still working on your computer.";
  if (invocation.status === "queued") return "The task is queued for the local bridge.";
  if (invocation.status === "dispatching") return "The task is being sent to your computer.";
  if (invocation.status === "cancelled") return "The task was stopped before it completed.";
  if (invocation.status === "failed") return audit?.errorSummary ?? "The task could not finish.";
  if (invocation.status === "timed_out") return "The task ran longer than its timeout.";
  if (audit?.permissionDecision) return `Audit recorded: ${readableAudit(audit)}.`;
  return "No final answer has been returned yet.";
}

function readableEventType(type) {
  const map = {
    invocation_created: "Task created",
    invocation_authorized: "Task allowed",
    invocation_rejected: "Task rejected",
    policy_decision_recorded: "Policy checked",
    local_approval_requested: "Approval needed",
    local_approval_granted: "Approval granted",
    local_approval_denied: "Approval denied",
    delivery_queued: "Waiting for computer",
    delivery_dispatched: "Sent to computer",
    delivery_redelivered: "Delivery retried",
    delivery_acknowledged: "Computer received task",
    execution_preview: "Execution preview",
    invocation_started: "Agent started",
    log: "Agent update",
    agent_output: "Agent output",
    codex_runtime_warning: "Codex warning",
    trace_created: "Trace started",
    span_completed: "Trace completed",
    heartbeat: "Computer connected",
    lifecycle_requested: "Agent action requested",
    lifecycle_started: "Agent action started",
    lifecycle_completed: "Agent action completed",
    lifecycle_failed: "Agent action failed",
    invocation_succeeded: "Task completed",
    invocation_failed: "Task failed",
    invocation_timed_out: "Task timed out",
    cancel_requested: "Stop requested",
    cancel_dispatched: "Stop sent",
    cancel_applied: "Stop completed",
    cancel_failed: "Stop failed"
  };
  return map[type] ?? type.replaceAll("_", " ");
}

function latestExecutionPreview(state, invocation) {
  if (!state || !invocation) return null;
  return state.events
    ?.filter((event) => event.invocationId === invocation.id && event.type === "execution_preview")
    .at(-1) ?? null;
}

function taskSummary(task) {
  const normalized = String(task ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 117)}...`;
}

function adapterText(adapter) {
  if (!adapter) return "-";
  if (adapter.type === "cli") return `CLI command: ${adapter.command}`;
  if (adapter.type === "http") return `HTTP endpoint: ${adapter.baseUrl}`;
  if (adapter.type === "platform") return `Platform agent: ${adapter.name ?? "built-in"}`;
  return adapter.type;
}

function cancellationText(adapter) {
  if (!adapter) return "No agent selected";
  if (adapter.cancellation === "supported") return "Can request stop";
  if (adapter.cancellation === "unsupported") return "Stop is not supported";
  return "Stop behavior is unknown";
}

function readableAudit(audit) {
  if (!audit) return "Nothing recorded";
  if (audit.permissionDecision === "allowed") return "Allowed and recorded";
  if (audit.permissionDecision === "denied") return "Denied and recorded";
  return "Recorded";
}

function readableLifecycleAudit(audit) {
  if (!audit) return "Nothing recorded";
  if (audit.status === "succeeded") return `${audit.operation.replaceAll("_", " ")} completed`;
  if (audit.status === "failed") return `${audit.operation.replaceAll("_", " ")} needs attention`;
  return `${audit.operation.replaceAll("_", " ")} ${audit.status}`;
}

function shortTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
