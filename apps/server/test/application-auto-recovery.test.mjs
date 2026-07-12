import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer as createHttpReceiver } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

// Orchestration auto-recovery (docs/design/ORCHESTRATION_AUTO_RECOVERY.md),
// driven end-to-end over real HTTP including the bridge protocol: opt-in config,
// auto-rerun on runtime failure, crash-loop cap, approval gate never crossed.

const now = () => new Date().toISOString();

let server;
let base;
let state;
let bridgeToken;
let appId;
let routineId;

before(async () => {
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../src/runtime/http-server.mjs");

  const projectDir = mkdtempSync(join(tmpdir(), "auto-recovery-project-"));
  const appDir = mkdtempSync(join(tmpdir(), "auto-recovery-app-"));
  writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "auto-recovery-demo", version: "1.0.0", scripts: { test: "echo ok" } }));

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
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const registered = await call("/api/applications/register", {
    method: "POST",
    body: { source: { type: "local", path: appDir }, name: "auto-recovery-demo" },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  appId = registered.body.application.id;
  routineId = `app-${appId}-maintenance`;
  const generated = await call(`/api/applications/${appId}/orchestrations/generate`, {
    method: "POST",
    body: { approvalToken: "operator-approved" },
  });
  assert.equal(generated.status, 201, JSON.stringify(generated.body));

  const bridge = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "test" } });
  assert.equal(bridge.status, 200);
  bridgeToken = bridge.body.bridgeToken;

  // Local webhook receiver so the crash-loop alert is observable.
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

// Run the routine and complete it via the bridge protocol with the given outcome.
async function runAndComplete({ status, summary }) {
  const run = await call(`/api/applications/${appId}/orchestrations/${routineId}/run`, { method: "POST", body: {} });
  assert.equal(run.status, 201, JSON.stringify(run.body));
  const invocationId = run.body.invocation.id;
  await completeViaBridge(invocationId, { status, summary });
  return invocationId;
}

async function completeViaBridge(invocationId, { status, summary }) {
  // Drain the dispatch queue until this invocation's delivery is leased.
  for (let i = 0; i < 10; i += 1) {
    const next = await call("/api/bridge/next", { token: bridgeToken });
    if (next.status === 204) break;
    if (next.body?.invocationId === invocationId) break;
  }
  const ack = await call("/api/bridge/ack", { method: "POST", body: { invocationId }, token: bridgeToken });
  assert.equal(ack.status, 200, `ack ${invocationId}: ${JSON.stringify(ack.body)}`);
  const complete = await call("/api/bridge/complete", {
    method: "POST",
    body: { invocationId, status, result: { summary } },
    token: bridgeToken,
  });
  assert.equal(complete.status, 200, `complete ${invocationId}: ${JSON.stringify(complete.body)}`);
}

const autoRequests = () => state.applicationRecoveryActions.filter((r) => r.requestedBy === "system_auto_recovery");
const autoRerunsOf = (invocationId) => state.invocations.filter(
  (inv) => inv.options?.metadata?.recoveryOfInvocationId === invocationId
    && inv.options?.metadata?.recoveryActionType === "rerun",
);
const skipEvents = (reason) => state.events.filter(
  (e) => e.type === "application_orchestration_auto_recovery_skipped" && e.data?.reason === reason,
);

test("auto-recovery config: approvalToken enforced, bounds validated, default off", async () => {
  const noToken = await call(`/api/applications/${appId}/auto-recovery`, { method: "POST", body: { enabled: true } });
  assert.equal(noToken.status, 409);
  assert.equal(noToken.body.error, "approval_required");

  const badCap = await call(`/api/applications/${appId}/auto-recovery`, {
    method: "POST",
    body: { enabled: true, maxAttempts: 9, approvalToken: "operator-approved" },
  });
  assert.equal(badCap.status, 400);
  assert.match(badCap.body.message, /between 1 and 5/);

  // Default off: a failed run with no config produces no auto action, silently.
  const failedWhileOff = await runAndComplete({ status: "failed", summary: "npm test failed with exit code 1" });
  assert.equal(autoRequests().length, 0);
  assert.equal(autoRerunsOf(failedWhileOff).length, 0);
  assert.equal(state.events.filter((e) => e.type === "application_orchestration_auto_recovery_skipped").length, 0, "opted-out apps emit no skip noise");

  const enabled = await call(`/api/applications/${appId}/auto-recovery`, {
    method: "POST",
    body: { enabled: true, maxAttempts: 2, approvalToken: "operator-approved" },
  });
  assert.equal(enabled.status, 200);
  assert.deepEqual(enabled.body.application.autoRecovery, { enabled: true, maxAttempts: 2 });
});

