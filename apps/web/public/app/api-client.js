const defaultApiBase = "http://127.0.0.1:5001";

export function resolveApiBase() {
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

export function createApiClient(apiBase) {
  const json = (path, options) => requestJson(apiBase, path, options);
  const command = (path, options) => requestJson(apiBase, path, { method: "POST", ...options });

  return {
    apiBase,
    addProject: (payload) => command("/api/projects", { body: payload, errorMessage: "Unable to add project." }),
    cancelInvocation: (invocationId) => command(`/api/invocations/${encodeURIComponent(invocationId)}/cancel`, { errorMessage: "Unable to cancel invocation." }),
    cloneProject: (payload) => command("/api/projects/clone", { body: payload, errorMessage: "Unable to clone project." }),
    closeTerminalSession: (terminalSessionId) => command(`/api/terminal/sessions/${encodeURIComponent(terminalSessionId)}/close`, { errorMessage: "Unable to close managed terminal session." }),
    createDiscovery: (payload) => command("/api/discovery", { body: payload, errorMessage: "Unable to start discovery." }),
    createIntegrationArtifact: (payload) => command("/api/integration-artifacts", { body: payload, errorMessage: "Unable to create integration artifact." }),
    createIntegrationBuilderDraft: (payload) => command("/api/integration-builder/draft", { body: payload, errorMessage: "Unable to draft integration plan." }),
    createInvocation: (payload) => command("/api/invocations", { body: payload, errorMessage: "Unable to start task." }),
    createLifecycleRecipe: (payload) => command("/api/m3/lifecycle-recipes", { body: payload, errorMessage: "Unable to create lifecycle recipe." }),
    createPrivateCatalogEntry: (payload) => command("/api/m3/private-catalog", { body: payload, errorMessage: "Unable to create private catalog entry." }),
    createSignedBundle: (payload) => command("/api/m3/signed-bundles", { body: payload, errorMessage: "Unable to create signed bundle." }),
    createAiUsageRecord: (payload) => command("/api/m3/ai-usage", { body: payload, errorMessage: "Unable to record AI usage." }),
    createAuditExportDryRun: (payload) => command("/api/m3/audit-export", { body: payload, errorMessage: "Unable to validate audit export." }),
    createCompareRun: (payload) => command("/api/compare-runs", { body: payload, errorMessage: "Unable to start task." }),
    createProject: (payload) => command("/api/projects/create", { body: payload, errorMessage: "Unable to create project." }),
    createTerminalSession: (payload) => command("/api/terminal/sessions", { body: payload, errorMessage: "Unable to register managed terminal session." }),
    createWorktree: (payload) => command("/api/worktrees", { body: payload, errorMessage: "Unable to create worktree." }),
    fetchProjectGitSummary: (projectId) => json(`/api/projects/${encodeURIComponent(projectId)}/git-summary`, { errorMessage: "Unable to load source control." }),
    fetchProjectSearch: (projectId, params) => json(`/api/projects/${encodeURIComponent(projectId)}/search?${params.toString()}`, { errorMessage: "Unable to search project content." }),
    fetchProjectTree: (projectId, params) => json(`/api/projects/${encodeURIComponent(projectId)}/tree?${params.toString()}`, { errorMessage: "Unable to load project files." }),
    fetchM3: () => json("/api/m3", { errorMessage: "Unable to refresh M3 state." }),
    fetchRoutineRuns: () => json("/api/loop-routines?limit=50", { errorMessage: "Unable to refresh loop routines." }),
    fetchState: () => json("/api/state", { errorMessage: "Unable to refresh state." }),
    generateIntegrationArtifact: (artifactId) => command(`/api/integration-artifacts/${encodeURIComponent(artifactId)}/generate`, { errorMessage: "Unable to generate integration artifact." }),
    importCodexEvidence: (payload) => command("/api/codex/imported-evidence", { body: payload, errorMessage: "Unable to import evidence." }),
    registerDiscoveryCandidate: (runId, candidateId) => command(`/api/discovery/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}/register`, { errorMessage: "Unable to register discovery candidate." }),
    registerSshTarget: (payload) => command("/api/ssh-targets", { body: payload, errorMessage: "Unable to register SSH target." }),
    removeProject: (projectId) => json(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE", errorMessage: "Unable to remove project." }),
    requestAgentHealth: (agentId) => command(`/api/agents/${encodeURIComponent(agentId)}/health-check`, { errorMessage: "Unable to start health check." }),
    resizeTerminalSession: (terminalSessionId, payload) => command(`/api/terminal/sessions/${encodeURIComponent(terminalSessionId)}/resize`, { body: payload, errorMessage: "Unable to resize managed terminal." }),
    resolveCodexApprovalRequest: (requestId, action) => command(`/api/codex/approval-broker/${encodeURIComponent(requestId)}/${action}`, { errorMessage: "Unable to resolve Codex approval request." }),
    resolveLocalApproval: (approvalId, action) => command(`/api/approvals/${encodeURIComponent(approvalId)}/${action}`, { errorMessage: "Unable to resolve approval request." }),
    reviewCodexChange: (payload) => command("/api/codex/change-reviews", { body: payload, errorMessage: "Unable to record change review." }),
    sendTerminalInput: (terminalSessionId, payload) => command(`/api/terminal/sessions/${encodeURIComponent(terminalSessionId)}/input`, { body: payload, errorMessage: "Unable to send managed terminal input." }),
    setAgentLifecycle: (agentId, action) => command(`/api/agents/${encodeURIComponent(agentId)}/${action}`, { errorMessage: "Unable to update agent lifecycle." }),
    switchProject: (projectId) => command(`/api/projects/${encodeURIComponent(projectId)}`, { errorMessage: "Unable to switch project." }),
    testSshTarget: (targetId) => command(`/api/ssh-targets/${encodeURIComponent(targetId)}/test`, { body: { expectLiveConnection: false }, errorMessage: "Unable to test SSH target." }),
    transitionIntegrationArtifact: (artifactId, action) => command(`/api/integration-artifacts/${encodeURIComponent(artifactId)}/${action}`, { errorMessage: "Unable to update integration artifact." }),
    troubleshootInvocation: (invocationId) => command(`/api/invocations/${encodeURIComponent(invocationId)}/troubleshoot`, { errorMessage: "Unable to troubleshoot invocation." }),
  };
}

async function requestJson(apiBase, path, { method = "GET", body = null, errorMessage = "Request failed." } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(data?.message ?? data?.error ?? errorMessage);
  }
  return data;
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
