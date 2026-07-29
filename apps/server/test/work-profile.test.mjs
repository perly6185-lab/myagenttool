import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPublicState } from "../src/read-models/state.mjs";
import { handleWorkProfileRoutes } from "../src/routes/work-profile.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";

function baseState() {
  return {
    workProfileInferences: [{
      id: "wpi_1",
      userId: "usr_a",
      ownerTeamId: "team_a",
      category: "work_type",
      value: "software_development",
      confidence: 0.86,
      status: "pending",
      evidence: [{
        projectId: "prj_a",
        projectName: "Alpha",
        authorizedDirectory: "C:\\work\\alpha",
      }],
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    }],
    workProfileAuditEvents: [],
  };
}

async function call({ method, path, actor, body, state = baseState() }) {
  const calls = [];
  let persisted = 0;
  let sequence = 0;
  const handled = await handleWorkProfileRoutes({
    req: { method },
    res: {},
    url: new URL(`http://local${path}`),
    sendJson: (_res, status, payload) => calls.push({ status, payload }),
    readJson: async () => body ?? {},
    state,
    actor,
    now: () => "2026-07-29T01:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++sequence}`,
    persistStateSoon: () => { persisted += 1; },
  });
  return { handled, calls, state, persisted };
}

test("a user can correct an incorrect work-profile classification with evidence retained", async () => {
  const result = await call({
    method: "PATCH",
    path: "/api/work-profile/inferences/wpi_1",
    actor: { userId: "usr_a", teamId: "team_a" },
    body: { category: "role", value: "Technical lead", reason: "Wrong classification" },
  });

  assert.equal(result.handled, true);
  assert.equal(result.calls.at(-1).status, 200);
  assert.equal(result.state.workProfileInferences[0].category, "role");
  assert.equal(result.state.workProfileInferences[0].value, "Technical lead");
  assert.equal(result.state.workProfileInferences[0].status, "pending");
  assert.equal(result.state.workProfileInferences[0].evidence[0].authorizedDirectory, "C:\\work\\alpha");
  assert.deepEqual(result.state.workProfileAuditEvents[0].before, {
    category: "work_type",
    value: "software_development",
    status: "pending",
    evidence: [{
      projectId: "prj_a",
      projectName: "Alpha",
      authorizedDirectory: "C:\\work\\alpha",
    }],
  });
  assert.equal(result.state.workProfileAuditEvents[0].after.category, "role");
  assert.equal(result.state.workProfileAuditEvents[0].action, "modified");
  assert.equal(result.persisted, 1);
});

test("confirm and reject decisions are durable audit events", async () => {
  const state = baseState();
  const confirmed = await call({
    method: "POST",
    path: "/api/work-profile/inferences/wpi_1/confirm",
    actor: { userId: "usr_a", teamId: "team_a" },
    state,
  });
  assert.equal(confirmed.state.workProfileInferences[0].status, "confirmed");
  assert.equal(confirmed.state.workProfileAuditEvents[0].action, "confirmed");

  const rejected = await call({
    method: "POST",
    path: "/api/work-profile/inferences/wpi_1/reject",
    actor: { userId: "usr_a", teamId: "team_a" },
    body: { reason: "Not representative" },
    state,
  });
  assert.equal(rejected.state.workProfileInferences[0].status, "rejected");
  assert.equal(rejected.state.workProfileAuditEvents[0].action, "rejected");
  assert.equal(rejected.state.workProfileAuditEvents[0].reason, "Not representative");
});

test("deletion removes the inference but retains an auditable pre-delete snapshot", async () => {
  const result = await call({
    method: "DELETE",
    path: "/api/work-profile/inferences/wpi_1",
    actor: { userId: "usr_a", teamId: "team_a" },
    body: { reason: "Remove it" },
  });

  assert.equal(result.calls.at(-1).status, 200);
  assert.equal(result.state.workProfileInferences.length, 0);
  assert.equal(result.state.workProfileAuditEvents.length, 1);
  assert.equal(result.state.workProfileAuditEvents[0].action, "deleted");
  assert.equal(result.state.workProfileAuditEvents[0].before.value, "software_development");
  assert.equal(result.state.workProfileAuditEvents[0].after, null);
});

test("another user or team cannot locate or mutate a work-profile inference", async () => {
  for (const actor of [
    { userId: "usr_b", teamId: "team_a" },
    { userId: "usr_a", teamId: "team_b" },
  ]) {
    const result = await call({
      method: "PATCH",
      path: "/api/work-profile/inferences/wpi_1",
      actor,
      body: { category: "role", value: "Attacker" },
    });
    assert.equal(result.calls.at(-1).status, 404);
    assert.deepEqual(result.calls.at(-1).payload, { error: "work_profile_inference_not_found" });
    assert.equal(result.state.workProfileInferences[0].value, "software_development");
    assert.equal(result.state.workProfileAuditEvents.length, 0);
  }
});

