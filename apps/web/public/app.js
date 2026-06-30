import { createApiClient, resolveApiBase } from "./app/api-client.js";
import {
  activityTitle,
  adapterText,
  cancellationText,
  costOwnerText,
  costText,
  highestRiskLevel,
  lifecycleText,
  readableAgentStatus,
  readableAudit,
  readableCancellation,
  readableDelivery,
  readableDeviceStatus,
  readableEventType,
  readableHealth,
  readableHealthLabel,
  readableLifecycleAudit,
  readableStatus,
  resultSummary,
  resultTitle,
  shortTime,
  taskSummary,
  usageText,
} from "./app/formatters.js";
import { createRoutineRunSurface } from "./app/routine-surface.js";
import { createTerminalSurface } from "./app/terminal-surface.js";
import { createWorkspaceTabSurface } from "./app/workspace-tabs.js";

const apiBase = resolveApiBase();
const api = createApiClient(apiBase);

const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  commandPanel: document.querySelector("#commandPanel"),
  workspaceTabStrip: document.querySelector("#workspaceTabStrip"),
  taskListPanel: document.querySelector("#taskListPanel"),
  taskListRows: document.querySelector("#taskListRows"),
  routineRunDetail: document.querySelector("#routineRunDetail"),
  newTaskFromListButton: document.querySelector("#newTaskFromListButton"),
  runPanel: document.querySelector("#runPanel"),
  contextPanel: document.querySelector(".context-panel"),
  workspace: document.querySelector(".workspace"),
  terminalSurfaceContext: document.querySelector("#terminalSurfaceContext"),
  terminalRuntimeStatus: document.querySelector("#terminalRuntimeStatus"),
  terminalShellSummary: document.querySelector("#terminalShellSummary"),
  terminalCwdSummary: document.querySelector("#terminalCwdSummary"),
  terminalSshSummary: document.querySelector("#terminalSshSummary"),
  terminalSessionSummary: document.querySelector("#terminalSessionSummary"),
  terminalCodexSummary: document.querySelector("#terminalCodexSummary"),
  terminalEvidenceSummary: document.querySelector("#terminalEvidenceSummary"),
  terminalPolicySummary: document.querySelector("#terminalPolicySummary"),
  createTerminalSessionButton: document.querySelector("#createTerminalSessionButton"),
  resizeTerminalButton: document.querySelector("#resizeTerminalButton"),
  closeTerminalSessionButton: document.querySelector("#closeTerminalSessionButton"),
  terminalOutputPreview: document.querySelector("#terminalOutputPreview"),
  terminalActionStatus: document.querySelector("#terminalActionStatus"),
  terminalProgressList: document.querySelector("#terminalProgressList"),
  modeTabs: document.querySelector(".workspace-nav"),
  modeButtons: [...document.querySelectorAll("[data-workspace-mode]")],
  modeSummary: document.querySelector("#modeSummary"),
  currentProjectSelectButton: document.querySelector("#currentProjectSelectButton"),
  currentProjectToggleButton: document.querySelector("#currentProjectToggleButton"),
  currentProjectMenuButton: document.querySelector("#currentProjectMenuButton"),
  currentProjectWorktreeButton: document.querySelector("#currentProjectWorktreeButton"),
  currentProjectMenuPanel: document.querySelector("#currentProjectMenuPanel"),
  currentProjectName: document.querySelector("#currentProjectName"),
  currentProjectPath: document.querySelector("#currentProjectPath"),
  projectList: document.querySelector("#projectList"),
  openProjectModalButton: document.querySelector("#openProjectModalButton"),
  projectModal: document.querySelector("#projectModal"),
  projectModalCloseButton: document.querySelector("#projectModalCloseButton"),
  projectModalBackButton: document.querySelector("#projectModalBackButton"),
  projectModalViews: [...document.querySelectorAll("[data-project-modal-view]")],
  projectModalTargets: [...document.querySelectorAll("[data-project-modal-target]")],
  projectBrowserContext: document.querySelector("#projectBrowserContext"),
  repoPanelTitle: document.querySelector("#repoPanelTitle"),
  repoToolButtons: [...document.querySelectorAll("[data-repo-tool]")],
  repoSearchModeButtons: [...document.querySelectorAll("[data-repo-search-mode]")],
  repoHistoryHeader: document.querySelector("#repoHistoryHeader"),
  repoContentFilters: document.querySelector("#repoContentFilters"),
  projectSearchIncludeInput: document.querySelector("#projectSearchIncludeInput"),
  projectSearchExcludeInput: document.querySelector("#projectSearchExcludeInput"),
  projectTreeSummary: document.querySelector("#projectTreeSummary"),
  projectTreeList: document.querySelector("#projectTreeList"),
  projectFileSearch: document.querySelector("#projectFileSearch"),
  refreshProjectTreeButton: document.querySelector("#refreshProjectTreeButton"),
  projectNameInput: document.querySelector("#projectNameInput"),
  projectPathInput: document.querySelector("#projectPathInput"),
  addProjectButton: document.querySelector("#addProjectButton"),
  removeProjectButton: document.querySelector("#removeProjectButton"),
  projectRegistryStatus: document.querySelector("#projectRegistryStatus"),
  cloneUrlInput: document.querySelector("#cloneUrlInput"),
  cloneParentInput: document.querySelector("#cloneParentInput"),
  cloneNameInput: document.querySelector("#cloneNameInput"),
  cloneProjectButton: document.querySelector("#cloneProjectButton"),
  createProjectNameInput: document.querySelector("#createProjectNameInput"),
  createProjectPathInput: document.querySelector("#createProjectPathInput"),
  createProjectButton: document.querySelector("#createProjectButton"),
  worktreeNameInput: document.querySelector("#worktreeNameInput"),
  worktreeBranchInput: document.querySelector("#worktreeBranchInput"),
  worktreeBaseInput: document.querySelector("#worktreeBaseInput"),
  worktreePathInput: document.querySelector("#worktreePathInput"),
  createWorktreeButton: document.querySelector("#createWorktreeButton"),
  worktreeStatus: document.querySelector("#worktreeStatus"),
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
  attachmentFileInput: document.querySelector("#attachmentFileInput"),
  attachmentFolderInput: document.querySelector("#attachmentFolderInput"),
  attachmentTray: document.querySelector("#attachmentTray"),
  addContextMenu: document.querySelector("#addContextMenu"),
  addContextOptions: document.querySelectorAll("[data-add-action]"),
  permissionMenu: document.querySelector("#permissionMenu"),
  permissionModeLabel: document.querySelector("#permissionModeLabel"),
  permissionOptions: document.querySelectorAll("[data-permission-mode]"),
  modelMenu: document.querySelector("#modelMenu"),
  modelModeLabel: document.querySelector("#modelModeLabel"),
  reasoningOptions: document.querySelectorAll("[data-reasoning-mode]"),
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
  sshTargetHost: document.querySelector("#sshTargetHost"),
  sshTargetPort: document.querySelector("#sshTargetPort"),
  sshTargetUser: document.querySelector("#sshTargetUser"),
  sshTargetAuthMethod: document.querySelector("#sshTargetAuthMethod"),
  sshTargetCredentialRef: document.querySelector("#sshTargetCredentialRef"),
  sshTargetKnownHostPolicy: document.querySelector("#sshTargetKnownHostPolicy"),
  sshTargetFingerprint: document.querySelector("#sshTargetFingerprint"),
  sshTargetWorkspaceRoot: document.querySelector("#sshTargetWorkspaceRoot"),
  sshTargetPlatformHint: document.querySelector("#sshTargetPlatformHint"),
  sshTargetKeySelection: document.querySelector("#sshTargetKeySelection"),
  sshTargetAgentForwarding: document.querySelector("#sshTargetAgentForwarding"),
  registerSshTargetButton: document.querySelector("#registerSshTargetButton"),
  testSshTargetButton: document.querySelector("#testSshTargetButton"),
  sshTargetSummary: document.querySelector("#sshTargetSummary"),
  sshTargetLatest: document.querySelector("#sshTargetLatest"),
  sshTargetTrust: document.querySelector("#sshTargetTrust"),
  sshTargetCredential: document.querySelector("#sshTargetCredential"),
  sshTargetRelay: document.querySelector("#sshTargetRelay"),
  sshTargetTestReport: document.querySelector("#sshTargetTestReport"),
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
let activePage = "tasks";
let selectedRoutineRunId = null;
let selectedAgentId = null;
let selectedArtifactId = null;
let activeMode = "run_task";
let selectedCodexApprovalRequestId = null;
let selectedManagedSessionId = null;
let selectedManagedChangeEvidenceId = null;
let selectedEvidenceRecordId = null;
let managedSessionFilter = "all";
let selectedPermissionMode = "ask";
let selectedReasoningMode = "extra_high";
let selectedAddAction = null;
let composerAttachments = [];
const collapsedProjectRootIds = new Set();
const expandedProjectTreePaths = new Set();
let projectTreeProjectId = null;
let projectTreeData = null;
let projectTreeLoading = false;
const loadingProjectTreePaths = new Set();
let repoPanelTool = "files";
let repoSearchMode = "name";
let repoHistoryScope = "all";
const expandedRepoSessionIds = new Set();
let openRepoSessionMenuId = null;
let projectContentSearchData = null;
let projectContentSearchLoading = false;
let repoGitSummaryData = null;
let repoGitSummaryLoading = false;
let routineRunsState = null;
let routineRunsRefreshInFlight = false;
let routineRunsLastProjectId = null;
let routineRunsLastRefreshMs = 0;
const selectedCompareAgentIds = new Set();
let pendingTerminalInput = "";
let terminalInputFlushTimer = null;
let terminalInputSendChain = Promise.resolve();
const attachmentLimits = {
  maxFiles: 8,
  maxTextBytes: 24_000,
  maxImageBytes: 768_000
};
const {
  renderRoutineRunDetail,
  renderTaskList,
} = createRoutineRunSurface({
  els,
  emptyMiniCard,
  getRoutineRunsState: () => routineRunsState,
  getSelectedRoutineRunId: () => selectedRoutineRunId,
  isRoutineRunsRefreshInFlight: () => routineRunsRefreshInFlight,
  setSelectedRoutineRunId: (value) => {
    selectedRoutineRunId = value;
  },
  shortTime,
});
const workspaceTabSurface = createWorkspaceTabSurface({
  els,
  getActivePage: () => activePage,
  getCurrentInvocationId: () => currentInvocationId,
  getLastState: () => lastState,
  getTaskWorkspaceUrl: taskWorkspaceUrl,
  onCurrentInvocationChange: (value) => {
    currentInvocationId = value;
  },
  onModeChange: (value) => {
    activeMode = value;
  },
  onPageChange: (value) => {
    activePage = value;
  },
  readableStatus,
  render: (state) => render(state),
  replaceHistory: (invocationId) => history.replaceState(null, "", repoSessionUrl(invocationId)),
  showTasksPage: () => showTasksPage(),
  showWorkspacePage: (options) => showWorkspacePage(options),
  taskSummary,
});
const terminalSurface = createTerminalSurface({
  els,
  emptyMiniCard,
  onTerminalInput: queueTerminalInput,
  shortTime,
});

initializeRouteState();

els.workspaceTabStrip.addEventListener("click", (event) => {
  const closeButton = event.target.closest("button[data-workspace-tab-close]");
  if (closeButton) {
    closeWorkspaceTab(closeButton.dataset.workspaceTabClose);
    return;
  }

  const tabButton = event.target.closest("button[data-workspace-tab-id]");
  if (!tabButton) return;
  activateWorkspaceTab(tabButton.dataset.workspaceTabId);
});

els.taskListRows.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-routine-run-id]");
  if (!button) return;
  selectedRoutineRunId = button.dataset.routineRunId;
  renderTaskList(lastState);
});

els.newTaskFromListButton.addEventListener("click", () => {
  showWorkspacePage({ draft: true });
  history.replaceState(null, "", taskWorkspaceUrl());
  render(lastState);
});

els.modeTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-workspace-mode]");
  if (!button) return;

  activeMode = button.dataset.workspaceMode;
  if (activeMode === "run_task") {
    showTasksPage();
    history.replaceState(null, "", taskListUrl());
  }
  if (activeMode === "managed_codex") {
    const codexAgent = codexAgentInState(lastState);
    if (codexAgent) selectedAgentId = codexAgent.id;
  }
  render(lastState);
});

