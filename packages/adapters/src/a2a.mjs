/*
 * A2A adapter — first slice.
 *
 * Same declarative shape as the MCP slice: a capability contract, config
 * normalization/validation, and the request descriptor an invocation maps to.
 * The live A2A client (fetching the Agent Card, sending tasks over JSON-RPC,
 * consuming SSE streams) belongs in the Desktop Bridge and is the documented
 * next step — see docs/vision/AGENT_ADAPTER_MATRIX.md.
 *
 * A2A model recap: a remote agent publishes an Agent Card (typically at
 * /.well-known/agent.json); tasks are sent as JSON-RPC `message/send`,
 * cancelled with `tasks/cancel`, and streamed with `message/stream` (SSE).
 */

/** Capabilities the A2A adapter path commits to, in the same shape as the
 *  CLI/HTTP/MCP contracts. */
export const A2A_ADAPTER_CONTRACT = Object.freeze({
  kind: "a2a",
  success: true,
  failure: true,
  cancellation: "supported",
  streamsEvents: true,
  transports: Object.freeze(["http"]),
});

const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;

/**
 * Validate + canonicalize a user-supplied A2A agent config. `agentUrl` is the
 * agent's base http(s) URL; the Agent Card is resolved from `agentCardPath`
 * (default /.well-known/agent.json). `allowedSkills` is an optional allowlist
 * of the remote agent's skill ids (empty = accept whatever the card offers).
 */
export function normalizeA2aAdapterConfig(input = {}) {
  const agentUrl = String(input.agentUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/.+/i.test(agentUrl)) {
    throw new Error("A2A adapter requires a valid http(s) agentUrl.");
  }
  const agentCardPath = String(input.agentCardPath ?? "/.well-known/agent.json").trim();
  if (!agentCardPath.startsWith("/")) {
    throw new Error("A2A agentCardPath must start with '/'.");
  }
  const headers =
    input.headers && typeof input.headers === "object" && !Array.isArray(input.headers)
      ? { ...input.headers }
      : {};
  const allowedSkills = Array.isArray(input.allowedSkills)
    ? input.allowedSkills.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const timeoutMs = Number.isFinite(Number(input.timeoutMs))
    ? Math.max(MIN_TIMEOUT_MS, Math.floor(Number(input.timeoutMs)))
    : DEFAULT_TIMEOUT_MS;
  return Object.freeze({
    kind: "a2a",
    agentUrl,
    agentCardPath,
    headers,
    allowedSkills,
    timeoutMs,
  });
}

/**
 * Map an invocation to the JSON-RPC `message/send` request the bridge would
 * POST to the agent. Enforces the skill allowlist when the caller targets a
 * specific skill. The bridge assigns the JSON-RPC `id` and the task/message
 * ids — this is the request descriptor, not a wire message.
 */
export function describeA2aTaskSend(config, task, { skillId = null } = {}) {
  const text = String(task ?? "").trim();
  if (!text) {
    throw new Error("An A2A task requires task text.");
  }
  const skill = skillId ? String(skillId).trim() : null;
  const allowlist = config?.allowedSkills ?? [];
  if (skill && allowlist.length > 0 && !allowlist.includes(skill)) {
    throw new Error(`A2A skill "${skill}" is not in the adapter's allowed skills.`);
  }
  return {
    jsonrpc: "2.0",
    method: "message/send",
    params: {
      message: {
        role: "user",
        parts: [{ kind: "text", text }],
        ...(skill ? { metadata: { skillId: skill } } : {}),
      },
    },
  };
}

/** The JSON-RPC cancellation request for a running A2A task. */
export function describeA2aTaskCancel(taskId) {
  const id = String(taskId ?? "").trim();
  if (!id) {
    throw new Error("An A2A cancellation requires the remote task id.");
  }
  return {
    jsonrpc: "2.0",
    method: "tasks/cancel",
    params: { id },
  };
}
