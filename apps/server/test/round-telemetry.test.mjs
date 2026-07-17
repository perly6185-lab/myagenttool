import assert from "node:assert/strict";
import { test } from "node:test";

import { createRoundTelemetryRuntime, redactDigest, scrubPii } from "../src/services/round-telemetry.mjs";

const T0 = "2026-07-13T00:00:00.000Z";
const T5 = "2026-07-13T00:00:05.000Z";

function harness(archiveSpies = {}) {
  const state = { invocationRounds: [], toolInvocationRecords: [], spans: [] };
  const events = [];
  let counter = 1;
  const runtime = createRoundTelemetryRuntime({
    state,
    now: () => T0,
    nextId: (prefix) => `${prefix}_${String(counter++).padStart(4, "0")}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    ...archiveSpies,
  });
  const invocation = { id: "inv_1", traceId: "trc_1", rootSpanId: "spn_root", delivery: {} };
  return { state, events, runtime, invocation };
}

function ev(type, data) {
  return { type, data };
}

test("round_started persists a round + child span under the root span and sets execution start", () => {
  const { state, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_started", {
    roundIndex: 0, provider: "anthropic", model: "claude-opus-4-8", startedAt: T0,
  }));

  assert.equal(state.invocationRounds.length, 1);
  const round = state.invocationRounds[0];
  assert.equal(round.roundIndex, 0);
  assert.equal(round.status, "started");
  assert.equal(round.provider, "anthropic");
  assert.match(round.id, /^rnd_demo_/);

  const span = state.spans.find((s) => s.id === round.spanId);
  assert.ok(span, "a child span was created");
  assert.equal(span.parentSpanId, "spn_root");
  assert.equal(span.traceId, "trc_1");
  assert.equal(span.startedAt, T0);
  assert.equal(span.status, "started");

  assert.equal(invocation.startedAt, T0, "first round sets true execution start");
});

test("a round span carries OpenTelemetry GenAI semantic-convention attributes", () => {
  const { state, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 0, provider: "anthropic", model: "claude-opus-4-8" }));
  let span = state.spans.find((s) => s.parentSpanId === "spn_root");
  assert.equal(span.attributes["gen_ai.system"], "anthropic");
  assert.equal(span.attributes["gen_ai.request.model"], "claude-opus-4-8");
  assert.equal(span.attributes["gen_ai.operation.name"], "chat", "model_turn maps to the chat operation");
  assert.equal(span.attributes.provider, "anthropic", "existing custom keys are kept for back-compat");

  runtime.recordRoundEvent(invocation, ev("round_completed", { roundIndex: 0, status: "succeeded", inputTokens: 120, outputTokens: 45 }));
  span = state.spans.find((s) => s.parentSpanId === "spn_root");
  assert.equal(span.attributes["gen_ai.usage.input_tokens"], 120, "usage attributes added on completion");
  assert.equal(span.attributes["gen_ai.usage.output_tokens"], 45);
});

test("round_completed fills tokens/timing and closes the child span", () => {
  const { state, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 0, startedAt: T0 }));
  runtime.recordRoundEvent(invocation, ev("round_completed", {
    roundIndex: 0, status: "succeeded", startedAt: T0, endedAt: T5, durationMs: 5000,
    inputTokens: 100, outputTokens: 50, cachedTokens: 25, reasoningTokens: 0,
    filesRead: ["/wt/a.mjs", "/wt/a.mjs"], responseDigest: "done",
  }));

  assert.equal(state.invocationRounds.length, 1, "completed updates the same round, not a new one");
  const round = state.invocationRounds[0];
  assert.equal(round.status, "succeeded");
  assert.equal(round.endedAt, T5);
  assert.equal(round.durationMs, 5000);
  assert.deepEqual(
    [round.inputTokens, round.outputTokens, round.cachedTokens, round.reasoningTokens],
    [100, 50, 25, 0],
  );
  assert.deepEqual(round.filesRead, ["/wt/a.mjs"], "files are deduped");
  assert.equal(round.responseDigest, "done");

  const span = state.spans.find((s) => s.id === round.spanId);
  assert.equal(span.status, "succeeded");
  assert.equal(span.endedAt, T5);
});

test("durationMs is derived from timestamps when not supplied", () => {
  const { state, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 0, startedAt: T0 }));
  runtime.recordRoundEvent(invocation, ev("round_completed", { roundIndex: 0, endedAt: T5 }));
  assert.equal(state.invocationRounds[0].durationMs, 5000);
});

test("tool_invocation_created is recorded and linked to its round", () => {
  const { state, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 0 }));
  runtime.recordRoundEvent(invocation, ev("tool_invocation_created", {
    roundIndex: 0, toolName: "Read", targetPath: "/wt/a.mjs", action: "read",
  }));

  assert.equal(state.toolInvocationRecords.length, 1);
  const tool = state.toolInvocationRecords[0];
  assert.match(tool.id, /^tiv_demo_/);
  assert.equal(tool.toolName, "Read");
  assert.equal(tool.targetPath, "/wt/a.mjs");
  assert.equal(tool.toolUseId, null, "no model tool_use id supplied stays honest null");
  const round = state.invocationRounds[0];
  assert.equal(tool.roundId, round.id);
  assert.deepEqual(round.toolCallIds, [tool.id]);
});

test("a tool call's side effect is a first-class boolean, derived from action/riskTag when not reported", () => {
  const { state, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 0 }));
  // read → no side effect
  runtime.recordRoundEvent(invocation, ev("tool_invocation_created", { roundIndex: 0, toolName: "Read", action: "read" }));
  // write action → side effect, and resultSize is captured
  runtime.recordRoundEvent(invocation, ev("tool_invocation_created", { roundIndex: 0, toolName: "Write", action: "write", resultSize: 4096 }));
  // read action but a network risk tag → still a side effect
  runtime.recordRoundEvent(invocation, ev("tool_invocation_created", { roundIndex: 0, toolName: "Fetch", action: "read", riskTag: "network_access" }));
  // an explicit reporter boolean wins over derivation
  runtime.recordRoundEvent(invocation, ev("tool_invocation_created", { roundIndex: 0, toolName: "Odd", action: "read", sideEffect: true }));

  const [oddCall, fetchCall, writeCall, readCall] = state.toolInvocationRecords; // unshift → newest first
  assert.equal(readCall.sideEffect, false, "a plain read has no side effect");
  assert.equal(readCall.resultSize, null, "unreported result size stays null");
  assert.equal(writeCall.sideEffect, true, "a write action is a side effect");
  assert.equal(writeCall.resultSize, 4096, "reported result byte size is captured");
  assert.equal(fetchCall.sideEffect, true, "a network risk tag makes even a read a side effect");
  assert.equal(oddCall.sideEffect, true, "an explicit reporter boolean is trusted over derivation");
});

test("#1087: a reported toolUseId is persisted as the join key to the transcript's full-text block", () => {
  const { state, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 0 }));
  runtime.recordRoundEvent(invocation, ev("tool_invocation_created", {
    roundIndex: 0, toolName: "Bash", toolUseId: "tu_01ABC", action: "command",
  }));
  runtime.recordRoundEvent(invocation, ev("tool_invocation_created", {
    roundIndex: 0, toolName: "Bash", toolUseId: "x".repeat(500),
  }));
  assert.equal(state.toolInvocationRecords[1].toolUseId, "tu_01ABC");
  assert.equal(state.toolInvocationRecords[0].toolUseId.length, 120, "oversized ids are clamped");
});

test("round_completed without a prior round_started still records a round", () => {
  const { state, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_completed", { roundIndex: 0, status: "failed", errorCode: "boom" }));
  assert.equal(state.invocationRounds.length, 1);
  const round = state.invocationRounds[0];
  assert.equal(round.status, "failed");
  assert.equal(round.errorCode, "boom");
  const span = state.spans.find((s) => s.id === round.spanId);
  assert.equal(span.status, "failed");
});

test("a duplicate round_started for the same index is idempotent", () => {
  const { state, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 0 }));
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 0 }));
  assert.equal(state.invocationRounds.length, 1);
});

test("rounds are capped per invocation with a visible dropped counter, not silently", () => {
  const { state, events, runtime, invocation } = harness();
  for (let i = 0; i < 500; i += 1) {
    runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: i }));
  }
  assert.equal(state.invocationRounds.length, 500);

  // The 501st and 502nd rounds are dropped.
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 500 }));
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 501 }));

  assert.equal(state.invocationRounds.length, 500, "cap holds");
  assert.equal(invocation.droppedRoundCount, 2, "drops are counted");
  const capEvents = events.filter((e) => e.level === "warn" && /capped/.test(e.message));
  assert.equal(capEvents.length, 1, "the cap is announced once, not per dropped round");
});

// --- Per-round cost (#853) ----------------------------------------------------

test("round_completed prices the turn from its tokens x the model rate", () => {
  const { state, runtime, invocation } = harness();
  // claude-opus default: input $15/MTok. 1M input tokens -> $15.
  runtime.recordRoundEvent(invocation, ev("round_completed", {
    roundIndex: 0, model: "claude-opus-4-8", inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0,
  }));
  assert.equal(state.invocationRounds[0].estimatedCostUsd, 15);
});

test("an unpriced round's cost is null, not zero", () => {
  const { state, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_completed", {
    roundIndex: 0, model: "mystery-model", inputTokens: 5000, outputTokens: 1000,
  }));
  assert.equal(state.invocationRounds[0].estimatedCostUsd, null);
});

test("an open (started) round has no cost yet", () => {
  const { state, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 0, model: "claude-opus-4-8" }));
  assert.equal(state.invocationRounds[0].estimatedCostUsd, null);
});

// --- Semantic loop signal (dimension 6) --------------------------------------

test("a tool called 3x with identical input inside one invocation flags a loop once", () => {
  const { state, events, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 0 }));
  for (let i = 0; i < 3; i += 1) {
    runtime.recordRoundEvent(invocation, ev("tool_invocation_created", { roundIndex: 0, toolName: "Bash", inputDigest: "grep foo" }));
  }
  const loopEvents = events.filter((e) => e.type === "agent_loop_suspected");
  assert.equal(loopEvents.length, 1, "the loop is announced once, not per repeat past the threshold");
  assert.equal(loopEvents[0].data.toolName, "Bash");
  assert.equal(loopEvents[0].data.repeats, 3);
  assert.equal(invocation.loopSuspected.toolName, "Bash");

  // A 4th identical call grows the streak but does NOT re-alert.
  runtime.recordRoundEvent(invocation, ev("tool_invocation_created", { roundIndex: 0, toolName: "Bash", inputDigest: "grep foo" }));
  assert.equal(events.filter((e) => e.type === "agent_loop_suspected").length, 1, "a growing streak does not re-alert");
  assert.equal(invocation.loopSuspected.repeats, 4, "but the count keeps climbing");
});

test("a same-tool loop that breaks and restarts re-alerts (not swallowed after the first)", () => {
  const { state, events, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 0 }));
  const call = (toolName, inputDigest) =>
    runtime.recordRoundEvent(invocation, ev("tool_invocation_created", { roundIndex: 0, toolName, inputDigest }));
  // First loop episode: Bash "grep foo" ×3 → one alert.
  call("Bash", "grep foo"); call("Bash", "grep foo"); call("Bash", "grep foo");
  assert.equal(events.filter((e) => e.type === "agent_loop_suspected").length, 1);
  // A different tool breaks the streak…
  call("Read", "a.mjs");
  // …then the same tool loops again → the leading run resets and re-alerts.
  call("Bash", "grep foo"); call("Bash", "grep foo"); call("Bash", "grep foo");
  assert.equal(events.filter((e) => e.type === "agent_loop_suspected").length, 2, "the second episode is not swallowed");
});

test("same tool with DIFFERENT input is not a loop, and null-input calls never flag", () => {
  const { state, events, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 0 }));
  // Three reads of different files — a legitimate scan, not a loop.
  runtime.recordRoundEvent(invocation, ev("tool_invocation_created", { roundIndex: 0, toolName: "Read", inputDigest: "a.mjs" }));
  runtime.recordRoundEvent(invocation, ev("tool_invocation_created", { roundIndex: 0, toolName: "Read", inputDigest: "b.mjs" }));
  runtime.recordRoundEvent(invocation, ev("tool_invocation_created", { roundIndex: 0, toolName: "Read", inputDigest: "c.mjs" }));
  // Three same-tool calls with no reported input digest — cannot judge, never flag.
  for (let i = 0; i < 3; i += 1) {
    runtime.recordRoundEvent(invocation, ev("tool_invocation_created", { roundIndex: 0, toolName: "List" }));
  }
  assert.equal(events.filter((e) => e.type === "agent_loop_suspected").length, 0);
  assert.equal(invocation.loopSuspected, undefined);
});

// --- Redaction (#811) ---------------------------------------------------------

test("redactDigest scrubs secret-shaped tokens and bounds length", () => {
  assert.equal(redactDigest("token sk-ABCDEFGHIJKLMNOPQRST here"), "token [redacted] here");
  assert.equal(redactDigest("pat github_pat_11ABCDEFGHIJKLMNOPQRSTUV done"), "pat [redacted] done");
  assert.equal(redactDigest("Bearer abcdef0123456789ABCDEF"), "[redacted]");
  assert.equal(redactDigest("email a.user@example.com ok"), "email [redacted] ok");
  assert.equal(redactDigest(""), null);
  assert.equal(redactDigest(null), null);
  const long = "x".repeat(1000);
  const out = redactDigest(long);
  assert.equal(out.length, 500);
  assert.ok(out.endsWith("..."));
});

test("scrubPii removes PII spans but does NOT truncate (retained records keep full text)", () => {
  const long = `prefix ${"y".repeat(1000)} mail a@b.com tail`;
  const out = scrubPii(long);
  assert.ok(out.length > 500, "full text retained, not bounded to 500 like redactDigest");
  assert.ok(out.includes("[redacted]"), "email scrubbed");
  assert.ok(!/a@b\.com/.test(out));
  assert.equal(scrubPii("clean text"), "clean text", "clean text unchanged");
  assert.equal(scrubPii(""), "", "empty stays empty (not null)");
});

test("redactDigest scrubs mainland-China PII: mobile, resident id, bank card", () => {
  assert.equal(redactDigest("call me at 13800138000 tomorrow"), "call me at [redacted] tomorrow");
  assert.equal(redactDigest("id 11010119900307765X on file"), "id [redacted] on file");
  assert.equal(redactDigest("card 6222021234567890123 charged"), "card [redacted] charged");
  // A 13-digit epoch-ms timestamp is not PII and must survive untouched.
  assert.equal(redactDigest("ts 1700000000000 logged"), "ts 1700000000000 logged");
});

test("round and tool digests are redacted at ingestion, not stored raw", () => {
  const { state, runtime, invocation } = harness();
  runtime.recordRoundEvent(invocation, ev("round_completed", {
    roundIndex: 0,
    responseDigest: "done, key sk-ABCDEFGHIJKLMNOPQRST",
    requestDigest: "prompt for a.user@example.com",
  }));
  const round = state.invocationRounds[0];
  assert.ok(!/sk-ABCDEFGHIJKLMNOPQRST/.test(round.responseDigest), "secret scrubbed from responseDigest");
  assert.ok(round.responseDigest.includes("[redacted]"));
  assert.ok(round.requestDigest.includes("[redacted]"), "email scrubbed from requestDigest");

  runtime.recordRoundEvent(invocation, ev("tool_invocation_created", {
    roundIndex: 0, toolName: "Bash", inputDigest: "curl -H 'Authorization: Bearer abcdef0123456789ABCDEF'",
  }));
  const tool = state.toolInvocationRecords[0];
  assert.ok(tool.inputDigest.includes("[redacted]"), "secret scrubbed from tool inputDigest");
  assert.ok(!/abcdef0123456789ABCDEF/.test(tool.inputDigest));
});

// --- Durable retention (#811) -------------------------------------------------

test("every ingestion routes global retention through the archive, not a silent slice", () => {
  const capCalls = [];
  const { runtime, invocation } = harness({
    capWithArchive: (list, max, collection) => {
      capCalls.push({ collection, max });
      return Array.isArray(list) ? list.slice(0, max) : [];
    },
  });
  runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: 0 }));
  const collections = capCalls.map((c) => `${c.collection}:${c.max}`);
  assert.ok(collections.includes("invocationRounds:5000"), "rounds capped via archive");
  assert.ok(collections.includes("toolInvocationRecords:5000"), "tool records capped via archive");
  assert.ok(collections.includes("spans:20000"), "the whole spans array is capped via archive too");
});

test("a per-invocation over-cap round is archived, never silently lost", () => {
  const archived = [];
  const { state, runtime, invocation } = harness({
    archiveEvicted: (collection, rows) => archived.push({ collection, rows }),
  });
  for (let i = 0; i < 501; i += 1) {
    runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: i }));
  }
  assert.equal(state.invocationRounds.length, 500, "cap holds in memory");
  const roundArchive = archived.filter((a) => a.collection === "invocationRounds");
  assert.equal(roundArchive.length, 1, "the over-cap round was archived");
  assert.equal(roundArchive[0].rows[0].overCap, true);
  assert.equal(roundArchive[0].rows[0].invocationId, "inv_1");
});

test("an over-cap round's digest is redacted before it is archived (no bypass)", () => {
  const archived = [];
  const { runtime, invocation } = harness({
    archiveEvicted: (collection, rows) => { for (const row of rows) archived.push(row); },
  });
  for (let i = 0; i < 500; i += 1) {
    runtime.recordRoundEvent(invocation, ev("round_started", { roundIndex: i }));
  }
  // A 501st round carrying a secret in its digest must be archived REDACTED —
  // the over-cap path used to hand the raw event data straight to the archive.
  runtime.recordRoundEvent(invocation, ev("round_completed", {
    roundIndex: 500, responseDigest: "leaked key sk-ABCDEFGHIJKLMNOPQRST",
  }));
  const overCap = archived.filter((row) => row.overCap);
  assert.equal(overCap.length, 1);
  assert.ok(overCap[0].data.responseDigest.includes("[redacted]"), "archived digest is redacted");
  assert.ok(!/sk-ABCDEFGHIJKLMNOPQRST/.test(overCap[0].data.responseDigest), "secret is not in the archive");
});
