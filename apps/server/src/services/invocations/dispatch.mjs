import { isAgentDisabled } from "../agents.mjs";

export function createInvocationDispatchRuntime({
  state,
  now,
  appendEvent,
  dispatchLeaseMs,
  findAgent,
  completeInvocation,
}) {
  // The directory a run occupies. Two runs in the same worktree (or the same
  // base project) must not execute concurrently — they'd write the same tree.
  function invocationDirKey(invocation) {
    const meta = invocation.input?.metadata ?? {};
    return meta.worktreePath || meta.projectPath || "__default__";
  }

  // Bridge-executed = a run that consumes this device's compute (CLI, a locally
  // spawned stdio MCP server, container). Off-device work (remote_http/platform,
  // a2a, and http-transport MCP — the bridge only drives the client; the work
  // happens on the remote server) must not consume a bridge concurrency slot.
  // Unknown agent → count it (conservative for the cap).
  function isBridgeExecuted(invocation) {
    const agent = findAgent(invocation.agentId);
    if (!agent) return true;
    if (agent.location?.type !== "local_device") return false;
    if (!belongsToThisBridge(invocation, agent)) return false;
    const adapter = agent.adapter ?? {};
    if (adapter.type === "mcp") return adapter.transport !== "http";
    return ["cli", "container"].includes(adapter.type);
  }

  function belongsToThisBridge(invocation, agent) {
    const deliveryDeviceId = invocation.delivery?.deviceId ?? null;
    const agentDeviceId = agent?.location?.type === "local_device" ? agent.location.deviceId : null;
    const deviceId = deliveryDeviceId ?? agentDeviceId;
    return deviceId === state.device.id;
  }

  // Force a terminal status on runs stuck in "cancelling" past a grace (e.g. the
  // bridge died mid-cancel). Otherwise they'd hold a concurrency slot and lock
  // their worktree forever. Grace ≥ twice the dispatch lease so a legitimately-
  // still-killing process isn't reclaimed early.
  const cancelGraceMs = Math.max(60_000, (dispatchLeaseMs ?? 30_000) * 2);
  function reclaimStuckCancellations() {
    if (typeof completeInvocation !== "function") return;
    const cutoff = Date.now() - cancelGraceMs;
    for (const invocation of state.invocations) {
      if (invocation.status !== "cancelling") continue;
      const since = Date.parse(invocation.cancellation?.requestedAt ?? invocation.updatedAt ?? "");
      if (Number.isFinite(since) && since > cutoff) continue;
      completeInvocation(invocation, {
        status: "cancelled",
        summary: "Cancellation reclaimed after grace — the bridge did not confirm completion.",
        result: null,
      });
    }
  }

  function nextDispatchableInvocation() {
    reclaimStuckCancellations();
    // Only bridge-executed runs count toward the device cap: a long-running
    // platform/HTTP agent (off-device) must not consume a bridge slot and
    // starve CLI dispatch.
    const inFlight = state.invocations.filter(
      (i) => ["dispatching", "running", "cancelling"].includes(i.status) && isBridgeExecuted(i),
    );
    // Authoritative cross-worktree concurrency cap.
    if (inFlight.length >= (state.device.maxConcurrency || 1)) {
      return undefined;
    }
    // Directories occupied by an in-flight run: skip a queued task whose cwd is
    // busy so the bridge can run other worktrees concurrently without two agents
    // writing the same directory.
    const busyDirs = new Set(inFlight.map(invocationDirKey));
    return state.invocations.find((item) => {
      if (item.status !== "queued" || !["queued", "redelivering"].includes(item.delivery.state)) {
        return false;
      }
      if (busyDirs.has(invocationDirKey(item))) {
        return false;
      }
      const agent = findAgent(item.agentId);
      if (!agent) {
        return false;
      }
      if (agent.location?.type === "local_device" && !belongsToThisBridge(item, agent)) {
        return false;
      }
      return !isAgentDisabled(agent) && agent?.health?.status !== "unhealthy";
    });
  }

  function markDispatched(invocation) {
    invocation.status = "dispatching";
    invocation.delivery.state = "dispatching";
    if (invocation.delivery.deviceId == null) {
      invocation.delivery.deviceId = state.device.id;
    }
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

  // A bridge that leases but never acks would otherwise ping-pong forever
  // (expire → requeue → re-lease …). After this many leased-and-lapsed attempts
  // the delivery is exhausted: an honest terminal failure whose errorCode routes
  // it to the dispatch_timeout recovery category (rerun recommended).
  const MAX_DISPATCH_ATTEMPTS = 5;

  function redeliverExpiredDispatches() {
    const current = Date.now();
    for (const invocation of state.invocations) {
      if (invocation.status !== "dispatching" || invocation.delivery.state !== "dispatching" || !invocation.delivery.leaseExpiresAt) {
        continue;
      }
      if (Date.parse(invocation.delivery.leaseExpiresAt) > current) {
        continue;
      }
      if (invocation.delivery.dispatchAttempts >= MAX_DISPATCH_ATTEMPTS && typeof completeInvocation === "function") {
        invocation.delivery.state = "exhausted";
        appendEvent({
          invocationId: invocation.id,
          type: "delivery_exhausted",
          level: "warn",
          message: `Delivery exhausted after ${invocation.delivery.dispatchAttempts} dispatch attempts without acknowledgement.`,
          data: { dispatchAttempts: invocation.delivery.dispatchAttempts, maxDispatchAttempts: MAX_DISPATCH_ATTEMPTS },
        });
        completeInvocation(invocation, {
          status: "failed",
          result: {
            summary: `Delivery exhausted: the bridge leased this run ${invocation.delivery.dispatchAttempts} times without acknowledging it.`,
            errorCode: "dispatch_timeout",
          },
        });
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
