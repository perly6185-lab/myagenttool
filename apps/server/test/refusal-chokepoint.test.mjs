import assert from "node:assert/strict";
import { test } from "node:test";

// Refusal model Phase 2 (#760): refuse() is the single writer, and the event-log
// guard makes coverage structural. These tests run the guard in STRICT mode so a
// refusal-typed event appended outside refuse() throws rather than warns.
process.env.REFUSAL_STRICT = "1";

const { createRefusalRuntime } = await import("../src/runtime/refusal-log.mjs");
const { createEventLogRuntime } = await import("../src/runtime/event-log.mjs");

const now = () => "2026-07-12T00:00:00.000Z";

function fakeState() {
  return { refusals: [], events: [] };
}

function harness() {
  const state = fakeState();
  let counter = 0;
  const nextId = (prefix) => `${prefix}_${String(++counter).padStart(4, "0")}`;
  const events = [];
  const appendEvent = (event, options = {}) => {
    events.push({ event, options });
    return { ...event, id: nextId("evt") };
  };
  const { refuse, firstRefusal } = createRefusalRuntime({ state, now, nextId, appendEvent });
  return { state, refuse, firstRefusal, events };
}

test("refuse() records a refusal AND fires the existing event, once each", () => {
  const { state, refuse, events } = harness();
  const { refusal, event } = refuse({
    subject: { kind: "invocation", id: "inv_1" },
    requester: { kind: "local_user", id: "usr_local" },
    category: "state",
    code: "over_budget",
    decidedBy: { kind: "policy_engine", id: "budget" },
    summary: "Over budget.",
    evidence: { gate: "budget" },
    remedy: "Raise the budget.",
    event: { invocationId: "inv_1", type: "invocation_rejected", level: "warn", message: "Over budget." },
  });
  assert.equal(state.refusals.length, 1);
  assert.equal(events.length, 1, "the existing event fired exactly once");
  assert.equal(events[0].options.viaRefuse, true, "and it is marked as coming through the writer");
  assert.match(refusal.id, /^ref_demo_/);
  assert.equal(refusal.category, "state");
  assert.equal(refusal.code, "over_budget");
  assert.equal(refusal.invocationId, "inv_1");
  assert.equal(refusal.retryAfter, null);
  assert.deepEqual(refusal.evidence, { gate: "budget" });
  assert.equal(event.type, "invocation_rejected");
});

test("refuse() rejects a (category, code) outside the closed taxonomy", () => {
  const { refuse } = harness();
  assert.throws(() => refuse({ category: "state", code: "not_a_real_code", summary: "x" }), /unknown code/);
  assert.throws(() => refuse({ category: "made_up", code: "over_budget", summary: "x" }), /unknown category/);
  // A real code under the wrong category is also caught.
  assert.throws(
    () => refuse({ category: "human", code: "over_budget", summary: "x" }),
    /not in the closed taxonomy/,
  );
});

test("firstRefusal enforces evaluation order not_granted → policy → state → human", () => {
  const { firstRefusal } = harness();
  const winner = firstRefusal([
    { category: "state", code: "over_budget" },
    { category: "human", code: "approval_denied" },
    { category: "not_granted", code: "capability_not_granted" },
    { category: "policy", code: "command_not_allowlisted" },
  ]);
  // An ungranted + over-budget request reports not_granted, never over_budget.
  assert.equal(winner.category, "not_granted");
  assert.equal(firstRefusal([]), null);
  assert.equal(firstRefusal([null, { category: "policy", code: "cwd_outside_approved_root" }]).category, "policy");
});

test("state.refusals is a bounded ring buffer (does not grow forever)", () => {
  const { state, refuse } = harness();
  for (let i = 0; i < 250; i += 1) {
    refuse({ category: "state", code: "over_budget", summary: `r${i}`, event: null });
  }
  assert.equal(state.refusals.length, 200, "capped at 200");
  // Newest first: the last inserted is at the head.
  assert.equal(state.refusals[0].summary, "r249");
});

test("the event-log guard throws when a refusal-typed event bypasses refuse() (strict)", () => {
  const state = fakeState();
  let counter = 0;
  const { appendEvent } = createEventLogRuntime({
    state,
    now,
    nextId: (p) => `${p}_${++counter}`,
    persistStateSoon: () => {},
    getCodexEventHandlers: () => ({ updateCodexSessionFromEvent() {}, createCodexEvidenceRecord() {} }),
  });
  // A denial that appends a refusal-typed event directly is a bypass.
  assert.throws(
    () => appendEvent({ invocationId: "inv_1", type: "local_approval_denied", level: "warn", message: "x" }),
    /outside refuse\(\)/,
  );
  // The same event is fine when the single writer marks it.
  const ok = appendEvent(
    { invocationId: "inv_1", type: "local_approval_denied", level: "warn", message: "x" },
    { viaRefuse: true },
  );
  assert.equal(ok.type, "local_approval_denied");
  // A non-refusal event is never guarded.
  const log = appendEvent({ invocationId: "inv_1", type: "log", level: "info", message: "hi" });
  assert.equal(log.type, "log");
});

test("a normal (non-denial) event mints no refusal record — queuing is not a refusal", () => {
  const state = fakeState();
  let counter = 0;
  const { appendEvent } = createEventLogRuntime({
    state,
    now,
    nextId: (p) => `${p}_${++counter}`,
    persistStateSoon: () => {},
    getCodexEventHandlers: () => ({ updateCodexSessionFromEvent() {}, createCodexEvidenceRecord() {} }),
  });
  createRefusalRuntime({ state, now, nextId: (p) => `${p}_${++counter}`, appendEvent });
  // Work being queued at the concurrency cap fires a normal delivery event; it is
  // held, not refused, so no refusal record is created.
  appendEvent({ invocationId: "inv_1", type: "delivery_queued", level: "info", message: "queued" });
  assert.equal(state.refusals.length, 0);
});
