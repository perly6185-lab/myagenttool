process.env.MYAGENT_REQUIRE_AUTH = "0";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

let server;
let base;
let state;

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  const now = (() => {
    let tick = 0;
    return () => `2026-07-27T00:00:${String(tick++).padStart(2, "0")}.000Z`;
  })();
  const created = createServerState({ defaultProjectPath: "/tmp", now });
  state = created.state;
  state.device.status = "offline";
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "guided-setup-test",
    protocolVersion: "0.0.0",
    state,
    defaultProject: created.defaultProject,
    defaultProjectPath: "/tmp",
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused-guided-setup.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "guided-setup-test",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

async function command(name, runId) {
  const response = await fetch(`${base}/api/guided-setup/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(runId ? { runId } : {}),
  });
  return { response, body: await response.json() };
}

test("start, recheck, cancel, resume, and refresh share one durable run", async () => {
  const started = await command("start");
  assert.equal(started.response.status, 201);
  assert.equal(started.body.guidedSetup.status, "action_required");
  assert.match(started.body.guidedSetup.runId, /^gsr_/);
  const runId = started.body.guidedSetup.runId;

  const refreshed = await fetch(`${base}/api/state`).then((response) => response.json());
  assert.equal(refreshed.guidedSetup.runId, runId);
  assert.equal(state.guidedSetupRuns.length, 1);

  const rechecked = await command("recheck", runId);
  assert.equal(rechecked.response.status, 200);
  assert.equal(rechecked.body.guidedSetup.runId, runId);
  assert.equal(state.guidedSetupRuns[0].checkCount, 2);

  const cancelled = await command("cancel", runId);
  assert.equal(cancelled.body.guidedSetup.status, "cancelled");
  assert.equal((await fetch(`${base}/api/state`).then((response) => response.json())).guidedSetup.status, "cancelled");

  const resumed = await command("resume", runId);
  assert.equal(resumed.body.guidedSetup.status, "action_required");
  assert.equal(resumed.body.guidedSetup.runId, runId);
  assert.equal(state.guidedSetupRuns[0].status, "active");
});

test("commands do not reveal unknown or foreign run ids", async () => {
  const missing = await command("cancel", "gsr_unknown");
  assert.equal(missing.response.status, 404);
  assert.deepEqual(missing.body, { error: "guided_setup_not_found" });

  state.guidedSetupRuns.unshift({
    id: "gsr_foreign",
    ownerTeamId: "team_other",
    ownerUserId: "usr_other",
    status: "active",
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
  });
  const foreign = await command("cancel", "gsr_foreign");
  assert.equal(foreign.response.status, 404);
  assert.deepEqual(foreign.body, { error: "guided_setup_not_found" });
});