els.projectList.addEventListener("click", async (event) => {
  const collapseButton = event.target.closest("button[data-project-toggle-id]");
  if (collapseButton) {
    const id = collapseButton.dataset.projectToggleId;
    if (collapsedProjectRootIds.has(id)) {
      collapsedProjectRootIds.delete(id);
    } else {
      collapsedProjectRootIds.add(id);
    }
    renderProjects(lastState);
    return;
  }

  const worktreeButton = event.target.closest("button[data-project-worktree-source-id]");
  if (worktreeButton) {
    const sourceProject = lastState?.projects?.find((item) => item.id === worktreeButton.dataset.projectWorktreeSourceId);
    if (sourceProject) {
      prepareWorktreeForProject(sourceProject);
    }
    return;
  }

  const menuButton = event.target.closest("button[data-project-menu-id]");
  if (menuButton) {
    toggleProjectMenu(menuButton.dataset.projectMenuId);
    return;
  }

  const button = event.target.closest("button[data-project-id]");
  if (!button) return;
  await selectProjectById(button.dataset.projectId);
});

async function selectProjectById(projectId) {
  els.projectRegistryStatus.textContent = "Switching project...";
  try {
    const data = await api.switchProject(projectId);
    els.projectRegistryStatus.textContent = `${data.project.name} selected.`;
    await refresh();
    linkProjectSelectionToSession(data.project);
  } catch (error) {
    els.projectRegistryStatus.textContent = error instanceof Error ? error.message : "Unable to switch project.";
  }
}

function linkProjectSelectionToSession(project) {
  const conversation = latestConversationForProject(lastState, project);
  repoPanelTool = "history";
  repoHistoryScope = project?.worktree || isHistoryProject(project) ? "worktree" : "all";
  if (conversation) {
    openWorkspaceTab(conversation.invocation.id, { activate: true });
    selectedManagedSessionId = conversation.session?.id ?? null;
    openRepoSessionMenuId = null;
    expandedRepoSessionIds.add(conversation.invocation.id);
    history.replaceState(null, "", repoSessionUrl(conversation.invocation.id));
  }
  render(lastState);
  if (conversation) queueMicrotask(() => scrollRepoSessionIntoView(conversation.invocation.id));
}

function prepareWorktreeForProject(sourceProject) {
  els.worktreeNameInput.value = "";
  els.worktreeBranchInput.value = `myagenttool/${slugForInput(sourceProject.name)}-task`;
  els.worktreeBaseInput.value = "HEAD";
  els.worktreePathInput.value = "";
  document.querySelector(".project-add.project-tool")?.setAttribute("open", "");
  els.worktreeStatus.textContent = `Creating worktree from ${sourceProject.name}.`;
}

els.currentProjectSelectButton.addEventListener("click", async () => {
  const project = repoBrowserProject(lastState);
  if (!project) return;
  await selectProjectById(project.id);
});

els.currentProjectToggleButton.addEventListener("click", () => {
  const project = repoBrowserProject(lastState);
  if (!project) return;
  if (collapsedProjectRootIds.has(project.id)) {
    collapsedProjectRootIds.delete(project.id);
  } else {
    collapsedProjectRootIds.add(project.id);
  }
  renderProjects(lastState);
});

els.currentProjectMenuButton.addEventListener("click", () => {
  const project = repoBrowserProject(lastState);
  if (!project) return;
  els.currentProjectMenuPanel.hidden = !els.currentProjectMenuPanel.hidden;
});

els.currentProjectWorktreeButton.addEventListener("click", () => {
  const project = repoBrowserProject(lastState);
  if (!project) return;
  prepareWorktreeForProject(project);
});

function toggleProjectMenu(projectId) {
  const menu = [...document.querySelectorAll("[data-project-menu-panel]")]
    .find((panel) => panel.dataset.projectMenuPanel === projectId);
  if (!menu) return;
  const willOpen = menu.hidden;
  for (const panel of document.querySelectorAll("[data-project-menu-panel]")) {
    panel.hidden = true;
  }
  menu.hidden = !willOpen;
}

function slugForInput(value) {
  return String(value ?? "project")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "project";
}

els.openProjectModalButton.addEventListener("click", () => openProjectModal("home"));
els.projectModalCloseButton.addEventListener("click", closeProjectModal);
els.projectModalBackButton.addEventListener("click", () => showProjectModalView("home"));
els.projectModal.addEventListener("click", (event) => {
  if (event.target === els.projectModal) closeProjectModal();
});
for (const button of els.projectModalTargets) {
  button.addEventListener("click", () => showProjectModalView(button.dataset.projectModalTarget));
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.projectModal.hidden) {
    closeProjectModal();
  }
});

els.addProjectButton.addEventListener("click", async () => {
  const path = els.projectPathInput.value.trim();
  if (!path) {
    els.projectRegistryStatus.textContent = "Enter a project path.";
    return;
  }
  els.addProjectButton.disabled = true;
  els.projectRegistryStatus.textContent = "Adding project...";
  try {
    const data = await api.addProject({ name: els.projectNameInput.value.trim(), path });
    els.projectNameInput.value = "";
    els.projectPathInput.value = "";
    els.projectRegistryStatus.textContent = `${data.project.name} added.`;
    await refresh();
    closeProjectModal();
  } catch (error) {
    els.projectRegistryStatus.textContent = error instanceof Error ? error.message : "Unable to add project.";
  } finally {
    els.addProjectButton.disabled = false;
  }
});

els.removeProjectButton.addEventListener("click", async () => {
  const project = currentProject(lastState);
  if (!project) return;
  els.removeProjectButton.disabled = true;
  els.projectRegistryStatus.textContent = "Removing project...";
  try {
    await api.removeProject(project.id);
    els.projectRegistryStatus.textContent = `${project.name} removed.`;
    await refresh();
  } catch (error) {
    els.projectRegistryStatus.textContent = error instanceof Error ? error.message : "Unable to remove project.";
  } finally {
    els.removeProjectButton.disabled = false;
  }
});

els.cloneProjectButton.addEventListener("click", async () => {
  const gitUrl = els.cloneUrlInput.value.trim();
  const parentPath = els.cloneParentInput.value.trim();
  if (!gitUrl || !parentPath) {
    els.projectRegistryStatus.textContent = "Enter a Git URL and parent folder.";
    return;
  }
  els.cloneProjectButton.disabled = true;
  els.projectRegistryStatus.textContent = "Cloning project...";
  try {
    const data = await api.cloneProject({
      gitUrl,
      parentPath,
      name: els.cloneNameInput.value.trim()
    });
    els.cloneUrlInput.value = "";
    els.cloneNameInput.value = "";
    els.projectRegistryStatus.textContent = `${data.project.name} cloned.`;
    await refresh();
    closeProjectModal();
  } catch (error) {
    els.projectRegistryStatus.textContent = error instanceof Error ? error.message : "Unable to clone project.";
  } finally {
    els.cloneProjectButton.disabled = false;
  }
});

els.createProjectButton.addEventListener("click", async () => {
  const path = els.createProjectPathInput.value.trim();
  const name = els.createProjectNameInput.value.trim();
  if (!path) {
    els.projectRegistryStatus.textContent = "Enter a project folder path.";
    return;
  }
  els.createProjectButton.disabled = true;
  els.projectRegistryStatus.textContent = "Creating project...";
  try {
    const data = await api.createProject({ name, path });
    els.createProjectNameInput.value = "";
    els.createProjectPathInput.value = "";
    els.projectRegistryStatus.textContent = `${data.project.name} created.`;
    await refresh();
    closeProjectModal();
  } catch (error) {
    els.projectRegistryStatus.textContent = error instanceof Error ? error.message : "Unable to create project.";
  } finally {
    els.createProjectButton.disabled = false;
  }
});

els.createWorktreeButton.addEventListener("click", async () => {
  const project = currentProject(lastState);
  if (!project) {
    els.worktreeStatus.textContent = "Select a source project first.";
    return;
  }
  els.createWorktreeButton.disabled = true;
  els.worktreeStatus.textContent = "Creating worktree...";
  try {
    const payload = {
      projectId: project.id,
      name: els.worktreeNameInput.value.trim(),
      branchName: els.worktreeBranchInput.value.trim(),
      baseBranch: els.worktreeBaseInput.value.trim(),
      path: els.worktreePathInput.value.trim()
    };
    const data = await api.createWorktree(payload);
    els.worktreeNameInput.value = "";
    els.worktreeBranchInput.value = "";
    els.worktreeBaseInput.value = "";
    els.worktreePathInput.value = "";
    els.worktreeStatus.textContent = `${data.project.name} worktree selected.`;
    await refresh();
  } catch (error) {
    els.worktreeStatus.textContent = error instanceof Error ? error.message : "Unable to create worktree.";
  } finally {
    els.createWorktreeButton.disabled = false;
  }
});

els.refreshProjectTreeButton.addEventListener("click", () => refreshRepoBrowser({ force: true }));
for (const button of els.repoToolButtons) {
  button.addEventListener("click", () => {
    repoPanelTool = button.dataset.repoTool;
    refreshRepoBrowser({ force: true });
  });
}
els.projectFileSearch.addEventListener("input", () => {
  clearTimeout(els.projectFileSearch._timer);
  els.projectFileSearch._timer = setTimeout(() => {
    if (repoPanelTool === "files" && repoSearchMode === "name") {
      expandedProjectTreePaths.clear();
      loadingProjectTreePaths.clear();
      projectTreeData = null;
    }
    refreshRepoBrowser({ force: true });
  }, 250);
});
for (const input of [els.projectSearchIncludeInput, els.projectSearchExcludeInput]) {
  input.addEventListener("input", () => {
    clearTimeout(input._timer);
    input._timer = setTimeout(() => {
      if (repoSearchMode === "content") loadProjectContentSearch({ force: true });
    }, 250);
  });
}
for (const button of els.repoSearchModeButtons) {
  button.addEventListener("click", () => {
    repoSearchMode = button.dataset.repoSearchMode;
    refreshRepoBrowser({ force: true });
  });
}
els.projectTreeList.addEventListener("click", (event) => {
  const historyScopeButton = event.target.closest("button[data-repo-history-scope]");
  if (historyScopeButton) {
    repoHistoryScope = historyScopeButton.dataset.repoHistoryScope ?? "all";
    renderRepoSessionHistory(lastState);
    return;
  }

  const sessionAction = event.target.closest("button[data-repo-session-action]");
  if (sessionAction) {
    const invocationId = sessionAction.dataset.invocationId;
    const action = sessionAction.dataset.repoSessionAction;
    if (invocationId && action === "open") {
      restoreRepoSession(invocationId);
    } else if (invocationId && action === "resume") {
      openRepoSessionInNewTab(invocationId);
    } else if (invocationId && action === "toggle") {
      toggleRepoSessionDetails(invocationId);
    } else if (invocationId && action === "menu") {
      openRepoSessionMenuId = openRepoSessionMenuId === invocationId ? null : invocationId;
      renderRepoSessionHistory(lastState);
    } else if (invocationId && action) {
      handleRepoSessionMenuAction(action, invocationId);
    }
    return;
  }

  const button = event.target.closest("button[data-tree-path]");
  if (!button) return;
  if (repoPanelTool === "history") return;
  if (repoSearchMode !== "name") return;
  if (button.dataset.kind !== "directory") return;
  const path = button.dataset.treePath ?? "";
  if (expandedProjectTreePaths.has(path)) {
    expandedProjectTreePaths.delete(path);
    renderProjectTree();
  } else {
    expandedProjectTreePaths.add(path);
    loadProjectTreeNode(path);
  }
});

async function submitTaskFromComposer() {
  const task = buildTaskWithAttachments();
  if (!task) return;

  els.runButton.disabled = true;
  try {
    const compareAgentIds = [...selectedCompareAgentIds].filter((id) => id !== selectedAgentId);
    const isCompareRun = compareAgentIds.length > 0;
    const data = await (isCompareRun
      ? api.createCompareRun({
        task,
        agentIds: [selectedAgentId, ...compareAgentIds],
        options: {
          codexSessionMode: els.codexSessionMode.value,
          codexWorkspacePolicy: els.codexWorkspacePolicy.value,
          approvalMode: selectedPermissionMode,
          metadata: composerMetadata()
        }
      })
      : api.createInvocation({
        task,
        agentId: selectedAgentId,
        options: {
          codexSessionMode: els.codexSessionMode.value,
          codexWorkspacePolicy: els.codexWorkspacePolicy.value,
          approvalMode: selectedPermissionMode,
          metadata: composerMetadata()
        }
      }));
    currentInvocationId = data.invocation?.id ?? data.compareRun?.childInvocationIds?.[0] ?? null;
    if (currentInvocationId) openWorkspaceTab(currentInvocationId, { activate: true });
    resetComposerAfterSubmit();
    await refresh();
  } catch (error) {
    els.resultTitle.textContent = "Could not start";
    els.resultSummary.textContent = error instanceof Error ? error.message : "Unable to start the task.";
  } finally {
    updateActions(lastState, currentInvocation());
  }
}

