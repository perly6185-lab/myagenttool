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

  return {
    cancelInvocation,
    cancelInvocationsForDeviceUnlink,
  };
}
