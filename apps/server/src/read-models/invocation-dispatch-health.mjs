import {
  belongsToThisBridge,
  classifyDispatchEligibility,
  DISPATCH_REASONS,
  INFLIGHT_STATUSES,
  invocationDirKey,
  isBridgeExecuted,
} from "../services/invocations/dispatch-eligibility.mjs";

/*
 * Layer-A dispatch observability (the invocation-delivery layer). The existing
 * /api/dispatch-evaluation read-model covers Layer B (issue→worker assignment);
 * this is its missing counterpart for Layer A: WHY is a queued invocation not
 * running right now, how long has it waited, and is the device at capacity. It
 * reuses the SAME eligibility predicates the bridge dispatches with
 * (dispatch-eligibility.mjs), so "why blocked" can never drift from the real
 * decision.
 *
 * `capacity` is device-global (the cap and in-flight count are infra facts that
 * a scoped actor's own `waiting_concurrency` items depend on). `queue`/`stats`
 * are filtered by `visibleInvocation` so a scoped actor sees only its team's work.
 */

// Below this many settled dispatches the latency/redelivery stats are not
// reported — a handful of samples is noise, not signal (mirrors the honest
// `indeterminate` gate in dispatch-evaluation.mjs).
const MIN_STATS_SAMPLES = 10;

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

export function computeInvocationDispatchHealth(state, { findAgent, now, visibleInvocation = () => true } = {}) {
  const invocations = state?.invocations ?? [];
  const deviceId = state?.device?.id ?? null;
  const maxConcurrency = state?.device?.maxConcurrency || 1;
  const nowMs = Date.parse(typeof now === "function" ? now() : new Date().toISOString());

  // Device-global in-flight (drives the cap AND the dir locks the bridge honours).
  const inFlight = invocations.filter((i) => INFLIGHT_STATUSES.includes(i.status) && isBridgeExecuted(i, { findAgent, deviceId }));
  const busyDirs = new Set(inFlight.map(invocationDirKey));
  const atCapacity = inFlight.length >= maxConcurrency;

  // --- queue: currently-undispatched invocations, each with its blocking reason ---
  const items = [];
  const byReason = {};
  for (const invocation of invocations) {
    if (invocation.status !== "queued") continue;
    if (!visibleInvocation(invocation)) continue;
    const agent = findAgent(invocation.agentId);
    let reason = classifyDispatchEligibility(invocation, {
      agent,
      dirBusy: busyDirs.has(invocationDirKey(invocation)),
      onThisBridge: agent ? belongsToThisBridge(invocation, agent, deviceId) : false,
    });
    // The one global gate the per-invocation classifier can't see: an otherwise
    // dispatchable item is held only because the device is already at capacity.
    if (reason === DISPATCH_REASONS.DISPATCHABLE && atCapacity) {
      reason = "waiting_concurrency";
    }
    const createdMs = Date.parse(invocation.createdAt ?? "");
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    items.push({
      invocationId: invocation.id,
      agentId: invocation.agentId ?? null,
      agentName: agent?.name ?? null,
      deliveryState: invocation.delivery?.state ?? null,
      dispatchAttempts: invocation.delivery?.dispatchAttempts ?? 0,
      queuedForMs: Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : null,
      blockedReason: reason,
    });
  }
  // Longest-waiting first — the items most in need of operator attention.
  items.sort((a, b) => (b.queuedForMs ?? -1) - (a.queuedForMs ?? -1));

  // --- stats: over settled (acknowledged) bridge-executed dispatches ---
  const latencies = [];
  let redelivered = 0;
  let exhausted = 0;
  let settled = 0;
  for (const invocation of invocations) {
    if (!visibleInvocation(invocation)) continue;
    if (invocation.delivery?.state === "exhausted" || invocation.result?.errorCode === "dispatch_timeout") {
      exhausted += 1;
    }
    const ackedAt = invocation.delivery?.acknowledgedAt;
    if (!ackedAt) continue;
    settled += 1;
    if ((invocation.delivery?.dispatchAttempts ?? 0) > 1) redelivered += 1;
    const created = Date.parse(invocation.createdAt ?? "");
    const acked = Date.parse(ackedAt);
    if (Number.isFinite(created) && Number.isFinite(acked) && acked >= created) latencies.push(acked - created);
  }
  const indeterminate = settled < MIN_STATS_SAMPLES;

  return {
    capacity: {
      maxConcurrency,
      inFlight: inFlight.length,
      utilization: maxConcurrency > 0 ? Math.round((inFlight.length / maxConcurrency) * 100) / 100 : null,
      atCapacity,
    },
    queue: {
      depth: items.length,
      byReason,
      items,
    },
    stats: {
      sampleSize: settled,
      indeterminate,
      medianMsToDispatch: indeterminate ? null : median(latencies),
      redeliveryRate: indeterminate ? null : Math.round((redelivered / settled) * 1000) / 1000,
      exhaustedCount: exhausted,
    },
  };
}
