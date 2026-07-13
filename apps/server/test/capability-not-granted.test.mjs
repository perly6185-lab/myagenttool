/*
 * Refusal model Phase 4 (#758): `capability_not_granted` becomes reachable. When
 * a requester invokes a capability that EXISTS but is not granted to their team,
 * a not_granted refusal is recorded for the owner — with NO event, so nothing
 * leaks to the requester, whose response stays an opaque capability_not_found.
 * A genuinely-unknown name mints nothing (a typo is not a device veto).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createCapabilityService } from "../src/services/capabilities.mjs";
import { createRefusalRuntime } from "../src/runtime/refusal-log.mjs";

function harness() {
  const state = { refusals: [], projects: [], applications: [] };
  let counter = 0;
  const nextId = (p) => `${p}_${++counter}`;
  const events = [];
  const appendEvent = (event) => { events.push(event); return { ...event, id: nextId("evt") }; };
  const { refuse } = createRefusalRuntime({ state, now: () => "2026-07-13T00:00:00.000Z", nextId, appendEvent });

  // One application owned by team_b, projecting one capability.
  const app = { id: "app_b", name: "b", status: "online", ownerTeamId: "team_b", projectId: null };
  const capability = { name: "app.app_b.wrapper.status", provider: { type: "application", id: "app_b" }, invokable: true };

  const svc = createCapabilityService({
    state,
    refuse,
    listTools: () => [],
    getTool: () => null,
    createToolInvocation: () => ({ status: 500, body: {} }),
    createInvocation: () => ({ id: "inv_1", status: "queued" }),
    completeInvocation: () => {},
    findAgent: () => ({ id: "agt_platform_application_wrapper", status: "enabled" }),
    listApplications: () => [app],
    listApplicationCapabilities: () => [capability],
    invokeApplicationCapability: () => ({ status: 500, body: {} }),
    planApplicationWrapperInvocation: () => ({ ok: true, wrapper: { cwdPolicy: "fixed" }, timeoutSeconds: 120 }),
  });
  return { state, events, svc };
}

test("an ungranted (foreign-team) capability records a not_granted refusal for the owner", () => {
  const { state, events, svc } = harness();
  const res = svc.createCapabilityInvocation("app.app_b.wrapper.status", {}, { teamId: "team_a", userId: "usr_a" });
  // Requester sees an opaque not-found — no capability existence leaks.
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "capability_not_found");
  // The owner gets a first-class refusal record.
  assert.equal(state.refusals.length, 1);
  const ref = state.refusals[0];
  assert.equal(ref.category, "not_granted");
  assert.equal(ref.code, "capability_not_granted");
  assert.equal(ref.subject.id, "app.app_b.wrapper.status");
  assert.equal(ref.requester.kind, "local_user");
  assert.equal(ref.appealTo, "device_owner");
  assert.deepEqual(ref.evidence, { capability: "app.app_b.wrapper.status", providerType: "application", actorTeamId: "team_a" });
  // NOTHING was fired to the requester's timeline — not_granted never surfaces.
  assert.equal(events.length, 0, "no event may fire for a not_granted refusal");
});

test("a genuinely-unknown capability name mints NO refusal (a typo is not a veto)", () => {
  const { state, events, svc } = harness();
  const res = svc.createCapabilityInvocation("app.does_not_exist.wrapper.x", {}, { teamId: "team_a", userId: "usr_a" });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "capability_not_found");
  assert.equal(state.refusals.length, 0, "no capability exists → no grant decision → no refusal");
  assert.equal(events.length, 0);
});

test("the requester response is IDENTICAL for unknown vs not-granted (no existence leak)", () => {
  const { svc } = harness();
  const notGranted = svc.createCapabilityInvocation("app.app_b.wrapper.status", {}, { teamId: "team_a" });
  const unknown = svc.createCapabilityInvocation("app.nope.wrapper.x", {}, { teamId: "team_a" });
  assert.deepEqual(notGranted, unknown, "the two cases are indistinguishable to the requester");
});

test("the owning team is granted and reaches execution (no not_granted refusal)", () => {
  const { state, svc } = harness();
  const res = svc.createCapabilityInvocation("app.app_b.wrapper.status", {}, { teamId: "team_b", userId: "usr_b" });
  // Team B owns the app → capability is visible → it dispatches (202), not refused.
  assert.notEqual(res.status, 404);
  assert.equal(state.refusals.length, 0);
});

test("unscoped/owner context (no teamId) is granted everything — no not_granted noise", () => {
  const { state, svc } = harness();
  const res = svc.createCapabilityInvocation("app.app_b.wrapper.status", {}, { userId: "usr_local" });
  assert.notEqual(res.status, 404);
  assert.equal(state.refusals.length, 0);
});
