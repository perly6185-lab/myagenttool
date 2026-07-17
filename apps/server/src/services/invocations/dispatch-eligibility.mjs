import { isAgentDisabled } from "../agents.mjs";

/*
 * Pure Layer-A dispatch predicates — the single source of truth for "is this
 * invocation dispatchable to the bridge right now, and if not, why". Extracted
 * from invocations/dispatch.mjs so the dispatch runtime AND the read-model that
 * OBSERVES it (read-models/invocation-dispatch-health.mjs) classify identically,
 * with no drift between what the bridge does and what the operator is shown.
 */

// Statuses that occupy a device compute slot (count toward the concurrency cap).
export const INFLIGHT_STATUSES = ["dispatching", "running", "cancelling"];

// Per-invocation eligibility outcomes (independent of the global concurrency cap,
// which the caller layers on top as `waiting_concurrency`).
export const DISPATCH_REASONS = Object.freeze({
  DISPATCHABLE: "dispatchable",
  NOT_QUEUED: "not_queued",
  DIR_BUSY: "dir_busy",
  AGENT_MISSING: "agent_missing",
  WRONG_DEVICE: "wrong_device",
  AGENT_DISABLED: "agent_disabled",
  AGENT_UNHEALTHY: "agent_unhealthy",
});

// The directory a run occupies. Two runs in the same worktree (or the same base
// project) must not execute concurrently — they'd write the same tree. Metadata
// lives on `options`, NOT `input` (input is `{ task }`); see #817 for the bug that
// followed from reading input.metadata (every key collapsed to "__default__").
export function invocationDirKey(invocation) {
  const meta = invocation.options?.metadata ?? {};
  return meta.worktreePath || meta.projectPath || "__default__";
}

// Does this invocation's delivery belong to the given bridge device? Prefers the
// pinned delivery.deviceId, else the agent's local_device id.
export function belongsToThisBridge(invocation, agent, deviceId) {
  const deliveryDeviceId = invocation.delivery?.deviceId ?? null;
  const agentDeviceId = agent?.location?.type === "local_device" ? agent.location.deviceId : null;
  const resolved = deliveryDeviceId ?? agentDeviceId;
  return resolved === deviceId;
}

// Bridge-executed = a run that consumes THIS device's compute (CLI, a locally
// spawned stdio MCP server, container). Off-device work (remote_http/platform,
// a2a, http-transport MCP — the bridge only drives the client) must not consume a
// bridge concurrency slot. Unknown agent → count it (conservative for the cap).
export function isBridgeExecuted(invocation, { findAgent, deviceId }) {
  const agent = findAgent(invocation.agentId);
  if (!agent) return true;
  if (agent.location?.type !== "local_device") return false;
  if (!belongsToThisBridge(invocation, agent, deviceId)) return false;
  const adapter = agent.adapter ?? {};
  if (adapter.type === "mcp") return adapter.transport !== "http";
  return ["cli", "container"].includes(adapter.type);
}

/**
 * Why an individual queued invocation is or isn't dispatchable RIGHT NOW, in the
 * exact order the bridge checks. Independent of the device concurrency cap (a
 * global gate the caller applies). Returns a DISPATCH_REASONS value.
 *
 * `dirBusy` — its dir is occupied by an in-flight run.
 * `onThisBridge` — belongsToThisBridge(invocation, agent, deviceId) (irrelevant
 *   unless the agent is local_device).
 */
export function classifyDispatchEligibility(invocation, { agent, dirBusy, onThisBridge }) {
  if (invocation.status !== "queued" || !["queued", "redelivering"].includes(invocation.delivery?.state)) {
    return DISPATCH_REASONS.NOT_QUEUED;
  }
  if (dirBusy) return DISPATCH_REASONS.DIR_BUSY;
  if (!agent) return DISPATCH_REASONS.AGENT_MISSING;
  if (agent.location?.type === "local_device" && !onThisBridge) return DISPATCH_REASONS.WRONG_DEVICE;
  if (isAgentDisabled(agent)) return DISPATCH_REASONS.AGENT_DISABLED;
  if (agent?.health?.status === "unhealthy") return DISPATCH_REASONS.AGENT_UNHEALTHY;
  return DISPATCH_REASONS.DISPATCHABLE;
}
