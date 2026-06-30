import { createInvocationApprovalRuntime } from "./invocations/approval.mjs";
import { createInvocationCompletionRuntime } from "./invocations/completion.mjs";
import { createInvocationCreationRuntime } from "./invocations/creation.mjs";
import { createInvocationDispatchRuntime } from "./invocations/dispatch.mjs";

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
  });
  const { createInvocation } = createInvocationCreationRuntime({
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
    createPolicyDecisionRecord,
    createApprovalRequest,
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
  });

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
