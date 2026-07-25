import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpReceiver } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

// Application health probe (docs/design/APPLICATION_HEALTH_PROBE.md): opt-in
// source-availability checks; auto-DEGRADE only (active→offline after 2
// consecutive failures), never auto-online; honest `unsupported` for sources
// with no local materialization.

const now = () => new Date().toISOString();

let server;
let base;
let state;
let sweep;
let sweepAlertOutbox;
let appId;
let appDir;
let hookServer;
const receivedAlerts = [];

async function waitForAlert(kind, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = receivedAlerts.find((alert) => alert.kind === kind);
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

before(async () => {
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../src/runtime/http-server.mjs");

  const projectDir = mkdtempSync(join(tmpdir(), "health-probe-project-"));
  appDir = mkdtempSync(join(tmpdir(), "health-probe-app-"));
  writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "health-probe-demo", version: "1.0.0" }));

  const created = createServerState({ defaultProjectPath: projectDir, now });
  state = created.state;
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject: created.defaultProject,
    defaultProjectPath: projectDir,
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  sweep = httpDependencies.applicationHealthSweep;
  sweepAlertOutbox = httpDependencies.sweepAlertOutbox;
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const registered = await call("/api/applications/register", {
    method: "POST",
    body: { source: { type: "local", path: appDir }, name: "health-probe-demo" },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  appId = registered.body.application.id;

  // Local webhook receiver so the sweep's operational alerts are observable.
  hookServer = createHttpReceiver((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        receivedAlerts.push(JSON.parse(body));
      } catch {
        /* non-JSON post — ignore */
      }
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise((resolve) => hookServer.listen(0, "127.0.0.1", resolve));
  state.autoRunSettings = {
    ...state.autoRunSettings,
    alertWebhookUrl: `http://127.0.0.1:${hookServer.address().port}/hook`,
  };
});

after(() => {
  server?.close();
  hookServer?.close();
});

const app = () => state.applications.find((a) => a.id === appId);
const events = (type) => state.events.filter((e) => e.type === type);

test("config endpoint: approvalToken enforced, interval bounds validated; default off → sweep is a no-op", async () => {
  const noToken = await call(`/api/applications/${appId}/health-probe`, { method: "POST", body: { enabled: true } });
  assert.equal(noToken.status, 409);
  assert.equal(noToken.body.error, "approval_required");

  const badInterval = await call(`/api/applications/${appId}/health-probe`, {
    method: "POST",
    body: { enabled: true, intervalMinutes: 0, approvalToken: "operator-approved" },
  });
  assert.equal(badInterval.status, 400);
  assert.match(badInterval.body.message, /between 1 and 60/);

  sweep({ force: true });
  assert.equal(app().health, undefined, "no health verdict is recorded while the probe is off");

  const enabled = await call(`/api/applications/${appId}/health-probe`, {
    method: "POST",
    body: { enabled: true, intervalMinutes: 5, approvalToken: "operator-approved" },
  });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.application.healthProbe.enabled, true);
});

test("healthy source: health recorded, status untouched, sweep throttled by intervalMinutes", () => {
  assert.equal(app().status, "active");
  sweep({ force: true });
  assert.equal(app().health.status, "healthy");
  assert.equal(app().health.consecutiveFailures, 0);
  assert.equal(app().status, "active");
  // A second un-forced sweep inside the interval is a no-op (checkedAt unchanged).
  const checkedAt = app().health.checkedAt;
  sweep();
  assert.equal(app().health.checkedAt, checkedAt, "per-app interval throttle skips the check");
});

test("source disappears: first failure keeps it active, second auto-offlines with audit events", () => {
  rmSync(appDir, { recursive: true, force: true });

  sweep({ force: true });
  assert.equal(app().health.status, "unhealthy");
  assert.equal(app().health.consecutiveFailures, 1);
  assert.equal(app().status, "active", "one failure must not flap the app offline");

  sweep({ force: true });
  assert.equal(app().health.consecutiveFailures, 2);
  assert.equal(app().status, "offline", "threshold reached → auto-degrade");
  assert.equal(events("application_health_probe_failed").length, 2);
  assert.equal(events("application_health_auto_offline").length, 1);
  // The transition went through the ordinary lifecycle path, attributed to the system.
  assert.equal(app().lifecycle.lastOperation, "offline");
  assert.equal(app().lifecycle.lastActorId, "system_health_probe");
});

test("the auto-offline pushes an operator alert to the configured webhook", async () => {
  await sweepAlertOutbox();
  const alert = await waitForAlert("application_health_auto_offline");
  assert.ok(alert, "webhook received the auto-offline alert");
  assert.equal(alert.severity, "warning");
  assert.equal(alert.data.applicationId, appId);
  assert.match(alert.message, /taken offline after 2 failed health checks/);
  assert.match(alert.message, /requires a human/);
});

