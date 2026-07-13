import assert from "node:assert/strict";
import { test } from "node:test";

import {
  roundStatuses,
  roundKinds,
  toolInvocationStatuses,
  aiUsageDerivations,
  roundTelemetryEventTypes,
} from "../src/index.mjs";

test("round statuses are the four lifecycle states, one non-terminal", () => {
  assert.deepEqual(roundStatuses, ["started", "succeeded", "failed", "cancelled"]);
});

test("model_turn is the only round kind today, but the enum stays open", () => {
  assert.ok(roundKinds.includes("model_turn"));
  assert.equal(roundKinds.length, 1);
});

test("tool invocation statuses are a subset of round statuses (no cancelled today)", () => {
  assert.deepEqual(toolInvocationStatuses, ["started", "succeeded", "failed"]);
  for (const status of toolInvocationStatuses) {
    assert.ok(roundStatuses.includes(status), `${status} is not a valid round status`);
  }
  assert.equal(toolInvocationStatuses.includes("cancelled"), false);
});

test("rounds is the authoritative usage derivation; the fallbacks are explicit", () => {
  assert.deepEqual(aiUsageDerivations, ["rounds", "client_reported", "import"]);
  assert.equal(aiUsageDerivations[0], "rounds", "the authoritative path must sort first");
});

test("round telemetry events add round_started/round_completed alongside the existing tool event", () => {
  assert.deepEqual(roundTelemetryEventTypes, [
    "round_started",
    "round_completed",
    "tool_invocation_created",
  ]);
});