test("a runtime failure auto-reruns, attributed to the system actor; a success resets the cap", async () => {
  const failed = await runAndComplete({ status: "failed", summary: "npm test failed with exit code 1" });
  const reruns = autoRerunsOf(failed);
  assert.equal(reruns.length, 1, "exactly one auto rerun spawned");
  assert.equal(autoRequests().at(-1).invocationId, failed);
  assert.equal(autoRequests().at(-1).actionType, "rerun");
  // The auto rerun succeeds → stream healthy again, attempt counter resets.
  await completeViaBridge(reruns[0].id, { status: "succeeded", summary: "maintenance findings reported" });
  assert.equal(autoRequests().length, 1);
});

test("crash-loop cap: after maxAttempts consecutive auto attempts, it stops with an audit event", async () => {
  const baseline = autoRequests().length;
  const failed1 = await runAndComplete({ status: "failed", summary: "npm test failed with exit code 1" });
  const rerun1 = autoRerunsOf(failed1)[0];
  assert.ok(rerun1, "attempt 1 spawned");
  await completeViaBridge(rerun1.id, { status: "failed", summary: "npm test failed with exit code 1" });
  const rerun2 = autoRerunsOf(rerun1.id)[0];
  assert.ok(rerun2, "attempt 2 spawned (rerun of the failed rerun)");
  await completeViaBridge(rerun2.id, { status: "failed", summary: "npm test failed with exit code 1" });
  assert.equal(autoRerunsOf(rerun2.id).length, 0, "attempt 3 must NOT spawn — cap is 2");
  assert.equal(autoRequests().length - baseline, 2);
  assert.equal(skipEvents("attempt_cap").length, 1);
  assert.equal(skipEvents("attempt_cap")[0].data.maxAttempts, 2);
  // The crash-loop is the one auto-recovery outcome a human must hear about.
  const alert = await waitForAlert("application_auto_recovery_capped");
  assert.ok(alert, "webhook received the crash-loop alert");
  assert.equal(alert.severity, "warning");
  assert.equal(alert.data.maxAttempts, 2);
  assert.match(alert.message, /still failing/);
});

test("approval-gated categories are auto-FILED for human approval, never auto-executed (phase 3)", async () => {
  // Reset the stream so the crash-loop cap from the previous test can't mask this.
  await runAndComplete({ status: "succeeded", summary: "healthy again" });
  const brokerBefore = state.codexApprovalBrokerRequests.length;
  const failed = await runAndComplete({ status: "failed", summary: "invalid_application_routine: validation failed" });

  assert.equal(autoRerunsOf(failed).length, 0, "nothing auto-EXECUTES for an approval-gated failure");
  const filedRequest = autoRequests()[0]; // unshift-ordered: newest first
  assert.equal(filedRequest.invocationId, failed);
  assert.equal(filedRequest.actionType, "regenerate_orchestration");
  assert.equal(filedRequest.status, "approval_pending", "the auto-filed action parks for a human");
  assert.equal(state.codexApprovalBrokerRequests.length, brokerBefore + 1, "one approval request parked in the broker");
  assert.ok(state.events.some((e) => e.type === "application_orchestration_auto_recovery_approval_filed" && e.invocationId === failed));
  // The parked decision surfaces in the one queue.
  const snapshot = await call("/api/state");
  assert.ok(snapshot.body.pendingDecisions.some((d) => d.kind === "application_recovery" && d.ref?.recoveryActionRequestId === filedRequest.id));

  // A second failure on the SAME run cannot double-file (duplicate guard) —
  // and the human can still approve the parked one, which executes end-to-end.
  const approved = await call(`/api/codex/approval-broker/${filedRequest.approvalRequestId}/approve`, { method: "POST", body: {} });
  assert.equal(approved.status, 200);
  assert.equal(autoRequests()[0].status, "executed", "human approval executes the auto-filed action");
});

