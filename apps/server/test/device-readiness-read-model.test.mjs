import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPublicState } from "../src/read-models/state.mjs";

function publicState(devices, { users = [{ id: "usr_a", teamId: "team_a" }], teamId = "team_a" } = {}) {
  const state = {
    devices,
    device: devices[0],
    users,
    teams: [...new Set(users.map((user) => user.teamId))].map((id) => ({ id })),
    projects: [], applications: [], invocations: [], events: [], auditSummaries: [], agents: [],
  };
  return buildPublicState({
    namespace: "test", protocolVersion: "0", state, defaultProjectPath: ".",
    currentProject: () => null, defaultAgent: () => null, loopRoutineReadModel: () => null,
    codexApprovalQueue: () => [], evidenceCenterRecords: () => [], ledgerSummary: () => null,
    budgetStatuses: () => [], teamBudgetStatuses: () => [], actor: { teamId },
  });
}

test("public state exposes every team device and derives stale readiness", () => {
  const fresh = new Date().toISOString();
  const old = "2026-01-01T00:00:00.000Z";
  const published = publicState([
    { id: "dev_a", ownerUserId: "usr_a", name: "A", status: "online", applicationBinaryReadiness: [{ command: "git", capabilityPrefix: "app.app_git.wrapper.", status: "absent", version: null, checkedAt: fresh }] },
    { id: "dev_b", ownerUserId: "usr_a", name: "B", status: "online", applicationBinaryReadiness: [{ command: "git", capabilityPrefix: "app.app_git.wrapper.", status: "available", version: "git version 2", checkedAt: old }] },
    { id: "dev_c", ownerUserId: "usr_a", name: "C", status: "offline", applicationBinaryReadiness: [{ command: "git", capabilityPrefix: "app.app_git.wrapper.", status: "available", version: "git version 3", checkedAt: fresh }] },
  ]);
  assert.equal(published.devices.length, 3);
  assert.equal(published.devices[0].applicationBinaryReadiness[0].status, "absent");
  assert.equal(published.devices[1].applicationBinaryReadiness[0].status, "stale");
  assert.equal(published.devices[2].applicationBinaryReadiness[0].status, "stale");
  assert.equal(published.guidedSetup.version, 1);
  assert.equal(published.guidedSetup.currentStep, "workspace");
});

test("the singleton device alias never falls back to another team's primary device", () => {
  const published = publicState([
    { id: "dev_a", ownerUserId: "usr_a", name: "A", status: "online", applicationBinaryReadiness: [] },
    { id: "dev_b", ownerUserId: "usr_b", name: "B", status: "online", applicationBinaryReadiness: [] },
  ], {
    users: [{ id: "usr_a", teamId: "team_a" }, { id: "usr_b", teamId: "team_b" }],
    teamId: "team_b",
  });
  assert.deepEqual(published.devices.map((device) => device.id), ["dev_b"]);
  assert.equal(published.device.id, "dev_b");
});
