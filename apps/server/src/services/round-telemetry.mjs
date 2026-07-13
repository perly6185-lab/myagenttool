// Per-round (per model turn) telemetry ingestion — Epic #805, Phase 3 (#808).
//
// The bridge emits round_started / round_completed / tool_invocation_created on
// /api/bridge/events (see apps/desktop/src/round-telemetry.mjs). This runtime
// folds them into first-class records: state.invocationRounds[] and
// state.toolInvocationRecords[], plus one child Span per round under the
// invocation's rootSpanId (real per-step timing). It also records the
// invocation's true execution start from the first round.
//
// Records are bounded per invocation with a visible dropped counter, so a
// runaway multi-round run never silently truncates.

const MAX_ROUNDS_PER_INVOCATION = 500;

const ROUND_TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const TOOL_STATUSES = new Set(["started", "succeeded", "failed"]);

export function createRoundTelemetryRuntime({ state, now, nextId, appendEvent, persistStateSoon }) {
  // Tolerate snapshots persisted before these arrays existed.
  if (!Array.isArray(state.invocationRounds)) state.invocationRounds = [];
  if (!Array.isArray(state.toolInvocationRecords)) state.toolInvocationRecords = [];

  function recordRoundEvent(invocation, body) {
    if (!invocation || !body) return;
    const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : null;
    if (!data) return;
    if (body.type === "round_started") handleRoundStarted(invocation, data);
    else if (body.type === "round_completed") handleRoundCompleted(invocation, data);
    else if (body.type === "tool_invocation_created") handleToolInvocation(invocation, data);
    else return;
    if (typeof persistStateSoon === "function") persistStateSoon();
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

  // Returns true (and accounts the drop) when this invocation is already at cap.
  function atCap(invocation) {
    if (roundsForInvocation(invocation.id).length < MAX_ROUNDS_PER_INVOCATION) return false;
    invocation.droppedRoundCount = (invocation.droppedRoundCount ?? 0) + 1;
    if (invocation.droppedRoundCount === 1) {
      appendEvent({
        invocationId: invocation.id,
        type: "log",
        level: "warn",
        message: `Round telemetry capped at ${MAX_ROUNDS_PER_INVOCATION}; further rounds dropped for this invocation.`,
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
    if (atCap(invocation)) return;
    createRound(invocation, data, "started");
  }

  function handleRoundCompleted(invocation, data) {
    let round = findRound(invocation, intOr(data.roundIndex, null));
    if (!round) {
      // round_completed without a preceding round_started — still record it.
      if (atCap(invocation)) return;
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
    round.responseDigest = typeof data.responseDigest === "string" ? data.responseDigest : null;
    round.requestDigest = typeof data.requestDigest === "string" ? data.requestDigest : null;
    round.errorCode = typeof data.errorCode === "string" ? data.errorCode : null;
    if (typeof data.provider === "string") round.provider = data.provider;
    if (typeof data.model === "string") round.model = data.model;
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
    const record = {
      id: nextId("tiv_demo"),
      invocationId: invocation.id,
      roundId: round?.id ?? null,
      toolName: typeof data.toolName === "string" ? data.toolName : "unknown",
      inputDigest: typeof data.inputDigest === "string" ? data.inputDigest : null,
      outputDigest: typeof data.outputDigest === "string" ? data.outputDigest : null,
      targetPath: typeof data.targetPath === "string" ? data.targetPath : null,
      action: typeof data.action === "string" ? data.action : null,
      riskTag: typeof data.riskTag === "string" ? data.riskTag : null,
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
