import { renderAgentSkillsIntoWorktree } from "../agent-skills.mjs";
import { createRefusalRuntime } from "../../runtime/refusal-log.mjs";
import { teamOf } from "../../runtime/auth.mjs";
import { runStateTransaction } from "../../runtime/state-transaction.mjs";

// Traces grow one-per-invocation with no count cap today (only time-reap, which
// is off by default). Bound the in-memory view and archive the over-cap oldest.
const MAX_TRACES_TOTAL = 10000;

export function createInvocationCreationRuntime({
  state,
  now,
  nextId,
  appendEvent,
  // Over-cap (oldest) traces are archived to a durable append-only store instead
  // of dropped; falls back to a plain newest-keeps slice when none is injected.
  capWithArchive = (list, max) => (Array.isArray(list) ? list.slice(0, max) : []),
  refuse: injectedRefuse,
  persistStateSoon,
  persistStateNow,
  defaultAgent,
  currentProject,
  worktreeForProject,
  normalizeCodexApprovalMode,
  normalizeCodexSessionMode,
  normalizeCodexWorkspacePolicy,
  normalizeClaudeSessionMode,
  createManagedCodexWorkspace,
  createManagedCodexSession,
  createManagedClaudeSession,
  resolveResumeCodexSessionId,
  resolveResumeClaudeSessionId,
  evaluateInvocationPolicy,
  enforcePlatformAiQuota,
  createPolicyDecisionRecord,
  createApprovalRequest,
  completeRootSpan,
  createAuditSummary,
  recordAgentUsage,
  budgetGateForProject,
  reserveBudget,
  checkUsageQuota,
}) {
  // Shared writer in production; a state-bound fallback for direct construction.
  const refuse = injectedRefuse ?? createRefusalRuntime({ state, now, nextId, appendEvent }).refuse;
  function createInvocation(task, agent = defaultAgent(), options = {}) {
    if (!agent) {
      throw new Error("No agent is registered.");
    }
    // Prefer an explicit requestedBy (the scheduler passes the automation's
    // creator), then the acting user, then the local fallback.
    const requestedBy = options.requestedBy ?? options.actor?.userId ?? "usr_local";
    // Idempotency (WS2 durable-state hardening): a client-provided key dedups a
    // retried create (e.g. a network-retried POST) so one logical request never
    // spawns two runs. Scoped per requester so keys can't collide across
    // tenants. Safe without a lock: createInvocation is fully synchronous, so
    // this check-then-insert cannot interleave with a concurrent create in the
    // single-threaded event loop; the key is persisted, so it also holds across
    // restart.
    const clientIdempotencyKey =
      typeof options.idempotencyKey === "string" && options.idempotencyKey.trim()
        ? options.idempotencyKey.trim()
        : null;
    if (clientIdempotencyKey) {
      const existing = state.invocations.find(
        (item) => item.idempotencyKey === clientIdempotencyKey && item.requestedBy === requestedBy,
      );
      if (existing) return existing;
    }
    // #890.2: every exit from the accept below — queued/running, awaiting
    // approval, OR a quota/budget rejection — commits through this one synchronous
    // barrier. The rejection returns previously used only the 20ms debounce, so a
    // crash could lose the rejection (invocation + refusal + audit); now the whole
    // accept outcome is durable when createInvocation returns. The single-file
    // snapshot rename makes each commit all-or-nothing across collections.
    const commitAccept = persistStateNow ?? persistStateSoon ?? (() => {});
    const id = nextId("inv_demo");
    const createdAt = now();
    const trace = createTrace(id, agent);
    const policy = evaluateInvocationPolicy(agent, options);
    const quotaGate = maybeEnforcePlatformAiQuota({
      invocationId: id,
      agent,
      options,
      enforcePlatformAiQuota,
    });
    const directRun = runsWithoutBridge(agent);
    let codexSessionMode = normalizeCodexSessionMode(options.codexSessionMode, agent);
    let claudeSessionMode = typeof normalizeClaudeSessionMode === "function"
      ? normalizeClaudeSessionMode(options.claudeSessionMode, agent)
      : "not_applicable";
    const remoteHttpRun = agent.adapter.type === "http" && agent.location.type === "remote_http";
    const codexWorkspacePolicy = normalizeCodexWorkspacePolicy(options.codexWorkspacePolicy, agent);
    const requestedMetadata = options.metadata && typeof options.metadata === "object" && !Array.isArray(options.metadata) ? options.metadata : {};
    const requestedWorktree = requestedMetadata.worktreeId
      ? state.worktrees.find((item) => item.id === requestedMetadata.worktreeId)
      : null;
    // Service-layer tenant guard (#865, S3): the HTTP route already blocks a
    // foreign projectId (denyForeignProject), but the service must not itself
    // resolve a project outside the actor's team — a future internal caller that
    // bypasses the route guard would otherwise run against a foreign project's
    // path. When the actor is unscoped (local dev, no teamId) this is a no-op,
    // exactly matching the route guard's own "unscoped ⇒ allow".
    const actorTeamId = options.actor?.teamId ?? null;
    const findProjectForActor = (projectId) => {
      if (!projectId) return null;
      const found = state.projects.find((item) => item.id === projectId) ?? null;
      if (found && actorTeamId != null && teamOf(found) !== actorTeamId) return null;
      return found;
    };
    const visibleProject = requestedMetadata.projectId
      ? findProjectForActor(requestedMetadata.projectId) ?? currentProject()
      : requestedWorktree?.projectId
        ? findProjectForActor(requestedWorktree.projectId) ?? currentProject()
        : currentProject();
    const project = requestedWorktree?.workspaceProjectId
      ? state.projects.find((item) => item.id === requestedWorktree.workspaceProjectId) ?? visibleProject
      : visibleProject;
    const projectWorktree = requestedWorktree ?? worktreeForProject(project?.id);
    // Register the managed workspace/session only after resolving the invocation's
    // requested worktree. Previously these records used currentProject(), so an
    // Auto-run continuation could resolve a provider session from the selected
    // console project instead of the worktree it was actually about to execute.
    const managedCodexWorkspace = createManagedCodexWorkspace({
      invocationId: id,
      agent,
      workspacePolicy: codexWorkspacePolicy,
      project,
      worktree: projectWorktree,
    });
    const managedCodexSession = createManagedCodexSession({
      invocationId: id,
      agent,
      codexSessionMode,
      workspace: managedCodexWorkspace,
      actor: options.actor,
      requestedBy,
      project,
      worktree: projectWorktree,
    });
    const managedClaudeSession = typeof createManagedClaudeSession === "function"
      ? createManagedClaudeSession({
          invocationId: id,
          agent,
          claudeSessionMode,
          actor: options.actor,
          requestedBy,
          project,
          worktree: projectWorktree,
        })
      : null;
    // Exact resume only. A requested continuation without a provider session /
    // thread id becomes a fresh session; it must never degrade to global --last,
    // which can cross concurrent tasks on the same machine.
    const codexResumeSessionId =
      codexSessionMode === "continue_last" && managedCodexSession && typeof resolveResumeCodexSessionId === "function"
        ? resolveResumeCodexSessionId({
            repoPath: managedCodexSession.repoPath,
            userId: managedCodexSession.userId,
            excludeSessionId: managedCodexSession.id,
            invocationId: typeof options.resumeFromInvocationId === "string" ? options.resumeFromInvocationId : null,
          })
        : null;
    if (codexSessionMode === "continue_last" && !codexResumeSessionId) {
      codexSessionMode = "new";
      if (managedCodexSession) managedCodexSession.sessionMode = "new";
    }
    const claudeResumeSessionId =
      claudeSessionMode === "continue_last"
      && managedClaudeSession
      && typeof resolveResumeClaudeSessionId === "function"
        ? resolveResumeClaudeSessionId({
            repoPath: managedClaudeSession.repoPath,
            userId: managedClaudeSession.userId,
            excludeSessionId: managedClaudeSession.id,
            invocationId: typeof options.resumeFromInvocationId === "string"
              ? options.resumeFromInvocationId
              : null,
          })
        : null;
    if (claudeSessionMode === "continue_last" && !claudeResumeSessionId) {
      claudeSessionMode = "new";
      if (managedClaudeSession) managedClaudeSession.sessionMode = "new";
    }
    if (managedClaudeSession && claudeResumeSessionId) {
      managedClaudeSession.resumedFromSessionId = claudeResumeSessionId;
    }
    // Budget gate: a project (or team pool) over its limit with a block policy
    // rejects the run up front, same shape as the platform AI quota gate.
    const targetProjectId = visibleProject?.id ?? project?.id ?? null;
    const budgetGate =
      typeof budgetGateForProject === "function" && targetProjectId
        ? budgetGateForProject(targetProjectId)
        : { blocked: false };
    // Usage-based quota gate (#856): a per-subject token/USD window already spent
    // rejects the run up front — applies to BYOK/bridge runs, not just platform AI.
    const usageQuotaGate = typeof checkUsageQuota === "function"
      ? checkUsageQuota({ subjectId: requestedBy })
      : { blocked: false };
    const otherGatesRejected = quotaGate?.allowed === false || budgetGate.blocked || usageQuotaGate.blocked === true;
    // #890.1 tail: place a budget HOLD for a concurrent manual/API accept too, so
    // two runs starting near a block limit can't both pass the finalized-spend gate
    // (the same TOCTOU 890.1 closed for the auto-run path). Skip when an auto-run
    // already reserved for this run (metadata.autoRunId) to avoid a double hold, and
    // when the estimate is 0 (default off). A hold that would exceed the limit
    // rejects the accept, handled by the budget branch below; the hold releases when
    // the invocation reaches a terminal state (completion + the reap-sweep reconcile).
    const reservationEstimateUsd = Number(state.autoRunSettings?.reservationEstimateUsd ?? 0) || 0;
    const reservedByAutoRun = Boolean(requestedMetadata.autoRunId);
    let reservationBlockReason = null;
    if (!otherGatesRejected && reservationEstimateUsd > 0 && !reservedByAutoRun && typeof reserveBudget === "function" && targetProjectId) {
      const held = reserveBudget({ projectId: targetProjectId, amountUsd: reservationEstimateUsd, invocationId: id });
      if (!held.ok) reservationBlockReason = held.reason;
    }
    const gateRejected = otherGatesRejected || Boolean(reservationBlockReason);
    const invocation = {
      id,
      idempotencyKey: clientIdempotencyKey,
      ideaSessionId: null,
      compareRunId: null,
      agentId: agent.id,
      terminalId: agent.location.type === "local_device" ? agent.location.deviceId : null,
      projectId: visibleProject?.id ?? project?.id ?? null,
      worktreeId: projectWorktree?.id ?? null,
      requestedBy,
      status: gateRejected ? "rejected" : policy.decision === "requires_local_approval" ? "waiting_for_local_approval" : directRun ? "running" : "queued",
      delivery: {
        deliveryId: nextId("del_demo"),
        deviceId: agent.location.type === "local_device" ? agent.location.deviceId : null,
        state: gateRejected ? "not_required" : policy.decision === "requires_local_approval" ? "not_required" : directRun ? "not_required" : "queued",
        idempotencyKey: `idem_${id}`,
        leaseExpiresAt: null,
        dispatchAttempts: gateRejected || policy.decision === "requires_local_approval" ? 0 : directRun ? 1 : 0,
        lastDispatchAt: gateRejected || policy.decision === "requires_local_approval" ? null : directRun ? createdAt : null,
        acknowledgedAt: gateRejected || policy.decision === "requires_local_approval" ? null : directRun ? createdAt : null,
        bridgeCursor: null,
        expiresAt: null
      },
      cancellation: {
        state: "none",
        requestedBy: null,
        requestedAt: null,
        reason: null,
        appliedAt: null,
        message: null
      },
      input: { task },
      options: {
        timeoutSeconds: Number(options.timeoutSeconds ?? 30),
        requireLocalApproval: Boolean(options.requireLocalApproval ?? policy.decision === "requires_local_approval"),
        // MCP tool selection (#975): the bridge's MCP client resolves the tool
        // from options.toolName / options.toolArguments, but the gateway never
        // carried them — a multi-tool MCP agent could not be invoked with a
        // chosen tool. Present only when the caller set them.
        ...(options.toolName ? { toolName: String(options.toolName) } : {}),
        ...(options.toolArguments && typeof options.toolArguments === "object" && !Array.isArray(options.toolArguments)
          ? { toolArguments: options.toolArguments }
          : {}),
        codexSessionMode,
        codexResumeSessionId,
        codexWorkspacePolicy,
        claudeSessionMode,
        claudeResumeSessionId,
        // A per-run selection wins; otherwise inherit the registered Agent's
        // canonical permission mode. This keeps API/scheduler callers aligned
        // with the Web composer instead of silently falling back to "ask".
        approvalMode: normalizeCodexApprovalMode(
          options.approvalMode
          ?? requestedMetadata.permissionMode
          ?? agent.adapter?.permissionMode,
        ),
        metadata: {
          demo: true,
          ...(options.metadata && typeof options.metadata === "object" && !Array.isArray(options.metadata) ? options.metadata : {}),
          quotaDecisionId: quotaGate?.quotaDecision?.id ?? null,
          quotaDecision: quotaGate?.quotaDecision?.decision ?? null,
          projectId: visibleProject?.id ?? project?.id ?? null,
          projectName: visibleProject?.name ?? project?.name ?? null,
          projectPath: project?.path ?? null,
          workspaceProjectId: project?.id ?? null,
          worktreeId: projectWorktree?.id ?? null,
          worktreeBranchName: projectWorktree?.branchName ?? null,
          worktreePath: projectWorktree?.worktreePath ?? null,
          ...(managedCodexSession ? {
            managedCodexSessionId: managedCodexSession.id,
            managedCodexWorkspaceId: managedCodexWorkspace?.id ?? null,
            managedLaunch: true
          } : {}),
          ...(managedClaudeSession ? {
            managedClaudeSessionId: managedClaudeSession.id,
            managedLaunch: true,
          } : {})
        }
      },
      result: null,
      policyDecisionId: null,
      approvalRequestId: null,
      traceId: trace.id,
      rootSpanId: trace.rootSpanId,
      createdAt,
      updatedAt: createdAt
    };
    state.invocations.unshift(invocation);
    persistStateSoon();
    if (managedCodexSession) {
      appendEvent({
        invocationId: invocation.id,
        type: "codex_session_registered",
        level: "info",
        message: "Managed Codex session registered for a MyAgentTool-launched invocation.",
        data: { codexSessionId: managedCodexSession.id, workspaceId: managedCodexWorkspace?.id ?? null, sessionMode: codexSessionMode, workspacePolicy: codexWorkspacePolicy }
      });
    }
    if (managedClaudeSession) {
      appendEvent({
        invocationId: invocation.id,
        type: "claude_session_registered",
        level: "info",
        message: "Managed Claude SDK session registered for a MyAgentTool-launched invocation.",
        data: {
          claudeSessionRegistryId: managedClaudeSession.id,
          sessionMode: claudeSessionMode,
          resumedFromSessionId: claudeResumeSessionId,
        },
      });
    }
    const policyRecord = createPolicyDecisionRecord(invocation, agent, policy);
    invocation.policyDecisionId = policyRecord.id;
    appendEvent({
      invocationId: invocation.id,
      type: "invocation_created",
      level: "info",
      message: "Invocation created from Web Console."
    });
    appendEvent({
      invocationId: invocation.id,
      type: "policy_decision_recorded",
      level: policy.decision === "requires_local_approval" ? "warn" : "info",
      message: policy.reason,
      data: { policyDecisionId: policyRecord.id, riskLevel: policy.riskLevel, riskTags: policy.riskTags, decision: policy.decision }
    });
    appendEvent({
      invocationId: invocation.id,
      type: "trace_created",
      level: "info",
      message: "Invocation trace created.",
      data: { traceId: trace.id, rootSpanId: trace.rootSpanId }
    });
    if (quotaGate?.allowed === false) {
      const policyRecord = state.policyDecisionRecords.find((item) => item.id === invocation.policyDecisionId);
      if (policyRecord) {
        policyRecord.decision = "denied";
        policyRecord.reason = quotaGate.quotaDecision.reason;
      }
      invocation.completedAt = createdAt;
      completeRootSpan(invocation, "failed");
      refuse({
        subject: { kind: "invocation", id: invocation.id },
        requester: { kind: "local_user", id: invocation.requestedBy ?? "usr_local" },
        category: "state",
        code: "over_quota",
        decidedBy: { kind: "policy_engine", id: quotaGate.quotaDecision.id },
        summary: quotaGate.quotaDecision.reason,
        evidence: { quotaDecisionId: quotaGate.quotaDecision.id, decision: quotaGate.quotaDecision.decision },
        remedy: "Wait for the quota window to reset or raise the platform AI quota.",
        retryAfter: null,
        appealTo: "device_owner",
        event: {
          invocationId: invocation.id,
          type: "invocation_rejected",
          level: "warn",
          message: quotaGate.quotaDecision.reason,
          data: { quotaDecisionId: quotaGate.quotaDecision.id, decision: quotaGate.quotaDecision.decision }
        },
      });
      state.auditSummaries.push(createAuditSummary(invocation, quotaGate.quotaDecision.reason));
      recordAgentUsage(invocation, "rejected");
      commitAccept();
      return invocation;
    }
    if (budgetGate.blocked || reservationBlockReason) {
      // Either the finalized-spend gate blocked, or the in-flight-hold gate would
      // push it over (#890.1 tail — concurrent admissions can't jointly exceed).
      const budgetReason = budgetGate.blocked ? budgetGate.reason : reservationBlockReason;
      const record = state.policyDecisionRecords.find((item) => item.id === invocation.policyDecisionId);
      if (record) {
        record.decision = "denied";
        record.reason = budgetReason;
      }
      invocation.completedAt = createdAt;
      completeRootSpan(invocation, "failed");
      refuse({
        subject: { kind: "invocation", id: invocation.id },
        requester: { kind: "local_user", id: invocation.requestedBy ?? "usr_local" },
        category: "state",
        code: "over_budget",
        decidedBy: { kind: "policy_engine", id: targetProjectId ?? "budget" },
        summary: budgetReason,
        evidence: { gate: "budget", projectId: targetProjectId ?? null, inFlightHold: Boolean(reservationBlockReason) },
        remedy: "Raise the project or team budget, or wait for the budget window to reset.",
        retryAfter: null,
        appealTo: "device_owner",
        event: {
          invocationId: invocation.id,
          type: "invocation_rejected",
          level: "warn",
          message: budgetReason,
          data: { gate: "budget", inFlightHold: Boolean(reservationBlockReason) }
        },
      });
      state.auditSummaries.push(createAuditSummary(invocation, budgetReason));
      recordAgentUsage(invocation, "rejected");
      commitAccept();
      return invocation;
    }
    appendEvent({
      invocationId: invocation.id,
      type: policy.decision === "requires_local_approval"
        ? "local_approval_requested"
        : remoteHttpRun
          ? "remote_http_accepted"
          : directRun
            ? "invocation_started"
            : "delivery_queued",
      level: "info",
      message: policy.decision === "requires_local_approval"
        ? "Local approval is required before this high-risk invocation can run."
        : remoteHttpRun
          ? `${agent.name} invocation accepted for remote execution.`
          : directRun
            ? `${agent.name} invocation started.`
            : "Invocation queued for Desktop Bridge."
    });
    if (policy.decision === "requires_local_approval") {
      const approval = createApprovalRequest(invocation, agent, policy);
      invocation.approvalRequestId = approval.id;
      policyRecord.approvalRequestId = approval.id;
    } else {
      appendEvent({
        invocationId: invocation.id,
        type: "invocation_authorized",
        level: "info",
        message: `Demo invocation authorized for ${agent.name}.`
      });
    }
    // Render applicable agent-skills into the resolved worktree (best-effort,
    // idempotent, git-excluded) so the agent sees them when the bridge runs it.
    // An auto-run seeds its decided role in metadata.role, so role-restricted
    // skills render only for their role; a run with no role gets the
    // unrestricted skills.
    if (projectWorktree?.worktreePath) {
      renderAgentSkillsIntoWorktree(agent, projectWorktree.worktreePath, state.agentSkills ?? [], {
        role: typeof requestedMetadata.role === "string" ? requestedMetadata.role : undefined,
      });
    }
    // Durable barrier: an accepted (queued/running) invocation has no lease to
    // recover it, so flush synchronously before returning — a crash in the
    // debounce window must not silently drop a run the caller was told exists.
    commitAccept();
    return invocation;
  }

  function createTrace(invocationId, agent = defaultAgent()) {
    const traceId = nextId("trc_demo");
    const spanId = nextId("spn_demo");
    const createdAt = now();
    const trace = {
      id: traceId,
      subjectType: "invocation",
      subjectId: invocationId,
      rootSpanId: spanId,
      createdAt
    };
    const span = {
      id: spanId,
      traceId,
      parentSpanId: null,
      name: "m0.remote_invocation",
      status: "started",
      startedAt: createdAt,
      endedAt: null,
      attributes: {
        deviceId: state.device.id,
        agentId: agent?.id ?? "unknown",
        adapterType: agent?.adapter.type ?? "unknown",
        transport: agent?.adapter.type === "http" ? "direct-http" : "polling-demo-websocket-baseline",
        queue: agent?.adapter.type === "http" ? "not-required" : "server-owned"
      }
    };
    state.traces.unshift(trace);
    state.spans.unshift(span);
    // Bound the traces view; the over-cap oldest are archived, not dropped. (Spans
    // are capped in the round-telemetry cap step, which caps the whole array.)
    state.traces = capWithArchive(state.traces, MAX_TRACES_TOTAL, "traces");
    return { id: traceId, rootSpanId: spanId };
  }

  return {
    createInvocation,
  };
}

function runsWithoutBridge(agent) {
  return agent.adapter.type === "platform" || (agent.adapter.type === "http" && agent.location.type === "remote_http");
}

function maybeEnforcePlatformAiQuota({ invocationId, agent, options, enforcePlatformAiQuota }) {
  const metadata = options.metadata && typeof options.metadata === "object" && !Array.isArray(options.metadata) ? options.metadata : {};
  if (!metadata.platformManagedAi || typeof enforcePlatformAiQuota !== "function") {
    return null;
  }
  return enforcePlatformAiQuota({
    invocationId,
    userId: options.actor?.userId ?? "usr_local",
    teamId: metadata.teamId ?? options.actor?.teamId,
    agentId: agent.id,
    provider: metadata.provider ?? "openai",
    model: metadata.model ?? "default",
    requestCount: metadata.requestCount ?? 1,
    estimatedCost: metadata.estimatedCost ?? "0",
    costOwner: metadata.costOwner ?? agent.economics?.costOwner ?? options.actor?.userId ?? "usr_local",
    allowedModels: metadata.allowedModels,
    credentialState: metadata.credentialState,
  });
}
