// Request context — the model-call setup a coding run was dispatched with:
// which model, permission mode, and the tool / MCP / skill / agent inventory the
// agent had available for the call.
//
// Captured from the agent CLI's stream-json `system/init` event by the Desktop
// Bridge (claudeRequestContext) and re-clamped here before it touches state —
// the device is not trusted. This is the wrapper-visible SUMMARY, not the raw
// provider envelope: the literal system prompt and full tool JSON schemas are
// never emitted by the CLI, so they are NOT here — only tool NAMES. The raw
// envelope is obtainable only by intercepting the wire (a logging proxy).
//
// Stored on the invocation so it ships to the client with state.invocations,
// alongside fileLedger. First init wins (a run has one setup); a later re-report
// is ignored so the recorded setup is the one the run actually started with.

const CAPS = {
  string: 120,
  toolName: 80,
  list: 200,
  mcp: 50,
};

function clampString(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function clampNameList(value, { cap = CAPS.list, itemMax = CAPS.toolName } = {}) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const name = clampString(item, itemMax);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= cap) break;
  }
  return out;
}

function clampMcpServers(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const server of value) {
    if (!server || typeof server !== "object") continue;
    const name = clampString(server.name, CAPS.string);
    if (!name) continue;
    const status = clampString(server.status, 40);
    out.push(status ? { name, status } : { name });
    if (out.length >= CAPS.mcp) break;
  }
  return out;
}

/**
 * Re-clamp a device-reported request context into the durable shape. Returns
 * null for anything that carries no usable signal (wrong type, or every field
 * empty) — the caller then records nothing.
 */
export function sanitizeRequestContext(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const context = {
    provider: clampString(raw.provider, 40) ?? "anthropic",
    model: clampString(raw.model, CAPS.string),
    permissionMode: clampString(raw.permissionMode, 40),
    tools: clampNameList(raw.tools),
    mcpServers: clampMcpServers(raw.mcpServers ?? raw.mcp_servers),
    skills: clampNameList(raw.skills),
    agents: clampNameList(raw.agents),
    slashCommandCount: Number.isFinite(Number(raw.slashCommandCount))
      ? Math.max(0, Math.trunc(Number(raw.slashCommandCount)))
      : Array.isArray(raw.slash_commands)
        ? raw.slash_commands.length
        : 0,
    sessionId: clampString(raw.sessionId ?? raw.session_id, CAPS.string),
  };
  const hasSignal =
    context.model ||
    context.permissionMode ||
    context.tools.length ||
    context.mcpServers.length ||
    context.skills.length ||
    context.agents.length ||
    context.slashCommandCount > 0;
  return hasSignal ? context : null;
}
