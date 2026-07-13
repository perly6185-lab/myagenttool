# Invocation Round Telemetry — Design & Issue Plan

This document specifies a **per-round telemetry model** for invocations and
breaks the work into a sequenced issue tree. Today an invocation collapses to
one aggregate usage record plus an unstructured, capped `agent_output` event
stream; a multi-turn agent run therefore has no queryable per-round params,
tokens, timing, or content-read. This plan turns each model turn into a
first-class record without changing execution behavior.

## Goal

For every invocation, capture — as durable, queryable records — each **round**
(one model turn) with its provider/model, input/output/cached/reasoning tokens,
true start/end timing, a redacted request/response digest, the content it read
(files, tool calls), and its status. Roll the existing aggregate
`AIUsageRecord` up from real per-round numbers instead of client-posted
defaults, and expose a per-round timeline in the console.

Non-negotiable boundaries carried from the existing model:

- No change to how agents execute or how the bridge dispatches work.
- No raw prompt or full response is persisted — only bounded, redactable
  digests (mirrors the 240-char summary discipline already in
  [completion.mjs](../../apps/server/src/services/invocations/completion.mjs)).
- Round telemetry is additive: `Invocation`, `AIUsageRecord`, `Span`, and the
  event log keep their current shape and semantics.

## Where this plugs into today's code

| Concern | Today | This plan |
| --- | --- | --- |
| Per-message model + usage + files | Already emitted by the adapter as `agent_output` event `data` ([index.mjs:2384-2392](../../apps/desktop/src/index.mjs)) then dropped | Folded into `InvocationRound` records |
| Per-step timing | Only one root span ([invocation.ts:238](../../packages/protocol/src/invocation.ts)) | One child `Span` per round, reusing the existing `Span` type |
| Tool calls | `tool_invocation_created` event **declared but unbacked** ([invocation.ts:214](../../packages/protocol/src/invocation.ts)) | Backed by `ToolInvocationRecord` |
| Token metering | `recordAiUsage` reads client-posted body, defaults 0 ([m3.mjs:701](../../apps/server/src/services/m3.mjs)) | Aggregate summed from real per-round tokens |
| Execution start | `AuditSummary.startedAt = invocation.createdAt` (enqueue time) ([completion.mjs:175](../../apps/server/src/services/invocations/completion.mjs)) | First round's `startedAt` = true execution start |

## Data Model

### `InvocationRound` (new)

One row per model turn. ID prefix `rnd_` (add to
[common.ts](../../packages/protocol/src/common.ts)).

```ts
export interface InvocationRound {
  id: InvocationRoundId;            // rnd_*
  invocationId: InvocationId;
  traceId: TraceId;
  spanId: SpanId;                   // child span under invocation.rootSpanId
  roundIndex: number;              // 0-based, monotonic within the invocation
  kind: "model_turn";             // reserved for future non-model rounds
  provider: string;               // e.g. "anthropic", "openai"
  model: string;                  // resolved model that served this round
  status: "started" | "succeeded" | "failed" | "cancelled";
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  requestDigest: string | null;   // bounded, redacted; NOT the raw prompt
  responseDigest: string | null;  // bounded, redacted latest message
  filesRead: string[];            // from adapter fileAccess / codex fileChange
  toolCallIds: ToolInvocationRecordId[];
  errorCode: string | null;
  usageRecordId?: AIUsageRecordId | null; // aggregate this round rolled into
  createdAt: IsoDateTime;
}
```

### `ToolInvocationRecord` (new — backs the existing event)

One row per tool call inside a round. ID prefix `tiv_`.

```ts
export interface ToolInvocationRecord {
  id: ToolInvocationRecordId;      // tiv_*
  invocationId: InvocationId;
  roundId: InvocationRoundId | null;
  toolName: string;
  inputDigest: string | null;      // bounded, redacted
  outputDigest: string | null;     // bounded, redacted
  targetPath: string | null;       // file touched, when known
  action: string | null;           // read | write | command | etc.
  riskTag: string | null;
  status: "started" | "succeeded" | "failed";
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}
```

### Changes to existing types

- `AIUsageRecord` (aggregate, still the billing/quota row): add
  `roundCount: number` and `derivedFrom: "rounds" | "client_reported" | "import"`
  so a summed-from-rounds record is distinguishable from a posted one.
- `Span`: no schema change — reuse `attributes` to carry `{ roundIndex, model,
  inputTokens, outputTokens }` per child span.
- New `InvocationEventType`s: `round_started`, `round_completed`. Keep the
  already-declared `tool_invocation_created`.

### Relationships

```
Invocation (1) ──< InvocationRound (N) ──< ToolInvocationRecord (N)
      │                    │
      │                    └── Span (1 child per round, under rootSpanId)
      └── AIUsageRecord (1 aggregate) ← summed from its rounds
```

### Persistence & caps

Rounds and tool records live in `state.invocationRounds` /
`state.toolInvocationRecords`, file-snapshotted like the rest of the read model.
Cap per invocation (e.g. 500 rounds) with an explicit `log()`-style dropped
counter so truncation is never silent — matching the `aiUsageRecords` cap of 200
at [m3.mjs:722](../../apps/server/src/services/m3.mjs).

## Issue Tree

| Order | Issue | Area | First batch? |
| --- | --- | --- | --- |
| 1 | Round Telemetry Issue Plan (this doc) | docs | Yes |
| 2 | Round & ToolCall protocol types (types-only) | protocol | Yes |
| 3 | Bridge round-boundary contract | desktop | Yes |
| 4 | Server round persistence + per-round spans | server | Yes |
| 5 | Roll aggregate AIUsageRecord up from real round tokens | server / billing | Yes |
| 6 | Console per-round timeline lens | web | No |
| 7 | Durable round store, retention caps & digest redaction policy | cross-cutting | No |

