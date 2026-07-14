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
  refuse,
  persistStateSoon,
  persistStateNow,
  dispatchLeaseMs,
  namespace,
  protocolVersion,
  findAgent,
  enforcePlatformAiQuota,
  recordInvocationLedgerEntry,
  recordInvocationRoundUsage,
  recordCcusageImportedEstimates,
  recordCodexReviewFindings,
  recordClaudeReviewFindings,
  recordCodexExecChanges,
  recordApplicationResult,
  currentProject,
  worktreeForProject,
  createWorktree,
  createWorktreePr,
  latestWorktreeReview,
  worktreeHeadCommit,
  uniqueStrings,
  normalizeCodexApprovalMode,
  normalizeCodexSessionMode,
  normalizeCodexWorkspacePolicy,
  createManagedCodexWorkspace,
  createManagedCodexSession,
  resolveResumeCodexSessionId,
  budgetGateForProject,
  checkUsageQuota,
  closeCodexSession,
  onInvocationCompleted,
  onInvocationApproved,
  onInvocationDenied,
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
    // #890.2: completion writes the terminal status + ledger entry; give it the
    // synchronous barrier so a crash can't lose a committed charge and re-run.
    persistStateNow,
    namespace,
    protocolVersion,
    findAgent,
    findInvocation,
    closeCodexSession,
    isTerminal,
    recordInvocationLedgerEntry,
    recordInvocationRoundUsage,
    recordCcusageImportedEstimates,
    recordCodexReviewFindings,
    recordClaudeReviewFindings,
    recordCodexExecChanges,
    // #804's generic importer was composed and handed to this service, and then
    // never forwarded to the runtime that calls it — so `typeof
    // recordApplicationResult === "function"` was false in completion.mjs and the
    // import silently never ran. Every unit test passed: they exercised the
    // importer directly and never this wire.
    recordApplicationResult,
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
    refuse,
    findAgent,
    uniqueStrings,
    completeRootSpan,
    createAuditSummary,
    recordAgentUsage,
    startInvocationIfAllowed,
    onInvocationApproved,
    onInvocationDenied,
  });
  const { createInvocation } = createInvocationCreationRuntime({
    state,
    now,
    nextId,
    appendEvent,
    refuse,
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
    checkUsageQuota,
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
    latestWorktreeReview,
    worktreeHeadCommit,
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
