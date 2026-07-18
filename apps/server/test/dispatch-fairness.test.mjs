/*
 * Fair Layer-A dispatch selection (#2): least-loaded team → least-loaded project →
 * oldest-waiting (FIFO), replacing array-order first-match so one tenant's burst
 * can't starve the rest.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { invocationProjectKey, invocationTeamKey, selectFairInvocation } from "../src/services/invocations/dispatch-fairness.mjs";

test("ownership keys: project from projectId/metadata, team via project owner then requester", () => {
  const state = { projects: [{ id: "prj_1", ownerTeamId: "team_a" }], users: [{ id: "usr_1", teamId: "team_z" }] };
  assert.equal(invocationProjectKey({ projectId: "prj_1" }), "prj_1");
  assert.equal(invocationProjectKey({ options: { metadata: { projectId: "prj_2" } } }), "prj_2");
  assert.equal(invocationProjectKey({}), "__no_project__");
  assert.equal(invocationTeamKey({ projectId: "prj_1" }, state), "team_a", "team via the project's owner");
  assert.equal(invocationTeamKey({ requestedBy: "usr_1" }, state), "team_z", "falls back to the requester's team");
  assert.equal(invocationTeamKey({}, state), "team_local", "single-tenant default");
});

const ageOf = (inv) => inv.age; // larger = waited longer

test("empty candidates → undefined", () => {
  assert.equal(selectFairInvocation([], { levels: [], ageMsOf: ageOf }), undefined);
});

test("single group: oldest-waiting first (FIFO), stable on ties", () => {
  const c = [
    { id: "young", g: "x", age: 10 },
    { id: "old", g: "x", age: 100 },
    { id: "mid", g: "x", age: 50 },
  ];
  const pick = selectFairInvocation(c, {
    levels: [{ keyOf: (i) => i.g, loadOf: () => 0 }],
    ageMsOf: ageOf,
  });
  assert.equal(pick.id, "old", "oldest waiter wins within a group");

  const tie = [{ id: "first", g: "x", age: 5 }, { id: "second", g: "x", age: 5 }];
  assert.equal(selectFairInvocation(tie, { levels: [{ keyOf: (i) => i.g, loadOf: () => 0 }], ageMsOf: ageOf }).id, "first", "equal age → original order");
});

test("least-loaded team wins even when its item is newer / later in the array", () => {
  const load = new Map([["busy", 3], ["idle", 0]]);
  const candidates = [
    { id: "busyTeamOld", team: "busy", age: 100 }, // earlier + older, but its team is loaded
    { id: "idleTeamNew", team: "idle", age: 10 },
  ];
  const pick = selectFairInvocation(candidates, {
    levels: [{ keyOf: (i) => i.team, loadOf: (k) => load.get(k) ?? 0 }],
    ageMsOf: ageOf,
  });
  assert.equal(pick.id, "idleTeamNew", "the idle tenant is served, not the flooding one at the front of the array");
});

test("hierarchy: least-loaded team, then least-loaded project, then oldest", () => {
  const teamLoad = new Map([["a", 0], ["b", 0]]);
  const projectLoad = new Map([["a1", 2], ["a2", 0]]);
  const candidates = [
    { id: "a1_old", team: "a", project: "a1", age: 100 }, // team a, but project a1 is loaded
    { id: "a2_new", team: "a", project: "a2", age: 10 },  // team a, project a2 idle → wins
    { id: "b_oldest", team: "b", project: "b1", age: 200 },
  ];
  const pick = selectFairInvocation(candidates, {
    levels: [
      { keyOf: (i) => i.team, loadOf: (k) => teamLoad.get(k) ?? 0 },
      { keyOf: (i) => i.project, loadOf: (k) => projectLoad.get(k) ?? 0 },
    ],
    ageMsOf: ageOf,
  });
  // Teams a and b are equally loaded (0); tie broken toward the oldest-waiting
  // group → team b (age 200). Within b there's one project → b_oldest.
  assert.equal(pick.id, "b_oldest", "equal team load → the longest-waiting team");

  // Now make team b loaded so team a wins; within a, project a2 (idle) beats a1.
  teamLoad.set("b", 5);
  const pick2 = selectFairInvocation(candidates, {
    levels: [
      { keyOf: (i) => i.team, loadOf: (k) => teamLoad.get(k) ?? 0 },
      { keyOf: (i) => i.project, loadOf: (k) => projectLoad.get(k) ?? 0 },
    ],
    ageMsOf: ageOf,
  });
  assert.equal(pick2.id, "a2_new", "least-loaded team a, then its least-loaded project a2");
});
