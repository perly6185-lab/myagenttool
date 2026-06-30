import { isAgentDisabled } from "../agents.mjs";

export function createInvocationDispatchRuntime({
  state,
  now,
  appendEvent,
  dispatchLeaseMs,
  findAgent,
}) {
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

  return {
    acknowledgeInvocation,
    markDispatched,
    nextDispatchableInvocation,
    redeliverExpiredDispatches,
  };
}
