/**
 * #1250 — the inactive-invocation tolerance predicate. It must match ONLY the
 * server's terminal-race responses, so a real bug (a different failure) still
 * surfaces instead of being silently swallowed by the pollers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isInactiveInvocationError } from "../src/bridge-events.mjs";

test("matches the server's late-event responses", () => {
  // Shaped like request()'s thrown Error: `${method} ${path} failed: ${json}`.
  assert.equal(
    isInactiveInvocationError(new Error('POST /api/bridge/events failed: {"error":"bridge_invocation_not_active"}')),
    true,
  );
  assert.equal(
    isInactiveInvocationError(new Error('POST /api/bridge/events failed: {"error":"invocation_not_found"}')),
    true,
  );
});

test("does NOT swallow other failures — a real error still propagates", () => {
  assert.equal(isInactiveInvocationError(new Error("POST /api/bridge/events failed: {\"error\":\"bridge_invocation_not_owned\"}")), false);
  assert.equal(isInactiveInvocationError(new Error("ECONNREFUSED 127.0.0.1:5001")), false);
  assert.equal(isInactiveInvocationError(new Error("Unexpected token in JSON")), false);
});

test("tolerates non-Error inputs", () => {
  assert.equal(isInactiveInvocationError("bridge_invocation_not_active"), true);
  assert.equal(isInactiveInvocationError(null), false);
  assert.equal(isInactiveInvocationError(undefined), false);
});
