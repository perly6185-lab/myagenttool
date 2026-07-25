import { extractClaudeFileAccesses } from "./claude-file-access.mjs";

/**
 * Per-round (per model turn) telemetry, derived from a provider's JSONL stream.
 *
 * A `round` is one model turn. This module is PURE and deterministic: the caller
 * injects `now` (an ISO timestamp) so tests are reproducible — no clock access.
 * It mirrors the protocol `InvocationRound` shape
 * (packages/protocol/src/round-telemetry.ts) and emits `round_started` /
 * `round_completed` bridge events for the server to persist (Phase 3+).
 *
 * Digests are bounded and never carry a raw prompt or full response — only a
 * truncated assistant message. `filesRead` is the content the round read.
 *
 * Timing note: `startedAt` is the previous round's boundary, so `durationMs` is
 * the WALL-CLOCK gap between turn boundaries (it includes tool/IO time between
 * model calls, not pure model latency). The first round of an invocation has no
 * prior boundary, so its `durationMs` is null.
 */

const DIGEST_LIMIT = 240;

export function newRoundState() {
  return {
    nextIndex: 0,
    lastEndedAt: null,
    // Codex reports usage only at turn.completed, so per-turn content is
    // accumulated from item events until the turn closes.
    pendingFiles: [],
    pendingMessage: null,
    currentStartedAt: null,
    touchedUserFiles: false,
  };
}

function trunc(text) {
  if (text == null) return null;
  const value = String(text).trim();
  if (!value) return null;
  return value.length > DIGEST_LIMIT ? `${value.slice(0, DIGEST_LIMIT - 3)}...` : value;
}

function uniquePaths(paths) {
  return [...new Set(paths.filter((p) => typeof p === "string" && p.length > 0))];
}

function num(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Anthropic usage → normalized token breakdown. Cached = read + creation.
function claudeTokens(usage) {
  return {
    inputTokens: num(usage?.input_tokens),
    outputTokens: num(usage?.output_tokens),
    cachedTokens: num(usage?.cache_read_input_tokens) + num(usage?.cache_creation_input_tokens),
    reasoningTokens: 0,
  };
}

// Codex usage → normalized token breakdown.
function codexTokens(usage) {
  return {
    inputTokens: num(usage?.input_tokens),
    outputTokens: num(usage?.output_tokens),
    cachedTokens: num(usage?.cached_input_tokens),
    reasoningTokens: num(usage?.reasoning_output_tokens),
  };
}

// Minimal, decoupled copy of the assistant-text flattening (index.mjs keeps its
// own for agent_output messages). Kept local so this module stays testable.
function claudeText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text;
      if (part?.type === "tool_use") return `[tool: ${part.name ?? "unknown"}]`;
      if (part?.type === "tool_result") return "[tool result]";
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function codexFilePath(event) {
  const item = event?.item;
  if (!item) return null;
  if (typeof item.path === "string") return item.path;
  if (Array.isArray(item.changes) && typeof item.changes[0]?.path === "string") {
    return item.changes[0].path;
  }
  return null;
}

// Build the round_started + round_completed pair for one turn and advance state.
function emitRound(state, { now, startedAt: explicitStartedAt = null, provider, model, status, tokens, filesRead, responseDigest, errorCode }) {
  const roundIndex = state.nextIndex;
  state.nextIndex += 1;
  const startedAt = explicitStartedAt ?? state.lastEndedAt ?? now;
  const endedAt = now;
  const durationMs = explicitStartedAt || state.lastEndedAt
    ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt))
    : null;
  state.lastEndedAt = endedAt;

  const base = { roundIndex, kind: "model_turn", provider, model: model ?? null };
  return [
    {
      type: "round_started",
      level: "info",
      message: `Round ${roundIndex} started (${model ?? provider}).`,
      data: { ...base, startedAt },
    },
    {
      type: "round_completed",
      level: status === "failed" ? "warn" : "info",
      message: `Round ${roundIndex} ${status}.`,
      data: {
        ...base,
        status,
        startedAt,
        endedAt,
        durationMs,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        cachedTokens: tokens.cachedTokens,
        reasoningTokens: tokens.reasoningTokens,
        filesRead,
        responseDigest: responseDigest ?? null,
        errorCode: errorCode ?? null,
      },
    },
  ];
}

/**
 * Claude JSONL: each `assistant` event is one completed model turn (Claude
 * reports that turn's usage on the same event). An `error` event ends a turn as
 * failed. Everything else contributes no round.
 */