test("source recovers: health goes healthy with an event, but status STAYS offline until a human acts", async () => {
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "health-probe-demo", version: "1.0.0" }));

  sweep({ force: true });
  assert.equal(app().health.status, "healthy");
  assert.equal(app().health.consecutiveFailures, 0);
  assert.equal(app().status, "offline", "recovery never auto-onlines");
  assert.equal(events("application_health_recovered").length, 1);

  // The human path completes the loop (capability invocation with approvalToken).
  const online = await call(`/api/applications/${appId}/online`, {
    method: "POST",
    body: { approvalToken: "operator-approved" },
  });
  assert.equal(online.status, 201, JSON.stringify(online.body));
  assert.equal(app().status, "active");
});

test("the sweep records its own health signal, visible in /api/state", async () => {
  sweep({ force: true });
  assert.ok(state.applicationHealthSweepStatus, "sweep status recorded");
  assert.ok(state.applicationHealthSweepStatus.lastSweepAt);
  assert.equal(state.applicationHealthSweepStatus.lastError, null);
  assert.ok(state.applicationHealthSweepStatus.checkedCount >= 1);
  const snapshot = await call("/api/state");
  assert.deepEqual(snapshot.body.applicationHealthSweepStatus, state.applicationHealthSweepStatus);
});

test("manual sources (no local materialization) read `unsupported` and are never auto-transitioned", async () => {
  const registered = await call("/api/applications/register", {
    method: "POST",
    body: { source: { type: "manual", uri: "https://example.com/app" }, name: "manual-demo" },
  });
  assert.equal(registered.status, 201);
  const manualId = registered.body.application.id;
  const enabled = await call(`/api/applications/${manualId}/health-probe`, {
    method: "POST",
    body: { enabled: true, approvalToken: "operator-approved" },
  });
  assert.equal(enabled.status, 200);

  sweep({ force: true });
  sweep({ force: true });
  const manual = state.applications.find((a) => a.id === manualId);
  assert.equal(manual.health.status, "unsupported");
  assert.notEqual(manual.status, "offline", "unsupported verdicts never degrade the app");
});

// #885 — an npm source (e.g. ccusage) has no local path, so its health is
// derived from its most recent run instead of a blind `unsupported`.
function seedNpmApp(id, status, over = {}) {
  const app = { id, name: id, status: "active", source: { type: "npm", package: "ccusage" }, path: null, healthProbe: { enabled: true, intervalMinutes: 1, lastCheckedAt: null }, health: null, createdAt: now(), updatedAt: now() };
  state.applications.push(app);
  state.invocations.unshift({ id: `inv_${id}`, status, completedAt: now(), options: { metadata: { applicationId: id } }, ...over });
  return app;
}

test("an npm-sourced app derives UNHEALTHY from its most recent failed run", () => {
  seedNpmApp("app_npm_fail", "failed", { result: { output: { error: "ccusage: command not found" } } });
  sweep({ force: true });
  const app = state.applications.find((a) => a.id === "app_npm_fail");
  assert.equal(app.health.status, "unhealthy");
  assert.match(app.health.reason, /command not found/);
});

test("an npm-sourced app with a recent successful run is HEALTHY", () => {
  seedNpmApp("app_npm_ok", "succeeded", { result: {} });
  sweep({ force: true });
  assert.equal(state.applications.find((a) => a.id === "app_npm_ok").health.status, "healthy");
});

test("a binary-source app (e.g. git) derives health from its latest run (#906)", () => {
  const app = { id: "app_bin_git", name: "git", status: "active", source: { type: "binary", binary: "git" }, path: null, healthProbe: { enabled: true, intervalMinutes: 1, lastCheckedAt: null }, health: null, createdAt: now(), updatedAt: now() };
  state.applications.push(app);
  state.invocations.unshift({ id: "inv_bin_git", status: "failed", completedAt: now(), options: { metadata: { applicationId: "app_bin_git" } }, result: { output: { error: "git: command not found" } } });
  sweep({ force: true });
  const updated = state.applications.find((a) => a.id === "app_bin_git");
  assert.equal(updated.health.status, "unhealthy", "a binary source is no longer a permanent `unsupported`");
  assert.match(updated.health.reason, /command not found/);
});

test("an npm-sourced app with no runs stays `unsupported` (no guessed verdict)", () => {
  const app = { id: "app_npm_new", name: "app_npm_new", status: "active", source: { type: "npm" }, path: null, healthProbe: { enabled: true, intervalMinutes: 1, lastCheckedAt: null }, health: null, createdAt: now(), updatedAt: now() };
  state.applications.push(app);
  sweep({ force: true });
  assert.equal(state.applications.find((a) => a.id === "app_npm_new").health.status, "unsupported");
});

async function call(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}
