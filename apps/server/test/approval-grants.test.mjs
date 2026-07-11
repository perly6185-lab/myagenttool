import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

// Approval grants (docs/design/APPROVAL_GRANTS.md), phase 1: issued single-use
// grants behind approvalToken, dual-accept for legacy free-text (stamped +
// counted), broker decisions minting execution grants, and the recovery-bypass
// gate that never weakens below its historical prefix contract.

const now = () => new Date().toISOString();

let server;
let base;
let state;
let deps;
let bridgeToken;
let appId;
let routineId;

before(async () => {
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../src/runtime/http-server.mjs");

  const projectDir = mkdtempSync(join(tmpdir(), "grants-project-"));
  const appDir = mkdtempSync(join(tmpdir(), "grants-app-"));
  writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "grants-demo", version: "1.0.0" }));

  const created = createServerState({ defaultProjectPath: projectDir, now });
  state = created.state;
  ({ httpDependencies: deps } = createServerRuntimeServices({
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
  }));
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...deps });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const registered = await call("/api/applications/register", {
    method: "POST",
    body: { source: { type: "local", path: appDir }, name: "grants-demo" },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  appId = registered.body.application.id;
  routineId = `app-${appId}-maintenance`;

  const bridge = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "test" } });
  bridgeToken = bridge.body.bridgeToken;
});

after(() => server?.close());

const issueGrant = (action, targetId = appId) =>
  call("/api/approvals/grants", { method: "POST", body: { action, targetId } });
const grantById = (id) => state.approvalGrants.find((g) => g.id === id);
const legacyCount = () => state.approvalTokenLegacyUses?.count ?? 0;

test("issue → consume: single-use, action+target scoped, audited", async () => {
  const issued = await issueGrant("auto-recovery-config");
  assert.equal(issued.status, 201);
  assert.ok(issued.body.token.length >= 32);
  assert.ok(!JSON.stringify(state.approvalGrants).includes(issued.body.token), "only the hash is stored server-side");

  const configured = await call(`/api/applications/${appId}/auto-recovery`, {
    method: "POST",
    body: { enabled: true, maxAttempts: 2, approvalToken: issued.body.token },
  });
  assert.equal(configured.status, 200);
  const grant = grantById(issued.body.grantId);
  assert.ok(grant.consumedAt, "grant stamped consumed");
  assert.ok(state.events.some((e) => e.type === "approval_grant_consumed" && e.data?.grantId === issued.body.grantId));

  // Single-use: replaying the same token is rejected, not re-accepted as legacy.
  const replay = await call(`/api/applications/${appId}/auto-recovery`, {
    method: "POST",
    body: { enabled: false, approvalToken: issued.body.token },
  });
  assert.equal(replay.status, 400);
  assert.match(replay.body.message, /grant_already_consumed/);
});

test("wrong action, wrong target, and expiry are all rejected without legacy fallback", async () => {
  const wrongAction = await issueGrant("health-probe-config");
  const misused = await call(`/api/applications/${appId}/auto-recovery`, {
    method: "POST",
    body: { enabled: false, approvalToken: wrongAction.body.token },
  });
  assert.equal(misused.status, 400);
  assert.match(misused.body.message, /grant_action_mismatch/);

  const otherApp = await call("/api/applications/register", {
    method: "POST",
    body: { source: { type: "manual", uri: "https://example.com/other" }, name: "other-demo" },
  });
  const wrongTarget = await issueGrant("auto-recovery-config", otherApp.body.application.id);
  const crossTarget = await call(`/api/applications/${appId}/auto-recovery`, {
    method: "POST",
    body: { enabled: false, approvalToken: wrongTarget.body.token },
  });
  assert.equal(crossTarget.status, 400);
  assert.match(crossTarget.body.message, /grant_target_mismatch/);

  const expiring = await issueGrant("auto-recovery-config");
  grantById(expiring.body.grantId).expiresAt = new Date(Date.now() - 1000).toISOString();
  const expired = await call(`/api/applications/${appId}/auto-recovery`, {
    method: "POST",
    body: { enabled: false, approvalToken: expiring.body.token },
  });
  assert.equal(expired.status, 400);
  assert.match(expired.body.message, /grant_expired/);
});

test("issuance validates input and refuses system actors", async () => {
  const missing = await call("/api/approvals/grants", { method: "POST", body: { action: "" } });
  assert.equal(missing.status, 400);
  const systemAttempt = deps.issueApprovalGrant({ action: "online", targetId: appId }, { userId: "system_auto_recovery" });
  assert.equal(systemAttempt.status, 403);
  assert.equal(systemAttempt.body.error, "system_actor_cannot_issue_grants");
});

