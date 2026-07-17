// Per-round (per model turn) telemetry ingestion — Epic #805, Phases 3 & 7
// (#808, #811).
//
// The bridge emits round_started / round_completed / tool_invocation_created on
// /api/bridge/events (see apps/desktop/src/round-telemetry.mjs). This runtime
// folds them into first-class records: state.invocationRounds[] and
// state.toolInvocationRecords[], plus one child Span per round under the
// invocation's rootSpanId (real per-step timing). It also records the
// invocation's true execution start from the first round.
//
// Retention (#811): records are bounded two ways, and NEITHER truncates
// silently. A per-invocation cap stops one runaway run from evicting every
// other run's rounds; a global cap bounds total memory. Both route the overflow
// through the durable archive (retention-archive.mjs) so an evicted row is
// appended to disk (recoverable via readArchive), not dropped.
//
// Redaction (#811): digest fields are scrubbed of secret-shaped tokens and
// bounded at ingestion — defense-in-depth over the bridge's own truncation, and
// the single chokepoint that decides what may ever appear in a stored digest.

import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { estimateCostUsdFromTokens } from "./m3.mjs";

const MAX_ROUNDS_PER_INVOCATION = 500;
const MAX_ROUNDS_TOTAL = 5000;
const MAX_TOOL_RECORDS_TOTAL = 5000;

const ROUND_TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const TOOL_STATUSES = new Set(["started", "succeeded", "failed"]);

// Actions and CapabilityRiskTag values (packages/protocol/src/agent.ts) that
// mutate state or reach outside the sandbox. Used to derive `sideEffect` when a
// reporter does not set it explicitly.
const SIDE_EFFECT_ACTIONS = new Set(["write", "command"]);
const SIDE_EFFECT_RISK_TAGS = new Set([
  "write_local",
  "network_access",
  "credential_access",
  "shell_exec",
  "browser_control",
  "desktop_control",
  "destructive",
  "budget_spending",
  "policy_change",
  "secret_exposure",
  "external_data_transfer",
]);

export function deriveSideEffect(action, riskTag, explicit) {
  if (typeof explicit === "boolean") return explicit;
  if (typeof action === "string" && SIDE_EFFECT_ACTIONS.has(action)) return true;
  if (typeof riskTag === "string" && SIDE_EFFECT_RISK_TAGS.has(riskTag)) return true;
  return false;
}