## First Batch PRs

### PR 1 — Round Telemetry Issue Plan

- This document exists and is linked from the engineering index.
- Defines the `InvocationRound` / `ToolInvocationRecord` shapes, the aggregate
  rollup rule, and the phased sequencing.
- Explicitly excludes raw-prompt persistence and any execution change.
- No runtime behavior changes.

Suggested files: `docs/engineering/INVOCATION_ROUND_TELEMETRY_ISSUE_PLAN.md`.

Verification: `pnpm docs:check`, `git diff --check`.

### PR 2 — Round & ToolCall protocol types (types-only, no persistence)

Mirror the refusal-model Phase 1 pattern (types land before any writer).

- Add `InvocationRoundId` (`rnd_`) and `ToolInvocationRecordId` (`tiv_`) to
  `common.ts`.
- Add `InvocationRound` and `ToolInvocationRecord` to `invocation.ts`.
- Add `roundCount` + `derivedFrom` to `AIUsageRecord`; add `round_started` /
  `round_completed` event types.
- No writer, no route, no persistence yet.

Accepted scope:

- Protocol typechecks and unit tests assert the new shapes and ID formats.
- A doc comment states "no records are written yet" as the refusal model does.

Suggested files: `packages/protocol/src/common.ts`,
`packages/protocol/src/invocation.ts`, `packages/protocol/src/economics.ts`.

Verification: `pnpm --filter @myagenttool/protocol test`,
`pnpm --filter @myagenttool/protocol typecheck`, `pnpm typecheck`.

### PR 3 — Bridge round-boundary contract

Make the adapter emit explicit round boundaries instead of only per-message
`agent_output`. The data already exists at
[index.mjs:2384-2392 / 2401-2419](../../apps/desktop/src/index.mjs) — this PR
promotes it to a structured signal.

- On each assistant turn, emit `round_started` (model, roundIndex) and, when the
  turn's usage is known, `round_completed` (usage, filesRead, toolCalls,
  duration) via `/api/bridge/events` (or a dedicated `/api/bridge/rounds`).
- Reuse `extractClaudeFileAccesses` and the Codex `fileChange*` extractors for
  `filesRead`.
- Digests are truncated at the bridge (same 240-char rule) so raw content never
  leaves the machine.

Accepted scope:

- Claude and Codex JSONL paths both emit round boundaries.
- Contract tests cover: multi-turn run, single-turn run, a turn with no usage,
  and a failed turn.
- Bridge-only change; server still tolerates the events as today.

Suggested files: `apps/desktop/src/index.mjs`, bridge contract fixtures/tests.

Verification: `pnpm --filter @myagenttool/desktop test`, `pnpm smoke:local`.

### PR 4 — Server round persistence + per-round spans

Make round records reachable (mirror refusal Phase 4).

- Ingest `round_started` / `round_completed` / `tool_invocation_created` into
  `state.invocationRounds` / `state.toolInvocationRecords`.
- Create one child `Span` per round under `invocation.rootSpanId`, with
  start/end from the round — giving real per-step timing.
- Set the invocation's true execution start from the first round and stop
  conflating it with `createdAt` in `AuditSummary`.
- Apply the per-invocation cap with a visible dropped counter.

Accepted scope:

- Tests cover multi-round persistence, child-span timing, the caps/drop counter,
  and that `startedAt` reflects first-round time.
- Existing aggregate/event behavior is unchanged for callers that don't emit
  rounds.

Suggested files: `apps/server/src/services/invocations/*`,
`apps/server/src/read-models/state.mjs`, `apps/server/src/routes/*`.

Verification: `pnpm --filter @myagenttool/server test`, `pnpm smoke:local`,
`pnpm typecheck`.

### PR 5 — Roll aggregate `AIUsageRecord` up from real round tokens

Close the "real tokens are discarded" gap.

- When an invocation completes, derive the aggregate `AIUsageRecord`
  (input/output/cached/reasoning tokens, `roundCount`, `latencyMs`) by summing
  its rounds, and set `derivedFrom: "rounds"`.
- Stop defaulting tokens to client-posted `0`; keep the client-posted path only
  as a fallback with `derivedFrom: "client_reported"`.
- Have the review wrappers surface per-round usage rather than only cost
  ([claude-review-wrapper.mjs:224-232](../../tools/agents/claude-review-wrapper.mjs)).

Accepted scope:

- Quota/ledger continue to work; a summed record and a fallback record are both
  covered by tests.
- Cost estimation still functions when only tokens (no USD) are known.

Suggested files: `apps/server/src/services/m3.mjs`,
`apps/server/src/services/invocations/completion.mjs`,
`tools/agents/*-review-wrapper.mjs`.

Verification: `pnpm --filter @myagenttool/server test`, `pnpm typecheck`,
`pnpm test`.

## Later Batch

### PR 6 — Console per-round timeline lens

- Invocation detail shows a round timeline: index, model, duration, tokens,
  files read, tool calls, status.
- Reads the new records; no new backend contract.

### PR 7 — Durable store, retention & redaction policy

- Move rounds/tool records behind the durable store boundary with retention
  windows rather than only in-memory caps.
- Formalize the digest redaction policy (what may appear in
  `requestDigest`/`responseDigest`/`inputDigest`) and enforce it at ingestion.

## Non-Goals

- Persisting raw prompts or full model responses.
- OpenTelemetry / external tracing backend integration.
- Changing agent execution, dispatch, or the invocation state machine.
- Per-token real-time billing UI (belongs to the economics reporting batch).

## Verification Baseline

Every first-batch issue should run:

```text
pnpm docs:check
pnpm typecheck
pnpm test
pnpm smoke:local
git diff --check
```
