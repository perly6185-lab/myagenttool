/*
 * MCP adapter — first slice.
 *
 * Consistent with the rest of this package, this is a *declarative* adapter: a
 * capability contract, config normalization/validation, and the request
 * descriptor an invocation maps to. The live MCP client (opening a stdio/HTTP
 * transport, listing tools, streaming results) belongs in the Desktop Bridge and
 * is the documented next step — see docs/vision/AGENT_ADAPTER_MATRIX.md. Keeping
 * the contract here means the server can register + validate an MCP agent, and
 * the mapping is testable without a live MCP server.
 */

/** Capabilities the MCP adapter path commits to, in the same shape as the M0
 *  CLI/HTTP contracts. Tool calls stream progress (MCP notifications) and can be
 *  cancelled (MCP `$/cancelRequest`). */
export const MCP_ADAPTER_CONTRACT = Object.freeze({
  kind: "mcp",
  success: true,
  failure: true,
  cancellation: "supported",
  streamsEvents: true,
  transports: Object.freeze(["stdio", "http"]),
});

const TRANSPORTS = new Set(["stdio", "http"]);
const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}

/**
 * Validate + canonicalize a user-supplied MCP server config into an adapter
 * descriptor. `stdio` needs a command; `http` needs an http(s) url. `allowedTools`
 * is an optional allowlist (empty = expose all the server offers). Throws Error
 * on anything invalid so registration can surface a plain-language message.
 */
export function normalizeMcpAdapterConfig(input = {}) {
  const transport = String(input.transport ?? "").trim();
  if (!TRANSPORTS.has(transport)) {
    throw new Error(`MCP transport must be one of: ${[...TRANSPORTS].join(", ")}.`);
  }

  const allowedTools = asStringArray(input.allowedTools);
  const timeoutMs = Number.isFinite(Number(input.timeoutMs))
    ? Math.max(MIN_TIMEOUT_MS, Math.floor(Number(input.timeoutMs)))
    : DEFAULT_TIMEOUT_MS;

  if (transport === "stdio") {
    const command = String(input.command ?? "").trim();
    if (!command) {
      throw new Error("MCP stdio transport requires a command.");
    }
    return Object.freeze({
      kind: "mcp",
      transport,
      command,
      args: asStringArray(input.args),
      allowedTools,
      timeoutMs,
    });
  }

  // transport === "http"
  const url = String(input.url ?? "").trim();
  if (!/^https?:\/\/.+/i.test(url)) {
    throw new Error("MCP http transport requires a valid http(s) url.");
  }
  const headers =
    input.headers && typeof input.headers === "object" && !Array.isArray(input.headers)
      ? { ...input.headers }
      : {};
  return Object.freeze({
    kind: "mcp",
    transport,
    url,
    headers,
    allowedTools,
    timeoutMs,
  });
}

/**
 * Map an invocation to the JSON-RPC `tools/call` request the bridge would send.
 * Enforces the allowlist. The bridge assigns the JSON-RPC `id`, so it is not
 * included here — this is the request descriptor, not a wire message.
 */
export function describeMcpToolCall(config, toolName, args = {}) {
  const name = String(toolName ?? "").trim();
  if (!name) {
    throw new Error("An MCP tool name is required.");
  }
  const allowlist = config?.allowedTools ?? [];
  if (allowlist.length > 0 && !allowlist.includes(name)) {
    throw new Error(`MCP tool "${name}" is not in the adapter's allowed tools.`);
  }
  const args_ = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  return {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name, arguments: args_ },
  };
}
