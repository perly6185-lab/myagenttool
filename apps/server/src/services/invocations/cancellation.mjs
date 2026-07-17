export function createInvocationCancellationRuntime({
  state,
  now,
  appendEvent,
  findAgent,
  findApprovalRequest,
  abortDirectHttpRun,
  createAuditSummary,
  recordAgentUsage,
  isTerminal,
}) {
  function cancelInvocation(invocation, actor = null) {
    if (isTerminal(invocation.status)) {
      return;
    }
    const requestedBy = actor?.userId ?? "usr_local";
    const agent = findAgent(invocation.agentId);
    invocation.cancellation.requestedBy = requestedBy;
    invocation.cancellation.requestedAt = now();
    invocation.cancellation.reason = "Requested from Web Console.";

    if (["queued", "waiting_for_local_approval"].includes(invocation.status)) {
      cancelQueuedInvocation(invocation, {
        cancellationReason: "Requested from Web Console.",
        eventType: "cancel_requested",
        eventMessage: "Queued invocation cancellation requested.",
        auditSummary: "Cancelled before local execution.",
        requestedBy,
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
      if (abortDirectHttpRun(invocation)) {
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

  function cancelQueuedInvocation(invocation, { cancellationReason, eventType, eventMessage, auditSummary, requestedBy = "usr_local" }) {
    const completedAt = now();
    const appliedMessage = "Invocation cancelled before execution.";
    invocation.status = "cancelled";
    invocation.cancellation.state = "queued_cancelled";
    invocation.cancellation.requestedBy = requestedBy;
    invocation.cancellation.requestedAt = completedAt;
    invocation.cancellation.reason = cancellationReason;
    invocation.cancellation.appliedAt = completedAt;
    invocation.cancellation.message = appliedMessage;
    invocation.completedAt = completedAt;
    invocation.updatedAt = completedAt;
    const pendingApproval = invocation.approvalRequestId ? findApprovalRequest(invocation.approvalRequestId) : null;
    if (pendingApproval?.status === "pending") {
      pendingApproval.status = "denied";
      pendingApproval.decidedAt = now();
      pendingApproval.decidedBy = requestedBy;
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
      message: appliedMessage
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

  return {
    cancelInvocation,
    cancelInvocationsForDeviceUnlink,
  };
}
