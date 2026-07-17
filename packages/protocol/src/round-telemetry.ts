import type {
  AIUsageRecordId,
  InvocationId,
  InvocationRoundId,
  IsoDateTime,
  SpanId,
  ToolInvocationRecordId,
  TraceId,
} from "./common.js";

/**
 * Invocation round telemetry — Epic #805, Phase 1 (#806).
 *
 * Today an invocation collapses to one aggregate `AIUsageRecord` plus an
 * unstructured, capped `agent_output` event stream, so a multi-turn agent run
 * has no queryable per-round params, tokens, timing, or content-read. This model
 * makes each model turn a first-class record.
 *
 * A `round` is one model turn. It carries its own provider/model, token counts,
 * true start/end timing, a bounded + redacted request/response digest, the
 * content it read (files, tool calls), and status. The aggregate `AIUsageRecord`
 * is summed from a round's real numbers starting in a later phase — it is NOT a
 * substitute for the round.
 *
 * Design of record: `docs/engineering/INVOCATION_ROUND_TELEMETRY_ISSUE_PLAN.md`.
 * The runtime mirror of these arrays lives in `./index.mjs` and is asserted by
 * `test/round-telemetry.test.mjs`.
 *
 * Phase 1 is types + taxonomy only: no records are written yet.
 */

/**
 * Round lifecycle. `started` on first token/turn open; the other three are
 * terminal. A round NEVER carries a non-terminal-but-finished state — an
 * abandoned round ends `cancelled`, not `started`.
 */
export const roundStatuses = [
  "started",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type RoundStatus = (typeof roundStatuses)[number];

/**
 * What a round represents. Only `model_turn` exists today; the enum is open to
 * future non-model rounds (e.g. a pure tool step) so consumers switch on it
 * rather than assuming every round is a model call.
 */
export const roundKinds = ["model_turn"] as const;

export type RoundKind = (typeof roundKinds)[number];

/** Tool-call lifecycle. Tool calls do not have a `cancelled` terminal today. */
export const toolInvocationStatuses = [
  "started",
  "succeeded",
  "failed",
] as const;

export type ToolInvocationStatus = (typeof toolInvocationStatuses)[number];

/**
 * How an aggregate `AIUsageRecord`'s token counts were obtained. `rounds` is the
 * authoritative path (summed from real per-round usage); `client_reported` is
 * the legacy fallback where a caller posted the numbers; `import` is an
 * after-the-fact estimate (e.g. ccusage).
 */
export const aiUsageDerivations = [
  "rounds",
  "client_reported",
  "import",
] as const;

export type AIUsageDerivation = (typeof aiUsageDerivations)[number];

/**
 * The round telemetry event types. `tool_invocation_created` already exists in
 * `InvocationEventType` (declared but unbacked until this model); `round_started`
 * and `round_completed` are added alongside it.
 */
export const roundTelemetryEventTypes = [
  "round_started",
  "round_completed",
  "tool_invocation_created",
] as const;

export type RoundTelemetryEventType = (typeof roundTelemetryEventTypes)[number];

/**
 * One model turn within an invocation. Written into `state.invocationRounds[]`
 * starting in Phase 3 (server persistence). `requestDigest` / `responseDigest`
 * are bounded, redactable summaries — NEVER the raw prompt or full response.
 */
export interface InvocationRound {
  id: InvocationRoundId;
  invocationId: InvocationId;
  traceId: TraceId;
  /** Child span under the invocation's rootSpanId — carries this round's timing. */
  spanId: SpanId;
  /** 0-based, monotonic within the invocation. */
  roundIndex: number;
  kind: RoundKind;
  provider: string;
  /** The resolved model that served this round. */
  model: string;
  status: RoundStatus;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  /** Bounded, redacted. NOT the raw prompt. */
  requestDigest: string | null;
  /** Bounded, redacted latest message. NOT the full response. */
  responseDigest: string | null;
  /** Files the round read, from adapter fileAccess / codex fileChange signals. */
  filesRead: string[];
  toolCallIds: ToolInvocationRecordId[];
  errorCode: string | null;
  /** Per-round cost from measured tokens x the matched model rate; null when unpriced. */
  estimatedCostUsd?: number | null;
  /** The aggregate usage record this round rolled into, once summed. */
  usageRecordId?: AIUsageRecordId | null;
  createdAt: IsoDateTime;
}

/**
 * One tool call inside a round. Backs the previously-declared, unbacked
 * `tool_invocation_created` event. Digests are bounded + redacted like a round's.
 */
export interface ToolInvocationRecord {
  id: ToolInvocationRecordId;
  invocationId: InvocationId;
  roundId: InvocationRoundId | null;
  toolName: string;
  /**
   * The model-assigned tool_use id (`tu_…`) when the reporting side knows it —
   * the join key to the same call's full-text block in the run transcript
   * (#1087). Null for server-dispatched governed tools (no model id exists)
   * and for bridge clients that have not adopted the field yet.
   */
  toolUseId: string | null;
  inputDigest: string | null;
  outputDigest: string | null;
  /** The file touched, when known. */
  targetPath: string | null;
  /** e.g. "read" | "write" | "command". */
  action: string | null;
  riskTag: string | null;
  /**
   * True when the call mutates state or reaches outside the sandbox (a write,
   * a command, or a network/credential/destructive risk tag). A first-class
   * boolean so side-effecting calls are directly filterable — a read that
   * fails only makes an answer incomplete, a write that fails or mis-fires can
   * cause real loss (#805 follow-up). Derived from `action`/`riskTag` when the
   * reporter does not set it explicitly.
   */
  sideEffect: boolean;
  /**
   * Byte length of the raw tool result before digest truncation, when the
   * reporter knows it. `outputDigest` is capped at 500 chars, so it cannot
   * answer "did this call return 40 bytes or 40 KB into the context". Null when
   * the size was not reported.
   */
  resultSize: number | null;
  status: ToolInvocationStatus;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}