test("the public state exposes only the current user's profile and audit history", () => {
  const now = () => "2026-07-29T01:00:00.000Z";
  const defaultProjectPath = process.cwd();
  const { state } = createServerState({ defaultProjectPath, now });
  state.workProfileInferences.push({
    ...state.workProfileInferences[0],
    id: "wpi_foreign",
    userId: "usr_b",
    ownerTeamId: "team_b",
  });
  state.workProfileAuditEvents.push(
    {
      id: "wpa_local",
      inferenceId: "wpi_primary_work",
      userId: "usr_local",
      ownerTeamId: "team_local",
      actorId: "usr_local",
      action: "confirmed",
      before: null,
      after: null,
      at: now(),
    },
    {
      id: "wpa_foreign",
      inferenceId: "wpi_foreign",
      userId: "usr_b",
      ownerTeamId: "team_b",
      actorId: "usr_b",
      action: "confirmed",
      before: null,
      after: null,
      at: now(),
    },
  );

  const snapshot = buildPublicState({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProjectPath,
    currentProject: () => state.projects[0],
    defaultAgent: () => state.agents[0],
    loopRoutineReadModel: () => [],
    codexApprovalQueue: () => [],
    evidenceCenterRecords: () => [],
    ledgerSummary: () => null,
    budgetStatuses: () => [],
    teamBudgetStatuses: () => [],
    actor: { userId: "usr_local", teamId: "team_local" },
  });

  assert.deepEqual(snapshot.workProfileInferences.map((row) => row.id), ["wpi_primary_work"]);
  assert.equal(
    snapshot.workProfileInferences[0].evidence[0].authorizedDirectory,
    state.projects[0].path,
  );
  assert.deepEqual(snapshot.workProfileAuditEvents.map((row) => row.id), ["wpa_local"]);
});

test("sanitized inference persists protocol-aligned rows for human review", async () => {
  const state = {
    projects: [{
      id: "prj_a",
      name: "Alpha",
      path: "C:\\work\\alpha",
      ownerTeamId: "team_a",
    }],
    workProfileInferences: [],
    workProfileAuditEvents: [],
  };
  const result = await call({
    method: "POST",
    path: "/api/work-profile/infer",
    actor: { userId: "usr_a", teamId: "team_a" },
    body: {
      projectId: "prj_a",
      input: {
        schema: "local-sanitized-profile-features/v1",
        sanitized: true,
        features: [
          { key: "technical_activity", score: 0.9, observations: 8 },
          { key: "detailed_response_preference", score: 0.7, observations: 5 },
        ],
      },
    },
    state,
  });

  assert.equal(result.calls.at(-1).status, 201);
  assert.equal(result.persisted, 1);
  assert.equal(result.state.workProfileInferences.length, 2);
  const technical = result.state.workProfileInferences.find(
    (row) => row.value === "interest.technology",
  );
  assert.equal(technical.category, "domain");
  assert.equal(technical.protocolKind, "category");
  assert.equal(technical.status, "pending");
  assert.equal(technical.sourceSummary.sources[0].kind, "project");
  assert.equal(technical.evidence[0].authorizedDirectory, "C:\\work\\alpha");
  assert.equal(technical.sourceSummary.observationCount, 8);
});

test("profile inference hides foreign projects and rejects raw input fields", async () => {
  const state = {
    projects: [{
      id: "prj_a",
      name: "Alpha",
      path: "C:\\work\\alpha",
      ownerTeamId: "team_a",
    }],
    workProfileInferences: [],
    workProfileAuditEvents: [],
  };
  const foreign = await call({
    method: "POST",
    path: "/api/work-profile/infer",
    actor: { userId: "usr_b", teamId: "team_b" },
    body: {
      projectId: "prj_a",
      input: { schema: "local-sanitized-profile-features/v1", sanitized: true, features: [] },
    },
    state,
  });
  assert.equal(foreign.calls.at(-1).status, 404);

  const raw = await call({
    method: "POST",
    path: "/api/work-profile/infer",
    actor: { userId: "usr_a", teamId: "team_a" },
    body: {
      projectId: "prj_a",
      input: {
        schema: "local-sanitized-profile-features/v1",
        sanitized: true,
        features: [],
        rawText: "must not be accepted",
      },
    },
    state,
  });
  assert.equal(raw.calls.at(-1).status, 400);
  assert.equal(raw.calls.at(-1).payload.error, "unauthorized_input_field");
  assert.equal(state.workProfileInferences.length, 0);
});