function resetComposerAfterSubmit() {
  els.taskInput.value = "";
  composerAttachments = [];
  selectedAddAction = null;
  els.attachmentFileInput.value = "";
  els.attachmentFolderInput.value = "";
  els.addContextMenu.open = false;
  renderAttachmentTray();
}

function composerMetadata() {
  const includedAttachments = composerAttachments.filter((attachment) => attachment.included);
  const project = currentProject(lastState);
  const projectWorktree = project?.worktree;
  return {
    permissionMode: selectedPermissionMode,
    reasoningMode: selectedReasoningMode,
    addAction: selectedAddAction,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    projectPath: project?.path ?? null,
    worktreeId: projectWorktree?.id ?? null,
    worktreeBranchName: projectWorktree?.branchName ?? null,
    attachmentBoundary: includedAttachments.length > 0 ? "composer_only" : "none",
    attachments: composerAttachments.map(attachmentMetadata)
  };
}

function buildTaskWithAttachments() {
  const baseTask = els.taskInput.value.trim();
  if (!baseTask && composerAttachments.length === 0) {
    return "";
  }
  const included = composerAttachments.filter((attachment) => attachment.included);
  if (!included.length) {
    return baseTask;
  }
  const attachmentContext = included.map((attachment, index) => {
    const header = `Attachment ${index + 1}: ${attachment.name} (${attachment.type || "unknown"}, ${formatBytes(attachment.size)})`;
    if (attachment.kind === "text") {
      return `${header}\n${attachment.content}${attachment.truncated ? "\n[truncated]" : ""}`;
    }
    if (attachment.kind === "image") {
      return attachment.truncated
        ? `${header}\nComposer image attachment exceeded the local prototype size limit and was not embedded. Ask the user for a smaller image if image analysis is required.`
        : `${header}\nComposer image attachment. Use this image only; do not search the local filesystem for other image files.`;
    }
    return `${header}\nBinary file attached; content not embedded.`;
  }).join("\n\n");
  return [
    baseTask || "Review the attached context.",
    composerAttachmentBoundary(),
    "Composer attachments:",
    attachmentContext
  ].join("\n\n");
}

function composerAttachmentBoundary() {
  return [
    "Attachment boundary:",
    "- Use only the composer attachments listed below as file or image context.",
    "- Do not search the local filesystem for other images or files to satisfy this request.",
    "- Attachment names are labels from the composer, not filesystem paths.",
    "- If an attachment is unreadable or insufficient, say that directly."
  ].join("\n");
}

function attachmentMetadata(attachment) {
  const metadata = {
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    kind: attachment.kind,
    included: attachment.included,
    truncated: attachment.truncated,
    source: attachment.source
  };
  if (attachment.kind === "image" && attachment.included && attachment.content && !attachment.truncated) {
    metadata.transport = {
      kind: "data_url",
      dataUrl: attachment.content
    };
  }
  return metadata;
}

async function ingestFiles(files, source) {
  const remaining = Math.max(0, attachmentLimits.maxFiles - composerAttachments.length);
  const selected = files.filter(Boolean).slice(0, remaining);
  if (!selected.length) {
    els.runBlockReason.textContent = `Attachment limit reached (${attachmentLimits.maxFiles} files).`;
    return;
  }
  const attachments = await Promise.all(selected.map((file) => readAttachment(file, source)));
  composerAttachments = [...composerAttachments, ...attachments];
  renderAttachmentTray();
  updateActions(lastState, currentInvocation());
}

async function readAttachment(file, source) {
  const type = file.type || guessFileType(file.name);
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const base = {
    id,
    name: file.webkitRelativePath || file.name || "pasted-file",
    type,
    size: file.size,
    source,
    included: true,
    truncated: false,
    content: "",
    kind: "binary"
  };
  if (isTextFile(file, type)) {
    const text = await file.text();
    base.kind = "text";
    base.truncated = text.length > attachmentLimits.maxTextBytes;
    base.content = text.slice(0, attachmentLimits.maxTextBytes);
    return base;
  }
  if (type.startsWith("image/")) {
    base.kind = "image";
    base.truncated = file.size > attachmentLimits.maxImageBytes;
    base.content = file.size <= attachmentLimits.maxImageBytes ? await readFileAsDataUrl(file) : "";
    return base;
  }
  return base;
}

function renderAttachmentTray() {
  els.attachmentTray.hidden = composerAttachments.length === 0;
  els.attachmentTray.replaceChildren(...composerAttachments.map((attachment) => {
    const item = document.createElement("div");
    item.className = "attachment-chip";
    item.dataset.kind = attachment.kind;

    const summary = document.createElement("span");
    summary.textContent = `${attachment.name} · ${formatBytes(attachment.size)}${attachment.truncated ? " · truncated" : ""}`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
    remove.dataset.removeAttachment = attachment.id;

    item.append(summary, remove);
    return item;
  }));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function isTextFile(file, type) {
  if (type.startsWith("text/")) return true;
  return /\.(md|txt|json|js|mjs|cjs|ts|tsx|jsx|css|html|xml|yaml|yml|csv|log)$/i.test(file.name || "");
}

function guessFileType(name) {
  if (/\.(png|jpg|jpeg|gif|webp)$/i.test(name)) return "image/unknown";
  if (/\.(md|txt|json|js|mjs|ts|tsx|css|html|yaml|yml|csv|log)$/i.test(name)) return "text/plain";
  return "application/octet-stream";
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

els.runButton.addEventListener("click", submitTaskFromComposer);

els.taskInput.addEventListener("input", () => updateActions(lastState, currentInvocation()));
els.taskInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    if (!els.runButton.disabled) {
      submitTaskFromComposer();
    }
  }
});
els.taskInput.addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files ?? [])];
  if (!files.length) return;
  ingestFiles(files, "paste");
});
els.attachmentFileInput.addEventListener("change", () => {
  ingestFiles([...els.attachmentFileInput.files], "picker");
  els.attachmentFileInput.value = "";
});
els.attachmentFolderInput.addEventListener("change", () => {
  ingestFiles([...els.attachmentFolderInput.files], "folder");
  els.attachmentFolderInput.value = "";
});
els.attachmentTray.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-remove-attachment]");
  if (!button) return;
  composerAttachments = composerAttachments.filter((attachment) => attachment.id !== button.dataset.removeAttachment);
  renderAttachmentTray();
  updateActions(lastState, currentInvocation());
});
for (const eventName of ["dragenter", "dragover"]) {
  els.taskInput.addEventListener(eventName, (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    els.taskInput.closest(".composer-card")?.setAttribute("data-dragging", "true");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  els.taskInput.addEventListener(eventName, (event) => {
    els.taskInput.closest(".composer-card")?.removeAttribute("data-dragging");
    if (eventName !== "drop") return;
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    ingestFiles(files, "drop");
  });
}
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

els.eventList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-codex-approval-action]");
  if (!button) return;

  button.disabled = true;
  await resolveCodexApprovalRequest(button.dataset.codexApprovalRequestId, button.dataset.codexApprovalAction);
});

els.addContextOptions.forEach((option) => {
  option.addEventListener("click", () => {
    selectedAddAction = option.dataset.addAction ?? null;
    els.addContextMenu.open = false;
    if (selectedAddAction === "files") {
      els.attachmentFileInput.click();
    } else if (selectedAddAction === "folder") {
      els.attachmentFolderInput.click();
    }
    els.runBlockReason.textContent = addActionMessage(selectedAddAction);
  });
});

els.permissionOptions.forEach((option) => {
  option.addEventListener("click", () => {
    selectedPermissionMode = option.dataset.permissionMode ?? "ask";
    renderPermissionMode();
    els.permissionMenu.open = false;
    updateActions(lastState, currentInvocation());
  });
});

els.reasoningOptions.forEach((option) => {
  option.addEventListener("click", () => {
    selectedReasoningMode = option.dataset.reasoningMode ?? "extra_high";
    renderReasoningMode();
    els.modelMenu.open = false;
    updateActions(lastState, currentInvocation());
  });
});