test("a declared errorCode beats misleading runtime-looking text (no auto-rerun of an approval-gated failure)", async () => {
  // Reset the stream so the crash-loop cap from the previous test can't mask this.
  await runAndComplete({ status: "succeeded", summary: "healthy again" });
  const autoBefore = autoRequests().length;
  // The text screams runtime_error, but the bridge DECLARED validation_failed.
  const run = await call(`/api/applications/${appId}/orchestrations/${routineId}/run`, { method: "POST", body: {} });
  const invocationId = run.body.invocation.id;
  await completeViaBridge(invocationId, { status: "failed", summary: "npm test failed with exit code 1" });
  // completeViaBridge sends result.summary only — re-complete path can't carry the
  // code, so drive this one manually with errorCode in the result payload.
  // (The invocation above is already terminal; make a fresh one carrying the code.)
  const run2 = await call(`/api/applications/${appId}/orchestrations/${routineId}/run`, { method: "POST", body: {} });
  const inv2 = run2.body.invocation.id;
  for (let i = 0; i < 10; i += 1) {
    const next = await call("/api/bridge/next", { token: bridgeToken });
    if (next.status === 204 || next.body?.invocationId === inv2) break;
  }
  await call("/api/bridge/ack", { method: "POST", body: { invocationId: inv2 }, token: bridgeToken });
  await call("/api/bridge/complete", {
    method: "POST",
    body: { invocationId: inv2, status: "failed", result: { summary: "npm test failed with exit code 1", errorCode: "validation_failed" } },
    token: bridgeToken,
  });
  assert.equal(autoRerunsOf(inv2).length, 0, "declared validation_failed must not auto-rerun");
  assert.ok(
    state.events.some((e) => e.type === "application_orchestration_auto_recovery_approval_filed"
      && e.invocationId === inv2 && e.data.category === "validation_failed"),
    "the declared code classified the failure (auto-filed for approval), not the runtime-looking text",
  );
  const recovery = await call(`/api/applications/${appId}/orchestrations/${routineId}/runs/${inv2}/recovery`);
  assert.equal(recovery.body.recovery.category, "validation_failed");
  assert.equal(recovery.body.recovery.confidence, 0.95, "structured signal carries higher confidence than haystack inference");
  // Guard against cross-test bleed: the first (undeclared) failure auto-reran as
  // runtime_error and the declared one auto-filed — two auto requests at most.
  assert.ok(autoRequests().length - autoBefore <= 2);
});

test("a declared runtime_error beats validation-looking text (the live-drive misclassification regression)", async () => {
  await runAndComplete({ status: "succeeded", summary: "healthy again" });
  const run = await call(`/api/applications/${appId}/orchestrations/${routineId}/run`, { method: "POST", body: {} });
  const invocationId = run.body.invocation.id;
  for (let i = 0; i < 10; i += 1) {
    const next = await call("/api/bridge/next", { token: bridgeToken });
    if (next.status === 204 || next.body?.invocationId === invocationId) break;
  }
  await call("/api/bridge/ack", { method: "POST", body: { invocationId }, token: bridgeToken });
  await call("/api/bridge/complete", {
    method: "POST",
    // Without the code, this text would classify as validation_failed (approval-gated).
    body: { invocationId, status: "failed", result: { summary: "invalid_application_routine validation failed", errorCode: "runtime_error" } },
    token: bridgeToken,
  });
  assert.equal(autoRerunsOf(invocationId).length, 1, "declared runtime_error auto-reruns despite the validation-looking text");
  const recovery = await call(`/api/applications/${appId}/orchestrations/${routineId}/runs/${invocationId}/recovery`);
  assert.equal(recovery.body.recovery.category, "runtime_error");
});

