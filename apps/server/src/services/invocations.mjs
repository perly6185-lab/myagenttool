import { createInvocationApprovalRuntime } from "./invocations/approval.mjs";
import { createInvocationCancellationRuntime } from "./invocations/cancellation.mjs";
import { createInvocationCompareRuntime } from "./invocations/compare.mjs";
import { createInvocationCompletionRuntime } from "./invocations/completion.mjs";
import { createInvocationCreationRuntime } from "./invocations/creation.mjs";
import { createInvocationDirectHttpRuntime } from "./invocations/direct-http.mjs";
import { createInvocationDispatchRuntime } from "./invocations/dispatch.mjs";
import { createInvocationTroubleshootingRuntime } from "./invocations/troubleshooting.mjs";

export function createInvocationService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  persistStateNow,
  dispatchLeaseMs,
  namespace,
  protocolVersion,
  findAgent,
  enforcePlatformAiQuota,
  recordInvocationLedgerEntry,
  recordCcusageImportedEstimates,
  recordCodexReviewFindings,
  recordClaudeReviewFindings,
  currentProject,
  worktreeForProject,
  createWorktree,
  createWorktreePr,
  uniqueStrings,
  normalizeCodexApprovalMode,
  normalizeCodexSessionMode,
  normalizeCodexWorkspacePolicy,
  createManagedCodexWorkspace,
  createManagedCodexSession,
  resolveResumeCodexSessionId,
  budgetGateForProject,
  closeCodexSession,
  onInvocationCompleted,
  onInvocationApproved,
}) {
  const {
    completeInvocation,
    completeRootSpan,
    createAuditSummary,
    getAgentUsageSummary,
    recordAgentUsage,
    updateCompareRun,
  } = createInvocationCompletionRuntime({
    state,
    now,
    appendEvent,
    persistStateSoon,
    namespace,
    protocolVersion,
    findAgent,
    findInvocation,
    closeCodexSession,
    isTerminal,
    recordInvocationLedgerEntry,
    recordCcusageImportedEstimates,
    recordCodexReviewFindings,
    recordClaudeReviewFindings,
    onInvocationCompleted,
  });
  const {
    abortDirectHttpRun,
    startInvocationIfAllowed,
  } = createInvocationDirectHttpRuntime({
    appendEvent,
    completeInvocation,
    findAgent,
    isTerminal,
  });
  const {
    approveInvocation,
    createApprovalRequest,
    createPolicyDecisionRecord,
    denyInvocation,
    evaluateInvocationPolicy,
  } = createInvocationApprovalRuntime({
    state,
    now,
    nextId,
    appendEvent,
    findAgent,
    uniqueStrings,
    completeRootSpan,
    createAuditSummary,
    recordAgentUsage,
    startInvocationIfAllowed,
    onInvocationApproved,
  });
  const { createInvocation } = createInvocationCreationRuntime({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    persistStateNow,
    defaultAgent,
    currentProject,
    worktreeForProject,
    normalizeCodexApprovalMode,
    normalizeCodexSessionMode,
    normalizeCodexWorkspacePolicy,
    createManagedCodexWorkspace,
    createManagedCodexSession,
    resolveResumeCodexSessionId,
    evaluateInvocationPolicy,
    enforcePlatformAiQuota,
    createPolicyDecisionRecord,
    createApprovalRequest,
    completeRootSpan,
    createAuditSummary,
    recordAgentUsage,
    budgetGateForProject,
  });
  const {
    acknowledgeInvocation,
    markDispatched,
    nextDispatchableInvocation,
    redeliverExpiredDispatches,
  } = createInvocationDispatchRuntime({
    state,
    now,
    appendEvent,
    dispatchLeaseMs,
    findAgent,
    completeInvocation,
  });
  const { createCompareRun, setCompareRunPreferred, promoteCompareRun } = createInvocationCompareRuntime({
    state,
    now,
    nextId,
    createInvocation,
    startInvocationIfAllowed,
    updateCompareRun,
    createWorktree,
    createWorktreePr,
    findInvocation,
  });
  const { createTroubleshootingReport } = createInvocationTroubleshootingRuntime({
    state,
    now,
    nextId,
    appendEvent,
    findAgent,
    createInvocation,
    completeInvocation,
  });
  const {
    cancelInvocation,
    cancelInvocationsForDeviceUnlink,
  } = createInvocationCancellationRuntime({
    state,
    now,
    appendEvent,
    findAgent,
    findApprovalRequest,
    abortDirectHttpRun,
    createAuditSummary,
    recordAgentUsage,
    isTerminal,
  });

  function findInvocation(id) {
    return state.invocations.find((item) => item.id === id);
  }

  function findApprovalRequest(id) {
    return state.approvalRequests.find((item) => item.id === id);
  }

  function defaultAgent() {
    return state.agents.find((item) => item.id === "agt_demo_cli") ?? state.agents.find((item) => item.adapter.type !== "platform") ?? state.agents[0] ?? null;
  }

  return {
    acknowledgeInvocation,
    approveInvocation,
    cancelInvocation,
    cancelInvocationsForDeviceUnlink,
    completeInvocation,
    createAuditSummary,
    createCompareRun,
    setCompareRunPreferred,
    promoteCompareRun,
    createInvocation,
    createTroubleshootingReport,
    defaultAgent,
    denyInvocation,
    findApprovalRequest,
    findInvocation,
    getAgentUsageSummary,
    isTerminal,
    markDispatched,
    nextDispatchableInvocation,
    recordAgentUsage,
    redeliverExpiredDispatches,
    startInvocationIfAllowed,
  };
}

export function isTerminal(status) {
  return ["succeeded", "failed", "cancelled", "timed_out", "expired", "rejected"].includes(status);
}
