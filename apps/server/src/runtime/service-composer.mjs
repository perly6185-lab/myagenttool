import { createEventLogRuntime } from "./event-log.mjs";
import { createBridgeCredentialRuntime } from "./bridge-auth.mjs";
import { createPersistenceRuntime } from "./persistence.mjs";
import { createReadModelRuntime } from "./read-models.mjs";
import {
  createAgentService,
  isAgentDisabled,
  normalizeStringArray,
} from "../services/agents.mjs";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { createAgentSkillService } from "../services/agent-skills.mjs";
import { createApplicationService, validateApplicationRoutineDraft } from "../services/applications.mjs";
import { createCapabilityService } from "../services/capabilities.mjs";
import { createCcusageImportService } from "../services/ccusage-imports.mjs";
import { createClaudeReviewImportService } from "../services/claude-review-imports.mjs";
import { createCodexReviewImportService } from "../services/codex-review-imports.mjs";
import { createCodexService } from "../services/codex.mjs";
import { createIntegrationService } from "../services/integrations.mjs";
import { createInvocationService } from "../services/invocations.mjs";
import { createM3Service } from "../services/m3.mjs";
import { createProjectService, sameProjectPath } from "../services/projects.mjs";
import { createAutoRunService } from "../services/auto-run.mjs";
import { resolveAutoRunVerifyCommand, runWorktreeVerification } from "../services/worktree-verify.mjs";
import { resolveStatusWritebackConfig, runIssueBodyFetch, runIssueComment, runIssueStatusTransition, runPrStateFetch } from "../services/issue-status.mjs";
import { deciderTimeoutMs, resolveDeciderCommand, runDeciderCommand } from "../services/decision-command.mjs";
import { childIssueBody, childIssueTitle, extractProjectFieldsBlock, runChildIssueCreate, spawnIssuesConfig } from "../services/auto-run-spawn.mjs";
import { refreshPrDispositions } from "../services/auto-run-eval.mjs";
import { judgeTimeoutMs, resolveJudgeCommand, runAcceptanceJudge } from "../services/auto-run-judge.mjs";
import { decisionConfig } from "../services/auto-run-decision.mjs";
import { autoRunSettingsEnvOverlay } from "../services/auto-run-config.mjs";
import { createTerminalService } from "../services/terminal.mjs";
import { createToolService } from "../services/tools.mjs";

