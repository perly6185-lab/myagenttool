import assert from "node:assert/strict";
import { test } from "node:test";

import { createRoundTelemetryRuntime } from "../src/services/round-telemetry.mjs";

const T0 = "2026-07-13T00:00:00.000Z";
const T5 = "2026-07-13T00:00:05.000Z";

function harness() {
  const state = { invocationRounds: [], toolInvocationRecords: [], spans: [] };
  const events = [];
  let counter = 1;
  const runtime = createRoundTelemetryRuntime({
    state,
    now: () => T0,
    nextId: (prefix) => `${prefix}_${String(counter++).padStart(4, "0")}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
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
  const round = state.invocationRounds[0];
  assert.equal(tool.roundId, round.id);
  assert.deepEqual(round.toolCallIds, [tool.id]);
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
