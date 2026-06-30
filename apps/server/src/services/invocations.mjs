import { cancellationTextForAdapter, isAgentDisabled, isCodexCliCommand } from "./agents.mjs";

export function createInvocationService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  dispatchLeaseMs,
  namespace,
  protocolVersion,
  findAgent,
  currentProject,
  worktreeForProject,
  uniqueStrings,
  normalizeCodexApprovalMode,
  normalizeCodexSessionMode,
  normalizeCodexWorkspacePolicy,
  createManagedCodexWorkspace,
  createManagedCodexSession,
  closeCodexSession,
}) {
  const directHttpRuns = new Map();

  function createInvocation(task, agent = defaultAgent(), options = {}) {
    if (!agent) {
      throw new Error("No agent is registered.");
    }
    const id = nextId("inv_demo");
    const createdAt = now();
    const trace = createTrace(id, agent);
    const policy = evaluateInvocationPolicy(agent, options);
    const directRun = runsWithoutBridge(agent);
    const codexSessionMode = normalizeCodexSessionMode(options.codexSessionMode, agent);
    const codexWorkspacePolicy = normalizeCodexWorkspacePolicy(options.codexWorkspacePolicy, agent);
    const managedCodexWorkspace = createManagedCodexWorkspace({ invocationId: id, agent, workspacePolicy: codexWorkspacePolicy });
    const managedCodexSession = createManagedCodexSession({ invocationId: id, agent, codexSessionMode, workspace: managedCodexWorkspace });
    const project = currentProject();
    const projectWorktree = worktreeForProject(project?.id);
    const invocation = {
      id,
      ideaSessionId: null,
      compareRunId: null,
      agentId: agent.id,
      requestedBy: "usr_local",
      status: policy.decision === "requires_local_approval" ? "waiting_for_local_approval" : directRun ? "running" : "queued",
      delivery: {
        deliveryId: nextId("del_demo"),
        deviceId: agent.location.type === "local_device" ? agent.location.deviceId : null,
        state: policy.decision === "requires_local_approval" ? "not_required" : directRun ? "not_required" : "queued",
        idempotencyKey: `idem_${id}`,
        leaseExpiresAt: null,
        dispatchAttempts: policy.decision === "requires_local_approval" ? 0 : directRun ? 1 : 0,
        lastDispatchAt: policy.decision === "requires_local_approval" ? null : directRun ? createdAt : null,
        acknowledgedAt: policy.decision === "requires_local_approval" ? null : directRun ? createdAt : null,
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
          projectId: project?.id ?? null,
          projectName: project?.name ?? null,
          projectPath: project?.path ?? null,
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
    return invocation;
  }

  function createCompareRun(task, agents, options = {}) {
    const createdAt = now();
    const compareRun = {
      id: nextId("cmp_demo"),
      task,
      requestedBy: "usr_local",
      status: "running",
      childInvocationIds: [],
      preferredInvocationId: null,
      summary: "Compare run started.",
      createdAt,
      updatedAt: createdAt
    };
    state.compareRuns.unshift(compareRun);
    for (const agent of agents) {
      const invocation = createInvocation(task, agent, {
        ...options,
        metadata: {
          ...(options.metadata && typeof options.metadata === "object" && !Array.isArray(options.metadata) ? options.metadata : {}),
          compareRunId: compareRun.id
        }
      });
      invocation.compareRunId = compareRun.id;
      compareRun.childInvocationIds.push(invocation.id);
      startInvocationIfAllowed(invocation, agent);
    }
    updateCompareRun(compareRun);
    return compareRun;
  }

  function evaluateInvocationPolicy(agent, options = {}) {
    const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : [];
    const riskLevel = highestRiskLevel(capabilities.map((capability) => capability.riskLevel));
    const riskTags = uniqueStrings(capabilities.flatMap((capability) => capability.riskTags ?? []));
    const codexNativeControls = isCodexCliCommand(agent.adapter?.command);
    const requiresApproval = !codexNativeControls && (Boolean(options.requireLocalApproval) || ["high", "critical"].includes(riskLevel));
    return {
      decision: requiresApproval ? "requires_local_approval" : "allowed",
      reason: requiresApproval
        ? `${agent.name} has ${riskLevel} risk capability tags and needs local approval before running.`
        : codexNativeControls
          ? `${agent.name} risk is ${riskLevel}; invocation is allowed and permissions are handled by Codex CLI native controls.`
          : `${agent.name} risk is ${riskLevel}; invocation is allowed by local policy.`,
      riskLevel,
      riskTags,
      summary: {
        risk: agent.registrationNotes?.risk ?? `${agent.name} reports ${riskLevel} risk for this capability.`,
        data: agent.registrationNotes?.data ?? "Task input, logs, trace, and result are recorded by the local demo server.",
        cost: agent.registrationNotes?.cost ?? costTextForAgent(agent),
        cancellation: agent.registrationNotes?.cancellation ?? cancellationTextForAdapter(agent.adapter)
      }
    };
  }

  function createPolicyDecisionRecord(invocation, agent, policy) {
    const record = {
      id: nextId("pdr_demo"),
      invocationId: invocation.id,
      agentId: agent.id,
      action: "invoke",
      riskLevel: policy.riskLevel,
      riskTags: policy.riskTags,
      decision: policy.decision,
      reason: policy.reason,
      approvalRequestId: null,
      approver: null,
      createdAt: now()
    };
    state.policyDecisionRecords.unshift(record);
    state.policyDecisionRecords = state.policyDecisionRecords.slice(0, 200);
    return record;
  }

  function createApprovalRequest(invocation, agent, policy) {
    const approval = {
      id: nextId("apr_demo"),
      invocationId: invocation.id,
      agentId: agent.id,
      requestedBy: invocation.requestedBy,
      status: "pending",
      riskLevel: policy.riskLevel,
      riskTags: policy.riskTags,
      summary: policy.summary,
      createdAt: now(),
      decidedAt: null,
      decidedBy: null
    };
    state.approvalRequests.unshift(approval);
    state.approvalRequests = state.approvalRequests.slice(0, 200);
    return approval;
  }

  function highestRiskLevel(levels) {
    const order = ["low", "medium", "high", "critical"];
    let highest = "low";
    for (const level of levels) {
      const normalized = order.includes(level) ? level : "medium";
      if (order.indexOf(normalized) > order.indexOf(highest)) {
        highest = normalized;
      }
    }
    return highest;
  }

  function costTextForAgent(agent) {
    if (agent.economics?.model && agent.economics.model !== "unknown") {
      return `${agent.economics.model} cost policy: ${agent.economics.unknownCostPolicy ?? "unknown"}.`;
    }
    return "Cost is unknown and no billing is performed by the demo server.";
  }

  function startInvocationIfAllowed(invocation, agent = findAgent(invocation.agentId)) {
    if (!agent || invocation.status === "waiting_for_local_approval" || isTerminal(invocation.status)) {
      return;
    }
    if (agent.adapter.type === "http" && agent.location.type === "remote_http") {
      queueMicrotask(() => runHttpInvocation(invocation, agent).catch((error) => {
        completeInvocation(invocation, {
          status: "failed",
          summary: `HTTP Agent failed: ${error instanceof Error ? error.message : String(error)}`,
          result: null
        });
      }));
    }
  }

  function runsWithoutBridge(agent) {
    return agent.adapter.type === "platform" || (agent.adapter.type === "http" && agent.location.type === "remote_http");
  }

  function approveInvocation(approval, invocation) {
    if (approval.status !== "pending" || invocation.status !== "waiting_for_local_approval") {
      return;
    }
    const agent = findAgent(invocation.agentId);
    approval.status = "approved";
    approval.decidedAt = now();
    approval.decidedBy = "usr_local";
    invocation.status = agent?.adapter.type === "http" ? "running" : "queued";
    invocation.delivery.state = agent?.adapter.type === "http" ? "not_required" : "queued";
    invocation.delivery.dispatchAttempts = agent?.adapter.type === "http" ? 1 : 0;
    invocation.delivery.lastDispatchAt = agent?.adapter.type === "http" ? now() : null;
    invocation.delivery.acknowledgedAt = agent?.adapter.type === "http" ? now() : null;
    invocation.updatedAt = now();
    const policyRecord = state.policyDecisionRecords.find((item) => item.id === invocation.policyDecisionId);
    if (policyRecord) {
      policyRecord.decision = "allowed";
      policyRecord.approver = "usr_local";
      policyRecord.reason = "Local approval granted for high-risk invocation.";
    }
    appendEvent({
      invocationId: invocation.id,
      type: "local_approval_granted",
      level: "info",
      message: "Local approval granted. Invocation can run.",
      data: { approvalRequestId: approval.id }
    });
    appendEvent({
      invocationId: invocation.id,
      type: "invocation_authorized",
      level: "info",
      message: `Invocation authorized after local approval for ${agent?.name ?? invocation.agentId}.`
    });
    appendEvent({
      invocationId: invocation.id,
      type: agent?.adapter.type === "http" ? "invocation_started" : "delivery_queued",
      level: "info",
      message: agent?.adapter.type === "http" ? "HTTP Agent invocation started after approval." : "Invocation queued for Desktop Bridge after approval."
    });
    startInvocationIfAllowed(invocation, agent);
  }

  function denyInvocation(approval, invocation) {
    if (approval.status !== "pending" || invocation.status !== "waiting_for_local_approval") {
      return;
    }
    approval.status = "denied";
    approval.decidedAt = now();
    approval.decidedBy = "usr_local";
    invocation.status = "rejected";
    invocation.completedAt = now();
    invocation.updatedAt = now();
    completeRootSpan(invocation, "failed");
    const policyRecord = state.policyDecisionRecords.find((item) => item.id === invocation.policyDecisionId);
    if (policyRecord) {
      policyRecord.decision = "denied";
      policyRecord.approver = "usr_local";
      policyRecord.reason = "Local approval denied by user.";
    }
    appendEvent({
      invocationId: invocation.id,
      type: "local_approval_denied",
      level: "warn",
      message: "Local approval denied. Invocation was not executed.",
      data: { approvalRequestId: approval.id }
    });
    appendEvent({
      invocationId: invocation.id,
      type: "invocation_rejected",
      level: "warn",
      message: "Invocation rejected before execution."
    });
    state.auditSummaries.push(createAuditSummary(invocation, "Local approval denied before execution."));
    recordAgentUsage(invocation, "rejected");
  }

  function nextDispatchableInvocation() {
    return state.invocations.find((item) => {
      if (item.status !== "queued" || !["queued", "redelivering"].includes(item.delivery.state)) {
        return false;
      }
      const agent = findAgent(item.agentId);
      if (!agent) {
        return false;
      }
      return !isAgentDisabled(agent) && agent?.health?.status !== "unhealthy";
    });
  }

  function markDispatched(invocation) {
    invocation.status = "dispatching";
    invocation.delivery.state = "dispatching";
    invocation.delivery.dispatchAttempts += 1;
    invocation.delivery.lastDispatchAt = now();
    invocation.delivery.leaseExpiresAt = new Date(Date.now() + dispatchLeaseMs).toISOString();
    invocation.delivery.bridgeCursor = `cursor_${invocation.delivery.dispatchAttempts}_${invocation.id}`;
    invocation.updatedAt = now();
    appendEvent({
      invocationId: invocation.id,
      type: invocation.delivery.dispatchAttempts > 1 ? "delivery_redelivered" : "delivery_dispatched",
      level: "info",
      message: invocation.delivery.dispatchAttempts > 1 ? "Invocation redelivered to Desktop Bridge." : "Invocation dispatched to Desktop Bridge.",
      data: {
        dispatchAttempts: invocation.delivery.dispatchAttempts,
        leaseExpiresAt: invocation.delivery.leaseExpiresAt,
        bridgeCursor: invocation.delivery.bridgeCursor
      }
    });
  }

  function acknowledgeInvocation(invocation) {
    if (invocation.delivery.state === "acknowledged" || invocation.status === "running") {
      return;
    }
    invocation.delivery.state = "acknowledged";
    invocation.delivery.acknowledgedAt = now();
    invocation.delivery.leaseExpiresAt = null;
    invocation.status = "running";
    invocation.updatedAt = now();
    appendEvent({
      invocationId: invocation.id,
      type: "delivery_acknowledged",
      level: "info",
      message: "Desktop Bridge acknowledged durable receipt."
    });
    appendEvent({
      invocationId: invocation.id,
      type: "invocation_started",
      level: "info",
      message: "Demo CLI Agent started."
    });
  }

  function completeInvocation(invocation, body) {
    if (isTerminal(invocation.status)) {
      return;
    }
    const terminalStatus =
      body.status === "cancelled"
        ? "cancelled"
        : body.status === "timed_out"
          ? "timed_out"
          : body.status === "failed"
            ? "failed"
            : "succeeded";
    invocation.status = terminalStatus;
    invocation.result = body.result ?? null;
    invocation.completedAt = now();
    invocation.updatedAt = now();
    completeRootSpan(invocation, terminalStatus);
    if (terminalStatus === "cancelled") {
      invocation.cancellation.state = "applied";
    }

    appendEvent({
      invocationId: invocation.id,
      type:
        terminalStatus === "succeeded"
          ? "invocation_succeeded"
          : terminalStatus === "cancelled"
            ? "cancel_applied"
            : terminalStatus === "timed_out"
              ? "invocation_timed_out"
              : "invocation_failed",
      level: terminalStatus === "succeeded" ? "info" : "warn",
      message: body.summary ?? `Invocation ${terminalStatus}.`,
      data: body.result ?? null
    });
    state.auditSummaries.push(createAuditSummary(invocation, body.summary ?? null));
    recordAgentUsage(invocation, terminalStatus);
    closeCodexSession(invocation, terminalStatus);
    updateCompareRunForInvocation(invocation);
    persistStateSoon();
  }

  function updateCompareRunForInvocation(invocation) {
    if (!invocation.compareRunId) {
      return;
    }
    const compareRun = state.compareRuns.find((item) => item.id === invocation.compareRunId);
    if (compareRun) {
      updateCompareRun(compareRun);
    }
  }

  function updateCompareRun(compareRun) {
    const children = compareRun.childInvocationIds.map((id) => findInvocation(id)).filter(Boolean);
    const terminal = children.filter((child) => isTerminal(child.status));
    compareRun.status = terminal.length === children.length
      ? children.some((child) => child.status === "succeeded") ? "completed" : "failed"
      : "running";
    compareRun.summary = `${terminal.length}/${children.length} agent run(s) finished.`;
    const firstSuccess = children.find((child) => child.status === "succeeded");
    compareRun.preferredInvocationId = compareRun.preferredInvocationId ?? firstSuccess?.id ?? null;
    compareRun.updatedAt = now();
    persistStateSoon();
  }

  function recordAgentUsage(invocation, terminalStatus) {
    const agent = findAgent(invocation.agentId);
    const summary = getAgentUsageSummary(invocation.agentId);
    summary.invocationCount += 1;
    if (terminalStatus === "succeeded") {
      summary.succeededCount += 1;
    } else if (terminalStatus === "failed" || terminalStatus === "timed_out" || terminalStatus === "expired" || terminalStatus === "rejected") {
      summary.failedCount += 1;
    } else if (terminalStatus === "cancelled") {
      summary.cancelledCount += 1;
    }
    summary.lastInvocationId = invocation.id;
    summary.lastInvocationStatus = terminalStatus;
    summary.costOwner = agent?.economics?.costOwner ?? "unknown";
    summary.economicModel = agent?.economics?.model ?? "unknown";
    summary.currency = agent?.economics?.currency ?? "USD";
    summary.unknownCostVisible = summary.economicModel === "unknown";
    summary.updatedAt = now();
    persistStateSoon();
  }

  function getAgentUsageSummary(agentId) {
    let summary = state.agentUsageSummaries.find((item) => item.agentId === agentId);
    if (!summary) {
      const agent = findAgent(agentId);
      summary = {
        agentId,
        invocationCount: 0,
        succeededCount: 0,
        failedCount: 0,
        cancelledCount: 0,
        lastInvocationId: null,
        lastInvocationStatus: null,
        costOwner: agent?.economics?.costOwner ?? "unknown",
        economicModel: agent?.economics?.model ?? "unknown",
        currency: agent?.economics?.currency ?? "USD",
        unknownCostVisible: (agent?.economics?.model ?? "unknown") === "unknown",
        updatedAt: null
      };
      state.agentUsageSummaries.push(summary);
    }
    return summary;
  }

  function createTroubleshootingReport(targetInvocation) {
    const platformAgent = findAgent("agt_platform_troubleshooter");
    if (!platformAgent) {
      throw new Error("Platform troubleshooting agent is not registered.");
    }
    const platformInvocation = createInvocation(`Troubleshoot invocation ${targetInvocation.id}`, platformAgent, {
      metadata: { targetInvocationId: targetInvocation.id }
    });
    appendEvent({
      invocationId: platformInvocation.id,
      type: "platform_agent_started",
      level: "info",
      message: `Invocation Troubleshooter started for ${targetInvocation.id}.`,
      data: { targetInvocationId: targetInvocation.id }
    });

    const report = buildTroubleshootingReport(targetInvocation, platformAgent);
    state.troubleshootingReports.unshift(report);
    state.troubleshootingReports = state.troubleshootingReports.slice(0, 100);

    appendEvent({
      invocationId: platformInvocation.id,
      type: "platform_agent_recommended",
      level: "info",
      message: report.summary,
      data: {
        targetInvocationId: targetInvocation.id,
        reportId: report.id,
        suggestedFixes: report.suggestedFixes,
        remediationRequiresApproval: report.remediationRequiresApproval
      }
    });
    appendEvent({
      invocationId: platformInvocation.id,
      type: "platform_agent_action_requested",
      level: "info",
      message: "Suggested fixes are advisory only; remediation must be approved and run through normal workflows.",
      data: { targetInvocationId: targetInvocation.id, reportId: report.id }
    });
    completeInvocation(platformInvocation, {
      status: "succeeded",
      summary: report.summary,
      result: {
        summary: report.summary,
        output: report,
        touchedUserFiles: false,
        cost: { model: platformAgent.economics.model, billable: false }
      }
    });
    return report;
  }

  function buildTroubleshootingReport(invocation, platformAgent) {
    const agent = findAgent(invocation.agentId);
    const events = state.events.filter((item) => item.invocationId === invocation.id).reverse();
    const logEvents = events.filter((item) => item.type === "log" || item.type === "agent_output");
    const audit = state.auditSummaries.find((item) => item.invocationId === invocation.id);
    const adapterError = findAdapterError(invocation, events, audit);
    const bridgeState = bridgeStateSummary(invocation, agent);
    const suggestedFixes = troubleshootingFixes(invocation, agent, adapterError);
    return {
      id: nextId("trb_demo"),
      invocationId: invocation.id,
      platformAgentId: platformAgent.id,
      requestedBy: "usr_local",
      status: "generated",
      failedStatus: invocation.status,
      bridgeState,
      adapterError,
      logSummary: summarizeLogs(logEvents),
      suggestedFixes,
      remediationRequiresApproval: true,
      summary: `Troubleshooter reviewed ${invocation.id}: status ${invocation.status}; ${adapterError ?? "no adapter error text recorded"}.`,
      createdAt: now()
    };
  }

  function findAdapterError(invocation, events, audit) {
    if (audit?.errorSummary) {
      return audit.errorSummary;
    }
    const failedEvent = events.find((event) => ["invocation_failed", "cancel_failed", "local_approval_denied"].includes(event.type));
    if (failedEvent?.message) {
      return failedEvent.message;
    }
    if (invocation.status === "cancelled") {
      return invocation.cancellation?.reason ?? "Invocation was cancelled before completion.";
    }
    if (invocation.status === "rejected") {
      return "Invocation was rejected before execution.";
    }
    return null;
  }

  function bridgeStateSummary(invocation, agent) {
    if (agent?.location?.type !== "local_device") {
      return `No Desktop Bridge delivery required; delivery state is ${invocation.delivery?.state ?? "unknown"}.`;
    }
    return `Device ${state.device.status}; delivery state ${invocation.delivery?.state ?? "unknown"}; attempts ${invocation.delivery?.dispatchAttempts ?? 0}.`;
  }

  function summarizeLogs(logEvents) {
    if (logEvents.length === 0) {
      return "No agent log events were recorded.";
    }
    const latest = logEvents.slice(-3).map((event) => event.message).filter(Boolean);
    return `${logEvents.length} log event(s). Latest: ${latest.join(" | ")}`;
  }

  function troubleshootingFixes(invocation, agent, adapterError) {
    const fixes = [];
    if (agent?.location?.type === "local_device" && state.device.status !== "online") {
      fixes.push("Start or reconnect Desktop Bridge, then retry the task.");
    }
    if (invocation.delivery?.dispatchAttempts === 0 && invocation.delivery?.state === "queued") {
      fixes.push("Check whether the agent is disabled, unhealthy, or waiting for the bridge.");
    }
    if (agent?.health?.status === "unhealthy") {
      fixes.push("Run an agent health check after fixing the reported health issue.");
    }
    if (adapterError?.toLowerCase().includes("http")) {
      fixes.push("Verify the HTTP agent URL, request path, and local service logs.");
    }
    if (invocation.status === "rejected") {
      fixes.push("Review the local approval request before retrying high-risk work.");
    }
    if (fixes.length === 0) {
      fixes.push("Review the event timeline and retry after confirming the selected agent setup.");
    }
    fixes.push("Do not apply remediation automatically; use the normal approved workflow for changes.");
    return fixes;
  }

  async function runHttpInvocation(invocation, agent) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Number(agent.adapter.timeoutSeconds ?? invocation.options.timeoutSeconds ?? 30) * 1000);
    directHttpRuns.set(invocation.id, controller);
    appendEvent({
      invocationId: invocation.id,
      type: "log",
      level: "info",
      message: `HTTP Agent request started for ${agent.name}.`
    });

    try {
      const url = new URL(agent.adapter.requestPath ?? "/invoke", agent.adapter.baseUrl);
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invocationId: invocation.id,
          task: invocation.input.task,
          input: invocation.input,
          options: invocation.options
        })
      });

      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { output: text };
      }

      if (!response.ok) {
        completeInvocation(invocation, {
          status: "failed",
          summary: payload?.summary ?? `HTTP Agent failed with status ${response.status}.`,
          result: payload
        });
        return;
      }

      completeInvocation(invocation, {
        status: "succeeded",
        summary: payload?.summary ?? "HTTP Agent completed.",
        result: payload
      });
    } catch (error) {
      if (timedOut) {
        completeInvocation(invocation, {
          status: "timed_out",
          summary: "HTTP Agent request timed out.",
          result: null
        });
        return;
      }
      if (controller.signal.aborted) {
        completeInvocation(invocation, {
          status: "cancelled",
          summary: "HTTP Agent request was cancelled.",
          result: null
        });
        return;
      }
      completeInvocation(invocation, {
        status: "failed",
        summary: `HTTP Agent request failed: ${error instanceof Error ? error.message : String(error)}`,
        result: null
      });
    } finally {
      clearTimeout(timeout);
      directHttpRuns.delete(invocation.id);
    }
  }

  function redeliverExpiredDispatches() {
    const current = Date.now();
    for (const invocation of state.invocations) {
      if (invocation.status !== "dispatching" || invocation.delivery.state !== "dispatching" || !invocation.delivery.leaseExpiresAt) {
        continue;
      }
      if (Date.parse(invocation.delivery.leaseExpiresAt) > current) {
        continue;
      }
      invocation.status = "queued";
      invocation.delivery.state = "redelivering";
      invocation.updatedAt = now();
      appendEvent({
        invocationId: invocation.id,
        type: "delivery_redelivered",
        level: "warn",
        message: "Dispatch lease expired; invocation returned to queue for redelivery.",
        data: { dispatchAttempts: invocation.delivery.dispatchAttempts }
      });
    }
  }

  function cancelInvocation(invocation) {
    if (isTerminal(invocation.status)) {
      return;
    }
    const agent = findAgent(invocation.agentId);
    invocation.cancellation.requestedBy = "usr_local";
    invocation.cancellation.requestedAt = now();
    invocation.cancellation.reason = "Requested from Web Console.";

    if (["queued", "waiting_for_local_approval"].includes(invocation.status)) {
      cancelQueuedInvocation(invocation, {
        cancellationReason: "Requested from Web Console.",
        eventType: "cancel_requested",
        eventMessage: "Queued invocation cancellation requested.",
        auditSummary: "Cancelled before local execution."
      });
      return;
    }

    invocation.status = "cancelling";
    invocation.cancellation.state = "requested";
    invocation.updatedAt = now();
    appendEvent({
      invocationId: invocation.id,
      type: "cancel_requested",
      level: "info",
      message: "Running invocation cancellation requested."
    });

    if (agent?.adapter.type === "http") {
      const controller = directHttpRuns.get(invocation.id);
      if (controller) {
        appendEvent({
          invocationId: invocation.id,
          type: "cancel_dispatched",
          level: "info",
          message: "Server aborted the HTTP Agent request."
        });
        controller.abort();
        return;
      }
      if (agent.adapter.cancellation === "unsupported") {
        invocation.cancellation.state = "not_supported";
        appendEvent({
          invocationId: invocation.id,
          type: "cancel_failed",
          level: "warn",
          message: "HTTP Agent cancellation is not supported."
        });
        state.auditSummaries.push(createAuditSummary(invocation, "HTTP cancellation is not supported."));
      }
    }
  }

  function cancelQueuedInvocation(invocation, { cancellationReason, eventType, eventMessage, auditSummary }) {
    invocation.status = "cancelled";
    invocation.cancellation.state = "queued_cancelled";
    invocation.cancellation.requestedBy = "usr_local";
    invocation.cancellation.requestedAt = now();
    invocation.cancellation.reason = cancellationReason;
    invocation.completedAt = now();
    invocation.updatedAt = now();
    const pendingApproval = invocation.approvalRequestId ? findApprovalRequest(invocation.approvalRequestId) : null;
    if (pendingApproval?.status === "pending") {
      pendingApproval.status = "denied";
      pendingApproval.decidedAt = now();
      pendingApproval.decidedBy = "usr_local";
    }
    appendEvent({
      invocationId: invocation.id,
      type: eventType,
      level: eventType === "device_queue_cancelled" ? "warn" : "info",
      message: eventMessage
    });
    appendEvent({
      invocationId: invocation.id,
      type: "cancel_applied",
      level: "info",
      message: "Invocation cancelled before execution."
    });
    state.auditSummaries.push(createAuditSummary(invocation, auditSummary));
    recordAgentUsage(invocation, "cancelled");
  }

  function requestRunningDeviceCancellation(invocation) {
    invocation.status = "cancelling";
    invocation.cancellation.state = "requested";
    invocation.cancellation.requestedBy = "usr_local";
    invocation.cancellation.requestedAt = now();
    invocation.cancellation.reason = "Device unlink requested cancellation for running local work.";
    invocation.updatedAt = now();
    appendEvent({
      invocationId: invocation.id,
      type: "cancel_requested",
      level: "warn",
      message: "Device unlink requested cancellation for running local work."
    });
  }

  function cancelInvocationsForDeviceUnlink() {
    for (const invocation of state.invocations.filter((item) => ["queued", "waiting_for_local_approval"].includes(item.status))) {
      cancelQueuedInvocation(invocation, {
        cancellationReason: "Device unlinked before dispatch.",
        eventType: "device_queue_cancelled",
        eventMessage: "Queued invocation cancelled because the device was unlinked.",
        auditSummary: "Device unlink cancelled queued local work."
      });
    }
    for (const invocation of state.invocations.filter((item) => ["dispatching", "running"].includes(item.status))) {
      requestRunningDeviceCancellation(invocation);
    }
  }

  function createAuditSummary(invocation, summary) {
    return {
      invocationId: invocation.id,
      requesterId: invocation.requestedBy,
      agentId: invocation.agentId,
      deviceId: invocation.delivery.deviceId,
      status: invocation.status,
      permissionDecision: invocation.status === "rejected" ? "denied" : "allowed",
      traceId: invocation.traceId ?? null,
      startedAt: invocation.createdAt,
      completedAt: invocation.completedAt ?? now(),
      resultSummary: invocation.status === "succeeded" ? summary : null,
      errorSummary: invocation.status === "succeeded" ? null : summary,
      dataStored: true,
      costSummary: "Demo agent cost is unknown; no billing was performed.",
      metadata: { namespace, protocolVersion }
    };
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

  function completeRootSpan(invocation, terminalStatus) {
    const span = state.spans.find((item) => item.id === invocation.rootSpanId);
    if (!span || span.endedAt) {
      return;
    }
    span.status = terminalStatus === "succeeded" ? "succeeded" : terminalStatus === "cancelled" ? "cancelled" : "failed";
    span.endedAt = now();
  }

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