export function claudeRoundEmits(state, event, now) {
  if (!event || typeof event !== "object") return [];
  if (event.type === "assistant") {
    const usage = event.message?.usage ?? event.usage ?? null;
    const model = event.message?.model ?? event.model ?? null;
    const filesRead = uniquePaths(
      extractClaudeFileAccesses(event)
        .filter((access) => access.mode === "read")
        .map((access) => access.path),
    );
    return emitRound(state, {
      now,
      provider: "anthropic",
      model,
      status: "succeeded",
      tokens: claudeTokens(usage),
      filesRead,
      responseDigest: trunc(claudeText(event.message?.content ?? event.content)),
    });
  }
  if (event.type === "error") {
    return emitRound(state, {
      now,
      provider: "anthropic",
      model: event.message?.model ?? event.model ?? null,
      status: "failed",
      tokens: claudeTokens(null),
      filesRead: [],
      responseDigest: trunc(event.message ?? event.error?.message ?? "Claude error"),
      errorCode: event.error?.type ?? "error",
    });
  }
  return [];
}

/**
 * The claude stream-json `system/init` event carries the run's request-setup
 * SUMMARY: model, permission mode, and the tool / MCP / skill / agent inventory
 * the agent had available for the call. It is NOT the raw provider envelope —
 * init omits the literal system prompt and full tool JSON schemas (tool NAMES
 * only). Returns the bridge `request_context` payload, or null for any other
 * event. The server re-clamps it (sanitizeRequestContext); this side only shapes.
 */
export function claudeRequestContext(event) {
  if (!event || typeof event !== "object") return null;
  if (event.type !== "system" || event.subtype !== "init") return null;
  const strList = (value) => (Array.isArray(value) ? value.filter((x) => typeof x === "string") : []);
  return {
    provider: "anthropic",
    model: typeof event.model === "string" ? event.model : null,
    permissionMode: typeof event.permissionMode === "string" ? event.permissionMode : null,
    tools: strList(event.tools),
    mcpServers: Array.isArray(event.mcp_servers)
      ? event.mcp_servers
          .filter((server) => server && typeof server === "object" && typeof server.name === "string")
          .map((server) => ({ name: server.name, status: typeof server.status === "string" ? server.status : null }))
      : [],
    skills: strList(event.skills),
    agents: strList(event.agents),
    slashCommandCount: Array.isArray(event.slash_commands) ? event.slash_commands.length : 0,
    sessionId: typeof event.session_id === "string" ? event.session_id : null,
  };
}

/**
 * Codex JSONL: usage arrives only at `turn.completed`, so item events accumulate
 * the turn's files/message, and the turn boundary emits one round. `turn.failed`
 * / `error` ends the turn as failed.
 */
export function codexRoundEmits(state, event, now) {
  if (!event || typeof event !== "object") return [];
  if (event.type === "turn.started") {
    state.currentStartedAt = now;
    return [];
  }
  const itemType = event.item?.type ?? null;
  if (itemType === "agent_message" && event.item?.text) {
    state.pendingMessage = String(event.item.text);
    return [];
  }
  if (itemType === "file_change" || itemType === "file_changes") {
    state.touchedUserFiles = true;
    const path = codexFilePath(event);
    if (path) state.pendingFiles.push(path);
    return [];
  }
  if (event.type === "turn.completed") {
    const emits = emitRound(state, {
      now,
      startedAt: state.currentStartedAt,
      provider: "openai",
      model: event.model ?? "codex",
      status: "succeeded",
      tokens: codexTokens(event.usage ?? null),
      filesRead: uniquePaths(state.pendingFiles),
      responseDigest: trunc(state.pendingMessage),
    });
    state.pendingFiles = [];
    state.pendingMessage = null;
    state.currentStartedAt = null;
    return emits;
  }
  if (event.type === "turn.failed" || event.type === "error") {
    const emits = emitRound(state, {
      now,
      startedAt: state.currentStartedAt,
      provider: "openai",
      model: event.model ?? "codex",
      status: "failed",
      tokens: codexTokens(event.usage ?? null),
      filesRead: uniquePaths(state.pendingFiles),
      responseDigest: trunc(state.pendingMessage ?? event.message ?? event.error?.message ?? "Codex turn failed"),
      errorCode: "turn_failed",
    });
    state.pendingFiles = [];
    state.pendingMessage = null;
    state.currentStartedAt = null;
    return emits;
  }
  return [];
}