export function createRoundTelemetryRuntime({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  capWithArchive,
  archiveEvicted,
  store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  // Tolerate snapshots persisted before these arrays existed.
  if (!Array.isArray(state.invocationRounds)) state.invocationRounds = [];
  if (!Array.isArray(state.toolInvocationRecords)) state.toolInvocationRecords = [];

  // Fall back to a plain slice / no-op when no archive is wired (e.g. unit tests
  // or persistence disabled) — retention still holds, only the disk copy is skipped.
  const capList = typeof capWithArchive === "function"
    ? capWithArchive
    : (list, max) => (Array.isArray(list) ? list.slice(0, max) : []);
  const archive = typeof archiveEvicted === "function" ? archiveEvicted : () => {};

  function recordRoundEvent(invocation, body) {
    if (!invocation || !body) return;
    const raw = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : null;
    if (!raw) return;
    // Redact digests ONCE, at the entry — so every downstream path sees only
    // sanitized data: the stored records AND the over-cap archive. This is the
    // single chokepoint that decides what may ever be persisted from a digest.
    const data = redactRoundData(raw);
    if (body.type === "round_started") handleRoundStarted(invocation, data);
    else if (body.type === "round_completed") handleRoundCompleted(invocation, data);
    else if (body.type === "tool_invocation_created") handleToolInvocation(invocation, data);
    else return;
    runTx(() => {
      // Global retention: keep the newest N in memory, archive the overflow.
      state.invocationRounds = capList(state.invocationRounds, MAX_ROUNDS_TOTAL, "invocationRounds");
      state.toolInvocationRecords = capList(state.toolInvocationRecords, MAX_TOOL_RECORDS_TOTAL, "toolInvocationRecords");
    });
  }

  function roundsForInvocation(invocationId) {
    return state.invocationRounds.filter((round) => round.invocationId === invocationId);
  }

  function findRound(invocation, roundIndex) {
    if (roundIndex === null) return null;
    return state.invocationRounds.find(
      (round) => round.invocationId === invocation.id && round.roundIndex === roundIndex,
    );
  }

  // invocationRounds is newest-first (unshift), so the first match is the latest.
  function latestRound(invocation) {
    return state.invocationRounds.find((round) => round.invocationId === invocation.id) ?? null;
  }

  // Returns true when this invocation is already at its per-run cap. The
  // over-cap round is NOT silently lost — its raw event data is archived to disk
  // so the audit trail survives a runaway run.
  function atCap(invocation, data) {
    if (roundsForInvocation(invocation.id).length < MAX_ROUNDS_PER_INVOCATION) return false;
    invocation.droppedRoundCount = (invocation.droppedRoundCount ?? 0) + 1;
    archive("invocationRounds", [{ invocationId: invocation.id, overCap: true, data, at: now() }]);
    if (invocation.droppedRoundCount === 1) {
      appendEvent({
        invocationId: invocation.id,
        type: "log",
        level: "warn",
        message: `Round telemetry capped at ${MAX_ROUNDS_PER_INVOCATION}; further rounds archived, not kept in state, for this invocation.`,
      });
    }
    return true;
  }

  function createRound(invocation, data, status) {
    const roundIndex = intOr(data.roundIndex, roundsForInvocation(invocation.id).length);
    const startedAt = typeof data.startedAt === "string" ? data.startedAt : now();
    const kind = typeof data.kind === "string" ? data.kind : "model_turn";
    const provider = typeof data.provider === "string" ? data.provider : "unknown";
    const model = typeof data.model === "string" ? data.model : "unknown";

    // One child span per round, under the invocation's root span — this is what
    // gives real per-step timing (the root span alone can't).
    const span = {
      id: nextId("spn_demo"),
      traceId: invocation.traceId,
      parentSpanId: invocation.rootSpanId ?? null,
      name: `round.${roundIndex}`,
      status: "started",
      startedAt,
      endedAt: null,
      attributes: { roundIndex, kind, provider, model },
    };
    state.spans.unshift(span);

    const round = {
      id: nextId("rnd_demo"),
      invocationId: invocation.id,
      traceId: invocation.traceId,
      spanId: span.id,
      roundIndex,
      kind,
      provider,
      model,
      status,
      startedAt,
      endedAt: null,
      durationMs: null,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      requestDigest: null,
      responseDigest: null,
      filesRead: [],
      toolCallIds: [],
      errorCode: null,
      // Per-round cost (#853): measured tokens x the matched model rate, filled
      // when the round completes. Null (not 0) while open or when unpriced.
      estimatedCostUsd: null,
      usageRecordId: null,
      createdAt: now(),
    };
    state.invocationRounds.unshift(round);

    // True execution start: the first round begins the real work. Falls back to
    // delivery ack / createdAt elsewhere when no round telemetry is present.
    if (!invocation.startedAt) invocation.startedAt = startedAt;
    return round;
  }

  function handleRoundStarted(invocation, data) {
    if (findRound(invocation, intOr(data.roundIndex, null))) return; // idempotent
    if (atCap(invocation, data)) return;
    createRound(invocation, data, "started");
  }

  function handleRoundCompleted(invocation, data) {
    let round = findRound(invocation, intOr(data.roundIndex, null));
    if (!round) {
      // round_completed without a preceding round_started — still record it.
      if (atCap(invocation, data)) return;
      round = createRound(invocation, data, "started");
    }
    const status = ROUND_TERMINAL_STATUSES.has(data.status) ? data.status : "succeeded";
    round.status = status;
    round.endedAt = typeof data.endedAt === "string" ? data.endedAt : now();
    round.durationMs = Number.isFinite(Number(data.durationMs))
      ? Number(data.durationMs)
      : durationBetween(round.startedAt, round.endedAt);
    round.inputTokens = nonNeg(data.inputTokens);
    round.outputTokens = nonNeg(data.outputTokens);
    round.cachedTokens = nonNeg(data.cachedTokens);
    round.reasoningTokens = nonNeg(data.reasoningTokens);
    round.filesRead = Array.isArray(data.filesRead)
      ? [...new Set(data.filesRead.filter((path) => typeof path === "string"))]
      : [];
    // Already redacted at the entry (recordRoundEvent).
    round.responseDigest = typeof data.responseDigest === "string" ? data.responseDigest : null;
    round.requestDigest = typeof data.requestDigest === "string" ? data.requestDigest : null;
    round.errorCode = typeof data.errorCode === "string" ? data.errorCode : null;
    if (typeof data.provider === "string") round.provider = data.provider;
    if (typeof data.model === "string") round.model = data.model;
    // Price this turn from its measured tokens (#853). Display-tier only — no
    // ledger entry. Unpriced models stay null, never a fabricated $0.
    const costUsd = estimateCostUsdFromTokens({
      model: round.model,
      inputTokens: round.inputTokens,
      cachedInputTokens: round.cachedTokens,
      outputTokens: round.outputTokens,
    });
    round.estimatedCostUsd = costUsd > 0 ? Number(costUsd.toFixed(6)) : null;
    completeRoundSpan(round, status);
  }

  function completeRoundSpan(round, status) {
    const span = state.spans.find((item) => item.id === round.spanId);
    if (!span || span.endedAt) return;
    span.status = status === "succeeded" ? "succeeded" : status === "cancelled" ? "cancelled" : "failed";
    span.endedAt = round.endedAt ?? now();
  }

  function handleToolInvocation(invocation, data) {
    const round = findRound(invocation, intOr(data.roundIndex, null)) ?? latestRound(invocation);
    const action = typeof data.action === "string" ? data.action : null;
    const riskTag = typeof data.riskTag === "string" ? data.riskTag : null;
    const record = {
      id: nextId("tiv_demo"),
      invocationId: invocation.id,
      roundId: round?.id ?? null,
      toolName: typeof data.toolName === "string" ? data.toolName : "unknown",
      // #1087: the model's tool_use id (tu_…) joins this digest record to the
      // same call's full-text block in the run transcript. Absent stays null
      // (server-dispatched tools have no model id; bridge adoption is separate).
      toolUseId: typeof data.toolUseId === "string" && data.toolUseId ? data.toolUseId.slice(0, 120) : null,
      inputDigest: typeof data.inputDigest === "string" ? data.inputDigest : null,
      outputDigest: typeof data.outputDigest === "string" ? data.outputDigest : null,
      targetPath: typeof data.targetPath === "string" ? data.targetPath : null,
      action,
      riskTag,
      // Explicit, filterable side-effect flag. Trust a reporter's boolean; else
      // derive it from a write/command action or a mutating/external risk tag.
      sideEffect: deriveSideEffect(action, riskTag, data.sideEffect),
      // Raw result byte size before the 500-char digest cap; null when unknown.
      resultSize: Number.isFinite(Number(data.resultSize)) ? Math.max(0, Math.trunc(Number(data.resultSize))) : null,
      status: TOOL_STATUSES.has(data.status) ? data.status : "succeeded",
      startedAt: typeof data.startedAt === "string" ? data.startedAt : now(),
      endedAt: typeof data.endedAt === "string" ? data.endedAt : now(),
      createdAt: now(),
    };
    state.toolInvocationRecords.unshift(record);
    if (round) round.toolCallIds = [...round.toolCallIds, record.id];
  }

  return { recordRoundEvent };
}

// The digest redaction policy (#811): the one place that decides what may ever
// be stored in a round/tool digest. Secret-shaped tokens are replaced and the
// result is length-bounded. High-confidence patterns only — a digest is an
// observability aid, so over-redaction is safer than leaking a credential.
const DIGEST_MAX = 500;
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{16,}/g, // OpenAI-style API key
  /github_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained PAT
  /gh[posru]_[A-Za-z0-9]{20,}/g, // GitHub classic tokens (ghp_/gho_/…)
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack token
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g, // JWT
  /(?:bearer|authorization:?)\s+[A-Za-z0-9._~+/=-]{16,}/gi, // bearer / authorization value
  /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----/g, // private key block
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // email address (PII)
  // Mainland-China PII the digest must never carry. Digit-boundary lookarounds
  // keep these from matching inside a longer token/id; over-redaction is
  // acceptable here (an epoch-ms timestamp is 13 digits — none of these widths).
  // Resident ID runs BEFORE bank card: an 18-char id ending in X would otherwise
  // have its 17 leading digits eaten by the card pattern, leaving a dangling X.
  /(?<![\dxX])\d{17}[\dxX](?![\dxX])/g, // China resident ID (18 chars, trailing X allowed)
  /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g, // bank card number (16–19 digits, spaced/dashed)
  /(?<!\d)1[3-9]\d{9}(?!\d)/g, // China mobile number (11 digits)
];

export function redactDigest(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  let value = text;
  for (const pattern of SECRET_PATTERNS) value = value.replace(pattern, "[redacted]");
  return value.length > DIGEST_MAX ? `${value.slice(0, DIGEST_MAX - 3)}...` : value;
}

const DIGEST_FIELDS = ["responseDigest", "requestDigest", "inputDigest", "outputDigest"];

// Return a shallow copy of an event's data with every digest field redacted, so
// the sanitized object can flow to BOTH the stored records and the over-cap
// archive. Non-digest fields (filesRead, tokens, model, …) pass through.
export function redactRoundData(data) {
  if (!data || typeof data !== "object") return data;
  const clone = { ...data };
  for (const field of DIGEST_FIELDS) {
    if (typeof clone[field] === "string") clone[field] = redactDigest(clone[field]);
  }
  return clone;
}

function intOr(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function nonNeg(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function durationBetween(startedAt, endedAt) {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}
