process.env.MYAGENT_REQUIRE_AUTH = "0";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

let server;
let base;
let state;
let projectPath;
let statePathRoot;
let tick = 0;

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  const now = () => new Date(Date.parse("2026-09-01T08:00:00.000Z") + tick++ * 1000).toISOString();
  projectPath = mkdtempSync(join(tmpdir(), "host-operations-pilot-http-project-"));
  statePathRoot = mkdtempSync(join(tmpdir(), "host-operations-pilot-http-state-"));
  const created = createServerState({ defaultProjectPath: projectPath, now });
  state = created.state;
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "host-operations-pilot-http-test", protocolVersion: "0.0.0", state,
    defaultProject: created.defaultProject, defaultProjectPath: projectPath,
    persistenceEnabled: false, stateStorePath: join(statePathRoot, "state.json"), stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000, now,
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "host-operations-pilot-http-test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (projectPath) rmSync(projectPath, { recursive: true, force: true });
  if (statePathRoot) rmSync(statePathRoot, { recursive: true, force: true });
});

async function call(path, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("HTTP pilot closes the consent, operations, feedback, workbench, and evidence loop", async () => {
  state.sshTargets.push({ id: "host_pilot_1", ownerTeamId: "team_local", createdByUserId: "usr_local", revision: 1 });
  const created = await call("/api/host-operations-pilot/campaigns", { method: "POST", body: { label: "真实处置试用" } });
  assert.equal(created.status, 201);
  const campaign = created.body.campaign;

  const activeBefore = await call(`/api/host-operations-pilot/sessions/active?hostId=host_pilot_1&code=${campaign.inviteCode}`);
  assert.equal(activeBefore.body.campaign.label, "真实处置试用");
  assert.equal(activeBefore.body.session, null);

  const started = await call("/api/host-operations-pilot/sessions", { method: "POST", body: {
    inviteCode: campaign.inviteCode, sshTargetId: "host_pilot_1", consent: true, rawIssue: "must not persist",
  } });
  assert.equal(started.status, 201);
  const session = started.body.session;

  state.hostOperationsCases.push({
    id: "case_http_1", ownerTeamId: "team_local", createdByUserId: "usr_local", sshTargetId: "host_pilot_1",
    diagnosticRunId: "run_http_1", intent: "website", status: "needs_help", nextStep: "review_manual_handoff",
    deviceChanged: false, createdAt: new Date(Date.parse(session.startedAt) + 1000).toISOString(), updatedAt: new Date(Date.parse(session.startedAt) + 2000).toISOString(),
    timeline: [{ kind: "case_opened", at: new Date(Date.parse(session.startedAt) + 1000).toISOString(), deviceChanged: false }],
  });
  const completed = await call(`/api/host-operations-pilot/sessions/${session.id}`, { method: "PATCH", body: {
    expectedRevision: session.revision, caseId: "case_http_1", nextStepClear: false, easeRating: 3, notes: "must not persist",
  } });
  assert.equal(completed.status, 200);

  const workbench = await call("/api/host-operations-pilot/campaigns");
  assert.equal(workbench.body.campaigns[0].summary.participation.completed, 1);
  assert.deepEqual(workbench.body.campaigns[0].summary.experience.nextStepClear, { numerator: 0, denominator: 1, rate: 0 });
  assert.equal(workbench.body.campaigns[0].summary.operations.cases.manualHandoff, 1);

  const evidence = await call(`/api/host-operations-pilot/campaigns/${campaign.id}/evidence`);
  assert.equal(evidence.status, 200);
  assert.match(evidence.body.sha256, /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify({ state: state.hostOperationsPilotSessions, evidence: evidence.body });
  assert.equal(serialized.includes("must not persist"), false);

  const closed = await call(`/api/host-operations-pilot/campaigns/${campaign.id}`, { method: "PATCH", body: { expectedRevision: campaign.revision, action: "close" } });
  assert.equal(closed.body.campaign.status, "closed");
});
