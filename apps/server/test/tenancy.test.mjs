/*
 * Hermetic unit tests for the tenancy layer (runtime/auth.mjs).
 *
 * These are the first real unit tests in the server: they import the pure
 * identity/authorization helpers and exercise them against hand-built state,
 * with NO server boot and NO dependency on apps/server/data/state.json. Tenancy
 * only bites once MYAGENT_REQUIRE_AUTH=1 and a second team exist, and project
 * ids are enumerable, so cross-team write guards are security-critical and
 * deserve regression coverage that can't silently rot.
 *
 * Run: node --test  (from apps/server), or `pnpm --filter @myagenttool/server test:unit`.
 * The route-level coverage this pins down lives in docs/engineering/TENANCY_ROUTE_MATRIX.md.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LOCAL_TEAM_ID,
  LOCAL_USER_ID,
  denyForeignProject,
  resolveActor,
  teamOf,
} from "../src/runtime/auth.mjs";

/** A sendJson spy matching the (res, status, body) signature the routes use. */
function captureSend() {
  const calls = [];
  const sendJson = (res, status, body) => calls.push({ res, status, body });
  return { sendJson, calls };
}

function reqWith(token) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}

const TEAM_A = "team_a";
const TEAM_B = "team_b";

/** Two teams, two users, a live token for user A, and a project per team. */
function twoTeamState({ tokenExpiresAt } = {}) {
  return {
    users: [
      { id: "usr_a", teamId: TEAM_A },
      { id: "usr_b", teamId: TEAM_B },
      { id: LOCAL_USER_ID, teamId: LOCAL_TEAM_ID },
    ],
    teams: [{ id: TEAM_A }, { id: TEAM_B }, { id: LOCAL_TEAM_ID }],
    tokens: [
      {
        token: "tok_a",
        userId: "usr_a",
        expiresAt: tokenExpiresAt ?? new Date(Date.now() + 60_000).toISOString(),
      },
    ],
    projects: [
      { id: "proj_a", ownerTeamId: TEAM_A },
      { id: "proj_b", ownerTeamId: TEAM_B },
      { id: "proj_unowned" },
    ],
  };
}

test("teamOf: unowned project falls back to the local team", () => {
  assert.equal(teamOf({ id: "p" }), LOCAL_TEAM_ID);
  assert.equal(teamOf(undefined), LOCAL_TEAM_ID);
  assert.equal(teamOf({ id: "p", ownerTeamId: TEAM_B }), TEAM_B);
});

test("resolveActor: a live token names its user and is authenticated", () => {
  const state = twoTeamState();
  const actor = resolveActor(state, reqWith("tok_a"));
  assert.equal(actor.userId, "usr_a");
  assert.equal(actor.teamId, TEAM_A);
  assert.equal(actor.authenticated, true);
});

test("resolveActor: no token falls back to the seeded local user, unauthenticated", () => {
  const state = twoTeamState();
  const actor = resolveActor(state, reqWith(null));
  assert.equal(actor.userId, LOCAL_USER_ID);
  assert.equal(actor.teamId, LOCAL_TEAM_ID);
  assert.equal(actor.authenticated, false);
});

test("resolveActor: an expired token does not authenticate (falls back to local)", () => {
  const state = twoTeamState({ tokenExpiresAt: new Date(Date.now() - 1_000).toISOString() });
  const actor = resolveActor(state, reqWith("tok_a"));
  assert.equal(actor.authenticated, false);
  assert.equal(actor.teamId, LOCAL_TEAM_ID);
});

test("resolveActor: a revoked token does not authenticate", () => {
  const state = twoTeamState();
  state.tokens[0].revokedAt = new Date(Date.now() - 1_000).toISOString();
  const actor = resolveActor(state, reqWith("tok_a"));
  assert.equal(actor.authenticated, false);
});

test("denyForeignProject: owning team is allowed through (no response written)", () => {
  const state = twoTeamState();
  const { sendJson, calls } = captureSend();
  const actor = { teamId: TEAM_A };
  const denied = denyForeignProject({ res: {}, sendJson, state, actor, projectId: "proj_a" });
  assert.equal(denied, false);
  assert.equal(calls.length, 0);
});

// Existence-hiding: a foreign project answers 404 (not 403), so an enumerating
// cross-team caller can't distinguish "exists but not yours" from "missing".
test("denyForeignProject: a foreign team is blocked with a 404 (hides existence)", () => {
  const state = twoTeamState();
  const { sendJson, calls } = captureSend();
  const actor = { teamId: TEAM_B };
  const denied = denyForeignProject({ res: {}, sendJson, state, actor, projectId: "proj_a" });
  assert.equal(denied, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 404);
  assert.equal(calls[0].body.error, "not_found");
});

test("denyForeignProject: a missing projectId is a no-op (route-level not-found handles it)", () => {
  const state = twoTeamState();
  const { sendJson, calls } = captureSend();
  const denied = denyForeignProject({
    res: {},
    sendJson,
    state,
    actor: { teamId: TEAM_B },
    projectId: undefined,
  });
  assert.equal(denied, false);
  assert.equal(calls.length, 0);
});

// Behavior guard, not an endorsement: an UNKNOWN projectId is currently allowed
// through (the guard can't resolve a team, so it declines to block and leaves
// the 404 to the route). If a route ever trusts this guard alone to scope a
// write on a dangling id, that is a cross-tenant hole — this test will flag the
// day the behavior changes so the decision is made deliberately.
test("denyForeignProject: an unknown projectId is currently allowed through (documents the gap)", () => {
  const state = twoTeamState();
  const { sendJson, calls } = captureSend();
  const denied = denyForeignProject({
    res: {},
    sendJson,
    state,
    actor: { teamId: TEAM_B },
    projectId: "proj_does_not_exist",
  });
  assert.equal(denied, false, "unknown projectId is not blocked by the ownership guard today");
  assert.equal(calls.length, 0);
});
