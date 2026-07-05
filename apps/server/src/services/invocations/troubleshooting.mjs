import {
  applicationRunWebLinkFromInvocation,
  invocationWebLink,
} from "../../read-models/web-navigation.mjs";

export function createInvocationTroubleshootingRuntime({
  state,
  now,
  nextId,
  appendEvent,
  findAgent,
  createInvocation,
  completeInvocation,
}) {
  function createTroubleshootingReport(targetInvocation, actor = null) {
    const platformAgent = findAgent("agt_platform_troubleshooter");
    if (!platformAgent) {
      throw new Error("Platform troubleshooting agent is not registered.");
    }
    const platformInvocation = createInvocation(`Troubleshoot invocation ${targetInvocation.id}`, platformAgent, {
      actor,
      metadata: {
        targetInvocationId: targetInvocation.id,
        projectId: targetInvocation.projectId ?? targetInvocation.options?.metadata?.projectId ?? null,
        worktreeId: targetInvocation.worktreeId ?? targetInvocation.options?.metadata?.worktreeId ?? null,
      }
    });
    appendEvent({
      invocationId: platformInvocation.id,
      type: "platform_agent_started",
      level: "info",
      message: `Invocation Troubleshooter started for ${targetInvocation.id}.`,
      data: { targetInvocationId: targetInvocation.id }
    });

    const report = buildTroubleshootingReport(targetInvocation, platformAgent, platformInvocation, actor);
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

  function buildTroubleshootingReport(invocation, platformAgent, platformInvocation, actor = null) {
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
      troubleshooterInvocationId: platformInvocation?.id ?? null,
      platformAgentId: platformAgent.id,
      requestedBy: actor?.userId ?? "usr_local",
      status: "generated",
      failedStatus: invocation.status,
      bridgeState,
      adapterError,
      logSummary: summarizeLogs(logEvents),
      suggestedFixes,
      remediationRequiresApproval: true,
      webLinks: troubleshootingWebLinks(invocation, platformInvocation),
      summary: `Troubleshooter reviewed ${invocation.id}: status ${invocation.status}; ${adapterError ?? "no adapter error text recorded"}.`,
      createdAt: now()
    };
  }

  function troubleshootingWebLinks(invocation, platformInvocation) {
    const applicationRun = applicationRunWebLinkFromInvocation(invocation);
    return {
      failedInvocation: invocationWebLink(invocation.id, "Open failed invocation"),
      troubleshooterInvocation: invocationWebLink(platformInvocation?.id, "Open troubleshooter invocation"),
      ...(applicationRun ? { applicationRun } : {}),
    };
  }

  function bridgeStateSummary(invocation, agent) {
    if (agent?.location?.type !== "local_device") {
      return `No Desktop Bridge delivery required; delivery state is ${invocation.delivery?.state ?? "unknown"}.`;
    }
    return `Device ${state.device.status}; delivery state ${invocation.delivery?.state ?? "unknown"}; attempts ${invocation.delivery?.dispatchAttempts ?? 0}.`;
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

  return {
    createTroubleshootingReport,
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

function summarizeLogs(logEvents) {
  if (logEvents.length === 0) {
    return "No agent log events were recorded.";
  }
  const latest = logEvents.slice(-3).map((event) => event.message).filter(Boolean);
  return `${logEvents.length} log event(s). Latest: ${latest.join(" | ")}`;
}
