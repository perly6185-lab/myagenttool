/*
 * Route-level regression tests for the automation tenancy guard (GAP-1).
 *
 * Drives handleControlPlaneRoutes directly with stubbed deps — no server boot,
 * no state.json — to prove PATCH/DELETE /api/automations/:id refuses a foreign
 * team. Before the guard, an enumerable id let a second team delete or repoint
 * (prompt/agent/schedule/enabled) another team's scheduled automation.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { handleControlPlaneRoutes } from "../src/routes/control-plane.mjs";

const TEAM_A = "team_a";
const TEAM_B = "team_b";

function baseState() {
  return {
    projects: [
      { id: "proj_a", ownerTeamId: TEAM_A },
      { id: "proj_b", ownerTeamId: TEAM_B },
    ],
    automations: [
      {
        id: "auto_1",
        projectId: "proj_a",
        name: "nightly",
        prompt: "original prompt",
        agentId: "agent_x",
        enabled: true,
        schedule: { kind: "manual" },
      },
    ],
  };
}

/** Invoke the control-plane handler for one request, capturing the response. */
async function call({ method, path, actor, body }) {
  const state = baseState();
  const calls = [];
  const handled = await handleControlPlaneRoutes({
    req: { method },
    res: {},
    url: new URL(`http://local${path}`),
    sendJson: (_res, status, payload) => calls.push({ status, payload }),
    readJson: async () => body ?? {},
    state,
    actor,
    now: () => "2026-07-01T00:00:00.000Z",
    nextId: (p) => `${p}_test`,
    appendEvent: () => {},
    findAgent: () => null,
    defaultAgent: () => null,
    createInvocation: () => null,
    startInvocationIfAllowed: () => {},
    persistStateSoon: () => {},
    budgetStatusFor: () => null,
    upsertBudget: () => null,
  });
  return { handled, calls, state };
}

test("DELETE /api/automations/:id — a foreign team gets 404 and the automation survives", async () => {
  const { handled, calls, state } = await call({
    method: "DELETE",
    path: "/api/automations/auto_1",
    actor: { teamId: TEAM_B },
  });
  assert.equal(handled, true);
  assert.equal(calls.at(-1).status, 404);
  assert.equal(state.automations.length, 1, "foreign DELETE must not remove the automation");
});

test("DELETE /api/automations/:id — the owning team can delete", async () => {
  const { calls, state } = await call({
    method: "DELETE",
    path: "/api/automations/auto_1",
    actor: { teamId: TEAM_A },
  });
  assert.equal(calls.at(-1).status, 204);
  assert.equal(state.automations.length, 0);
});

test("PATCH /api/automations/:id — a foreign team cannot repoint it (404, fields unchanged)", async () => {
  const { calls, state } = await call({
    method: "PATCH",
    path: "/api/automations/auto_1",
    actor: { teamId: TEAM_B },
    body: { prompt: "attacker prompt", enabled: false, agentId: "agent_evil" },
  });
  assert.equal(calls.at(-1).status, 404);
  const auto = state.automations[0];
  assert.equal(auto.prompt, "original prompt");
  assert.equal(auto.enabled, true);
  assert.equal(auto.agentId, "agent_x");
});

// Existence-hiding drift guard: the "exists but foreign" 404 must be
// byte-identical to the "genuinely missing" 404, or an enumerating cross-team
// caller could tell the two apart. If someone changes one branch's body and not
// the other, this fails.
test("DELETE /api/automations/:id — foreign and missing return an identical 404 body", async () => {
  const foreign = await call({
    method: "DELETE",
    path: "/api/automations/auto_1", // exists, owned by TEAM_A
    actor: { teamId: TEAM_B },
  });
  const missing = await call({
    method: "DELETE",
    path: "/api/automations/auto_does_not_exist",
    actor: { teamId: TEAM_B },
  });
  assert.equal(foreign.calls.at(-1).status, 404);
  assert.equal(missing.calls.at(-1).status, 404);
  assert.deepEqual(
    foreign.calls.at(-1).payload,
    missing.calls.at(-1).payload,
    "foreign automation must be indistinguishable from a missing one",
  );
  assert.deepEqual(foreign.calls.at(-1).payload, { error: "automation_not_found" });
});