document.addEventListener("click", (event) => {
  for (const menu of [els.addContextMenu, els.permissionMenu, els.modelMenu]) {
    if (menu?.open && !menu.contains(event.target)) {
      menu.open = false;
    }
  }
  if (openRepoSessionMenuId && !event.target.closest(".repo-session-menu") && !event.target.closest("[data-repo-session-action='menu']")) {
    openRepoSessionMenuId = null;
    renderRepoSessionHistory(lastState);
  }
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
  const button = event.target.closest("button[data-session-id], button[data-invocation-id]");
  if (!button) return;

  selectedManagedSessionId = button.dataset.sessionId ?? null;
  if (button.dataset.invocationId) {
    openWorkspaceTab(button.dataset.invocationId, { activate: true });
  }
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

els.createTerminalSessionButton.addEventListener("click", async () => {
  try {
    await api.createTerminalSession({
      shell: lastState?.terminalRuntimeCapability?.defaultShell ?? "powershell",
      ownerCodexSessionId: terminalSurface.latestCodexSession(lastState)?.id ?? null,
      ownerInvocationId: terminalSurface.latestCodexSession(lastState)?.invocationId ?? null
    });
    els.terminalActionStatus.textContent = "Managed terminal session registry updated.";
    await refresh();
  } catch (error) {
    els.terminalActionStatus.textContent = error instanceof Error ? error.message : "Unable to register managed terminal session.";
  }
});

async function sendTerminalBytes(input, successMessage) {
  const session = terminalSurface.latestTerminalSession(lastState);
  if (!session) return;
  try {
    await api.sendTerminalInput(session.terminalSessionId, { input });
    els.terminalActionStatus.textContent = successMessage;
  } catch (error) {
    els.terminalActionStatus.textContent = error instanceof Error ? error.message : "Unable to send managed terminal input.";
  }
}

function queueTerminalInput(input) {
  pendingTerminalInput += input;
  if (terminalInputFlushTimer) {
    return;
  }
  terminalInputFlushTimer = setTimeout(() => {
    const payload = pendingTerminalInput;
    pendingTerminalInput = "";
    terminalInputFlushTimer = null;
    if (payload) {
      terminalInputSendChain = terminalInputSendChain
        .then(() => sendTerminalBytes(payload, "Managed terminal input queued."))
        .catch(() => {});
    }
  }, 20);
}

els.resizeTerminalButton.addEventListener("click", async () => {
  const session = terminalSurface.latestTerminalSession(lastState);
  if (!session) return;
  try {
    terminalSurface.fitTerminalView();
    await api.resizeTerminalSession(session.terminalSessionId, terminalSurface.terminalSize());
    els.terminalActionStatus.textContent = "Managed terminal resize queued.";
    await refresh();
  } catch (error) {
    els.terminalActionStatus.textContent = error instanceof Error ? error.message : "Unable to resize managed terminal.";
  }
});

els.closeTerminalSessionButton.addEventListener("click", async () => {
  const session = terminalSurface.latestTerminalSession(lastState);
  if (!session) return;
  try {
    await api.closeTerminalSession(session.terminalSessionId);
    els.terminalActionStatus.textContent = "Managed terminal session closed.";
    await refresh();
  } catch (error) {
    els.terminalActionStatus.textContent = error instanceof Error ? error.message : "Unable to close managed terminal session.";
  }
});

els.cancelButton.addEventListener("click", async () => {
  if (!currentInvocationId) return;

  els.cancelButton.disabled = true;
  try {
    await api.cancelInvocation(currentInvocationId);
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.healthCheckButton.addEventListener("click", async () => {
  if (!selectedAgentId) return;

  els.healthCheckButton.disabled = true;
  try {
    await api.requestAgentHealth(selectedAgentId);
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
    await api.setAgentLifecycle(agent.id, action);
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
      await api.requestAgentHealth(codexAgent.id);
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

els.registerSshTargetButton.addEventListener("click", async () => {
  els.registerSshTargetButton.disabled = true;
  try {
    await registerSshTarget(sshTargetPayload());
    els.sshTargetSummary.textContent = "SSH target registered for setup preflight. Remote relay is still disabled.";
    await refresh();
  } catch (error) {
    els.sshTargetSummary.textContent = error instanceof Error ? error.message : "Unable to register SSH target.";
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.testSshTargetButton.addEventListener("click", async () => {
  const target = terminalSurface.latestSshTarget(lastState);
  if (!target) {
    els.sshTargetSummary.textContent = "Register an SSH target before running preflight.";
    return;
  }
  els.testSshTargetButton.disabled = true;
  try {
    await testSshTarget(target.id);
    els.sshTargetSummary.textContent = "SSH target preflight report updated.";
    await refresh();
  } catch (error) {
    els.sshTargetSummary.textContent = error instanceof Error ? error.message : "Unable to test SSH target.";
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.candidateList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-discovery-run-id][data-candidate-id]");
  if (!button) return;

  button.disabled = true;
  try {
    await api.registerDiscoveryCandidate(button.dataset.discoveryRunId, button.dataset.candidateId);
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
    await api.generateIntegrationArtifact(artifact.id);
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.builderDraftButton.addEventListener("click", async () => {
  els.builderDraftButton.disabled = true;
  try {
    const data = await api.createIntegrationBuilderDraft(integrationPayload());
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
    const action = button.dataset.artifactAction;
    await api.transitionIntegrationArtifact(button.dataset.artifactId, action);
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
    await api.resolveLocalApproval(approval.id, "approve");
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
    await api.resolveLocalApproval(approval.id, "deny");
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
    await api.importCodexEvidence({
      source: "user_selected_local_preview",
      summary
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
    await api.troubleshootInvocation(invocation.id);
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

setInterval(refresh, 700);
setInterval(() => {
  if (activeMode === "terminal") {
    refresh();
  }
}, 80);
refresh();

let lastState = null;
let refreshInFlight = false;

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const state = await fetchState();
    lastState = state;
    if (routineRunsLastProjectId !== state.currentProjectId) {
      routineRunsState = null;
      routineRunsLastProjectId = state.currentProjectId ?? null;
    }
    els.connectionStatus.textContent = "Connected";
    els.connectionStatus.dataset.state = "ok";
    render(state);
    refreshRoutineRuns({ force: activePage === "tasks" });
  } catch {
    els.connectionStatus.textContent = "Server offline";
    els.connectionStatus.dataset.state = "bad";
    renderOffline();
  } finally {
    refreshInFlight = false;
  }
}

function render(state) {
  if (!state) {
    return;
  }
  renderPermissionMode();
  renderReasoningMode();
  renderProjects(state);
  const agents = state.agents?.length ? state.agents : [state.agent].filter(Boolean);
  if (!selectedAgentId || !agents.some((agent) => agent.id === selectedAgentId)) {
    selectedAgentId = preferredAgentId(state, agents);
  }

  renderSelectors(state, agents);
  renderCompareAgentChoices(agents);

  if (activePage === "workspace" && !workspaceTabSurface.isDraftTabOpen() && (!currentInvocationId || !state.invocations.some((item) => item.id === currentInvocationId))) {
    currentInvocationId = workspaceTabSurface.fallbackInvocationId(state);
  }
  if (activePage === "workspace" && currentInvocationId && state.invocations.some((item) => item.id === currentInvocationId)) {
    openWorkspaceTab(currentInvocationId, { activate: false });
  }
  syncWorkspaceTabs(state);
  const taskListActive = activePage === "tasks";
  const draftActive = workspaceTabSurface.isDraftTabOpen() && !currentInvocationId;
  const invocation = taskListActive || draftActive ? null : currentInvocation();
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
  const codexApproval = currentCodexApproval(state, invocation);
  const usage = agent ? state.agentUsageSummaries?.find((item) => item.agentId === agent.id) : null;
  const troubleshootingReport = currentTroubleshootingReport(state, invocation);
  const selectedArtifact = selectedIntegrationArtifact(state) ?? state.integrationArtifacts?.[0] ?? null;
  if (selectedArtifact) selectedArtifactId = selectedArtifact.id;

  if (invocation && !draftActive) currentInvocationId = invocation.id;
  renderWorkspaceTabs(state);
  renderTaskList(state);
  const executionEvent = latestExecutionPreview(state, invocation);
  renderMode(state, selectedAgentForMode, invocation, approval);

  const readableTaskState = codexApproval?.status === "pending" ? "Needs approval" : readableStatus(invocation?.status);
  els.taskState.textContent = readableTaskState;
  els.taskState.dataset.state = codexApproval?.status === "pending" ? "waiting_for_local_approval" : invocation?.status ?? "waiting";
  els.activityTitle.textContent = codexApproval?.status === "pending"
    ? `Waiting for Codex approval: ${codexApproval.toolName ?? "tool"}`
    : activityTitle(invocation?.status);

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

  const visibleEvents = draftActive || !invocation
    ? []
    : taskEventsForInvocation(state, invocation).slice(0, 30);
  renderApproval(approval);
  renderTimeline(visibleEvents, invocation, state);
  renderComparePanel(state);
  applyTaskListSurface();
  renderDiscovery(discoveryRun);
  terminalSurface.renderSshTargets(state);
  renderIntegrationArtifacts(state.integrationArtifacts ?? [], state.integrationProbeRuns ?? []);
  updateActions(state, invocation);
}

function renderPermissionMode() {
  const labels = {
    ask: "Ask for approval",
    auto: "Approve for me",
    full: "Full access"
  };
  els.permissionModeLabel.textContent = labels[selectedPermissionMode] ?? labels.ask;
  for (const option of els.permissionOptions) {
    const selected = option.dataset.permissionMode === selectedPermissionMode;
    option.setAttribute("aria-selected", String(selected));
  }
}

function renderReasoningMode() {
  const labels = {
    low: "5.5 Low",
    medium: "5.5 Medium",
    high: "5.5 High",
    extra_high: "5.5 Extra High"
  };
  els.modelModeLabel.textContent = labels[selectedReasoningMode] ?? labels.extra_high;
  for (const option of els.reasoningOptions) {
    const selected = option.dataset.reasoningMode === selectedReasoningMode;
    option.setAttribute("aria-selected", String(selected));
  }
}

function openProjectModal(view = "home") {
  els.projectModal.hidden = false;
  showProjectModalView(view);
}

function closeProjectModal() {
  els.projectModal.hidden = true;
  showProjectModalView("home");
}

function showProjectModalView(view = "home") {
  for (const item of els.projectModalViews) {
    item.hidden = item.dataset.projectModalView !== view;
  }
  els.projectModalBackButton.hidden = view === "home";
  if (view === "home") {
    els.projectRegistryStatus.textContent = "";
  }
}

function renderProjects(state) {
  const projects = state?.projects ?? [];
  const project = currentProject(state);
  const browserProject = repoBrowserProject(state);
  if (browserProject?.id !== projectTreeProjectId) {
    projectTreeProjectId = browserProject?.id ?? null;
    expandedProjectTreePaths.clear();
    loadingProjectTreePaths.clear();
    projectTreeData = null;
    projectContentSearchData = null;
    queueMicrotask(() => refreshRepoBrowser({ force: true }));
  }
  els.currentProjectName.textContent = browserProject?.name ?? project?.name ?? "No project";
  els.repoPanelTitle.textContent = browserProject?.name ?? "No project";
  els.currentProjectPath.textContent = browserProject
    ? browserProject.worktree ? `${browserProject.path} · ${browserProject.worktree.branchName}` : browserProject.path
    : "Register a project to scope local runs.";
  els.currentProjectToggleButton.textContent = browserProject && collapsedProjectRootIds.has(browserProject.id) ? "›" : "⌄";
  els.currentProjectMenuPanel.replaceChildren(...(browserProject ? projectMenuItems() : []));
  els.addProjectButton.disabled = false;
  els.removeProjectButton.disabled = projects.length <= 1;
  els.createWorktreeButton.disabled = !project;
  const highlightedProjectId = activePage === "tasks"
    ? null
    : state.currentProjectId;
  els.projectList.replaceChildren(...projectTreeItems(projects, highlightedProjectId));
  renderProjectTree();
}

function projectTreeItems(projects, currentProjectId) {
  if (!projects.length) return [emptyMiniCard("No projects registered.")];
  const primaryRoot = repoBrowserProject({ projects }) ?? projects.find((item) => !item.worktree) ?? projects[0];
  const roots = [primaryRoot, ...projects.filter((item) => !item.worktree && item.id !== primaryRoot?.id && !isHistoryProject(item))];
  const taskProjects = projects.filter((item) => item.worktree || isHistoryProject(item));
  const usedWorktreeIds = new Set();
  const rows = [];

  for (const root of roots) {
    const children = taskProjects.filter((item) => item.worktree?.sourceProjectId === root.id || (root.id === primaryRoot?.id && isHistoryProject(item)));
    for (const child of children) usedWorktreeIds.add(child.id);
    rows.push(projectGroup(root, children, currentProjectId, { hideRootActions: root.id === primaryRoot?.id, hideRootRow: root.id === primaryRoot?.id }));
  }

  for (const taskProject of taskProjects) {
    if (usedWorktreeIds.has(taskProject.id) || isHistoryProject(taskProject)) continue;
    rows.push(projectGroup(taskProject, [], currentProjectId));
  }

  return rows;
}

function projectGroup(project, children, currentProjectId, { hideRootActions = false, hideRootRow = false } = {}) {
  const group = document.createElement("section");
  group.className = "project-group";
  const collapsed = collapsedProjectRootIds.has(project.id);

  if (!hideRootRow) {
    const root = document.createElement("div");
    root.className = "project-root";
    root.dataset.active = String(project.id === currentProjectId && project.worktree);

    const select = document.createElement("button");
    select.type = "button";
    select.className = "project-root-select";
    select.dataset.projectId = project.id;
    const folder = document.createElement("span");
    folder.className = "project-folder";
    folder.setAttribute("aria-hidden", "true");
    folder.textContent = "#";
    const title = document.createElement("strong");
    title.textContent = projectRootName(project);
    select.append(folder, title);

    const actions = document.createElement("span");
    actions.className = "project-root-actions";
    const chevron = document.createElement("span");
    const toggle = document.createElement("button");
    toggle.type = "button";
    chevron.className = "project-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = collapsed ? "›" : "⌄";
    toggle.className = "project-root-action";
    toggle.dataset.projectToggleId = project.id;
    toggle.setAttribute("aria-label", collapsed ? "Expand project" : "Collapse project");
    toggle.append(chevron);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "project-root-action";
    more.dataset.projectMenuId = project.id;
    more.setAttribute("aria-label", "Project menu");
    more.textContent = "...";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "project-root-action";
    add.dataset.projectWorktreeSourceId = project.id;
    add.setAttribute("aria-label", `Create worktree for ${project.name}`);
    add.textContent = "+";
    actions.append(toggle, more, add);
    root.append(select, actions);
    if (project.id === currentProjectId || hideRootActions) {
      actions.hidden = true;
    }
    group.append(root);
    group.append(projectMenuPanel(project));
  }

  if (collapsed) {
    return group;
  }

  if (!project.worktree) {
    group.append(projectBranchRow(project, currentProjectId));
  }
  for (const child of children) {
    group.append(projectWorktreeRow(child, currentProjectId, true));
  }
  if (project.worktree) {
    group.append(projectWorktreeRow(project, currentProjectId, true));
  }

  return group;
}

function projectMenuPanel(project) {
  const panel = document.createElement("div");
  panel.className = "project-menu-panel";
  panel.dataset.projectMenuPanel = project.id;
  panel.hidden = true;
  panel.replaceChildren(...projectMenuItems());
  return panel;
}

function projectMenuItems() {
  const items = [
    ["☷", "项目设置"],
    ["♢", "更改项目图标"],
    ["◉", "Show hidden worktrees"],
    ["▣", "来自项目的新组"],
    ["⌫", "删除项目", "danger"]
  ];
  return items.map(([icon, label, tone]) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "project-menu-item";
    if (tone) item.dataset.tone = tone;
    const iconEl = document.createElement("span");
    iconEl.textContent = icon;
    const labelEl = document.createElement("strong");
    labelEl.textContent = label;
    item.append(iconEl, labelEl);
    return item;
  });
}

function projectBranchRow(project, currentProjectId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "project-tree-item project-branch-row";
  button.dataset.projectId = project.id;
  button.dataset.active = String(project.id === currentProjectId);

  const dot = document.createElement("span");
  dot.className = "project-status-dot";
  dot.setAttribute("aria-hidden", "true");
  const body = document.createElement("span");
  body.className = "project-tree-body";
  const name = document.createElement("strong");
  name.textContent = project.git?.currentBranch ?? project.git?.defaultBranch ?? "main";
  const detail = document.createElement("span");
  detail.textContent = "主工作树";
  body.append(name, detail);
  button.append(dot, body);
  return button;
}

function projectWorktreeRow(project, currentProjectId, nested = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "project-tree-item project-worktree-row";
  if (nested) button.classList.add("project-worktree-child");
  button.dataset.projectId = project.id;
  button.dataset.active = String(project.id === currentProjectId);

  const dot = document.createElement("span");
  dot.className = "project-status-dot";
  dot.setAttribute("aria-hidden", "true");
  const body = document.createElement("span");
  body.className = "project-tree-body";
  const title = document.createElement("strong");
  title.textContent = project.name;
  const detail = document.createElement("span");
  detail.textContent = project.worktree?.branchName ?? project.git?.currentBranch ?? projectPathLeaf(project.path);
  const meta = document.createElement("small");
  meta.textContent = projectPathLeaf(project.path);
  body.append(title, detail, meta);
  button.append(dot, body);
  return button;
}

function projectRootName(project) {
  if (!project.worktree) return project.name;
  return projectPathLeaf(project.worktree?.repoPath ?? project.path) || project.name;
}

function projectPathLeaf(path) {
  return String(path ?? "").split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

function isHistoryProject(project) {
  const name = String(project?.name ?? "").toLowerCase();
  const path = String(project?.path ?? "").toLowerCase();
  return name.includes("history") || path.includes("myagenttool-history-");
}

function currentProject(state) {
  return state?.currentProject
    ?? state?.projects?.find((project) => project.id === state.currentProjectId)
    ?? state?.projects?.[0]
    ?? null;
}

function repoBrowserProject(state) {
  return state?.projects?.find((project) => project.source === "default" && project.name === "myagenttool")
    ?? state?.projects?.find((project) => project.id === "prj_myagenttool")
    ?? state?.projects?.find((project) => project.name === "myagenttool")
    ?? currentProject(state);
}

async function loadProjectTree({ force = false } = {}) {
  const project = repoBrowserProject(lastState);
  if (!project || projectTreeLoading) return;
  if (!force && projectTreeData?.projectId === project.id) return;
  projectTreeLoading = true;
  renderProjectTree();
  try {
    const search = els.projectFileSearch.value.trim();
    const nodes = new Map();
    const root = await fetchProjectTreeNode(project.id, "", search);
    nodes.set("", root);
    projectTreeData = root ? { ...root, nodes } : null;
  } catch (error) {
    projectTreeData = {
      projectId: project.id,
      path: "",
      entries: [],
      error: error instanceof Error ? error.message : "Unable to load project files."
    };
  } finally {
    projectTreeLoading = false;
    renderProjectTree();
  }
}

async function loadProjectTreeNode(path) {
  const project = repoBrowserProject(lastState);
  if (!project || !projectTreeData || loadingProjectTreePaths.has(path)) return;
  if (projectTreeData.nodes?.has(path)) {
    renderProjectTree();
    return;
  }
  loadingProjectTreePaths.add(path);
  renderProjectTree();
  try {
    const data = await fetchProjectTreeNode(project.id, path, els.projectFileSearch.value.trim());
    projectTreeData.nodes.set(path, data);
  } catch {
    projectTreeData.nodes.set(path, { projectId: project.id, path, entries: [], error: "Unable to load folder." });
  } finally {
    loadingProjectTreePaths.delete(path);
    renderProjectTree();
  }
}

async function fetchProjectTreeNode(projectId, path, search) {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (search) params.set("search", search);
  return api.fetchProjectTree(projectId, params);
}

function refreshRepoBrowser({ force = false } = {}) {
  renderRepoBrowserMode();
  if (repoPanelTool === "history") {
    renderRepoSessionHistory(lastState);
    return;
  }
  if (repoPanelTool === "source") {
    loadRepoGitSummary({ force });
    return;
  }
  if (repoPanelTool === "publish") {
    loadRepoGitSummary({ force });
    return;
  }
  if (repoSearchMode === "content") {
    loadProjectContentSearch({ force });
    return;
  }
  loadProjectTree({ force });
}

async function loadProjectContentSearch({ force = false } = {}) {
  const project = repoBrowserProject(lastState);
  if (!project || projectContentSearchLoading) return;
  const query = els.projectFileSearch.value.trim();
  const include = els.projectSearchIncludeInput.value.trim();
  const exclude = els.projectSearchExcludeInput.value.trim();
  const cacheKey = `${project.id}\n${query}\n${include}\n${exclude}`;
  if (!force && projectContentSearchData?.cacheKey === cacheKey) return;
  projectContentSearchLoading = true;
  renderProjectTree();
  try {
    if (!query) {
      projectContentSearchData = { projectId: project.id, cacheKey, query, results: [] };
      return;
    }
    const params = new URLSearchParams({ q: query });
    if (include) params.set("include", include);
    if (exclude) params.set("exclude", exclude);
    projectContentSearchData = { ...await api.fetchProjectSearch(project.id, params), cacheKey };
  } catch (error) {
    projectContentSearchData = {
      projectId: project.id,
      cacheKey,
      query,
      results: [],
      error: error instanceof Error ? error.message : "Unable to search project content."
    };
  } finally {
    projectContentSearchLoading = false;
    renderProjectTree();
  }
}

function renderRepoBrowserMode() {
  for (const button of els.repoToolButtons) {
    const active = button.dataset.repoTool === repoPanelTool;
    button.dataset.active = String(active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const button of els.repoSearchModeButtons) {
    const active = button.dataset.repoSearchMode === repoSearchMode;
    button.dataset.active = String(active);
    button.setAttribute("aria-selected", String(active));
  }
  const showingFiles = repoPanelTool === "files";
  const showingHistory = repoPanelTool === "history";
  els.repoPanelTitle.parentElement.hidden = repoPanelTool === "publish";
  els.repoHistoryHeader.hidden = !showingHistory;
  if (!showingHistory) els.repoHistoryHeader.replaceChildren();
  els.projectFileSearch.closest(".repo-search-shell").hidden = !(showingFiles || showingHistory);
  els.projectFileSearch.placeholder = showingHistory ? "搜索会话" : "搜索";
  els.repoSearchModeButtons[0].parentElement.hidden = !showingFiles;
  els.repoContentFilters.hidden = !showingFiles || repoSearchMode !== "content";
}

function renderProjectTree() {
  const project = repoBrowserProject(lastState);
  renderRepoBrowserMode();
  if (repoPanelTool === "history") {
    renderRepoSessionHistory(lastState);
    return;
  }
  if (repoPanelTool === "source") {
    renderRepoSourceControl(project);
    return;
  }
  if (repoPanelTool === "publish") {
    renderRepoPublishPanel(lastState);
    return;
  }
  if (!project) {
    els.projectTreeSummary.textContent = "Register a project to browse files.";
    els.projectTreeList.replaceChildren(emptyMiniCard("No project selected."));
    return;
  }
  els.repoPanelTitle.textContent = project.name;
  els.refreshProjectTreeButton.disabled = projectTreeLoading;
  if (repoSearchMode === "content") {
    renderProjectContentSearch(project);
    return;
  }
  if (projectTreeLoading) {
    els.projectTreeSummary.textContent = "Loading project files...";
    els.projectTreeList.replaceChildren(emptyMiniCard("Loading..."));
    return;
  }
  if (projectTreeData?.error) {
    els.projectTreeSummary.textContent = projectTreeData.error;
    els.projectTreeList.replaceChildren(emptyMiniCard("Project files unavailable."));
    return;
  }
  const data = projectTreeData;
  if (!data) {
    els.projectTreeSummary.textContent = "Project files will load shortly.";
    els.projectTreeList.replaceChildren(emptyMiniCard("Loading project files..."));
    return;
  }
  const dirtyCount = Object.values(data.gitSummary ?? {}).reduce((sum, value) => sum + Number(value ?? 0), 0);
  els.projectTreeSummary.textContent = `${project.name}${dirtyCount ? ` · ${dirtyCount} changed` : ""}`;
  const rows = projectTreeRows(data, "");
  els.projectTreeList.replaceChildren(...(rows.length ? rows : [emptyMiniCard("No files matched.")]));
}

function renderRepoSessionHistory(state) {
  const allConversations = conversationHistoryItems(state);
  const query = els.projectFileSearch.value.trim().toLowerCase();
  const conversations = allConversations
    .filter((conversation) => repoHistoryScope === "worktree" ? conversationHasWorktree(conversation) : true)
    .filter((conversation) => {
      if (!query) return true;
      return [
        taskSummary(conversation.invocation.input?.task),
        conversation.invocation.id,
        conversation.resultSummary,
        conversation.project?.name,
        conversation.session?.workspace?.branchName,
        conversation.session?.workspace?.worktreePath
      ].some((value) => String(value ?? "").toLowerCase().includes(query));
    })
    .slice(0, 12);
  els.repoPanelTitle.textContent = "Agent 会话历史";
  els.projectTreeSummary.textContent = "";
  els.repoHistoryHeader.replaceChildren(repoHistoryToolbar(conversations.length, allConversations.length));
  els.projectTreeList.replaceChildren(
    ...(conversations.length ? conversations.map(repoSessionHistoryRow) : [emptyMiniCard("No agent sessions matched.")])
  );
}

function repoHistoryToolbar(visibleCount, totalCount) {
  const toolbar = document.createElement("div");
  toolbar.className = "repo-history-toolbar";

  const summary = document.createElement("span");
  summary.textContent = `已显示 ${visibleCount} 项 · 最近 ${totalCount} 项`;

  const filters = document.createElement("span");
  filters.className = "repo-history-filters";
  for (const [scope, label] of [["all", "全部"], ["worktree", "工作树"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.repoHistoryScope = scope;
    button.dataset.active = String(repoHistoryScope === scope);
    button.textContent = label;
    filters.append(button);
  }

  const tools = document.createElement("span");
  tools.className = "repo-history-tools";
  tools.append(
    repoHistoryToolButton("≡", "筛选"),
    repoHistoryToolButton("↻", "刷新")
  );

  toolbar.append(summary, filters, tools);
  return toolbar;
}

function repoHistoryToolButton(label, ariaLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", ariaLabel);
  button.textContent = label;
  return button;
}

function repoSessionHistoryRow(conversation) {
  const row = document.createElement("article");
  row.className = "repo-session-row";
  row.dataset.invocationId = conversation.invocation.id;
  row.dataset.expanded = String(expandedRepoSessionIds.has(conversation.invocation.id));
  row.dataset.active = String(conversation.invocation.id === currentInvocationId);

  const body = document.createElement("button");
  body.type = "button";
  body.className = "repo-session-body";
  body.dataset.repoSessionAction = "open";
  body.dataset.invocationId = conversation.invocation.id;

  const title = document.createElement("strong");
  title.textContent = taskSummary(conversation.invocation.input?.task) ?? conversation.invocation.id;
  const preview = document.createElement("span");
  preview.textContent = conversation.resultSummary;
  const meta = document.createElement("small");
  meta.textContent = [
    "Codex",
    `${conversation.messageCount} 条消息`,
    conversation.invocation.updatedAt ? relativeTime(conversation.invocation.updatedAt) : null
  ].filter(Boolean).join(" · ");

  const actions = document.createElement("span");
  actions.className = "repo-session-actions";
  const expanded = expandedRepoSessionIds.has(conversation.invocation.id);
  actions.append(
    repoSessionDragHandle(conversation),
    repoSessionActionButton("▷", "在新标签页中恢复", "resume", conversation.invocation.id),
    repoSessionActionButton(expanded ? "⌃" : "⌄", expanded ? "收起详情" : "展开详情", "toggle", conversation.invocation.id),
    repoSessionActionButton("...", "更多操作", "menu", conversation.invocation.id)
  );

  body.append(title, preview, meta);
  row.append(body, actions);
  if (expanded) {
    row.append(repoSessionDetails(conversation));
  }
  if (openRepoSessionMenuId === conversation.invocation.id) {
    row.append(repoSessionMenu(conversation));
  }
  return row;
}

function repoSessionDragHandle(conversation) {
  const button = repoSessionActionButton("⋮⋮", "拖到新标签页中恢复", "drag", conversation.invocation.id);
  button.draggable = true;
  button.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/uri-list", repoSessionUrl(conversation.invocation.id));
    event.dataTransfer.setData("text/plain", repoSessionUrl(conversation.invocation.id));
  });
  return button;
}

function repoSessionActionButton(label, ariaLabel, action = null, invocationId = null) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "repo-session-action";
  button.setAttribute("aria-label", ariaLabel);
  button.textContent = label;
  if (action) button.dataset.repoSessionAction = action;
  if (invocationId) button.dataset.invocationId = invocationId;
  return button;
}

function repoSessionDetails(conversation) {
  const details = document.createElement("section");
  details.className = "repo-session-details";

  const originalTitle = document.createElement("strong");
  originalTitle.textContent = "原始请求";
  const original = document.createElement("p");
  original.textContent = taskSummary(conversation.invocation.input?.task) ?? conversation.invocation.id;

  const latestTitle = document.createElement("strong");
  latestTitle.textContent = "最近回复";
  const turns = document.createElement("div");
  turns.className = "repo-session-turns";
  const recentEvents = (lastState?.events ?? [])
    .filter((event) => event.invocationId === conversation.invocation.id)
    .slice(-3);
  for (const event of recentEvents) {
    const row = document.createElement("p");
    row.append(document.createElement("span"), document.createElement("em"));
    row.querySelector("span").textContent = timelineRole(event) === "agent" ? "Agent" : readableEventType(event.type);
    row.querySelector("em").textContent = repoSessionEventSummary(event);
    turns.append(row);
  }
  if (!recentEvents.length) {
    const empty = document.createElement("p");
    empty.textContent = conversation.resultSummary;
    turns.append(empty);
  }

  const quick = document.createElement("div");
  quick.className = "repo-session-detail-actions";
  quick.append(
    repoSessionActionButton("▷ 在新标签页中恢复", "在新标签页中恢复", "resume", conversation.invocation.id),
    repoSessionActionButton("⧉ 复制恢复命令", "复制恢复命令", "copy-command", conversation.invocation.id)
  );

  details.append(originalTitle, original, latestTitle, turns, quick);
  return details;
}

function repoSessionEventSummary(event) {
  const message = timelineMessage(event);
  if (Array.isArray(message)) {
    return message.map(([label, value]) => `${label}: ${value}`).join(" · ");
  }
  return message;
}

function repoSessionMenu(conversation) {
  const menu = document.createElement("div");
  menu.className = "repo-session-menu";
  menu.dataset.invocationId = conversation.invocation.id;
  const items = [
    ["▷", "在新标签页中恢复", "resume"],
    ["⧉", "复制恢复命令", "copy-command"],
    ["◫", "打开日志", "open-log"],
    ["▣", "显示日志", "show-log"],
    ["□", "打开工作目录", "open-workdir"],
    ["⧉", "复制会话 ID", "copy-session-id"],
    ["⧉", "复制日志路径", "copy-log-path"]
  ];
  for (const [icon, label, action] of items) {
    const item = document.createElement("button");
    item.type = "button";
    item.dataset.repoSessionAction = action;
    item.dataset.invocationId = conversation.invocation.id;
    const iconEl = document.createElement("span");
    iconEl.textContent = icon;
    const labelEl = document.createElement("strong");
    labelEl.textContent = label;
    item.append(iconEl, labelEl);
    menu.append(item);
  }
  return menu;
}

function restoreRepoSession(invocationId) {
  openWorkspaceTab(invocationId, { activate: true });
  openRepoSessionMenuId = null;
  history.replaceState(null, "", repoSessionUrl(invocationId));
  render(lastState);
}

function openRepoSessionInNewTab(invocationId) {
  openWorkspaceTab(invocationId, { activate: true });
  openRepoSessionMenuId = null;
  render(lastState);
}

function toggleRepoSessionDetails(invocationId) {
  if (expandedRepoSessionIds.has(invocationId)) {
    expandedRepoSessionIds.delete(invocationId);
  } else {
    expandedRepoSessionIds.add(invocationId);
  }
  openRepoSessionMenuId = null;
  renderRepoSessionHistory(lastState);
}

async function handleRepoSessionMenuAction(action, invocationId) {
  const conversation = conversationHistoryItems(lastState).find((item) => item.invocation.id === invocationId);
  if (!conversation) return;
  if (action === "resume") {
    openRepoSessionInNewTab(invocationId);
  } else if (action === "copy-command") {
    await copyText(repoSessionResumeCommand(conversation), "恢复命令已复制。");
  } else if (action === "copy-session-id") {
    await copyText(conversation.session?.codexThreadId ?? conversation.session?.codexSessionId ?? conversation.session?.id ?? invocationId, "会话 ID 已复制。");
  } else if (action === "copy-log-path") {
    await copyText(repoSessionLogPath(conversation), "日志路径已复制。");
  } else if (action === "open-workdir") {
    openLocalPath(managedWorkspaceForSession(lastState, conversation.session)?.worktreePath ?? managedWorkspaceForSession(lastState, conversation.session)?.repoPath ?? conversation.project?.path);
  } else if (action === "open-log" || action === "show-log") {
    openRepoSessionLogView(conversation);
  }
  openRepoSessionMenuId = null;
  renderRepoSessionHistory(lastState);
}

function repoSessionUrl(invocationId) {
  const url = new URL(window.location.href);
  url.searchParams.set("invocation", invocationId);
  url.searchParams.set("mode", "run_task");
  return url.toString();
}

function taskListUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("invocation");
  url.searchParams.set("mode", "run_task");
  return url.toString();
}

function taskWorkspaceUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("invocation");
  url.searchParams.set("mode", "task_workspace");
  return url.toString();
}

function repoSessionResumeCommand(conversation) {
  const threadId = conversation.session?.codexThreadId ?? conversation.session?.codexSessionId;
  return threadId ? `codex resume ${threadId}` : `codex resume --last`;
}

function repoSessionLogPath(conversation) {
  return conversation.session?.codexThreadId
    ? `Codex JSONL thread ${conversation.session.codexThreadId}`
    : conversation.session?.id ? `Managed session ${conversation.session.id}` : `Invocation ${conversation.invocation.id}`;
}

function openRepoSessionLogView(conversation) {
  selectedManagedSessionId = conversation.session?.id ?? null;
  currentInvocationId = conversation.invocation.id;
  activeMode = "session";
  render(lastState);
}

function scrollRepoSessionIntoView(invocationId) {
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(invocationId) : String(invocationId).replaceAll('"', '\\"');
  const row = els.projectTreeList.querySelector(`[data-invocation-id="${escaped}"]`);
  row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function copyText(value, successMessage) {
  const text = String(value ?? "").trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    els.projectTreeSummary.textContent = successMessage;
  } catch {
    els.projectTreeSummary.textContent = text;
  }
}

function openLocalPath(path) {
  if (!path) {
    els.projectTreeSummary.textContent = "当前会话没有记录工作目录。";
    return;
  }
  copyText(path, "工作目录已复制，可在文件管理器中打开。");
}

function conversationHasWorktree(conversation) {
  return Boolean(
    conversation.session?.workspace?.worktreePath
      || conversation.project?.worktree
      || isHistoryProject(conversation.project)
      || String(conversation.invocation?.options?.metadata?.projectName ?? "").toLowerCase().includes("history")
  );
}

function relativeTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const deltaMs = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(deltaMs / 60_000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

async function loadRepoGitSummary({ force = false } = {}) {
  const project = repoBrowserProject(lastState);
  if (!project || repoGitSummaryLoading) return;
  if (!force && repoGitSummaryData?.projectId === project.id) {
    renderProjectTree();
    return;
  }
  repoGitSummaryLoading = true;
  renderProjectTree();
  try {
    repoGitSummaryData = await api.fetchProjectGitSummary(project.id);
  } catch (error) {
    repoGitSummaryData = {
      projectId: project.id,
      changes: [],
      error: error instanceof Error ? error.message : "Unable to load source control."
    };
  } finally {
    repoGitSummaryLoading = false;
    renderProjectTree();
  }
}

function renderRepoSourceControl(project) {
  els.repoPanelTitle.textContent = "源代码控制";
  if (!project) {
    els.projectTreeSummary.textContent = "No repository selected.";
    els.projectTreeList.replaceChildren(emptyMiniCard("No repository selected."));
    return;
  }
  if (repoGitSummaryLoading) {
    els.projectTreeSummary.textContent = "Loading source control...";
    els.projectTreeList.replaceChildren(emptyMiniCard("Loading changes..."));
    return;
  }
  if (repoGitSummaryData?.error) {
    els.projectTreeSummary.textContent = repoGitSummaryData.error;
    els.projectTreeList.replaceChildren(emptyMiniCard("Source control unavailable."));
    return;
  }
  const changes = repoGitSummaryData?.changes ?? [];
  els.projectTreeSummary.textContent = `${repoGitSummaryData?.branch ?? "branch"} · 更改 ${changes.length}`;
  els.projectTreeList.replaceChildren(...[
    repoSourceMessageBox(),
    repoStageAllButton(),
    ...(changes.length ? changes.map(repoChangeRow) : [emptyMiniCard("No working tree changes.")])
  ]);
}

function repoSourceMessageBox() {
  const box = document.createElement("div");
  box.className = "repo-source-message";
  box.textContent = "信息";
  return box;
}

function repoStageAllButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "repo-stage-all";
  button.textContent = "+ 暂存全部";
  return button;
}

function repoChangeRow(change) {
  const row = document.createElement("div");
  row.className = "repo-change-row";
  const name = document.createElement("strong");
  name.textContent = change.name;
  const dir = document.createElement("span");
  dir.textContent = change.directory;
  const status = document.createElement("small");
  status.textContent = change.status;
  row.append(name, dir, status);
  return row;
}

function renderRepoPublishPanel(state) {
  const project = repoBrowserProject(state);
  els.projectTreeSummary.textContent = "";
  if (repoGitSummaryLoading) {
    els.projectTreeList.replaceChildren(emptyMiniCard("Loading branch status..."));
    return;
  }
  if (repoGitSummaryData?.error) {
    els.projectTreeList.replaceChildren(emptyMiniCard(repoGitSummaryData.error));
    return;
  }
  const published = Boolean(repoGitSummaryData?.published);
  const panel = document.createElement("div");
  panel.className = "repo-publish-panel";
  const title = document.createElement("strong");
  title.textContent = published ? "分支已发布" : "分支未发布";
  const copy = document.createElement("span");
  copy.textContent = published
    ? `此分支正在跟踪 ${repoGitSummaryData.upstream}。`
    : "在创建 pull request 之前发布此分支。";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "刷新";
  refresh.addEventListener("click", () => loadRepoGitSummary({ force: true }));
  const branch = document.createElement("small");
  branch.textContent = [
    repoGitSummaryData?.branch ?? project?.git?.currentBranch ?? "Unknown branch",
    `${repoGitSummaryData?.changes?.length ?? 0} 个本地更改`
  ].join(" · ");
  panel.append(title, copy, refresh, branch);
  els.projectTreeList.replaceChildren(panel);
}

function projectTreeRows(data, path, depth = 0) {
  const node = path ? data.nodes?.get(path) : data;
  const rows = [];
  for (const entry of node?.entries ?? []) {
    rows.push(projectTreeRow(entry, depth));
    if (entry.kind === "directory" && expandedProjectTreePaths.has(entry.path)) {
      if (loadingProjectTreePaths.has(entry.path)) {
        rows.push(projectTreeMessageRow("Loading...", depth + 1));
      } else if (data.nodes?.get(entry.path)?.error) {
        rows.push(projectTreeMessageRow(data.nodes.get(entry.path).error, depth + 1));
      } else {
        rows.push(...projectTreeRows(data, entry.path, depth + 1));
      }
    }
  }
  return rows;
}

function projectTreeMessageRow(text, depth = 0) {
  const row = document.createElement("p");
  row.className = "project-tree-inline-message";
  row.style.setProperty("--tree-depth", String(depth));
  row.textContent = text;
  return row;
}

function renderProjectContentSearch(project) {
  els.refreshProjectTreeButton.disabled = projectContentSearchLoading;
  const query = els.projectFileSearch.value.trim();
  if (!query) {
    els.projectTreeSummary.textContent = "";
    els.projectTreeList.replaceChildren(emptyMiniCard("输入要在文件中搜索的内容"));
    return;
  }
  if (projectContentSearchLoading) {
    els.projectTreeSummary.textContent = "Searching repository content...";
    els.projectTreeList.replaceChildren(emptyMiniCard("Searching..."));
    return;
  }
  if (projectContentSearchData?.error) {
    els.projectTreeSummary.textContent = projectContentSearchData.error;
    els.projectTreeList.replaceChildren(emptyMiniCard("Project content search unavailable."));
    return;
  }
  const results = projectContentSearchData?.results ?? [];
  els.projectTreeSummary.textContent = `${project.name} content matches · ${results.length}`;
  els.projectTreeList.replaceChildren(...(results.length ? results.map(projectContentSearchRow) : [emptyMiniCard("No content matched.")]));
}

function projectContentSearchRow(result) {
  const row = document.createElement("article");
  row.className = "project-content-row";

  const title = document.createElement("strong");
  title.textContent = result.path;
  title.title = result.path;
  const detail = document.createElement("span");
  detail.textContent = `Line ${result.line}: ${result.preview}`;
  detail.title = result.preview;

  row.append(title, detail);
  return row;
}

function projectTreeRow(entry, depth = 0) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "project-tree-row";
  row.dataset.treePath = entry.path ?? "";
  row.dataset.kind = entry.kind;
  row.dataset.expanded = String(entry.kind === "directory" && expandedProjectTreePaths.has(entry.path));
  row.style.setProperty("--tree-depth", String(depth));

  const icon = document.createElement("span");
  icon.textContent = entry.kind === "directory"
    ? expandedProjectTreePaths.has(entry.path) ? "▾" : "▸"
    : "•";

  const name = document.createElement("span");
  name.textContent = entry.name;
  name.title = entry.path || entry.name;

  const status = document.createElement("span");
  status.className = "project-tree-status";
  status.dataset.status = entry.gitStatus;
  status.textContent = gitStatusLabel(entry.gitStatus);

  row.append(icon, name, status);
  return row;
}

function gitStatusLabel(status) {
  if (status === "modified") return "M";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  return "";
}

function addActionMessage(action) {
  const messages = {
    files: "Choose files or paste/drag them into the composer.",
    folder: "Choose a folder; readable files are embedded into task context.",
    goal: "Goal mode is marked for the next task in composer metadata.",
    plan: "Plan mode is marked for the next task in composer metadata."
  };
  return messages[action] ?? "";
}

function renderMode(state, agent, invocation = null, approval = null) {
  const modeLabels = {
    run_task: "Describe the task, choose the computer and agent, then run it.",
    session: "Review managed session history and continue work without losing context.",
    diff: "Review changed files and send feedback from the managed session.",
    terminal: "Inspect managed runtime status. Terminal attach waits for the runtime phase.",
    evidence_center: "Trace managed and imported evidence without entering the task workflow.",
    approval: "Review pending approvals with risk, timeout, consequence, and audit context.",
    setup: "Connect agents and prepare runtime targets outside the task composer."
  };
  const normalizedMode = modeLabels[activeMode] ? activeMode : "run_task";
  activeMode = normalizedMode;
  const isCodex = isCodexAgent(agent);
  const showCodexSummary = isCodex || ["session", "diff", "terminal", "evidence_center", "approval"].includes(activeMode);
  const showSessionSurface = activeMode === "session";
  const showDiffSurface = activeMode === "diff";
  const showEvidenceSurface = activeMode === "evidence_center";
  const showApprovalSurface = activeMode === "approval";
  const showSetupSurface = activeMode === "setup";
  const showTerminalSurface = activeMode === "terminal";
  const showRunSurface = activeMode === "run_task";

  for (const button of els.modeButtons) {
    const isActive = button.dataset.workspaceMode === activeMode;
    button.dataset.active = String(isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }

  els.modeSummary.textContent = modeLabels[activeMode];
  els.contextPanel.dataset.workspaceMode = activeMode;
  els.commandPanel.hidden = !showRunSurface;
  els.runPanel.hidden = true;
  els.connectAgentPanel.hidden = !showSetupSurface;
  els.managedCodexContext.hidden = !showCodexSummary;
  els.managedSessionHistoryContext.hidden = !(showSessionSurface || showDiffSurface);
  els.managedPolicyContext.hidden = !(showSessionSurface || showTerminalSurface);
  els.managedEvidenceContext.hidden = !(showSessionSurface || showEvidenceSurface);
  els.evidenceCenterContext.hidden = !showEvidenceSurface;
  els.managedApprovalContext.hidden = !showApprovalSurface;
  els.importSessionContext.hidden = !showEvidenceSurface;
  els.terminalSurfaceContext.hidden = !showTerminalSurface;
  els.managedChangeReviewPanel.hidden = !showDiffSurface;

  const showsCodexSession = showRunSurface && isCodex;
  els.codexSessionControl.hidden = !showsCodexSession;
  els.codexWorkspaceControl.hidden = !showsCodexSession;

  if (["session", "diff", "terminal", "evidence_center", "approval"].includes(activeMode) && state && !codexAgentInState(state)) {
    els.modeSummary.textContent = "Codex CLI is not registered yet. Use Connect agent or start Desktop Bridge, then select Codex CLI.";
  } else if (["session", "diff", "terminal", "evidence_center", "approval"].includes(activeMode) && !isCodex) {
    els.modeSummary.textContent = "Select Codex CLI to inspect session registry, policy, evidence, and approval details.";
  }

  renderManagedCodexContext(state, agent, invocation, approval);
  renderManagedSessionHistory(state);
  renderEvidenceCenter(state);
  renderImportedEvidenceContext(state);
  terminalSurface.renderTerminalSurface(state);
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
  const allConversations = conversationHistoryItems(state);
  const conversations = allConversations.filter((item) => conversationMatchesHistoryFilter(state, item));
  for (const button of els.managedSessionHistoryFilters.querySelectorAll("button[data-session-filter]")) {
    button.dataset.active = String(button.dataset.sessionFilter === managedSessionFilter);
  }

  if (!conversations.length) {
    const empty = document.createElement("p");
    empty.className = "session-history-empty";
    empty.textContent = allConversations.length
      ? "No conversations match this filter."
      : "No project conversations recorded yet.";
    els.managedSessionHistoryList.replaceChildren(empty);
    renderManagedSessionDetail(state, null);
    return;
  }

  els.managedSessionHistoryList.replaceChildren(
    ...conversations.map((conversation) => {
      const { invocation, session } = conversation;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "session-history-item";
      row.dataset.invocationId = invocation.id;
      if (session?.id) row.dataset.sessionId = session.id;
      row.dataset.selected = String(invocation.id === currentInvocationId);

      const top = document.createElement("div");
      top.className = "session-history-top";
      const title = document.createElement("strong");
      title.textContent = taskSummary(invocation.input?.task) ?? invocation.id;
      const status = document.createElement("span");
      status.className = "session-history-badge";
      status.textContent = readableStatus(invocation.status);
      top.append(title, status);

      const meta = document.createElement("p");
      meta.textContent = [
        conversation.project?.name ?? "Unknown project",
        session ? sessionModeText(session.sessionMode) : "Demo session",
        invocation.updatedAt ? shortTime(invocation.updatedAt) : null,
        `${conversation.messageCount} events`,
        conversation.approvalCount ? `${conversation.approvalCount} approval` : null
      ].filter(Boolean).join(" · ");

      const result = document.createElement("p");
      result.className = "session-history-result";
      result.textContent = conversation.resultSummary;

      row.append(top, meta, result);
      return row;
    })
  );
  renderManagedSessionDetail(
    state,
    conversations.find((item) => item.invocation.id === currentInvocationId) ?? null
  );
}

function renderManagedSessionDetail(state, conversation) {
  if (!conversation) {
    els.managedSessionDetailTitle.textContent = "Session detail";
    els.managedSessionDetailSummary.textContent = "Select a conversation to restore its transcript and inspect evidence.";
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

  const { invocation, session } = conversation;
  const summary = session ? managedSessionSummary(state, session) : null;
  const agent = state?.agents?.find((item) => item.id === invocation.agentId);
  const workspace = managedWorkspaceForSession(state, session);
  const changes = session ? codexChangeEvidenceForSession(state, session, invocation) : [];
  els.managedSessionDetailTitle.textContent = taskSummary(invocation.input?.task) ?? invocation.id;
  els.managedSessionDetailSummary.textContent = conversation.resultSummary;
  els.managedSessionDetailAgent.textContent = agent?.name ?? invocation.agentId ?? "Unknown agent";
  els.managedSessionDetailMode.textContent = session ? sessionModeText(session.sessionMode) : "Demo invocation";
  els.managedSessionDetailRepo.textContent = workspace?.repoPath ?? conversation.project?.path ?? "Repo unknown";
  els.managedSessionDetailWorktree.textContent = workspace?.worktreePath ?? "Not isolated";
  els.managedSessionDetailBranch.textContent = workspace?.branchName ?? workspace?.baseBranch ?? "Unknown";
  els.managedSessionDetailDirty.textContent = workspace?.dirtyState ?? "Unknown";
  els.managedSessionDetailCommit.textContent = workspace?.lastCommit ?? "Unknown";
  els.managedSessionDetailEvidence.textContent = session
    ? `${summary.evidenceCount} JSONL record(s), ${summary.hookCount} hook event(s)`
    : `${conversation.messageCount} event(s)`;
  els.managedSessionDetailApprovals.textContent = conversation.approvalCount
    ? `${conversation.approvalCount} request(s)`
    : "No approval request recorded";
  els.managedSessionDetailContinue.textContent = session && (session.status === "completed" || session.status === "observing")
    ? "Use Continue last session from the task composer when Codex CLI is selected."
    : "Clicking this history item restores the center transcript; exact provider resume is tracked in the worktree phase.";
  renderManagedChangeReview(state, session, changes);
}

function conversationHistoryItems(state) {
  const invocations = state?.invocations ?? [];
  return invocations.map((invocation) => {
    const session = state?.codexSessions?.find((item) => item.invocationId === invocation.id) ?? null;
    const project = projectForInvocation(state, invocation);
    const audit = state?.auditSummaries?.find((item) => item.invocationId === invocation.id);
    const events = state?.events?.filter((event) => event.invocationId === invocation.id) ?? [];
    const approvalCount = (state?.approvalRequests ?? []).filter((approval) => approval.invocationId === invocation.id).length
      + (state?.codexApprovalBrokerRequests ?? []).filter((approval) => approval.invocationId === invocation.id).length;
    return {
      invocation,
      session,
      project,
      messageCount: events.length,
      approvalCount,
      resultSummary: resultSummary(invocation, audit),
      updatedAt: invocation.updatedAt ?? invocation.createdAt
    };
  }).sort((a, b) => Date.parse(b.updatedAt ?? 0) - Date.parse(a.updatedAt ?? 0));
}

function projectForInvocation(state, invocation) {
  const projectId = invocation?.options?.metadata?.projectId;
  return state?.projects?.find((project) => project.id === projectId) ?? null;
}

function latestConversationForProject(state, project) {
  if (!state || !project) return null;
  return conversationHistoryItems(state).find((conversation) => conversationMatchesProject(conversation, project)) ?? null;
}

function conversationMatchesProject(conversation, project, state = lastState) {
  const metadata = conversation.invocation?.options?.metadata ?? {};
  const workspace = conversation.session ? managedWorkspaceForSession(state, conversation.session) : null;
  if (metadata.projectId === project.id || workspace?.projectId === project.id) return true;
  if (samePath(metadata.projectPath, project.path) || samePath(workspace?.repoPath, project.path) || samePath(workspace?.worktreePath, project.path)) return true;
  if (project.worktree) {
    return metadata.worktreeId === project.worktree.id
      || samePath(metadata.worktreePath, project.path)
      || samePath(workspace?.worktreePath, project.path);
  }
  if (isHistoryProject(project)) {
    return samePath(metadata.projectPath, project.path)
      || String(metadata.projectName ?? "").toLowerCase() === String(project.name ?? "").toLowerCase();
  }
  return false;
}

function samePath(left, right) {
  const normalize = (value) => String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  return Boolean(left && right && normalize(left) === normalize(right));
}

function conversationMatchesHistoryFilter(state, item) {
  const invocation = item.invocation;
  if (managedSessionFilter === "all") return true;
  if (managedSessionFilter === "project") return item.project?.id === state?.currentProjectId;
  if (managedSessionFilter === "imported") return item.session?.sessionMode === "imported" || item.session?.status === "imported";
  if (managedSessionFilter === "needs_approval") return item.approvalCount > 0 && ["waiting_for_local_approval", "running"].includes(invocation.status);
  if (managedSessionFilter === "running") return ["queued", "dispatching", "running", "waiting_for_local_approval", "cancelling"].includes(invocation.status);
  if (managedSessionFilter === "completed") return invocation.status === "succeeded";
  if (managedSessionFilter === "failed") return ["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation.status);
  return true;
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
    await api.reviewCodexChange({
      evidenceId: selectedManagedChangeEvidenceId,
      decision,
      comment: els.managedChangeReviewComment.value.trim()
    });
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
  await resolveCodexApprovalRequest(selectedCodexApprovalRequestId, action);
}

async function resolveCodexApprovalRequest(requestId, action) {
  if (!requestId) {
    return;
  }
  els.managedApproveButton.disabled = true;
  els.managedDenyButton.disabled = true;
  try {
    await api.resolveCodexApprovalRequest(requestId, action);
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

function taskEventsForInvocation(state, invocation) {
  if (!state || !invocation) return [];
  return (state.events ?? []).filter((event) => event.invocationId === invocation.id);
}

function shortInvocationId(id) {
  const value = String(id ?? "");
  const number = value.match(/(\d+)$/)?.[1];
  return number ? `#${number}` : value.replace(/^inv_/, "#").slice(0, 8);
}

function showTasksPage() {
  activePage = "tasks";
  activeMode = "run_task";
  workspaceTabSurface.showTasks();
  refreshRoutineRuns({ force: true });
}

function showWorkspacePage({ draft = false, invocationId = null } = {}) {
  activePage = "workspace";
  activeMode = "run_task";
  workspaceTabSurface.showWorkspace({ draft, invocationId });
}

const {
  activateWorkspaceTab,
  applyTaskListSurface,
  closeWorkspaceTab,
  openWorkspaceTab,
  renderWorkspaceTabs,
  syncWorkspaceTabs,
} = workspaceTabSurface;

function currentApproval(state, invocation) {
  if (!state || !invocation?.approvalRequestId) {
    return null;
  }
  return state.approvalRequests?.find((item) => item.id === invocation.approvalRequestId) ?? null;
}

function currentCodexApproval(state, invocation) {
  if (!state || !invocation) {
    return null;
  }
  return (state.codexApprovalBrokerRequests ?? []).find((request) => request.invocationId === invocation.id && request.status === "pending") ?? null;
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
  els.registerSshTargetButton.disabled = true;
  els.testSshTargetButton.disabled = true;
  els.createIntegrationButton.disabled = true;
  els.builderDraftButton.disabled = true;
  els.generateIntegrationButton.disabled = true;
  els.importEvidenceButton.disabled = true;
  els.currentProjectName.textContent = "Offline";
  els.currentProjectPath.textContent = "Project registry is unavailable.";
  els.addProjectButton.disabled = true;
  els.removeProjectButton.disabled = true;
  els.projectList.replaceChildren(emptyMiniCard("Reconnect server to load projects."));
  els.projectTreeSummary.textContent = "Project files unavailable while offline.";
  els.projectTreeList.replaceChildren(emptyMiniCard("Reconnect server to browse files."));
  els.approvalPanel.hidden = true;
  els.approveButton.disabled = true;
  els.denyButton.disabled = true;
  els.managedApproveButton.disabled = true;
  els.managedDenyButton.disabled = true;
  els.troubleshootButton.disabled = true;
  els.troubleshooterPanel.hidden = true;
  els.runBlockReason.textContent = "Server is offline.";
  els.discoverySummary.textContent = "Server is offline.";
  els.sshTargetSummary.textContent = "Server is offline.";
  els.sshTargetTestReport.textContent = "SSH preflight results appear here.";
  els.integrationSummary.textContent = "Server is offline.";
  els.candidateList.replaceChildren();
  els.artifactList.replaceChildren();
  renderTimeline([]);
}

function renderTimeline(events, invocation = null, state = null) {
  if (events.length === 0 && !invocation?.input?.task) {
    const empty = document.createElement("div");
    empty.className = "timeline-empty";
    empty.innerHTML = "<strong>Start a Codex conversation</strong><span>Describe a task below. The center workspace stays in conversation mode while terminal output remains in Terminal.</span>";
    els.eventList.replaceChildren(empty);
    return;
  }

  const messageItems = [];
  if (invocation?.input?.task) {
    messageItems.push(transcriptItem({
      role: "user",
      title: "You",
      message: taskSummary(invocation.input.task) ?? String(invocation.input.task),
      createdAt: invocation.createdAt
    }));
  }

  els.eventList.replaceChildren(
    ...messageItems,
    ...events.slice().reverse().map((event) => {
      const brokerRequest = codexApprovalRequestForEvent(state, event, invocation);
      return transcriptItem({
        role: timelineRole(event),
        title: readableEventType(event.type),
        message: timelineMessage(event),
        createdAt: event.createdAt,
        actions: brokerRequest?.status === "pending" ? codexApprovalActions(brokerRequest) : null
      });
    })
  );
}

function transcriptItem({ role, title, message, createdAt = null, actions = null }) {
  const item = document.createElement("article");
  item.className = "timeline-item";
  item.dataset.role = role;

  if (createdAt) {
    const time = document.createElement("time");
    time.className = "timeline-time";
    time.dateTime = createdAt;
    time.textContent = shortTime(createdAt);
    item.append(time);
  }

  const copy = document.createElement("div");
  copy.className = "timeline-copy";

  const heading = document.createElement("strong");
  heading.textContent = title;
  copy.append(heading);

  if (Array.isArray(message)) {
    copy.append(transcriptDetails(message));
  } else {
    const text = document.createElement("p");
    text.textContent = message;
    copy.append(text);
  }

  if (actions) copy.append(actions);
  item.append(copy);
  return item;
}

function transcriptDetails(rows) {
  const details = document.createElement("details");
  details.className = "timeline-details";
  details.open = false;

  const summary = document.createElement("summary");
  summary.textContent = "Show technical details";

  const list = document.createElement("dl");
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    list.append(term, description);
  }

  details.append(summary, list);
  return details;
}

function codexApprovalRequestForEvent(state, event, invocation) {
  if (!state || !event || !invocation) {
    return null;
  }
  const requestId = event.data?.approvalBrokerRequestId ?? event.data?.brokerRequestId ?? null;
  const requests = state.codexApprovalBrokerRequests ?? [];
  if (requestId) {
    return requests.find((request) => request.id === requestId) ?? null;
  }
  if (event.type === "codex_approval_requested") {
    return requests.find((request) => request.invocationId === invocation.id && request.status === "pending") ?? null;
  }
  return null;
}

function codexApprovalActions(request) {
  const actions = document.createElement("div");
  actions.className = "inline-approval-actions";

  const approve = document.createElement("button");
  approve.type = "button";
  approve.textContent = "Approve";
  approve.dataset.codexApprovalRequestId = request.id;
  approve.dataset.codexApprovalAction = "approve";

  const deny = document.createElement("button");
  deny.type = "button";
  deny.className = "secondary";
  deny.textContent = "Deny";
  deny.dataset.codexApprovalRequestId = request.id;
  deny.dataset.codexApprovalAction = "deny";

  actions.append(approve, deny);
  return actions;
}

function timelineRole(event) {
  if (event.type === "execution_preview") return "tool";
  if (event.type === "codex_approval_requested" || event.type === "approval_requested") return "approval";
  if (event.type === "codex_runtime_warning" && event.data?.warningCategory === "command_timeout") return "tool";
  if (event.type === "codex_runtime_warning" && event.level !== "warn") return "system";
  if (event.type === "codex_hook_event") return "system";
  if (event.type === "agent_output" || event.type === "invocation_completed") return "assistant";
  if (event.level === "warn") return "approval";
  return "system";
}

function updateActions(state, invocation) {
  const hasServer = Boolean(state);
  const hasTask = els.taskInput.value.trim().length > 0 || composerAttachments.length > 0;
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
  const runActionText = localAgent && state?.device?.status !== "online" ? "Queue for this computer" : "Send task";
  els.runButton.textContent = "↑";
  els.runButton.setAttribute("aria-label", runActionText);
  els.runButton.title = runActionText;
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
  const sshPayload = sshTargetPayload();
  const hasSshBasics = Boolean(sshPayload.host && sshPayload.user && sshPayload.workspaceRoot);
  els.registerSshTargetButton.disabled = !hasServer || activeMode !== "setup" || !hasSshBasics;
  els.testSshTargetButton.disabled = !hasServer || activeMode !== "setup" || !terminalSurface.latestSshTarget(state);
  const artifact = selectedIntegrationArtifact(state);
  els.createIntegrationButton.disabled = !hasServer || els.integrationIntent.value.trim().length === 0;
  els.builderDraftButton.disabled = !hasServer || els.integrationIntent.value.trim().length === 0;
  els.generateIntegrationButton.disabled = !hasServer || !artifact || artifact.artifactType !== "integration_plan" || ["archived", "rejected"].includes(artifact.reviewState);
  els.importEvidenceButton.disabled = !hasServer || activeMode !== "import_session" || !els.importEvidenceSummary.value.trim();
  els.runBlockReason.textContent = [
    runBlockReason({ hasServer, hasTask, hasAgent, isRunning, disabled, unhealthy, agent }),
    selectedAddAction ? addActionMessage(selectedAddAction) : null
  ].filter(Boolean).join(" ");
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
  return api.createIntegrationArtifact({ ...integrationPayload(), ...overrides });
}

async function createDiscovery(payload) {
  return api.createDiscovery(payload);
}

async function registerSshTarget(payload) {
  return api.registerSshTarget(payload);
}

async function testSshTarget(targetId) {
  return api.testSshTarget(targetId);
}

function initializeRouteState() {
  const params = new URLSearchParams(window.location.search);
  const invocationId = params.get("invocation");
  const mode = params.get("mode");
  if (invocationId) {
    showWorkspacePage({ invocationId });
  }
  if (mode === "task_workspace") {
    showWorkspacePage({ draft: !invocationId, invocationId });
    return;
  }
  if (mode && ["run_task", "session", "diff", "terminal", "evidence_center", "approval", "setup", "import_session", "managed_codex"].includes(mode)) {
    activeMode = mode;
    if (mode === "run_task" && !invocationId) {
      showTasksPage();
    }
  }
}

async function fetchState() {
  return api.fetchState();
}

async function refreshRoutineRuns({ force = false } = {}) {
  if (routineRunsRefreshInFlight) return;
  if (!force && activePage !== "tasks") return;
  if (!force && Date.now() - routineRunsLastRefreshMs < 2000) return;
  routineRunsRefreshInFlight = true;
  try {
    routineRunsState = await api.fetchRoutineRuns();
    routineRunsLastProjectId = lastState?.currentProjectId ?? null;
    routineRunsLastRefreshMs = Date.now();
    if (activePage === "tasks") renderTaskList(lastState);
  } catch {
    if (activePage === "tasks") {
      els.taskListRows.replaceChildren(emptyMiniCard("Routine read model is unavailable."));
      els.routineRunDetail.replaceChildren(emptyMiniCard("Check the local server and retry."));
    }
  } finally {
    routineRunsRefreshInFlight = false;
  }
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
    const details = [
      ["Command", event.data.commandLine],
      ["Session", event.data.sessionMode ? sessionModeText(event.data.sessionMode) : "Not recorded"],
      ["Task", event.data.taskSummary ?? "Not recorded"]
    ];
    if (event.data.attachments?.length) {
      details.push(["Attachments", event.data.attachments.map((attachment) => `${attachment.name} via Codex --image`).join(", ")]);
    }
    return details;
  }
  if (event.type === "codex_runtime_warning") {
    if (event.data?.warningCategory === "command_timeout") {
      return `${event.message ?? "A Codex command timed out."} The overall task can still succeed.`;
    }
    return event.message ?? "Codex CLI reported a runtime warning.";
  }
  if (event.type === "codex_approval_requested") {
    return `${event.message ?? "Codex approval is pending"} Review and choose Approve or Deny.`;
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

function sshTargetPayload() {
  return {
    host: els.sshTargetHost.value.trim(),
    port: Number(els.sshTargetPort.value || 22),
    user: els.sshTargetUser.value.trim(),
    authMethod: els.sshTargetAuthMethod.value,
    credentialRef: els.sshTargetCredentialRef.value.trim(),
    knownHostPolicy: els.sshTargetKnownHostPolicy.value,
    knownHostFingerprint: els.sshTargetFingerprint.value.trim(),
    workspaceRoot: els.sshTargetWorkspaceRoot.value.trim(),
    platformHint: els.sshTargetPlatformHint.value,
    keySelection: els.sshTargetKeySelection.value,
    agentForwarding: els.sshTargetAgentForwarding.checked
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

function agentCostText(agent) {
  if (isCodexAgent(agent)) return "External or unknown";
  return costText(agent?.economics);
}

function latestExecutionPreview(state, invocation) {
  if (!state || !invocation) return null;
  return state.events
    ?.filter((event) => event.invocationId === invocation.id && event.type === "execution_preview")
    .at(-1) ?? null;
}
