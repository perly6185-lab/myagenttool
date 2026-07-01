import { renderAgentSkillsIntoWorktree } from "../agent-skills.mjs";

export function createInvocationCreationRuntime({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  defaultAgent,
  currentProject,
  worktreeForProject,
  normalizeCodexApprovalMode,
  normalizeCodexSessionMode,
  normalizeCodexWorkspacePolicy,
  createManagedCodexWorkspace,
  createManagedCodexSession,
  evaluateInvocationPolicy,
  enforcePlatformAiQuota,
  createPolicyDecisionRecord,
  createApprovalRequest,
  completeRootSpan,
  createAuditSummary,
  recordAgentUsage,
}) {
  function createInvocation(task, agent = defaultAgent(), options = {}) {
    if (!agent) {
      throw new Error("No agent is registered.");
    }
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
    const codexSessionMode = normalizeCodexSessionMode(options.codexSessionMode, agent);
    const codexWorkspacePolicy = normalizeCodexWorkspacePolicy(options.codexWorkspacePolicy, agent);
    const managedCodexWorkspace = createManagedCodexWorkspace({ invocationId: id, agent, workspacePolicy: codexWorkspacePolicy });
    const managedCodexSession = createManagedCodexSession({ invocationId: id, agent, codexSessionMode, workspace: managedCodexWorkspace, actor: options.actor });
    const requestedMetadata = options.metadata && typeof options.metadata === "object" && !Array.isArray(options.metadata) ? options.metadata : {};
    const requestedWorktree = requestedMetadata.worktreeId
      ? state.worktrees.find((item) => item.id === requestedMetadata.worktreeId)
      : null;
    const visibleProject = requestedMetadata.projectId
      ? state.projects.find((item) => item.id === requestedMetadata.projectId) ?? currentProject()
      : requestedWorktree?.projectId
        ? state.projects.find((item) => item.id === requestedWorktree.projectId) ?? currentProject()
        : currentProject();
    const project = requestedWorktree?.workspaceProjectId
      ? state.projects.find((item) => item.id === requestedWorktree.workspaceProjectId) ?? visibleProject
      : visibleProject;
    const projectWorktree = requestedWorktree ?? worktreeForProject(project?.id);
    const invocation = {
      id,
      ideaSessionId: null,
      compareRunId: null,
      agentId: agent.id,
      projectId: visibleProject?.id ?? project?.id ?? null,
      worktreeId: projectWorktree?.id ?? null,
      // Prefer an explicit requestedBy (the scheduler passes the automation's
      // creator), then the acting user, then the local fallback.
      requestedBy: options.requestedBy ?? options.actor?.userId ?? "usr_local",
      status: quotaGate?.allowed === false ? "rejected" : policy.decision === "requires_local_approval" ? "waiting_for_local_approval" : directRun ? "running" : "queued",
      delivery: {
        deliveryId: nextId("del_demo"),
        deviceId: agent.location.type === "local_device" ? agent.location.deviceId : null,
        state: quotaGate?.allowed === false ? "not_required" : policy.decision === "requires_local_approval" ? "not_required" : directRun ? "not_required" : "queued",
        idempotencyKey: `idem_${id}`,
        leaseExpiresAt: null,
        dispatchAttempts: quotaGate?.allowed === false || policy.decision === "requires_local_approval" ? 0 : directRun ? 1 : 0,
        lastDispatchAt: quotaGate?.allowed === false || policy.decision === "requires_local_approval" ? null : directRun ? createdAt : null,
        acknowledgedAt: quotaGate?.allowed === false || policy.decision === "requires_local_approval" ? null : directRun ? createdAt : null,
        bridgeCursor: null,
        expiresAt: null
      },
      cancellation: {
        state: "none",
        requestedBy: null,
        requestedAt: null,
        reason: null
      },
      input: { task },
      options: {
        timeoutSeconds: Number(options.timeoutSeconds ?? 30),
        requireLocalApproval: Boolean(options.requireLocalApproval ?? policy.decision === "requires_local_approval"),
        codexSessionMode,
        codexWorkspacePolicy,
        approvalMode: normalizeCodexApprovalMode(options.approvalMode ?? options.metadata?.permissionMode),
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
      appendEvent({
        invocationId: invocation.id,
        type: "invocation_rejected",
        level: "warn",
        message: quotaGate.quotaDecision.reason,
        data: { quotaDecisionId: quotaGate.quotaDecision.id, decision: quotaGate.quotaDecision.decision }
      });
      state.auditSummaries.push(createAuditSummary(invocation, quotaGate.quotaDecision.reason));
      recordAgentUsage(invocation, "rejected");
      persistStateSoon();
      return invocation;
    }
    appendEvent({
      invocationId: invocation.id,
      type: policy.decision === "requires_local_approval" ? "local_approval_requested" : directRun ? "invocation_started" : "delivery_queued",
      level: "info",
      message: policy.decision === "requires_local_approval" ? "Local approval is required before this high-risk invocation can run." : directRun ? `${agent.name} invocation started.` : "Invocation queued for Desktop Bridge."
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
    if (projectWorktree?.worktreePath) {
      renderAgentSkillsIntoWorktree(agent, projectWorktree.worktreePath, state.agentSkills ?? []);
    }
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
