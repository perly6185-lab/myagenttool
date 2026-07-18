import { isAgentDisabled } from "../agents.mjs";

/*
 * Same-device agent failover (#1268, slice 3b). When a run fails for an
 * INFRASTRUCTURE reason — the bridge went offline (dispatch_timeout), the
 * invocation was orphaned by a restart, or the run went stuck — the work itself is
 * fine; only the executor died. If another healthy agent of the SAME adapter type
 * sits on the SAME device, it can pick up the run's existing (device-local)
 * worktree. Cross-device failover is out of scope: worktrees are un-replicated
 * local git checkouts, so another device can't resume this one's tree.
 */

// The failure codes that mean "the executor/infrastructure died", not "the task
// failed". Only these trigger failover; a genuine task `failed`/`rejected` (null
// code) never does.
export const FAILOVER_INFRA_CODES = ["dispatch_timeout", "orphaned", "stuck"];

// How many times one run may fail over before it's left failed for a human. Bounds
// ping-pong across a pool of unhealthy agents.
export const MAX_FAILOVERS = 2;

/**
 * Pick a healthy alternate agent for `failedAgent`: same device, same adapter type,
 * not disabled, not unhealthy, not already tried (`excludeIds`). Returns the first
 * match, or null when none qualifies (including a non-local failed agent, which has
 * no "same device" to fail over within). Pure.
 */
export function selectFailoverAgent(agents, failedAgent, excludeIds = []) {
  if (!failedAgent) return null;
  const deviceId = failedAgent.location?.type === "local_device" ? failedAgent.location.deviceId : null;
  if (deviceId == null) return null; // only local-device runs have a same-device pool
  const adapterType = failedAgent.adapter?.type ?? null;
  const exclude = new Set((excludeIds ?? []).filter(Boolean));
  return (
    (agents ?? []).find(
      (agent) =>
        agent
        && agent.id
        && !exclude.has(agent.id)
        && agent.location?.type === "local_device"
        && agent.location.deviceId === deviceId
        && (agent.adapter?.type ?? null) === adapterType
        && !isAgentDisabled(agent)
        && agent.health?.status !== "unhealthy",
    ) ?? null
  );
}