export function createServerRuntimeServices({
  namespace,
  protocolVersion,
  state,
  defaultProject,
  defaultProjectPath,
  persistenceEnabled,
  stateStorePath,
  stateSchemaVersion,
  dispatchLeaseMs,
  now,
}) {
  let idCounter = 1;
  let invocationService = null;
  let codexEventHandlers = {
    createCodexEvidenceRecord: () => null,
    updateCodexSessionFromEvent: () => null,
  };

  const {
    persistStateSoon,
    persistStateNow,
    restorePersistentState,
    savePersistentState,
  } = createPersistenceRuntime({
    state,
    enabled: persistenceEnabled,
    stateStorePath,
    schemaVersion: stateSchemaVersion,
    now,
    defaultProject,
    sameProjectPath,
  });
  restorePersistentState();
  idCounter = nextIdCounterAfterState(state);

  const { appendEvent } = createEventLogRuntime({
    state,
    now,
    nextId,
    persistStateSoon,
    getCodexEventHandlers: () => codexEventHandlers,
  });
  const {
    issueBridgeCredential,
    requireBridgeCredential,
  } = createBridgeCredentialRuntime({ state, now, persistStateSoon });

  const {
    addProject,
    cloneProject,
    createBlankProject,
    commitWorktreeChanges,
    createWorktree,
    currentProject,
    gitProjectSummary,
    projectBranches,
    publishWorktreeBranch,
    createWorktreePr,
    worktreeDiff,
    projectGithubItems,
    projectForInvocation,
    readProjectTree,
    removeProject,
    removeWorktree,
    searchProjectContent,
    selectProject,
    updateProject,
    worktreeForProject,
  } = createProjectService({ state, now, nextId, appendEvent, persistStateSoon });

  const {
    createAgentSkill,
    updateAgentSkill,
    deleteAgentSkill,
  } = createAgentSkillService({ state, now, nextId, persistStateSoon });

  const {
    findApplication,
    invokeApplicationCapability,
    listApplicationCapabilities,
    listApplications,
    planApplicationWrapperInvocation,
    probeApplication,
    registerApplication,
    transitionApplication,
  } = createApplicationService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    addProject,
    cloneProject,
    defaultProjectPath,
  });

  const {
    completeHealthCheck,
    createAgentHealthCheck,
    disableAgent,
    enableAgent,
    findAgent,
    markHealthCheckStarted,
    nextBridgeHealthCheck,
    registerAgent,
  } = createAgentService({ state, now, nextId, appendEvent, persistStateSoon });

  const {
    closeCodexSession,
    codexApprovalQueue,
    codexSessionForInvocation,
    createCodexChangeReview,
    createCodexEvidenceRecord,
    createCodexImportedEvidenceRecord,
    createManagedCodexSession,
    createManagedCodexWorkspace,
    expireCodexApprovalBrokerRequests: expireCodexApprovalBrokerRequestsBase,
    normalizeCodexApprovalMode,
    normalizeCodexSessionMode,
    normalizeCodexWorkspacePolicy,
    recordCodexHookEvent,
    repoPathForEvidence,
    resolveCodexApprovalBrokerRequest: resolveCodexApprovalBrokerRequestBase,
    resolveResumeCodexSessionId,
    updateCodexSessionFromEvent,
  } = createCodexService({
    state,
    now,
    nextId,
    appendEvent,
    currentProject,
    findInvocation,
    persistStateSoon,
    uniqueStrings,
    worktreeForProject,
  });
  codexEventHandlers = {
    createCodexEvidenceRecord,
    updateCodexSessionFromEvent,
  };

  const {
    createManagedTerminalSession,
    createSshConnectionTest,
    createSshTarget,
    nextTerminalBridgeAction,
    queueTerminalBridgeAction,
    recordTerminalBridgeEvent,
    recordTerminalEvidence,
  } = createTerminalService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    summarizeText,
    uniqueStrings,
    codexSessionForInvocation,
  });

  const {
    chargebackExport,
    completeLifecycleAction,
    createAuditExportRequest,
    createPrivateCatalogEntry,
    createSignedBundleManifest,
    createLifecycleRecipe,
    createQuotaPolicy,
    decideLifecycleLocalApproval,
    evaluateLifecyclePolicy,
    enforcePlatformAiQuota,
    budgetStatusFor,
    budgetStatuses,
    budgetGateForProject,
    findLifecycleLocalApproval,
    findLifecycleRollbackRequest,
    findLifecycleRecipe,
    findPrivateCatalogEntry,
    ledgerSummary,
    markLifecycleActionStarted,
    nextBridgeLifecycleAction,
    queueLifecycleAction,
    queueRollbackAction,
    recordAiUsage,
    recordInvocationLedgerEntry,
    requestLifecycleLocalApproval,
    transitionLifecycleRecipe,
    updatePrivateDeploymentConfig,
    upsertBudget,
  } = createM3Service({
    state,
    now,
    nextId,
    appendEvent,
    findAgent,
    persistStateSoon,
  });
  const { recordCcusageImportedEstimates } = createCcusageImportService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
  });
  const { recordCodexReviewFindings } = createCodexReviewImportService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
  });
  const { recordClaudeReviewFindings } = createClaudeReviewImportService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
  });

  // Late-bound so completion can trigger the auto-run reaction, which is created
  // below (it needs createInvocation from this very service). Set after the
  // auto-run service exists; until then completion has nothing to advance.
  let advanceAutoRunHook = null;
  let approvalAutoRunHook = null;

  invocationService = createInvocationService({
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
    uniqueStrings,
    normalizeCodexApprovalMode,
    normalizeCodexSessionMode,
    normalizeCodexWorkspacePolicy,
    createManagedCodexWorkspace,
    createManagedCodexSession,
    resolveResumeCodexSessionId,
    closeCodexSession,
    budgetGateForProject,
    onInvocationCompleted: (invocation) => advanceAutoRunHook?.(invocation),
    onInvocationApproved: (invocation) => approvalAutoRunHook?.(invocation),
  });

  const {
    acknowledgeInvocation,
    approveInvocation,
    cancelInvocation,
    cancelInvocationsForDeviceUnlink,
    completeInvocation,
    createCompareRun,
    createInvocation,
    createTroubleshootingReport,
    denyInvocation,
    getAgentUsageSummary,
    markDispatched,
    nextDispatchableInvocation,
    redeliverExpiredDispatches,
    startInvocationIfAllowed,
  } = invocationService;

  // Persisted safe-knob overrides (state.autoRunSettings) overlaid on the env
  // defaults. Empty settings => the env values unchanged. Applied here at
  // composer time, so console edits take effect on the next server start.
  const autoRunEnv = autoRunSettingsEnvOverlay(state.autoRunSettings);

  const { startAutoRun, advanceAutoRunForInvocation, syncAutoRunOnApproval, retryAutoRun } = createAutoRunService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    createWorktree,
    findAgent,
    defaultAgent,
    createInvocation,
    startInvocationIfAllowed,
    commitWorktreeChanges,
    publishWorktreeBranch,
    createWorktreePr,
    // Verification gate: run the project-configured command in the worktree.
    // No command configured -> unverified pass-through (PR labeled unverified);
    // a configured command that fails blocks the PR.
    verifyWorktree: async ({ worktree }) => {
      const command = resolveAutoRunVerifyCommand();
      if (!command || !worktree?.path) {
        return { passed: true, verified: false, summary: "No verification command configured — PR opened unverified." };
      }
      return runWorktreeVerification({ cwd: worktree.path, command });
    },
    // Issue status writeback (ready -> in-progress -> review). Undefined when
    // disabled so the orchestrator skips it entirely — no GitHub writes by default.
    writeIssueStatus: resolveStatusWritebackConfig(autoRunEnv).enabled
      ? async ({ issueNumber, repoPath, to }) => runIssueStatusTransition({ cwd: repoPath, issueNumber, to })
      : undefined,
    // Post an investigation auto-run's findings back to the issue. Gated by the
    // same GitHub-write opt-in; undefined (off) still sets report_posted locally.
    postIssueReport: resolveStatusWritebackConfig(autoRunEnv).enabled
      ? async ({ issueNumber, repoPath, body }) => runIssueComment({ cwd: repoPath, issueNumber, body })
      : undefined,
    // Decision step (ISSUE_DECISION_AGENT_PLAN.md slice 3): an operator-configured
    // one-shot command (any LLM CLI/script; issue context JSON on stdin, decision
    // JSON on stdout). Unconfigured -> undefined -> the heuristic floor decides,
    // byte-compatible with the previous intent routing.
    decideIssuePath: (() => {
      const command = resolveDeciderCommand(autoRunEnv);
      return command
        ? async ({ link, issueBody }) => runDeciderCommand({ command, input: { link, issueBody }, timeoutMs: deciderTimeoutMs(autoRunEnv) })
        : undefined;
    })(),
    // Decision confidence gate + fast-path (settings overlaid on env); passed so
    // startAutoRun's resolveDecision honors the console-saved thresholds.
    decisionSettings: decisionConfig(autoRunEnv),
    // Read-only issue body fetch: context for the decision and the role prompt.
    fetchIssueBody: async ({ issueNumber, repoPath }) => runIssueBodyFetch({ cwd: repoPath, issueNumber }),
    // Governed child-issue spawning (slice 4): a design deliverable becomes a
    // pending-decision child issue (parent fields inherited, never auto-labelled,
    // depth-1 marked). Off by default; undefined -> the orchestrator skips it.
    spawnChildIssue: spawnIssuesConfig(autoRunEnv).enabled
      ? async ({ parentLink, design, repoPath }) => {
          const parentBody = await runIssueBodyFetch({ cwd: repoPath, issueNumber: parentLink.number });
          return runChildIssueCreate({
            cwd: repoPath,
            title: childIssueTitle(parentLink),
            body: childIssueBody({ parentLink, design, projectFieldsBlock: extractProjectFieldsBlock(parentBody) }),
          });
        }
      : undefined,
    // Acceptance judge (Phase B): operator-configured one-shot command judging
    // "does this diff solve this issue?". Unconfigured -> undefined -> skipped.
    judgeAcceptance: (() => {
      const command = resolveJudgeCommand(autoRunEnv);
      return command
        ? async ({ worktree, autoRun }) => {
            const diff = worktreeDiff(worktree)?.diff ?? "";
            const issueBody = autoRun.link?.type === "issue" && worktree?.repoPath
              ? await runIssueBodyFetch({ cwd: worktree.repoPath, issueNumber: autoRun.link.number })
              : null;
            return runAcceptanceJudge({ command, link: autoRun.link, issueBody, diff, timeoutMs: judgeTimeoutMs(autoRunEnv) });
          }
        : undefined;
    })(),
  });
  // Now that the reaction exists, let completion drive it.
  advanceAutoRunHook = advanceAutoRunForInvocation;
  approvalAutoRunHook = syncAutoRunOnApproval;

  // Routing-evaluation disposition refresh (slice 5): bounded, throttled,
  // read-only gh; persists only when something changed.
  async function refreshAutoRunPrDispositions() {
    const result = await refreshPrDispositions({
      state,
      now,
      fetchPrState: ({ prNumber, repoPath }) => runPrStateFetch({ cwd: repoPath, prNumber }),
    });
    if (result.updated > 0) persistStateSoon();
    return result;
  }

  const {
    completeDiscoveryRun,
    completeIntegrationProbeRun,
    createAgentDryProbeRun,
    createDiscoveryRun,
    createIntegrationArtifact,
    createIntegrationProbeRun,
    draftIntegrationWithPlatformAgent,
    findDiscoveryRun,
    findIntegrationArtifact,
    findIntegrationProbeRun,
    generateIntegrationArtifacts,
    markDiscoveryStarted,
    markIntegrationProbeStarted,
    nextBridgeDiscoveryRun,
    nextBridgeProbeRun,
    registerDiscoveredCandidate,
    registerIntegrationArtifact,
    transitionIntegrationArtifact,
    updateIntegrationRetentionSettings,
  } = createIntegrationService({
    state,
    now,
    nextId,
    appendEvent,
    completeInvocation,
    createInvocation,
    disableAgent,
    findAgent,
    registerAgent,
    persistStateSoon,
  });

  const {
    currentLoopRoutineProjectContext,
    evidenceCenterRecords,
    publicState,
  } = createReadModelRuntime({
    namespace,
    protocolVersion,
    state,
    defaultProjectPath,
    currentProject,
    defaultAgent,
    codexApprovalQueue,
    codexSessionForInvocation,
    findInvocation,
    repoPathForEvidence,
    ledgerSummary,
    budgetStatuses,
    expireCodexApprovalBrokerRequests,
  });

  const {
    createToolInvocation,
    getTool,
    listTools,
  } = createToolService({
    state,
    now,
    appendEvent,
    createInvocation,
    startInvocationIfAllowed,
    findApplication,
    findAgent,
    planApplicationWrapperInvocation,
  });

  const {
    createCapabilityInvocation,
    getCapability,
    listCapabilities,
  } = createCapabilityService({
    state,
    listTools,
    getTool,
    createToolInvocation,
    createInvocation,
    completeInvocation,
    findAgent,
    listApplications,
    listApplicationCapabilities,
    invokeApplicationCapability,
    planApplicationWrapperInvocation,
  });

  function runApplicationOrchestration(applicationId, routineId, body = {}, actor = null) {
    const application = findApplication(applicationId);
    if (!application) {
      return { status: 404, body: { error: "application_not_found" } };
    }
    const orchestration = (application.orchestrations ?? []).find((item) => item?.routineId === routineId);
    if (!orchestration) {
      return { status: 404, body: { error: "orchestration_not_found", applicationId, routineId } };
    }
    if (application.status === "archived") {
      return { status: 409, body: { error: "application_archived", applicationId } };
    }
    if (application.status !== "active") {
      return { status: 409, body: { error: "application_not_active", applicationId, status: application.status } };
    }
    if (orchestration.status === "invalid" || orchestration.validation?.ok === false) {
      return {
        status: 422,
        body: {
          error: "invalid_application_routine",
          applicationId,
          routineId,
          validation: orchestration.validation ?? null,
        },
      };
    }
    if (!orchestration.path || !isManagedApplicationRoutinePath(application, orchestration.path)) {
      return { status: 422, body: { error: "invalid_orchestration_path", applicationId, routineId } };
    }
    if (!existsSync(orchestration.path)) {
      return { status: 404, body: { error: "orchestration_file_not_found", applicationId, routineId } };
    }

    let routine = null;
    try {
      routine = JSON.parse(readFileSync(orchestration.path, "utf8"));
    } catch (error) {
      return {
        status: 422,
        body: {
          error: "invalid_application_routine",
          message: error instanceof Error ? error.message : String(error),
          applicationId,
          routineId,
        },
      };
    }
    const validation = validateApplicationRoutineDraft(routine, {
      root: dirname(orchestration.path),
      application,
    });
    if (!validation.ok) {
      return {
        status: 422,
        body: {
          error: "invalid_application_routine",
          applicationId,
          routineId,
          validation,
        },
      };
    }

    const agentId = typeof body?.agentId === "string" && body.agentId.trim()
      ? body.agentId.trim()
      : null;
    const agent = agentId ? findAgent(agentId) : defaultAgent();
    if (!agent) {
      return { status: 404, body: { error: "agent_not_found" } };
    }
    if (agent.status === "disabled") {
      return { status: 409, body: { error: "agent_disabled", agentId: agent.id } };
    }
    if (agent.health?.status === "unhealthy") {
      return {
        status: 409,
        body: { error: "agent_unhealthy", agentId: agent.id, message: agent.health.message },
      };
    }
    if (agent.location?.type === "local_device" && state.device.unlinkState !== "linked") {
      return { status: 409, body: { error: "device_unlinked", agentId: agent.id } };
    }
    const retryOfInvocationId = typeof body?.retryOfInvocationId === "string" && body.retryOfInvocationId.trim()
      ? body.retryOfInvocationId.trim()
      : null;
    if (retryOfInvocationId) {
      const retryOfInvocation = findInvocation(retryOfInvocationId);
      if (!retryOfInvocation || !isApplicationOrchestrationRun(retryOfInvocation, application.id, routineId)) {
        return { status: 404, body: { error: "orchestration_run_not_found", applicationId, routineId, invocationId: retryOfInvocationId } };
      }
    }
    const retryReason = retryOfInvocationId
      ? summarizeText(body?.retryReason ?? "Manual application orchestration retry.", 160)
      : null;
    const invocation = createInvocation(applicationRoutineTask({ application, orchestration, routine, validation }), agent, {
      actor,
      requestedBy: actor?.userId,
      metadata: {
        source: "application_orchestration",
        applicationId: application.id,
        applicationName: application.name,
        routineId,
        routineName: routine.metadata?.name ?? null,
        orchestrationPath: orchestration.path ?? null,
        orchestrationRelativePath: orchestration.relativePath ?? null,
        projectId: application.projectId ?? null,
        routineValidationOk: validation.ok,
        retryOfInvocationId,
        retryReason,
        recoveryActionType: typeof body?.recoveryActionType === "string" ? body.recoveryActionType : null,
        recoveryOfInvocationId: typeof body?.recoveryOfInvocationId === "string" ? body.recoveryOfInvocationId : null,
        recoveryReason: typeof body?.recoveryReason === "string" ? summarizeText(body.recoveryReason, 160) : null,
        recoveryCategory: typeof body?.recoveryCategory === "string" ? body.recoveryCategory : null,
      },
      timeoutSeconds: Number(body?.timeoutSeconds ?? 30),
    });
    startInvocationIfAllowed(invocation, agent);
    appendEvent({
      invocationId: invocation.id,
      type: "application_orchestration_run_requested",
      level: "info",
      message: retryOfInvocationId
        ? `${application.name} application orchestration ${routineId} retry requested.`
        : `${application.name} application orchestration ${routineId} run requested.`,
      data: { applicationId: application.id, routineId, retryOfInvocationId, retryReason },
    });
    return {
      status: 201,
      body: {
        applicationId: application.id,
        routineId,
        invocationId: invocation.id,
        agentId: agent.id,
        status: invocation.status,
        invocation,
      },
    };
  }

  function listApplicationOrchestrationRuns(applicationId, routineId, searchParams = new URLSearchParams()) {
    const scope = applicationOrchestrationScope(applicationId, routineId);
    if (scope.status !== 200) return scope;
    const limit = clampNumber(searchParams?.get?.("limit") ?? 10, 1, 50);
    const runs = state.invocations
      .filter((invocation) => isApplicationOrchestrationRun(invocation, applicationId, routineId))
      .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? ""))
      .slice(0, limit)
      .map(applicationOrchestrationRunSummary);
    return {
      status: 200,
      body: {
        applicationId,
        routineId,
        runs,
      },
    };
  }

  function getApplicationOrchestrationRun(applicationId, routineId, invocationId) {
    const run = getScopedApplicationOrchestrationInvocation(applicationId, routineId, invocationId);
    if (run.status !== 200) return run;
    return {
      status: 200,
      body: {
        applicationId,
        routineId,
        run: applicationOrchestrationRunDetail(run.invocation),
      },
    };
  }

  function listApplicationOrchestrationRunEvents(applicationId, routineId, invocationId) {
    const run = getScopedApplicationOrchestrationInvocation(applicationId, routineId, invocationId);
    if (run.status !== 200) return run;
    const events = applicationOrchestrationRunEvents(invocationId)
      .map((event) => ({
        id: event.id,
        invocationId: event.invocationId,
        type: event.type,
        level: event.level,
        message: event.message,
        data: event.data ?? null,
        createdAt: event.createdAt,
      }));
    return {
      status: 200,
      body: {
        applicationId,
        routineId,
        invocationId,
        events,
      },
    };
  }

  function getApplicationOrchestrationRunRecovery(applicationId, routineId, invocationId) {
    const run = getScopedApplicationOrchestrationInvocation(applicationId, routineId, invocationId);
    if (run.status !== 200) return run;
    const events = applicationOrchestrationRunEvents(invocationId);
    const recoveryActions = applicationRecoveryActionsForRun(applicationId, routineId, invocationId);
    return {
      status: 200,
      body: {
        applicationId,
        routineId,
        invocationId,
        recovery: applicationOrchestrationRecovery(run.invocation, events, recoveryActions),
      },
    };
  }

  function listApplicationOrchestrationRecoveryAgentCandidates(applicationId, routineId, invocationId) {
    const run = getScopedApplicationOrchestrationInvocation(applicationId, routineId, invocationId);
    if (run.status !== 200) return run;
    const recoveryModel = applicationOrchestrationRecovery(
      run.invocation,
      applicationOrchestrationRunEvents(invocationId),
      applicationRecoveryActionsForRun(applicationId, routineId, invocationId),
    );
    const candidateViews = recoveryAgentCandidateViews(run.invocation);
    return {
      status: 200,
      body: {
        applicationId,
        routineId,
        invocationId,
        recoveryCategory: recoveryModel.category,
        sourceAgentId: run.invocation.agentId ?? null,
        preferredAgentId: candidateViews.find((candidate) => candidate.preferred)?.id ?? null,
        candidates: candidateViews,
      },
    };
  }

  function requestApplicationOrchestrationRecoveryAction(applicationId, routineId, invocationId, body = {}, actor = null) {
    const run = getScopedApplicationOrchestrationInvocation(applicationId, routineId, invocationId);
    if (run.status !== 200) return run;
    const actionType = typeof body?.actionType === "string" ? body.actionType.trim() : "";
    if (!actionType) {
      return { status: 400, body: { error: "invalid_recovery_action", message: "actionType is required." } };
    }
    const events = applicationOrchestrationRunEvents(invocationId);
    const recoveryModel = applicationOrchestrationRecovery(
      run.invocation,
      events,
      applicationRecoveryActionsForRun(applicationId, routineId, invocationId),
    );
    const selectedAction = recoveryModel.actions.find((item) => item.type === actionType);
    if (!selectedAction) {
      appendRecoveryActionEvent("rejected", invocationId, applicationId, routineId, actionType, recoveryModel.category, "action_not_suggested");
      return {
        status: 400,
        body: {
          error: "recovery_action_not_suggested",
          applicationId,
          routineId,
          invocationId,
          actionType,
          explanation: applicationRecoveryActionExplanation(null, {
            actionType,
            recoveryModel,
            status: "rejected",
            reason: "action_not_suggested",
          }),
        },
      };
    }
    if (selectedAction.availability?.state === "blocked") {
      const blockedReason = selectedAction.blockedReason ?? selectedAction.availability.blockedReason ?? "recovery_action_blocked";
      const latestRequestId = selectedAction.latestRequestId ?? selectedAction.availability.latestRequestId ?? null;
      appendRecoveryActionEvent("rejected", invocationId, applicationId, routineId, actionType, recoveryModel.category, blockedReason);
      return {
        status: 409,
        body: {
          error: "recovery_action_blocked",
          applicationId,
          routineId,
          invocationId,
          actionType,
          blockedReason,
          latestRequestId,
          action: selectedAction,
          explanation: applicationRecoveryActionExplanation(null, {
            action: selectedAction,
            recoveryModel,
            status: "blocked",
            blockedReason,
            latestRequestId,
          }),
        },
      };
    }
    const reason = summarizeText(body?.reason ?? selectedAction.description ?? recoveryModel.summary, 160);
    const actionRequest = createApplicationRecoveryActionRequest({
      applicationId,
      routineId,
      invocationId,
      action: selectedAction,
      recoveryCategory: recoveryModel.category,
      reason,
      actor,
    });
    if (selectedAction.requiresApproval && !isApplicationActionApproved(body?.approvalToken)) {
      const approvalRequest = createApplicationRecoveryApprovalRequest(run.invocation, actionRequest, selectedAction, recoveryModel, actor);
      actionRequest.status = approvalRequest.status === "approved" ? "approval_approved" : approvalRequest.status === "denied" ? "approval_denied" : "approval_pending";
      actionRequest.approvalRequestId = approvalRequest.id;
      actionRequest.updatedAt = now();
      persistStateSoon();
      appendRecoveryActionEvent("approval_pending", invocationId, applicationId, routineId, actionType, recoveryModel.category, reason, actionRequest);
      return {
        status: 202,
        body: {
          applicationId,
          routineId,
          invocationId,
          action: selectedAction,
          recoveryActionRequest: actionRequest,
          approvalRequest,
          status: "approval_pending",
          explanation: applicationRecoveryActionExplanation(actionRequest, {
            action: selectedAction,
            recoveryModel,
            status: "approval_pending",
          }),
        },
      };
    }
    if (actionType === "view_invocation") {
      actionRequest.status = "noop";
      actionRequest.updatedAt = now();
      persistStateSoon();
      appendRecoveryActionEvent("requested", invocationId, applicationId, routineId, actionType, recoveryModel.category, reason, actionRequest);
      return {
        status: 200,
        body: {
          applicationId,
          routineId,
          invocationId,
          action: selectedAction,
          recoveryActionRequest: actionRequest,
          status: "noop",
          explanation: applicationRecoveryActionExplanation(actionRequest, {
            action: selectedAction,
            recoveryModel,
            status: "noop",
          }),
        },
      };
    }
    if (actionType === "regenerate_orchestration") {
      appendRecoveryActionEvent("requested", invocationId, applicationId, routineId, actionType, recoveryModel.category, reason, actionRequest);
      executeApprovedApplicationRecoveryAction(actionRequest, actor);
      if (actionRequest.status === "failed") {
        return {
          status: 500,
          body: {
            error: "recovery_action_execution_failed",
            applicationId,
            routineId,
            invocationId,
            actionType,
            recoveryActionRequest: actionRequest,
            explanation: applicationRecoveryActionExplanation(actionRequest, {
              action: selectedAction,
              recoveryModel,
              status: "failed",
            }),
          },
        };
      }
      return {
        status: 201,
        body: {
          applicationId,
          routineId,
          invocationId,
          action: selectedAction,
          recoveryActionRequest: actionRequest,
          status: actionRequest.status,
          explanation: applicationRecoveryActionExplanation(actionRequest, {
            action: selectedAction,
            recoveryModel,
          }),
        },
      };
    }
    if (actionType === "select_agent") {
      actionRequest.requestedAgentId = typeof body?.agentId === "string" && body.agentId.trim()
        ? body.agentId.trim()
        : null;
      actionRequest.agentCandidateSnapshot = recoveryAgentCandidateSnapshot(run.invocation, actionRequest.requestedAgentId);
      const selectedAgent = selectRecoveryAgent(run.invocation, body);
      if (!selectedAgent.ok) {
        actionRequest.status = "failed";
        actionRequest.error = selectedAgent.error;
        actionRequest.updatedAt = now();
        persistStateSoon();
        appendRecoveryActionEvent("rejected", invocationId, applicationId, routineId, actionType, recoveryModel.category, selectedAgent.error, actionRequest);
        return {
          status: selectedAgent.status,
          body: {
            error: selectedAgent.error,
            applicationId,
            routineId,
            invocationId,
            actionType,
            recoveryActionRequest: actionRequest,
            explanation: applicationRecoveryActionExplanation(actionRequest, {
              action: selectedAction,
              recoveryModel,
              status: "failed",
            }),
          },
        };
      }
      appendRecoveryActionEvent("requested", invocationId, applicationId, routineId, actionType, recoveryModel.category, reason, actionRequest);
      const result = runApplicationOrchestration(applicationId, routineId, {
        agentId: selectedAgent.agent.id,
        timeoutSeconds: body?.timeoutSeconds,
        retryOfInvocationId: invocationId,
        retryReason: reason,
        recoveryActionType: actionType,
        recoveryOfInvocationId: invocationId,
        recoveryReason: reason,
        recoveryCategory: recoveryModel.category,
      }, actor);
      if (result.status >= 400) {
        actionRequest.status = "failed";
        actionRequest.error = result.body?.error ?? "run_failed";
        actionRequest.updatedAt = now();
        persistStateSoon();
        appendRecoveryActionEvent("rejected", invocationId, applicationId, routineId, actionType, recoveryModel.category, actionRequest.error, actionRequest);
        return {
          ...result,
          body: {
            ...result.body,
            recoveryActionRequest: actionRequest,
            explanation: applicationRecoveryActionExplanation(actionRequest, {
              action: selectedAction,
              recoveryModel,
              status: "failed",
            }),
          },
        };
      }
      actionRequest.status = "executed";
      actionRequest.selectedAgentId = selectedAgent.agent.id;
      actionRequest.resultInvocationId = result.body?.invocationId ?? null;
      actionRequest.executedAt = now();
      actionRequest.updatedAt = actionRequest.executedAt;
      persistStateSoon();
      appendEvent({
        invocationId,
        type: "application_orchestration_recovery_action_executed",
        level: "info",
        message: `Application orchestration recovery action ${actionType} executed.`,
        data: {
          applicationId,
          routineId,
          actionType,
          recoveryActionRequestId: actionRequest.id,
          selectedAgentId: actionRequest.selectedAgentId,
          resultInvocationId: actionRequest.resultInvocationId,
        },
      });
      return {
        status: result.status,
        body: {
          ...result.body,
          recoveryActionRequest: actionRequest,
          recoveryAction: {
            actionType,
            selectedAgentId: selectedAgent.agent.id,
            recoveryCategory: recoveryModel.category,
            recoveryOfInvocationId: invocationId,
            recoveryReason: reason,
          },
          explanation: applicationRecoveryActionExplanation(actionRequest, {
            action: selectedAction,
            recoveryModel,
          }),
        },
      };
    }
    if (actionType !== "rerun") {
      actionRequest.status = "unsupported";
      actionRequest.updatedAt = now();
      persistStateSoon();
      appendRecoveryActionEvent("rejected", invocationId, applicationId, routineId, actionType, recoveryModel.category, "action_not_supported", actionRequest);
      return {
        status: 501,
        body: {
          error: "recovery_action_not_supported",
          applicationId,
          routineId,
          invocationId,
          actionType,
          recoveryActionRequest: actionRequest,
          explanation: applicationRecoveryActionExplanation(actionRequest, {
            action: selectedAction,
            recoveryModel,
            status: "unsupported",
          }),
        },
      };
    }
    appendRecoveryActionEvent("requested", invocationId, applicationId, routineId, actionType, recoveryModel.category, reason, actionRequest);
    const result = runApplicationOrchestration(applicationId, routineId, {
      agentId: typeof body?.agentId === "string" ? body.agentId : null,
      timeoutSeconds: body?.timeoutSeconds,
      retryOfInvocationId: invocationId,
      retryReason: reason,
      recoveryActionType: actionType,
      recoveryOfInvocationId: invocationId,
      recoveryReason: reason,
      recoveryCategory: recoveryModel.category,
    }, actor);
    if (result.status >= 400) {
      actionRequest.status = "failed";
      actionRequest.updatedAt = now();
      persistStateSoon();
      appendRecoveryActionEvent("rejected", invocationId, applicationId, routineId, actionType, recoveryModel.category, result.body?.error ?? "run_failed", actionRequest);
      return {
        ...result,
        body: {
          ...result.body,
          recoveryActionRequest: actionRequest,
          explanation: applicationRecoveryActionExplanation(actionRequest, {
            action: selectedAction,
            recoveryModel,
            status: "failed",
          }),
        },
      };
    }
    actionRequest.status = "executed";
    actionRequest.resultInvocationId = result.body?.invocationId ?? null;
    actionRequest.executedAt = now();
    actionRequest.updatedAt = actionRequest.executedAt;
    persistStateSoon();
    return {
      status: result.status,
      body: {
        ...result.body,
        recoveryActionRequest: actionRequest,
        recoveryAction: {
          actionType,
          recoveryCategory: recoveryModel.category,
          recoveryOfInvocationId: invocationId,
          recoveryReason: reason,
        },
        explanation: applicationRecoveryActionExplanation(actionRequest, {
          action: selectedAction,
          recoveryModel,
        }),
      },
    };
  }

  function applicationRecoveryActionExplanation(actionRequest = null, options = {}) {
    const actionType = actionRequest?.actionType ?? options.action?.type ?? options.actionType ?? null;
    const status = options.status ?? actionRequest?.status ?? "requested";
    const blockedReason = options.blockedReason ?? options.action?.blockedReason ?? options.action?.availability?.blockedReason ?? null;
    const latestRequestId = options.latestRequestId ?? options.action?.latestRequestId ?? options.action?.availability?.latestRequestId ?? null;
    const reason = options.reason ?? actionRequest?.error ?? blockedReason ?? actionRequest?.reason ?? null;
    const state = recoveryExplanationState(status, blockedReason);
    return {
      selectedAction: actionType,
      state,
      reason: recoveryExplanationReason(state, reason),
      summary: recoveryExplanationSummary(state, actionType, reason),
      nextStep: recoveryExplanationNextStep(state, blockedReason),
      recoveryCategory: actionRequest?.recoveryCategory ?? options.recoveryModel?.category ?? null,
      blockedReason,
      latestRequestId,
      recoveryActionRequestId: actionRequest?.id ?? null,
      approvalRequestId: actionRequest?.approvalRequestId ?? null,
      requestedAgentId: actionRequest?.requestedAgentId ?? null,
      selectedAgentId: actionRequest?.selectedAgentId ?? null,
      resultInvocationId: actionRequest?.resultInvocationId ?? null,
      resultOrchestrationId: actionRequest?.resultOrchestrationId ?? null,
      resultOrchestrationRelativePath: actionRequest?.resultOrchestrationRelativePath ?? null,
    };
  }

  function recoveryExplanationState(status, blockedReason) {
    if (blockedReason || status === "blocked") return "blocked";
    if (status === "noop") return "no_result_expected";
    if (status === "approval_pending") return "approval_pending";
    if (status === "approval_denied" || status === "approval_timed_out") return status;
    if (status === "unsupported") return "unsupported";
    if (status === "failed") return "failed";
    if (status === "executed") return "executed";
    if (status === "executing") return "executing";
    if (status === "rejected") return "rejected";
    return "requested";
  }

  function recoveryExplanationReason(state, reason) {
    if (state === "no_result_expected") return "no_result_expected";
    if (state === "executed") return "execution_completed";
    if (state === "executing") return "execution_in_progress";
    if (state === "requested") return "recovery_requested";
    return reason ?? state;
  }

  function recoveryExplanationSummary(state, actionType, reason) {
    const action = actionType ?? "recovery";
    if (state === "blocked") return `Recovery action ${action} is blocked: ${reason ?? "recovery_action_blocked"}.`;
    if (state === "approval_pending") return `Recovery action ${action} is waiting for approval.`;
    if (state === "no_result_expected") return `Recovery action ${action} records inspection only and does not create a result.`;
    if (state === "executed") return `Recovery action ${action} executed successfully.`;
    if (state === "failed") return `Recovery action ${action} failed: ${reason ?? "execution_failed"}.`;
    if (state === "unsupported") return `Recovery action ${action} is not supported.`;
    if (state === "rejected") return `Recovery action ${action} was rejected: ${reason ?? "rejected"}.`;
    if (state === "executing") return `Recovery action ${action} is executing.`;
    return `Recovery action ${action} was requested.`;
  }

  function recoveryExplanationNextStep(state, blockedReason) {
    if (state === "blocked") {
      return blockedReason === "same_action_approval_pending"
        ? "Resolve the latest approval request before requesting this action again."
        : "Wait for the in-progress recovery action to finish before requesting this action again.";
    }
    if (state === "approval_pending") return "Resolve the linked approval request before this recovery can execute.";
    if (state === "no_result_expected") return "Inspect the source invocation evidence.";
    if (state === "executed") return "Inspect the recovery result and continue with the recovered orchestration.";
    if (state === "failed") return "Review the failure details and choose another recovery action.";
    if (state === "unsupported" || state === "rejected") return "Choose one of the currently suggested recovery actions.";
    if (state === "executing" || state === "requested") return "Wait for the recovery action to finish, then inspect the result.";
    return "Review the recovery action audit trail.";
  }

  function createApplicationRecoveryActionRequest({ applicationId, routineId, invocationId, action, recoveryCategory, reason, actor }) {
    const createdAt = now();
    const request = {
      id: nextId("app_rec"),
      applicationId,
      routineId,
      invocationId,
      actionType: action.type,
      status: "requested",
      recoveryCategory,
      reason,
      requiresApproval: Boolean(action.requiresApproval),
      approvalRequestId: null,
      resultInvocationId: null,
      selectedAgentId: null,
      requestedAgentId: null,
      agentCandidateSnapshot: null,
      resultOrchestrationId: null,
      resultOrchestrationRelativePath: null,
      error: null,
      requestedBy: actor?.userId ?? "usr_local",
      decidedAt: null,
      executedAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    state.applicationRecoveryActions.unshift(request);
    state.applicationRecoveryActions = state.applicationRecoveryActions.slice(0, 200);
    persistStateSoon();
    return request;
  }

  function createApplicationRecoveryApprovalRequest(invocation, actionRequest, action, recoveryModel) {
    const createdAt = now();
    const request = {
      id: nextId("cdx_appr"),
      invocationId: invocation.id,
      codexSessionRegistryId: null,
      hookEventId: null,
      toolName: `application.recovery.${action.type}`,
      summary: summarizeText(actionRequest.reason || action.description || recoveryModel.summary, 240),
      riskLevel: "high",
      status: "pending",
      timeoutAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      decision: null,
      decidedAt: null,
      notificationState: "queued",
      approvalMode: "ask",
      createdAt,
      updatedAt: createdAt,
      source: "application_recovery_action",
      applicationRecoveryActionRequestId: actionRequest.id,
    };
    state.codexApprovalBrokerRequests.unshift(request);
    state.codexApprovalBrokerRequests = state.codexApprovalBrokerRequests.slice(0, 200);
    persistStateSoon();
    appendEvent({
      invocationId: invocation.id,
      type: "application_orchestration_recovery_approval_requested",
      level: "warn",
      message: `Application orchestration recovery action ${action.type} is waiting for approval.`,
      data: {
        applicationId: actionRequest.applicationId,
        routineId: actionRequest.routineId,
        actionType: action.type,
        recoveryCategory: recoveryModel.category,
        recoveryActionRequestId: actionRequest.id,
        approvalBrokerRequestId: request.id,
      },
    });
    return request;
  }

  function resolveCodexApprovalBrokerRequest(request, action, actor = null) {
    const updated = resolveCodexApprovalBrokerRequestBase(request, action);
    syncApplicationRecoveryActionApproval(updated, actor);
    return updated;
  }

  function expireCodexApprovalBrokerRequests() {
    expireCodexApprovalBrokerRequestsBase();
    for (const request of state.codexApprovalBrokerRequests) {
      if (request?.applicationRecoveryActionRequestId) {
        syncApplicationRecoveryActionApproval(request);
      }
    }
  }

  function syncApplicationRecoveryActionApproval(approvalRequest, actor = null) {
    const requestId = approvalRequest?.applicationRecoveryActionRequestId;
    if (!requestId) return;
    const actionRequest = state.applicationRecoveryActions.find((item) => item.id === requestId);
    if (!actionRequest) return;
    if (["executing", "executed", "failed"].includes(actionRequest.status)) return;
    const previousStatus = actionRequest.status;
    let nextStatus = "approval_pending";
    if (approvalRequest.status === "approved") {
      nextStatus = "approval_approved";
    } else if (approvalRequest.status === "denied") {
      nextStatus = "approval_denied";
    } else if (approvalRequest.status === "timed_out") {
      nextStatus = "approval_timed_out";
    }
    if (previousStatus === nextStatus) return;
    actionRequest.status = nextStatus;
    actionRequest.decidedAt = approvalRequest.decidedAt ?? actionRequest.decidedAt ?? null;
    actionRequest.updatedAt = now();
    persistStateSoon();
    if (approvalRequest.status === "pending") return;
    appendEvent({
      invocationId: actionRequest.invocationId,
      type: "application_orchestration_recovery_approval_resolved",
      level: approvalRequest.status === "approved" ? "info" : "warn",
      message: `Application orchestration recovery action ${actionRequest.actionType} approval ${approvalRequest.status}.`,
      data: {
        applicationId: actionRequest.applicationId,
        routineId: actionRequest.routineId,
        actionType: actionRequest.actionType,
        recoveryActionRequestId: actionRequest.id,
        approvalBrokerRequestId: approvalRequest.id,
        status: approvalRequest.status,
      },
    });
    if (approvalRequest.status === "approved") {
      executeApprovedApplicationRecoveryAction(actionRequest, actor);
    }
  }

  function executeApprovedApplicationRecoveryAction(actionRequest, actor = null) {
    if (actionRequest.actionType !== "regenerate_orchestration") return;
    if (actionRequest.status === "executed" || actionRequest.status === "executing") return;
    const application = findApplication(actionRequest.applicationId);
    if (!application) {
      markApplicationRecoveryActionFailed(actionRequest, "application_not_found");
      return;
    }
    const capability = (listApplicationCapabilities(actionRequest.applicationId) ?? [])
      .find((item) => item.name.endsWith(".generate_orchestration"));
    if (!capability) {
      markApplicationRecoveryActionFailed(actionRequest, "capability_not_found");
      return;
    }
    actionRequest.status = "executing";
    actionRequest.updatedAt = now();
    persistStateSoon();
    appendEvent({
      invocationId: actionRequest.invocationId,
      type: "application_orchestration_recovery_action_executing",
      level: "info",
      message: `Application orchestration recovery action ${actionRequest.actionType} is executing.`,
      data: {
        applicationId: actionRequest.applicationId,
        routineId: actionRequest.routineId,
        actionType: actionRequest.actionType,
        recoveryActionRequestId: actionRequest.id,
      },
    });
    const result = createCapabilityInvocation(capability.name, {
      approvalToken: "operator-approved-application-recovery",
      recoveryActionRequestId: actionRequest.id,
      recoveryOfInvocationId: actionRequest.invocationId,
      recoveryReason: actionRequest.reason,
    }, actor);
    if (result.status >= 400) {
      markApplicationRecoveryActionFailed(actionRequest, result.body?.error ?? "execution_failed", result.body);
      return;
    }
    const orchestration = result.body?.invocation?.result?.output?.orchestration ?? null;
    actionRequest.status = "executed";
    actionRequest.resultInvocationId = result.body?.invocationId ?? null;
    actionRequest.resultOrchestrationId = orchestration?.id ?? null;
    actionRequest.resultOrchestrationRelativePath = orchestration?.relativePath ?? null;
    actionRequest.executedAt = now();
    actionRequest.updatedAt = actionRequest.executedAt;
    persistStateSoon();
    appendEvent({
      invocationId: actionRequest.invocationId,
      type: "application_orchestration_recovery_action_executed",
      level: "info",
      message: `Application orchestration recovery action ${actionRequest.actionType} executed.`,
      data: {
        applicationId: actionRequest.applicationId,
        routineId: actionRequest.routineId,
        actionType: actionRequest.actionType,
        recoveryActionRequestId: actionRequest.id,
        resultInvocationId: actionRequest.resultInvocationId,
        resultOrchestrationId: actionRequest.resultOrchestrationId,
        resultOrchestrationRelativePath: actionRequest.resultOrchestrationRelativePath,
      },
    });
  }

  function markApplicationRecoveryActionFailed(actionRequest, error, details = null) {
    actionRequest.status = "failed";
    actionRequest.error = summarizeText(error, 160);
    actionRequest.updatedAt = now();
    persistStateSoon();
    appendEvent({
      invocationId: actionRequest.invocationId,
      type: "application_orchestration_recovery_action_failed",
      level: "warn",
      message: `Application orchestration recovery action ${actionRequest.actionType} failed: ${actionRequest.error}.`,
      data: {
        applicationId: actionRequest.applicationId,
        routineId: actionRequest.routineId,
        actionType: actionRequest.actionType,
        recoveryActionRequestId: actionRequest.id,
        error: actionRequest.error,
        details,
      },
    });
  }

  function selectRecoveryAgent(sourceInvocation, body = {}) {
    const requestedAgentId = typeof body?.agentId === "string" && body.agentId.trim()
      ? body.agentId.trim()
      : null;
    const candidates = requestedAgentId
      ? [findAgent(requestedAgentId)].filter(Boolean)
      : orderedRecoveryAgentCandidates();
    if (!candidates.length) {
      return { ok: false, status: 404, error: requestedAgentId ? "agent_not_found" : "healthy_agent_not_found" };
    }
    const preferred = candidates.find((agent) => agent.id !== sourceInvocation.agentId && isAgentSelectableForRecovery(agent))
      ?? candidates.find((agent) => isAgentSelectableForRecovery(agent));
    if (!preferred) {
      const first = candidates[0];
      if (first?.status === "disabled") {
        return { ok: false, status: 409, error: "agent_disabled" };
      }
      if (first?.health?.status === "unhealthy") {
        return { ok: false, status: 409, error: "agent_unhealthy" };
      }
      if (first?.location?.type === "local_device" && state.device.unlinkState !== "linked") {
        return { ok: false, status: 409, error: "device_unlinked" };
      }
      return { ok: false, status: 409, error: "healthy_agent_not_found" };
    }
    return { ok: true, agent: preferred };
  }

  function isAgentSelectableForRecovery(agent) {
    return recoveryAgentSelectability(agent).selectable;
  }

  function recoveryAgentCandidateViews(sourceInvocation) {
    const candidates = orderedRecoveryAgentCandidates();
    const preferred = candidates.find((agent) => agent.id !== sourceInvocation.agentId && isAgentSelectableForRecovery(agent))
      ?? candidates.find((agent) => isAgentSelectableForRecovery(agent))
      ?? null;
    return candidates.map((agent) => recoveryAgentCandidateView(agent, sourceInvocation, preferred));
  }

  function recoveryAgentCandidateSnapshot(sourceInvocation, requestedAgentId = null) {
    const snapshot = recoveryAgentCandidateViews(sourceInvocation);
    const requestedAgent = requestedAgentId ? findAgent(requestedAgentId) : null;
    if (requestedAgent && !snapshot.some((candidate) => candidate.id === requestedAgent.id)) {
      snapshot.push(recoveryAgentCandidateView(requestedAgent, sourceInvocation, null));
    }
    return snapshot;
  }

  function recoveryAgentCandidateView(agent, sourceInvocation, preferred = null) {
    const selectability = recoveryAgentSelectability(agent);
    return {
      id: agent.id,
      name: agent.name ?? agent.id,
      status: agent.status ?? "unknown",
      healthStatus: agent.health?.status ?? null,
      locationType: agent.location?.type ?? null,
      adapterType: agent.adapter?.type ?? null,
      selectable: selectability.selectable,
      reasons: selectability.reasons,
      preferred: preferred?.id === agent.id,
      sourceAgent: agent.id === sourceInvocation.agentId,
    };
  }

  function recoveryAgentSelectability(agent) {
    const reasons = [];
    if (!agent) {
      return { selectable: false, reasons: ["agent_not_found"] };
    }
    if (!hasApplicationControlCapability(agent)) reasons.push("application_control_missing");
    if (agent.status === "disabled") reasons.push("agent_disabled");
    if (agent.status === "unavailable") reasons.push("agent_unavailable");
    if (agent.health?.status === "unhealthy") reasons.push("agent_unhealthy");
    if (agent.location?.type === "local_device" && state.device.unlinkState !== "linked") reasons.push("device_unlinked");
    return {
      selectable: reasons.length === 0,
      reasons,
    };
  }

  function orderedRecoveryAgentCandidates() {
    const applicationControl = state.agents.find((agent) => agent?.id === "agt_platform_application_control");
    return [
      applicationControl,
      ...state.agents.filter((agent) => agent && agent.id !== applicationControl?.id && hasApplicationControlCapability(agent)),
    ].filter(Boolean);
  }

  function hasApplicationControlCapability(agent) {
    return Array.isArray(agent?.capabilities)
      && agent.capabilities.some((capability) => capability?.name === "application_control");
  }

  function nextId(prefix) {
    const id = `${prefix}_${String(idCounter).padStart(4, "0")}`;
    idCounter += 1;
    return id;
  }

  function findInvocation(id) {
    return invocationService?.findInvocation(id) ?? state.invocations.find((item) => item.id === id);
  }

  function findApprovalRequest(id) {
    return invocationService?.findApprovalRequest(id) ?? state.approvalRequests.find((item) => item.id === id);
  }

  function defaultAgent() {
    return invocationService?.defaultAgent() ?? state.agents.find((item) => item.id === "agt_demo_cli") ?? state.agents.find((item) => item.adapter.type !== "platform") ?? state.agents[0] ?? null;
  }

  function uniqueStrings(values) {
    return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, Math.floor(number)));
  }

  function summarizeText(value, maxLength = 160) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  function applicationRoutineTask({ application, orchestration, routine, validation }) {
    const location = orchestration.relativePath ?? orchestration.path ?? `routine ${orchestration.routineId}`;
    return [
      `Run application orchestration ${orchestration.routineId} for ${application.name}.`,
      `Use ${location} as the validated LoopRoutine draft.`,
      `Routine name: ${routine.metadata?.name ?? orchestration.routineId}.`,
      `Goal: ${routine.goal?.summary ?? "Inspect the registered application and report findings."}`,
      `Safety policy: remoteWrites=${validation.policy.remoteWrites}, githubWrites=${validation.policy.githubWrites}, fanout.apply=${validation.policy.fanoutApply}.`,
      "Execute only allowed steps, keep all side effects under the platform approval policy, and report audit-friendly evidence.",
    ].join("\n");
  }

  function applicationOrchestrationRunSummary(invocation) {
    const metadata = invocation.options?.metadata ?? {};
    const auditSummary = state.auditSummaries.find((item) => item.invocationId === invocation.id);
    return {
      invocationId: invocation.id,
      status: invocation.status,
      agentId: invocation.agentId,
      projectId: invocation.projectId ?? metadata.projectId ?? null,
      worktreeId: invocation.worktreeId ?? metadata.worktreeId ?? null,
      deliveryState: invocation.delivery?.state ?? null,
      cancellationState: invocation.cancellation?.state ?? null,
      resultSummary: invocation.result?.summary ?? null,
      errorSummary: auditSummary?.errorSummary ?? null,
      createdAt: invocation.createdAt ?? null,
      updatedAt: invocation.updatedAt ?? null,
      completedAt: invocation.completedAt ?? null,
      metadata: {
        source: metadata.source ?? null,
        applicationId: metadata.applicationId ?? null,
        applicationName: metadata.applicationName ?? null,
        routineId: metadata.routineId ?? null,
        routineName: metadata.routineName ?? null,
        orchestrationRelativePath: metadata.orchestrationRelativePath ?? null,
        retryOfInvocationId: metadata.retryOfInvocationId ?? null,
        retryReason: metadata.retryReason ?? null,
        recoveryActionType: metadata.recoveryActionType ?? null,
        recoveryOfInvocationId: metadata.recoveryOfInvocationId ?? null,
        recoveryReason: metadata.recoveryReason ?? null,
        recoveryCategory: metadata.recoveryCategory ?? null,
      },
    };
  }

  function applicationOrchestrationRunDetail(invocation) {
    const summary = applicationOrchestrationRunSummary(invocation);
    const auditSummary = state.auditSummaries.find((item) => item.invocationId === invocation.id);
    return {
      ...summary,
      traceId: invocation.traceId ?? auditSummary?.traceId ?? null,
      rootSpanId: invocation.rootSpanId ?? null,
      approvalRequestId: invocation.approvalRequestId ?? null,
      policyDecisionId: invocation.policyDecisionId ?? null,
      delivery: invocation.delivery ?? null,
      cancellation: invocation.cancellation ?? null,
      result: invocation.result ?? null,
      audit: auditSummary ? {
        permissionDecision: auditSummary.permissionDecision ?? null,
        errorSummary: auditSummary.errorSummary ?? null,
        traceId: auditSummary.traceId ?? null,
        costSummary: auditSummary.costSummary ?? null,
      } : null,
      metadata: invocation.options?.metadata ?? summary.metadata,
    };
  }

  function applicationOrchestrationRunEvents(invocationId) {
    return state.events
      .filter((event) => event.invocationId === invocationId)
      .sort((left, right) => Date.parse(left.createdAt ?? "") - Date.parse(right.createdAt ?? ""));
  }

  function applicationOrchestrationRecovery(invocation, events, recoveryActions = []) {
    const auditSummary = state.auditSummaries.find((item) => item.invocationId === invocation.id);
    const haystack = [
      invocation.status,
      invocation.delivery?.state,
      invocation.cancellation?.state,
      invocation.result?.summary,
      auditSummary?.errorSummary,
      ...events.flatMap((event) => [event.type, event.level, event.message]),
    ].filter(Boolean).join(" ").toLowerCase();
    const eventTypes = events.map((event) => String(event.type ?? "").toLowerCase());
    const deliveryState = String(invocation.delivery?.state ?? "").toLowerCase();
    const cancellationState = String(invocation.cancellation?.state ?? "").toLowerCase();

    if (["succeeded", "completed"].includes(invocation.status)) {
      return recovery("none", 0.99, false, "No recovery needed.", [
        action("view_invocation", "Review audit trail", "Open the invocation if you need evidence for the successful run.", false, { invocationId: invocation.id }),
      ], recoveryActions);
    }
    if (invocation.status === "cancelled" || cancellationState === "cancelled" || eventTypes.some((type) => type.includes("cancel"))) {
      return recovery("cancelled", 0.9, true, "The run was cancelled before completion.", [
        action("rerun", "Re-run orchestration", "Start a new governed run if the cancellation was intentional or transient.", false, { invocationId: invocation.id }),
        action("view_invocation", "Review cancellation context", "Inspect the invocation timeline before retrying a user-cancelled run.", false, { invocationId: invocation.id }),
      ], recoveryActions);
    }
    if (haystack.includes("invalid_application_routine") || haystack.includes("validation") || haystack.includes("invalid routine")) {
      return recovery("validation_failed", 0.86, false, "The LoopRoutine draft or policy validation needs correction before retrying.", [
        action("regenerate_orchestration", "Regenerate orchestration", "Generate a fresh governed routine draft for the application.", true, { applicationId: invocation.options?.metadata?.applicationId ?? null }),
        action("view_invocation", "Inspect validation evidence", "Review the failing validation message and routine metadata.", false, { invocationId: invocation.id }),
      ], recoveryActions);
    }
    if (haystack.includes("agent_disabled") || haystack.includes("agent_unhealthy") || haystack.includes("agent_not_found") || haystack.includes("unhealthy") || haystack.includes("disabled")) {
      return recovery("agent_unavailable", 0.84, true, "The selected agent was unavailable or unhealthy.", [
        action("select_agent", "Select a healthy agent", "Retry with an available governed agent.", false, { agentId: invocation.agentId ?? null }),
        action("view_invocation", "Inspect agent state", "Review the failed invocation and agent health context.", false, { invocationId: invocation.id }),
      ], recoveryActions);
    }
    if (haystack.includes("device_unlinked") || haystack.includes("device credentials") || haystack.includes("unlinked")) {
      return recovery("device_unlinked", 0.88, true, "The local device bridge is unlinked or unavailable.", [
        action("relink_device", "Relink device", "Restore Desktop Bridge credentials before retrying local-device work.", true, { agentId: invocation.agentId ?? null }),
        action("rerun", "Re-run after relink", "Start a new governed run once the bridge is linked.", false, { invocationId: invocation.id }),
      ], recoveryActions);
    }
    if (deliveryState === "dispatching" || deliveryState === "redelivering" || haystack.includes("dispatch lease expired") || eventTypes.includes("delivery_redelivered")) {
      return recovery("dispatch_timeout", 0.78, true, "The run did not reach the bridge cleanly or needed redelivery.", [
        action("rerun", "Re-run orchestration", "Retry the governed run after confirming the bridge is online.", false, { invocationId: invocation.id }),
        action("view_invocation", "Inspect delivery attempts", "Check dispatch attempts and bridge cursor details.", false, { invocationId: invocation.id }),
      ], recoveryActions);
    }
    if (haystack.includes("policy_blocked") || haystack.includes("policy denied") || haystack.includes("approval denied") || haystack.includes("requires_local_approval") || eventTypes.includes("invocation_rejected")) {
      return recovery("policy_blocked", 0.72, false, "The run appears blocked by policy or approval handling.", [
        action("view_invocation", "Review policy decision", "Inspect approval and policy events before retrying.", true, { invocationId: invocation.id }),
      ], recoveryActions);
    }
    if (auditSummary?.errorSummary || invocation.status === "failed" || eventTypes.some((type) => type.endsWith("_failed") || type.includes("failure"))) {
      return recovery("runtime_error", 0.74, true, auditSummary?.errorSummary ?? "The run failed during execution.", [
        action("rerun", "Re-run orchestration", "Retry if the failure is transient or after applying the indicated fix.", false, { invocationId: invocation.id }),
        action("view_invocation", "Inspect runtime error", "Review result, audit summary, and timeline details.", false, { invocationId: invocation.id }),
      ], recoveryActions);
    }
    return recovery("unknown_failure", 0.35, false, "No specific recovery path could be inferred from the recorded evidence.", [
      action("view_invocation", "Inspect invocation", "Review the full invocation before choosing a recovery action.", false, { invocationId: invocation.id }),
    ], recoveryActions);
  }

  function recovery(category, confidence, retryRecommended, summary, actions, recoveryActions = []) {
    const rankedActions = rankRecoveryActions(category, actions, recoveryActions);
    return {
      category,
      confidence,
      retryRecommended,
      humanApprovalRequired: rankedActions.some((item) => item.requiresApproval),
      summary,
      actions: rankedActions,
    };
  }

  function action(type, label, description, requiresApproval, target = {}) {
    return { type, label, description, requiresApproval, target };
  }

  function rankRecoveryActions(category, actions, recoveryActions = []) {
    const preferredActionType = preferredRecoveryActionType(category);
    return actions
      .map((item) => {
        const priority = recoveryActionPriority(category, item, preferredActionType);
        const availability = recoveryActionAvailability(item, recoveryActions);
        return {
          ...item,
          priority,
          recommended: item.type === preferredActionType,
          recommendationReason: recoveryActionRecommendationReason(category, item.type, item.type === preferredActionType),
          riskLevel: recoveryActionRiskLevel(item),
          availability,
          blockedReason: availability.blockedReason,
          warningReason: availability.warningReason,
          latestRequestId: availability.latestRequestId,
        };
      })
      .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label));
  }

  function applicationRecoveryActionsForRun(applicationId, routineId, invocationId) {
    return (state.applicationRecoveryActions ?? [])
      .filter((request) => request.applicationId === applicationId
        && request.routineId === routineId
        && request.invocationId === invocationId)
      .sort((left, right) => Date.parse(right.updatedAt ?? right.createdAt ?? "") - Date.parse(left.updatedAt ?? left.createdAt ?? ""));
  }

  function recoveryActionAvailability(item, recoveryActions) {
    const latestSameType = recoveryActions.find((request) => request.actionType === item.type) ?? null;
    if (!latestSameType) {
      return {
        state: "available",
        blockedReason: null,
        warningReason: null,
        latestRequestId: null,
      };
    }
    if (["requested", "approval_pending", "approval_approved", "executing"].includes(latestSameType.status)) {
      return {
        state: "blocked",
        blockedReason: latestSameType.status === "approval_pending" ? "same_action_approval_pending" : "same_action_in_progress",
        warningReason: null,
        latestRequestId: latestSameType.id,
      };
    }
    if (latestSameType.status === "failed") {
      return {
        state: "warning",
        blockedReason: null,
        warningReason: "same_action_recently_failed",
        latestRequestId: latestSameType.id,
      };
    }
    return {
      state: "available",
      blockedReason: null,
      warningReason: null,
      latestRequestId: latestSameType.id,
    };
  }

  function preferredRecoveryActionType(category) {
    const preferred = {
      agent_unavailable: "select_agent",
      cancelled: "rerun",
      device_unlinked: "relink_device",
      dispatch_timeout: "rerun",
      none: "view_invocation",
      policy_blocked: "view_invocation",
      runtime_error: "rerun",
      unknown_failure: "view_invocation",
      validation_failed: "regenerate_orchestration",
    };
    return preferred[category] ?? "view_invocation";
  }

  function recoveryActionPriority(category, item, preferredActionType) {
    if (item.type === preferredActionType) return 10;
    if (item.type === "view_invocation") return 80;
    if (item.requiresApproval) return 60;
    if (category === "device_unlinked" && item.type === "rerun") return 40;
    return 50;
  }

  function recoveryActionRecommendationReason(category, actionType, recommended) {
    if (!recommended) {
      if (actionType === "view_invocation") return "Use this to inspect evidence before taking a side-effecting recovery action.";
      if (actionType === "rerun") return "Use after the blocking condition has been resolved.";
      return "Available as an alternate governed recovery path.";
    }
    const reasons = {
      agent_unavailable: "The source agent appears unavailable or unhealthy, so retrying on a healthy governed agent is the best next step.",
      cancelled: "The run was cancelled, so a fresh governed run is the safest recovery.",
      device_unlinked: "The local device bridge appears unlinked, so relinking must happen before local-device work can recover.",
      dispatch_timeout: "The run did not dispatch cleanly, so a fresh governed run is the most direct recovery.",
      none: "The run completed successfully; inspecting the audit trail is the only recovery action needed.",
      policy_blocked: "Policy or approval evidence should be reviewed before attempting another side-effecting action.",
      runtime_error: "The run failed during execution; a governed rerun is the lowest-risk automated recovery.",
      unknown_failure: "The failure evidence is not specific enough to choose an automated recovery safely.",
      validation_failed: "The routine failed validation, so regenerating the orchestration addresses the likely source of failure.",
    };
    return reasons[category] ?? "Recommended based on the recorded recovery category.";
  }

  function recoveryActionRiskLevel(item) {
    if (item.requiresApproval) return "high";
    if (["rerun", "select_agent"].includes(item.type)) return "medium";
    return "low";
  }

  function appendRecoveryActionEvent(kind, invocationId, applicationId, routineId, actionType, recoveryCategory, reason, actionRequest = null) {
    const requested = kind === "requested";
    const pending = kind === "approval_pending";
    appendEvent({
      invocationId,
      type: requested || pending
        ? "application_orchestration_recovery_action_requested"
        : "application_orchestration_recovery_action_rejected",
      level: requested ? "info" : "warn",
      message: pending
        ? `Application orchestration recovery action ${actionType} is pending approval.`
        : requested
          ? `Application orchestration recovery action ${actionType} requested.`
        : `Application orchestration recovery action ${actionType} rejected.`,
      data: {
        applicationId,
        routineId,
        actionType,
        recoveryCategory,
        reason,
        recoveryActionRequestId: actionRequest?.id ?? null,
        status: actionRequest?.status ?? null,
        approvalRequestId: actionRequest?.approvalRequestId ?? null,
      },
    });
  }

  function isApplicationActionApproved(token) {
    return typeof token === "string" && token.startsWith("operator-approved");
  }

  function applicationOrchestrationScope(applicationId, routineId) {
    const application = findApplication(applicationId);
    if (!application) {
      return { status: 404, body: { error: "application_not_found" } };
    }
    const orchestration = (application.orchestrations ?? []).find((item) => item?.routineId === routineId);
    if (!orchestration) {
      return { status: 404, body: { error: "orchestration_not_found", applicationId, routineId } };
    }
    return { status: 200, application, orchestration };
  }

  function getScopedApplicationOrchestrationInvocation(applicationId, routineId, invocationId) {
    const scope = applicationOrchestrationScope(applicationId, routineId);
    if (scope.status !== 200) return scope;
    const invocation = findInvocation(invocationId);
    if (!invocation || !isApplicationOrchestrationRun(invocation, applicationId, routineId)) {
      return { status: 404, body: { error: "orchestration_run_not_found", applicationId, routineId, invocationId } };
    }
    return { status: 200, invocation };
  }

  function isApplicationOrchestrationRun(invocation, applicationId, routineId) {
    const metadata = invocation?.options?.metadata;
    return metadata?.source === "application_orchestration"
      && metadata.applicationId === applicationId
      && metadata.routineId === routineId;
  }

  function isManagedApplicationRoutinePath(application, path) {
    const applicationSegment = String(application.id ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72);
    if (!applicationSegment) return false;
    const routinesRoot = resolve(defaultProjectPath || process.cwd(), ".myagenttool", "applications", applicationSegment, "routines");
    const target = resolve(path);
    return target === routinesRoot || target.startsWith(routinesRoot + sep);
  }

  function unlinkDevice() {
    state.device.status = "offline";
    state.device.unlinkState = "unlinked";
    state.device.credentialRevokedAt = now();
    if (state.device.bridgeCredential) {
      state.device.bridgeCredential.revokedAt = state.device.credentialRevokedAt;
    }
    state.device.updatedAt = now();
    for (const agent of state.agents.filter((item) => item.location.type === "local_device")) {
      if (isAgentDisabled(agent)) {
        agent.updatedAt = now();
        continue;
      }
      agent.status = "unavailable";
      agent.updatedAt = now();
    }
    cancelInvocationsForDeviceUnlink();
    appendEvent({
      invocationId: null,
      type: "device_unlinked",
      level: "info",
      message: "Desktop Bridge device credentials were revoked for unlink."
    });
  }

  const selfCheckDependencies = {
    acknowledgeInvocation,
    appendEvent,
    approveInvocation,
    cancelInvocation,
    codexSessionForInvocation,
    completeDiscoveryRun,
    completeHealthCheck,
    completeIntegrationProbeRun,
    completeInvocation,
    createAgentHealthCheck,
    createCapabilityInvocation,
    findApplication,
    getApplicationOrchestrationRunRecovery,
    listApplicationOrchestrationRecoveryAgentCandidates,
    getApplicationOrchestrationRun,
    invokeApplicationCapability,
    getCapability,
    listApplicationCapabilities,
    listCapabilities,
    listApplications,
    listApplicationOrchestrationRunEvents,
    listApplicationOrchestrationRuns,
    probeApplication,
    registerApplication,
    requestApplicationOrchestrationRecoveryAction,
    runApplicationOrchestration,
    transitionApplication,
    createCodexChangeReview,
    createCodexImportedEvidenceRecord,
    createCompareRun,
    createDiscoveryRun,
    createIntegrationArtifact,
    createIntegrationProbeRun,
    createInvocation,
    createManagedCodexSession,
    createManagedCodexWorkspace,
    createManagedTerminalSession,
    createSshConnectionTest,
    createSshTarget,
    createTroubleshootingReport,
    createToolInvocation,
    defaultAgent,
    disableAgent,
    denyInvocation,
    enableAgent,
    evidenceCenterRecords,
    expireCodexApprovalBrokerRequests,
    findAgent,
    findApprovalRequest,
    findInvocation,
    generateIntegrationArtifacts,
    getAgentUsageSummary,
    getTool,
    chargebackExport,
    completeLifecycleAction,
    createAuditExportRequest,
    markDispatched,
    markDiscoveryStarted,
    markHealthCheckStarted,
    markIntegrationProbeStarted,
    nextBridgeDiscoveryRun,
    nextBridgeHealthCheck,
    nextDispatchableInvocation,
    nextTerminalBridgeAction,
    queueTerminalBridgeAction,
    recordCcusageImportedEstimates,
    recordCodexHookEvent,
    recordTerminalBridgeEvent,
    redeliverExpiredDispatches,
    registerAgent,
    registerDiscoveredCandidate,
    registerIntegrationArtifact,
    createLifecycleRecipe,
    createPrivateCatalogEntry,
    createSignedBundleManifest,
    createQuotaPolicy,
    decideLifecycleLocalApproval,
    evaluateLifecyclePolicy,
    enforcePlatformAiQuota,
    findLifecycleLocalApproval,
    findLifecycleRollbackRequest,
    findLifecycleRecipe,
    findPrivateCatalogEntry,
    markLifecycleActionStarted,
    nextBridgeLifecycleAction,
    queueLifecycleAction,
    queueRollbackAction,
    recordAiUsage,
    requestLifecycleLocalApproval,
    resetIdCounter: () => {
      idCounter = 1;
    },
    resolveCodexApprovalBrokerRequest,
    startInvocationIfAllowed,
    state,
    transitionIntegrationArtifact,
    transitionLifecycleRecipe,
    updatePrivateDeploymentConfig,
    unlinkDevice,
    listTools,
    now,
  };

  const httpDependencies = {
    state,
    now,
    publicState,
    currentLoopRoutineProjectContext,
    currentProject,
    addProject,
    cloneProject,
    createBlankProject,
    createWorktree,
    createWorktreePr,
    publishWorktreeBranch,
    startAutoRun,
    retryAutoRun,
    refreshAutoRunPrDispositions,
    selectProject,
    removeProject,
    removeWorktree,
    updateProject,
    readProjectTree,
    searchProjectContent,
    gitProjectSummary,
    projectBranches,
    worktreeDiff,
    projectGithubItems,
    createAgentSkill,
    updateAgentSkill,
    deleteAgentSkill,
    createCapabilityInvocation,
    findApplication,
    getApplicationOrchestrationRunRecovery,
    listApplicationOrchestrationRecoveryAgentCandidates,
    getApplicationOrchestrationRun,
    invokeApplicationCapability,
    getCapability,
    listApplicationCapabilities,
    listCapabilities,
    listApplications,
    listApplicationOrchestrationRunEvents,
    listApplicationOrchestrationRuns,
    probeApplication,
    registerApplication,
    requestApplicationOrchestrationRecoveryAction,
    runApplicationOrchestration,
    transitionApplication,
    createSshTarget,
    createSshConnectionTest,
    createManagedTerminalSession,
    queueTerminalBridgeAction,
    nextTerminalBridgeAction,
    recordTerminalBridgeEvent,
    recordTerminalEvidence,
    summarizeText,
    appendEvent,
    isAgentDisabled,
    redeliverExpiredDispatches,
    registerAgent,
    findAgent,
    disableAgent,
    enableAgent,
    createAgentHealthCheck,
    unlinkDevice,
    recordCodexHookEvent,
    expireCodexApprovalBrokerRequests,
    resolveCodexApprovalBrokerRequest,
    createCodexImportedEvidenceRecord,
    createCodexChangeReview,
    createDiscoveryRun,
    createIntegrationArtifact,
    createLifecycleRecipe,
    createPrivateCatalogEntry,
    createSignedBundleManifest,
    createQuotaPolicy,
    findIntegrationArtifact,
    findLifecycleLocalApproval,
    findLifecycleRollbackRequest,
    findLifecycleRecipe,
    findPrivateCatalogEntry,
    generateIntegrationArtifacts,
    chargebackExport,
    completeLifecycleAction,
    createAuditExportRequest,
    decideLifecycleLocalApproval,
    evaluateLifecyclePolicy,
    enforcePlatformAiQuota,
    queueLifecycleAction,
    queueRollbackAction,
    recordAiUsage,
    requestLifecycleLocalApproval,
    transitionLifecycleRecipe,
    updatePrivateDeploymentConfig,
    createAgentDryProbeRun,
    issueBridgeCredential,
    requireBridgeCredential,
    createIntegrationProbeRun,
    registerIntegrationArtifact,
    transitionIntegrationArtifact,
    updateIntegrationRetentionSettings,
    draftIntegrationWithPlatformAgent,
    findDiscoveryRun,
    registerDiscoveredCandidate,
    nextDispatchableInvocation,
    markDispatched,
    projectForInvocation,
    nextBridgeHealthCheck,
    markHealthCheckStarted,
    completeHealthCheck,
    nextBridgeDiscoveryRun,
    markDiscoveryStarted,
    normalizeStringArray,
    completeDiscoveryRun,
    nextBridgeProbeRun,
    markLifecycleActionStarted,
    nextBridgeLifecycleAction,
    markIntegrationProbeStarted,
    findIntegrationProbeRun,
    completeIntegrationProbeRun,
    findInvocation,
    acknowledgeInvocation,
    completeInvocation,
    findApprovalRequest,
    approveInvocation,
    denyInvocation,
    defaultAgent,
    createInvocation,
    startInvocationIfAllowed,
    createCompareRun,
    cancelInvocation,
    createTroubleshootingReport,
    createToolInvocation,
    getTool,
    listTools,
    nextId,
    persistStateSoon,
    budgetStatusFor,
    upsertBudget,
  };

  return {
    httpDependencies,
    savePersistentState,
    selfCheckDependencies,
  };
}

function nextIdCounterAfterState(state) {
  let max = 0;
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") {
      if (typeof value === "string") {
        const match = value.match(/_(\d{4,})$/);
        if (match) max = Math.max(max, Number(match[1]));
      }
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const item of Object.values(value)) visit(item);
  };
  visit(state);
  return max + 1;
}