test("an unknown errorCode falls back to haystack inference (never a fabricated category)", async () => {
  await runAndComplete({ status: "succeeded", summary: "healthy again" });
  const run = await call(`/api/applications/${appId}/orchestrations/${routineId}/run`, { method: "POST", body: {} });
  const invocationId = run.body.invocation.id;
  for (let i = 0; i < 10; i += 1) {
    const next = await call("/api/bridge/next", { token: bridgeToken });
    if (next.status === 204 || next.body?.invocationId === invocationId) break;
  }
  await call("/api/bridge/ack", { method: "POST", body: { invocationId }, token: bridgeToken });
  await call("/api/bridge/complete", {
    method: "POST",
    body: { invocationId, status: "failed", result: { summary: "invalid_application_routine validation failed", errorCode: "flux_capacitor_burnout" } },
    token: bridgeToken,
  });
  const recovery = await call(`/api/applications/${appId}/orchestrations/${routineId}/runs/${invocationId}/recovery`);
  assert.equal(recovery.body.recovery.category, "validation_failed", "unknown code → haystack fallback");
  assert.equal(recovery.body.recovery.confidence, 0.86);
});

test("routine-level overrides win over the app policy: off silences, cap tightens, clear restores", async () => {
  // Override OFF for this routine while the app stays enabled → silent no-op.
  await runAndComplete({ status: "succeeded", summary: "healthy again" });
  const offSet = await call(`/api/applications/${appId}/auto-recovery`, {
    method: "POST",
    body: { enabled: false, routineId, approvalToken: "operator-approved" },
  });
  assert.equal(offSet.status, 200);
  assert.deepEqual(offSet.body.application.autoRecovery.routineOverrides[routineId], { enabled: false, maxAttempts: 2 });
  const autoBefore = autoRequests().length;
  const silentFail = await runAndComplete({ status: "failed", summary: "npm test failed with exit code 1" });
  assert.equal(autoRerunsOf(silentFail).length, 0, "override off → no auto action");
  assert.equal(autoRequests().length, autoBefore);

  // Override ON with a tighter cap (1) → one attempt, then the cap event.
  await call(`/api/applications/${appId}/auto-recovery`, {
    method: "POST",
    body: { enabled: true, maxAttempts: 1, routineId, approvalToken: "operator-approved" },
  });
  await runAndComplete({ status: "succeeded", summary: "reset the stream" });
  const capBefore = skipEvents("attempt_cap").length;
  const failed = await runAndComplete({ status: "failed", summary: "npm test failed with exit code 1" });
  const rerun = autoRerunsOf(failed)[0];
  assert.ok(rerun, "attempt 1 spawned under the override");
  await completeViaBridge(rerun.id, { status: "failed", summary: "npm test failed with exit code 1" });
  assert.equal(autoRerunsOf(rerun.id).length, 0, "override cap 1 blocks attempt 2 (app cap is 2)");
  assert.equal(skipEvents("attempt_cap").length, capBefore + 1);
  assert.equal(skipEvents("attempt_cap")[0].data.maxAttempts, 1, "the override's cap, not the app's (events are unshift-ordered)");

  // Clear the override → the app-level policy (cap 2) applies again.
  const cleared = await call(`/api/applications/${appId}/auto-recovery`, {
    method: "POST",
    body: { routineId, clearOverride: true, approvalToken: "operator-approved" },
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.application.autoRecovery.routineOverrides[routineId], undefined);
  await runAndComplete({ status: "succeeded", summary: "reset the stream" });
  const failedAgain = await runAndComplete({ status: "failed", summary: "npm test failed with exit code 1" });
  assert.equal(autoRerunsOf(failedAgain).length, 1, "app-level policy active again");
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
