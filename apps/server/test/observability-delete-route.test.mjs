/*
 * Route-level test for POST /api/observability/delete (ADR 0018): owner-gated,
 * delegates to the composer's requestObservabilityDeletion. Drives
 * handleControlPlaneRoutes directly with a stubbed deletion dep — no server boot.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { handleControlPlaneRoutes } from "../src/routes/control-plane.mjs";

async function call({ actor, body, requestObservabilityDeletion }) {
  const calls = [];
  const handled = await handleControlPlaneRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://local/api/observability/delete"),
    sendJson: (_res, status, payload) => calls.push({ status, payload }),
    readJson: async () => body ?? {},
    state: {},
    actor,
    now: () => "2026-07-17T00:00:00.000Z",
    nextId: (p) => `${p}_test`,
    appendEvent: () => {},
    requestObservabilityDeletion,
  });
  return { handled, response: calls[0] };
}

test("POST /api/observability/delete is refused for a non-owner (403), never calling the engine", async () => {
  let called = false;
  const { handled, response } = await call({
    actor: { role: "operator", userId: "usr_op" },
    body: { scope: "user", subjectId: "usr_1", tier: "operational" },
    requestObservabilityDeletion: () => { called = true; return { ok: true }; },
  });
  assert.equal(handled, true);
  assert.equal(response.status, 403);
  assert.equal(called, false, "the deletion engine is never reached for a non-owner");
});

test("POST /api/observability/delete runs the deletion for an owner and returns the counts", async () => {
  const seen = [];
  const { response } = await call({
    actor: { role: "owner", userId: "usr_owner" },
    body: { scope: "team", subjectId: "team_a", tier: "full" },
    requestObservabilityDeletion: (args) => { seen.push(args); return { ok: true, tier: "full", invocationCount: 3, counts: { digests: 4 } }; },
  });
  assert.equal(response.status, 200);
  assert.equal(response.payload.deleted, true);
  assert.equal(response.payload.tier, "full");
  assert.equal(response.payload.invocationCount, 3);
  assert.deepEqual(seen[0], { scope: "team", subjectId: "team_a", tier: "full", actor: { role: "owner", userId: "usr_owner" } });
});

test("an owner with an invalid request gets a 400 from the engine result", async () => {
  const { response } = await call({
    actor: { role: "owner", userId: "usr_owner" },
    body: { scope: "bogus", subjectId: "x" },
    requestObservabilityDeletion: () => ({ ok: false, error: "invalid_request" }),
  });
  assert.equal(response.status, 400);
  assert.equal(response.payload.error, "invalid_request");
});
