import {
  INFLIGHT_STATUSES,
  belongsToThisBridge as belongsToThisBridgeShared,
  classifyDispatchEligibility,
  DISPATCH_REASONS,
  invocationDirKey,
  isBridgeExecuted as isBridgeExecutedShared,
} from "./dispatch-eligibility.mjs";
import { invocationProjectKey, invocationTeamKey, selectFairInvocation } from "./dispatch-fairness.mjs";

export function createInvocationDispatchRuntime({
  state,
  now,
  appendEvent,
  dispatchLeaseMs,
  findAgent,
  completeInvocation,
  store,
  isWorktreeReactionBusy = () => false,
}) {
  // #968: route the dispatch claim/ack through the Store's unit of work so it
  // commits synchronously. Before this, the lease + attempt increment persisted
  // only via the appendEvent debounce — a crash in the window lost the claim (W2).
  // The mutations stay in-place on the shared invocation (the in-memory adapter
  // commits the same state object); the transaction just owns the durable commit.
  // Falls back to a direct call when no store is injected (hermetic unit tests).
  const runTx = (fn) => (typeof store?.transaction === "function" ? store.transaction(fn) : fn());
  // Dir-lock, bridge-executed, and belongs-to-this-bridge predicates are shared
  // (dispatch-eligibility.mjs) with the read-model so the operator sees exactly
  // what the bridge decides. Bind the device-id-dependent ones to this device.
  const bridgeDevice = state.device;
  const isBridgeExecuted = (invocation) => isBridgeExecutedShared(invocation, { findAgent, deviceId: bridgeDevice.id });
  const belongsToThisBridge = (invocation, agent) => belongsToThisBridgeShared(invocation, agent, bridgeDevice.id);

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

  function reclaimSupersededBridgeSessions() {
    if (typeof completeInvocation !== "function") return;
    const current = Date.now();
    for (const invocation of state.invocations) {
      const supersession = invocation.delivery?.sessionSupersession;
      if (!supersession || !INFLIGHT_STATUSES.includes(invocation.status)) continue;
      const completeAt = Date.parse(supersession.completeAfter ?? "");
      if (Number.isFinite(completeAt) && completeAt > current) continue;
      delete invocation.delivery.sessionSupersession;
      const cancelled = supersession.terminalStatus === "cancelled" || invocation.status === "cancelling";
      completeInvocation(invocation, cancelled
        ? {
            status: "cancelled",
            summary: "Cancellation completed while the superseded Desktop Bridge executor tree drained.",
            result: null,
          }
        : {
            status: "failed",
            summary: "Desktop Bridge process restarted before this invocation reported completion.",
            result: { errorCode: supersession.errorCode ?? "transport_closed" },
          });
    }
  }

  function nextDispatchableInvocation() {
    reclaimSupersededBridgeSessions();
    reclaimStuckCancellations();
    // Only bridge-executed runs count toward the device cap: a long-running
    // platform/HTTP agent (off-device) must not consume a bridge slot and
    // starve CLI dispatch.
    const inFlight = state.invocations.filter(
      (i) => INFLIGHT_STATUSES.includes(i.status) && isBridgeExecuted(i),
    );
    // Authoritative cross-worktree concurrency cap.
    if (inFlight.length >= (bridgeDevice.maxConcurrency || 1)) {
      return undefined;
    }
    // Directories occupied by an in-flight run: skip a queued task whose cwd is
    // busy so the bridge can run other worktrees concurrently without two agents
    // writing the same directory.
    const busyDirs = new Set(inFlight.map(invocationDirKey));
    const dispatchable = state.invocations.filter((item) => {
      const agent = findAgent(item.agentId);
      return classifyDispatchEligibility(item, {
        agent,
        dirBusy: busyDirs.has(invocationDirKey(item)) || isWorktreeReactionBusy(item),
        onThisBridge: agent ? belongsToThisBridge(item, agent) : false,
      }) === DISPATCH_REASONS.DISPATCHABLE;
    });
    if (dispatchable.length === 0) {
      return undefined;
    }
    // Fair selection instead of array-order first-match: pick from the least-loaded
    // team, then its least-loaded project, then the oldest-waiting invocation — so
    // one tenant's burst can't monopolize the device and starve the rest. Load is
    // measured over the SAME in-flight set that governs the cap.
    const teamLoad = new Map();
    const projectLoad = new Map();
    for (const item of inFlight) {
      const team = invocationTeamKey(item, state);
      const project = invocationProjectKey(item);
      teamLoad.set(team, (teamLoad.get(team) ?? 0) + 1);
      projectLoad.set(project, (projectLoad.get(project) ?? 0) + 1);
    }
    const nowMs = Date.parse(now());
    return selectFairInvocation(dispatchable, {
      levels: [
        { keyOf: (item) => invocationTeamKey(item, state), loadOf: (key) => teamLoad.get(key) ?? 0 },
        { keyOf: (item) => invocationProjectKey(item), loadOf: (key) => projectLoad.get(key) ?? 0 },
      ],
      ageMsOf: (item) => {
        const created = Date.parse(item.createdAt ?? "");
        return Number.isFinite(created) && Number.isFinite(nowMs) ? Math.max(0, nowMs - created) : 0;
      },
    });
  }

  // Whether a SPECIFIC invocation is dispatchable right now — the device cap, the
  // dir lock, and the same eligibility classifier the selector uses, but for one
  // invocation rather than "who goes next". Lets callers assert a run is dispatch-
  // ready without depending on the fair-selection order among its queued peers.
  function isInvocationDispatchable(invocation) {
    if (!invocation) return false;
    const inFlight = state.invocations.filter((i) => INFLIGHT_STATUSES.includes(i.status) && isBridgeExecuted(i));
    if (inFlight.length >= (bridgeDevice.maxConcurrency || 1)) return false;
    const busyDirs = new Set(inFlight.map(invocationDirKey));
    const agent = findAgent(invocation.agentId);
    return classifyDispatchEligibility(invocation, {
      agent,
      dirBusy: busyDirs.has(invocationDirKey(invocation)) || isWorktreeReactionBusy(invocation),
      onThisBridge: agent ? belongsToThisBridge(invocation, agent) : false,
    }) === DISPATCH_REASONS.DISPATCHABLE;
  }

  function markDispatched(invocation) {
    runTx(() => {
      invocation.status = "dispatching";
      invocation.delivery.state = "dispatching";
      if (invocation.delivery.deviceId == null) {
        invocation.delivery.deviceId = bridgeDevice.id;
      }
      invocation.delivery.bridgeSessionId = bridgeDevice.bridgeSessionId ?? null;
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
    });
  }

  function acknowledgeInvocation(invocation) {
    if (invocation.delivery.state === "acknowledged" || invocation.status === "running") {
      return;
    }
    runTx(() => {
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
        message: `${findAgent(invocation.agentId)?.name || "Agent"} started.`
      });
    });
  }

  // A bridge that leases but never acks would otherwise ping-pong forever
  // (expire → requeue → re-lease …). After this many leased-and-lapsed attempts
  // the delivery is exhausted: an honest terminal failure whose errorCode routes
  // it to the dispatch_timeout recovery category (rerun recommended).
  const MAX_DISPATCH_ATTEMPTS = 5;

  function redeliverExpiredDispatches() {
    reclaimSupersededBridgeSessions();
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
    isInvocationDispatchable,
    redeliverExpiredDispatches,
  };
}