test("phase 1 dual-accept: legacy free-text still passes, stamped and counted", async () => {
  const before = legacyCount();
  const configured = await call(`/api/applications/${appId}/auto-recovery`, {
    method: "POST",
    body: { enabled: false, approvalToken: "operator-approved" },
  });
  assert.equal(configured.status, 200, JSON.stringify(configured.body));
  assert.equal(legacyCount(), before + 1);
  assert.ok(state.events.some((e) => e.type === "approval_token_legacy_used" && e.data?.action === "auto-recovery-config"));
});

test("broker approve mints a decision-linked grant that authorizes the execution (no magic string)", async () => {
  const generated = await call(`/api/applications/${appId}/orchestrations/generate`, {
    method: "POST",
    body: { approvalToken: "operator-approved-generate" },
  });
  assert.equal(generated.status, 201, JSON.stringify(generated.body));
  // Fail a run with a validation-flavored error → regenerate parks for approval.
  const run = await call(`/api/applications/${appId}/orchestrations/${routineId}/run`, { method: "POST", body: {} });
  const invocationId = run.body.invocation.id;
  for (let i = 0; i < 10; i += 1) {
    const next = await call("/api/bridge/next", { token: bridgeToken });
    if (next.status === 204 || next.body?.invocationId === invocationId) break;
  }
  await call("/api/bridge/ack", { method: "POST", body: { invocationId }, token: bridgeToken });
  await call("/api/bridge/complete", {
    method: "POST",
    body: { invocationId, status: "failed", result: { summary: "x", errorCode: "validation_failed" } },
    token: bridgeToken,
  });
  const parked = await call(`/api/applications/${appId}/orchestrations/${routineId}/runs/${invocationId}/recovery/actions`, {
    method: "POST",
    body: { actionType: "regenerate_orchestration" },
  });
  assert.equal(parked.status, 202);
  const brokerId = parked.body.approvalRequest.id;

  const approved = await call(`/api/codex/approval-broker/${brokerId}/approve`, { method: "POST", body: {} });
  assert.equal(approved.status, 200);
  const actionRequest = state.applicationRecoveryActions.find((r) => r.id === parked.body.recoveryActionRequest.id);
  assert.equal(actionRequest.status, "executed");
  const decisionGrant = state.approvalGrants.find((g) => g.sourceDecisionId === brokerId);
  assert.ok(decisionGrant, "the broker decision minted a grant");
  assert.equal(decisionGrant.action, "generate_orchestration");
  assert.ok(decisionGrant.consumedAt, "the execution consumed it — decision → grant → execution");
});

test("the recovery bypass never weakens: arbitrary free text parks, the prefix and real grants bypass", async () => {
  // Fresh validation-failed run for each probe.
  const failValidationRun = async () => {
    const run = await call(`/api/applications/${appId}/orchestrations/${routineId}/run`, { method: "POST", body: {} });
    const invocationId = run.body.invocation.id;
    for (let i = 0; i < 10; i += 1) {
      const next = await call("/api/bridge/next", { token: bridgeToken });
      if (next.status === 204 || next.body?.invocationId === invocationId) break;
    }
    await call("/api/bridge/ack", { method: "POST", body: { invocationId }, token: bridgeToken });
    await call("/api/bridge/complete", {
      method: "POST",
      body: { invocationId, status: "failed", result: { summary: "x", errorCode: "validation_failed" } },
      token: bridgeToken,
    });
    return invocationId;
  };

  const inv1 = await failValidationRun();
  const arbitrary = await call(`/api/applications/${appId}/orchestrations/${routineId}/runs/${inv1}/recovery/actions`, {
    method: "POST",
    body: { actionType: "regenerate_orchestration", approvalToken: "totally-not-approved" },
  });
  assert.equal(arbitrary.status, 202, "arbitrary free text must NOT bypass — it parks for approval");
  assert.equal(arbitrary.body.status, "approval_pending");

  const inv2 = await failValidationRun();
  const granted = await issueGrant("recovery_action");
  const viaGrant = await call(`/api/applications/${appId}/orchestrations/${routineId}/runs/${inv2}/recovery/actions`, {
    method: "POST",
    body: { actionType: "regenerate_orchestration", approvalToken: granted.body.token },
  });
  assert.equal(viaGrant.status, 201, JSON.stringify(viaGrant.body));
  assert.equal(viaGrant.body.recoveryActionRequest.status, "executed", "an issued grant bypasses parking and executes");
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
