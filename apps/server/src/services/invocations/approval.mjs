import { cancellationTextForAdapter, isCodexCliCommand } from "../agents.mjs";

export function createInvocationApprovalRuntime({
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
}) {
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
    state.auditSummaries.push({
      ...createAuditSummary(invocation, "Local approval denied before execution."),
      permissionDecision: "denied",
      errorSummary: "Local approval denied before execution.",
    });
    recordAgentUsage(invocation, "rejected");
  }

  return {
    approveInvocation,
    createApprovalRequest,
    createPolicyDecisionRecord,
    denyInvocation,
    evaluateInvocationPolicy,
  };
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
