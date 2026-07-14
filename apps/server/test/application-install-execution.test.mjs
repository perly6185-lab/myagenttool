import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

let server;
let base;
let state;
let bridgeToken;

before(async () => {
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../src/runtime/http-server.mjs");
  const projectDir = mkdtempSync(join(tmpdir(), "application-install-execution-"));
  const created = createServerState({ defaultProjectPath: projectDir, now: () => new Date().toISOString() });
  state = created.state;
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test", protocolVersion: "0.0.0", state, defaultProject: created.defaultProject,
    defaultProjectPath: projectDir, persistenceEnabled: false, stateStorePath: "/tmp/unused.json",
    stateSchemaVersion: 1, dispatchLeaseMs: 30_000, now: () => new Date().toISOString(),
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const registered = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "test" } });
  bridgeToken = registered.body.bridgeToken;
});

after(() => server?.close());

test("P2 requires a single-use approval bound to the exact plan", async () => {
  const planned = await call("/api/applications/install/plan", { method: "POST", body: { name: "ccusage", deviceId: state.device.id } });
  assert.equal(planned.status, 200);
  const plan = planned.body.plan;

  const withoutApproval = await call("/api/applications/install/runs", { method: "POST", body: { plan } });
  assert.equal(withoutApproval.status, 403);

  const grant = await call("/api/approvals/grants", { method: "POST", body: { action: "application.install", targetId: plan.planId } });
  assert.equal(grant.status, 201);
  const queued = await call("/api/applications/install/runs", { method: "POST", body: { plan, approvalToken: grant.body.token } });
  assert.equal(queued.status, 201, JSON.stringify(queued.body));
  assert.equal(queued.body.run.status, "queued");

  const replay = await call("/api/applications/install/runs", { method: "POST", body: { plan, approvalToken: grant.body.token } });
  assert.equal(replay.status, 403);
});

test("P2 Bridge dispatch, progress, cancellation, and completion are device-bound and audited", async () => {
  const next = await call("/api/bridge/application-install-next", { token: bridgeToken });
  assert.equal(next.status, 200, JSON.stringify(next.body));
  assert.equal(next.body.plan.execution.shell, false);
  const runId = next.body.runId;

  const progress = await call("/api/bridge/application-install-progress", { method: "POST", token: bridgeToken, body: { runId, type: "spawning", summary: "Starting approved installation." } });
  assert.equal(progress.status, 200);
  const cancelled = await call(`/api/applications/install/runs/${runId}/cancel`, { method: "POST", body: {} });
  assert.equal(cancelled.body.run.status, "cancelling");
  const cancelStatus = await call(`/api/bridge/application-install-cancel-status?runId=${encodeURIComponent(runId)}`, { token: bridgeToken });
  assert.equal(cancelStatus.body.cancelRequested, true);
  const completed = await call("/api/bridge/application-install-complete", { method: "POST", token: bridgeToken, body: { runId, status: "cancelled", classification: "cancelled", summary: "Installation cancelled locally.", exitCode: null, durationMs: 10 } });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.run.status, "cancelled");
  assert.ok(state.events.some((event) => event.type === "application_install_cancelled" && event.data?.runId === runId));
  assert.doesNotMatch(JSON.stringify(completed.body.run), /stdout|stderr|token/i);
});

test("P2 rejects a modified plan before consuming installation work", async () => {
  const planned = await call("/api/applications/install/plan", { method: "POST", body: { name: "git", deviceId: state.device.id } });
  const plan = planned.body.plan;
  const grant = await call("/api/approvals/grants", { method: "POST", body: { action: "application.install", targetId: plan.planId } });
  const modified = { ...plan, execution: { ...plan.execution, args: [...plan.execution.args, "--evil"] } };
  const response = await call("/api/applications/install/runs", { method: "POST", body: { plan: modified, approvalToken: grant.body.token } });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, "application_install_plan_mismatch");
});

async function call(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try { parsed = await response.json(); } catch { parsed = null; }
  return { status: response.status, body: parsed };
}
