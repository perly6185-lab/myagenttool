import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const now = () => new Date().toISOString();

let server;
let base;
let state;
let deps;

before(async () => {
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../src/runtime/http-server.mjs");

  const created = createServerState({ defaultProjectPath: process.cwd(), now });
  state = created.state;
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject: created.defaultProject,
    defaultProjectPath: process.cwd(),
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  deps = httpDependencies;

  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test("bridge registration issues a device-bound credential and protects bridge routes", async () => {
  const registered = await call("/api/bridge/register", { method: "POST", body: {
    bridgeVersion: "test",
    timeZone: "Asia/Shanghai",
    applicationBinaryReadiness: [
      { command: "git", capabilityPrefix: "app.app_git.wrapper.", status: "available", version: "git version 2.50.0", authenticationStatus: "authenticated", authenticationMethod: "API Key $$$" },
      { command: "C:/evil.exe", capabilityPrefix: "app.app_git.wrapper.", status: "available", version: "bad" },
      { command: "node", capabilityPrefix: "not-an-app", status: "available", version: "bad" },
    ],
  } });
  assert.equal(registered.status, 200);
  assert.equal(typeof registered.body.bridgeToken, "string");
  assert(registered.body.bridgeToken.length > 20);
  assert.equal(registered.body.device.bridgeCredential.tokenHash, undefined);
  assert.equal(registered.body.bridgeCredential.tokenHash, undefined);
  assert.equal(typeof state.device.bridgeCredential.tokenHash, "string");
  assert.equal(state.device.timeZone, "Asia/Shanghai");
  assert.equal(registered.body.device.timeZone, "Asia/Shanghai");
  assert.deepEqual(state.device.runtimeReadiness, state.device.applicationBinaryReadiness);
  assert.deepEqual(state.device.applicationBinaryReadiness, [{
    runtimeId: "runtime_git",
    command: "git",
    capabilityPrefix: "app.app_git.wrapper.",
    status: "available",
    version: "git version 2.50.0",
    authenticationStatus: "authenticated",
    authenticationMethod: "api_key_",
    checkedAt: state.device.lastSeenAt,
  }]);

  const refreshed = await call("/api/bridge/readiness", {
    method: "POST",
    token: registered.body.bridgeToken,
    body: {
      timeZone: "America/Los_Angeles",
      applicationBinaryReadiness: [{ command: "git", capabilityPrefix: "app.app_git.wrapper.", status: "absent", version: "must be dropped", authenticationStatus: "authenticated", authenticationMethod: "must_drop" }],
    },
  });
  assert.equal(refreshed.status, 200);
  assert.equal(state.device.timeZone, "America/Los_Angeles");
  assert.equal(state.device.applicationBinaryReadiness[0].status, "absent");
  assert.equal(state.device.applicationBinaryReadiness[0].version, null);
  assert.equal(state.device.applicationBinaryReadiness[0].authenticationStatus, undefined);

  const invalidTimeZone = await call("/api/bridge/readiness", {
    method: "POST",
    token: registered.body.bridgeToken,
    body: { timeZone: "not/a-time-zone" },
  });
  assert.equal(invalidTimeZone.status, 400);
  assert.equal(invalidTimeZone.body.error, "invalid_device_timezone");
  assert.equal(state.device.timeZone, "America/Los_Angeles", "an invalid refresh must not overwrite the stored zone");

  const unauthenticatedPoll = await call("/api/bridge/next");
  assert.equal(unauthenticatedPoll.status, 401);
  assert.equal(unauthenticatedPoll.body.error, "invalid_bridge_credentials");

  const invalidPoll = await call("/api/bridge/next", { token: "wrong-token" });
  assert.equal(invalidPoll.status, 401);
  assert.equal(invalidPoll.body.error, "invalid_bridge_credentials");

  const validPoll = await call("/api/bridge/next", { token: registered.body.bridgeToken });
  assert.equal(validPoll.status, 204);

  const validTerminalPoll = await call("/api/bridge/terminal-next", { token: registered.body.bridgeToken });
  assert.equal(validTerminalPoll.status, 204);

  await assertBridgeCredentialRequired({ token: registered.body.bridgeToken });
  await assertBridgeWorkOwnership({ token: registered.body.bridgeToken });

  const registerWithoutBearer = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "again" } });
  assert.equal(registerWithoutBearer.status, 401);

  const unlink = await call("/api/device/unlink", { method: "POST" });
  assert.equal(unlink.status, 200);
  const revokedPoll = await call("/api/bridge/next", { token: registered.body.bridgeToken });
  assert.equal(revokedPoll.status, 403);
  assert.equal(revokedPoll.body.error, "device_credentials_revoked");

  await assertBridgeCredentialRevoked({ token: registered.body.bridgeToken });
});

test("bridge hook reporting remains device-authenticated when user login is required", async () => {
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../src/runtime/http-server.mjs");
  const created = createServerState({ defaultProjectPath: process.cwd(), now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "auth-test",
    protocolVersion: "0.0.0",
    state: created.state,
    defaultProject: created.defaultProject,
    defaultProjectPath: process.cwd(),
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused-auth.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  const previousRequireAuth = process.env.MYAGENT_REQUIRE_AUTH;
  process.env.MYAGENT_REQUIRE_AUTH = "1";
  const authServer = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "auth-test",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  if (previousRequireAuth === undefined) delete process.env.MYAGENT_REQUIRE_AUTH;
  else process.env.MYAGENT_REQUIRE_AUTH = previousRequireAuth;
  await new Promise((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const authBase = `http://127.0.0.1:${authServer.address().port}`;
  const authCall = async (path, { method = "GET", body, token } = {}) => {
    const response = await fetch(`${authBase}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  try {
    const registration = await authCall("/api/bridge/register", {
      method: "POST",
      body: { bridgeVersion: "auth-test" },
    });
    assert.equal(registration.status, 200);
    const invocation = bridgeInvocationFixture("inv_auth_hook", {
      status: "dispatching",
      deliveryState: "dispatching",
      deviceId: created.state.device.id,
    });
    created.state.invocations.unshift(invocation);
    assert.equal((await authCall("/api/bridge/ack", {
      method: "POST",
      body: { invocationId: invocation.id },
      token: registration.body.bridgeToken,
    })).status, 200);

    const legacy = await authCall("/api/codex/hooks", {
      method: "POST",
      body: { invocationId: invocation.id, eventName: "SessionStart" },
      token: registration.body.bridgeToken,
    });
    assert.equal(legacy.status, 401, "a device token must not authenticate as a user");

    const bridgeHook = await authCall("/api/bridge/codex/hooks", {
      method: "POST",
      body: { invocationId: invocation.id, eventName: "SessionStart" },
      token: registration.body.bridgeToken,
    });
    assert.equal(bridgeHook.status, 202);
  } finally {
    await new Promise((resolve) => authServer.close(resolve));
  }
});

const protectedBridgeRoutes = [
  { method: "GET", path: "/api/bridge/next" },
  { method: "GET", path: "/api/bridge/aux-next" },
  { method: "GET", path: "/api/bridge/health-next" },
  { method: "POST", path: "/api/bridge/health-complete", body: {} },
  { method: "GET", path: "/api/bridge/discovery-next" },
  { method: "POST", path: "/api/bridge/discovery-complete", body: {} },
  { method: "GET", path: "/api/bridge/probe-next" },
  { method: "POST", path: "/api/bridge/probe-complete", body: {} },
  { method: "GET", path: "/api/bridge/lifecycle-next" },
  { method: "POST", path: "/api/bridge/lifecycle-complete", body: {} },
  { method: "GET", path: "/api/bridge/cancel-status?invocationId=missing" },
  { method: "POST", path: "/api/bridge/ack", body: {} },
  { method: "POST", path: "/api/bridge/events", body: {} },
  { method: "POST", path: "/api/bridge/codex/hooks", body: {} },
  { method: "POST", path: "/api/bridge/agent/hooks", body: {} },
  { method: "GET", path: "/api/bridge/agent/approval-broker/missing" },
  { method: "POST", path: "/api/bridge/complete", body: {} },
  { method: "POST", path: "/api/bridge/refuse", body: {} },
  { method: "GET", path: "/api/bridge/terminal-next" },
  { method: "POST", path: "/api/bridge/terminal-events", body: {} },
];

async function assertBridgeCredentialRequired({ token }) {
  for (const route of protectedBridgeRoutes) {
    const missingCredential = await call(route.path, { method: route.method, body: route.body });
    assert.equal(missingCredential.status, 401, `${route.method} ${route.path} should reject missing bridge credentials`);
    assert.equal(missingCredential.body.error, "invalid_bridge_credentials");

    const invalidCredential = await call(route.path, { method: route.method, body: route.body, token: "wrong-token" });
    assert.equal(invalidCredential.status, 401, `${route.method} ${route.path} should reject invalid bridge credentials`);
    assert.equal(invalidCredential.body.error, "invalid_bridge_credentials");
  }

  const stillValid = await call("/api/bridge/next", { token });
  assert.equal(stillValid.status, 204);
}

async function assertBridgeCredentialRevoked({ token }) {
  for (const route of protectedBridgeRoutes) {
    const revoked = await call(route.path, { method: route.method, body: route.body, token });
    assert.equal(revoked.status, 403, `${route.method} ${route.path} should reject revoked bridge credentials`);
    assert.equal(revoked.body.error, "device_credentials_revoked");
  }
}

async function assertBridgeWorkOwnership({ token }) {
  const ownedInvocation = bridgeInvocationFixture("inv_bridge_owned", {
    status: "dispatching",
    deliveryState: "dispatching",
    deviceId: state.device.id,
  });
  state.invocations.unshift(ownedInvocation);

  const ack = await call("/api/bridge/ack", { method: "POST", body: { invocationId: ownedInvocation.id }, token });
  assert.equal(ack.status, 200);
  assert.equal(ownedInvocation.status, "running");
  assert.equal(ownedInvocation.delivery.state, "acknowledged");

  const event = await call("/api/bridge/events", {
    method: "POST",
    body: { invocationId: ownedInvocation.id, type: "log", level: "info", message: "owned event" },
    token,
  });
  assert.equal(event.status, 200);

  const legacyHook = await call("/api/codex/hooks", {
    method: "POST",
    body: { invocationId: ownedInvocation.id, eventName: "SessionStart" },
    token,
  });
  assert.equal(legacyHook.status, 410, "the user-authenticated legacy write endpoint is retired");

  const hook = await call("/api/bridge/codex/hooks", {
    method: "POST",
    body: {
      invocationId: ownedInvocation.id,
      eventName: "PermissionRequest",
      toolName: "Bash",
      summary: "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' https://example.test",
    },
    token,
  });
  assert.equal(hook.status, 202);
  assert.match(hook.body.hookEvent.summary, /\[redacted\]/);
  assert.doesNotMatch(hook.body.hookEvent.summary, /abcdefghijklmnopqrstuvwxyz/);

  const approvalPoll = await call(
    `/api/bridge/agent/approval-broker/${encodeURIComponent(hook.body.brokerRequest.id)}`,
    { token },
  );
  assert.equal(approvalPoll.status, 200);
  assert.equal(approvalPoll.body.approvalRequest.id, hook.body.brokerRequest.id);

  const complete = await call("/api/bridge/complete", {
    method: "POST",
    body: { invocationId: ownedInvocation.id, status: "succeeded", summary: "owned completion" },
    token,
  });
  assert.equal(complete.status, 200);
  assert.equal(ownedInvocation.status, "succeeded");

  const offDeviceInvocation = bridgeInvocationFixture("inv_bridge_off_device", {
    status: "running",
    deliveryState: "acknowledged",
    deviceId: "dev_other_bridge",
  });
  state.invocations.unshift(offDeviceInvocation);
  const offDeviceComplete = await call("/api/bridge/complete", {
    method: "POST",
    body: { invocationId: offDeviceInvocation.id, status: "succeeded", summary: "spoofed completion" },
    token,
  });
  assert.equal(offDeviceComplete.status, 403);
  assert.equal(offDeviceComplete.body.error, "bridge_invocation_not_owned");
  assert.equal(offDeviceInvocation.status, "running");
  assert(
    state.events.some(
      (event) =>
        event.invocationId === offDeviceInvocation.id &&
        event.type === "bridge_delivery_refused" &&
        event.data?.operation === "complete" &&
        event.data?.reason === "bridge_invocation_not_owned",
    ),
    "off-device completion refusal should be auditable",
  );

  const inactiveInvocation = bridgeInvocationFixture("inv_bridge_waiting_approval", {
    status: "waiting_for_local_approval",
    deliveryState: "queued",
    deviceId: state.device.id,
  });
  state.invocations.unshift(inactiveInvocation);
  const inactiveAck = await call("/api/bridge/ack", {
    method: "POST",
    body: { invocationId: inactiveInvocation.id },
    token,
  });
  assert.equal(inactiveAck.status, 409);
  assert.equal(inactiveAck.body.error, "bridge_invocation_not_active");
  assert(
    state.events.some(
      (event) =>
        event.invocationId === inactiveInvocation.id &&
        event.type === "bridge_delivery_refused" &&
        event.data?.operation === "ack" &&
        event.data?.reason === "bridge_invocation_not_active",
    ),
    "inactive ack refusal should be auditable",
  );

  state.agents.unshift(otherDeviceCliAgentFixture());
  const otherDeviceQueuedInvocation = bridgeInvocationFixture("inv_bridge_other_device_queued", {
    agentId: "agt_other_device_cli",
    status: "queued",
    deliveryState: "queued",
    deviceId: "dev_other_bridge",
  });
  const localQueuedInvocation = bridgeInvocationFixture("inv_bridge_local_queued", {
    status: "queued",
    deliveryState: "queued",
    deviceId: state.device.id,
  });
  localQueuedInvocation.options.metadata = { agentName: "Untrusted client-supplied name" };
  state.invocations.unshift(otherDeviceQueuedInvocation, localQueuedInvocation);
  const invocationPoll = await call("/api/bridge/next", { token });
  assert.equal(invocationPoll.status, 200);
  assert.equal(invocationPoll.body.invocationId, localQueuedInvocation.id);
  assert.equal(invocationPoll.body.agentName, state.agents.find((agent) => agent.id === localQueuedInvocation.agentId)?.name);
  assert.equal(localQueuedInvocation.status, "dispatching");
  assert.equal(otherDeviceQueuedInvocation.status, "queued");

  const localQueuedAck = await call("/api/bridge/ack", {
    method: "POST",
    body: { invocationId: localQueuedInvocation.id },
    token,
  });
  assert.equal(localQueuedAck.status, 200);
  const localQueuedComplete = await call("/api/bridge/complete", {
    method: "POST",
    body: { invocationId: localQueuedInvocation.id, status: "succeeded", summary: "local queued completion" },
    token,
  });
  assert.equal(localQueuedComplete.status, 200);

  const legacyLocalQueuedInvocation = bridgeInvocationFixture("inv_bridge_legacy_local_queued", {
    status: "queued",
    deliveryState: "queued",
    deviceId: undefined,
  });
  state.invocations.unshift(legacyLocalQueuedInvocation);
  const legacyInvocationPoll = await call("/api/bridge/next", { token });
  assert.equal(legacyInvocationPoll.status, 200);
  assert.equal(legacyInvocationPoll.body.invocationId, legacyLocalQueuedInvocation.id);
  assert.equal(legacyLocalQueuedInvocation.delivery.deviceId, state.device.id, "legacy local claims should be bound to the current bridge");
  const legacyAck = await call("/api/bridge/ack", {
    method: "POST",
    body: { invocationId: legacyLocalQueuedInvocation.id },
    token,
  });
  assert.equal(legacyAck.status, 200);
  const legacyComplete = await call("/api/bridge/complete", {
    method: "POST",
    body: { invocationId: legacyLocalQueuedInvocation.id, status: "succeeded", summary: "legacy local completion" },
    token,
  });
  assert.equal(legacyComplete.status, 200);

  const otherDeviceLifecycle = lifecycleActionFixture("lco_bridge_other", {
    status: "running",
    deviceId: "dev_other_bridge",
  });
  state.lifecycleQueuedActions.unshift(otherDeviceLifecycle);
  const otherDeviceLifecycleComplete = await call("/api/bridge/lifecycle-complete", {
    method: "POST",
    body: { lifecycleActionId: otherDeviceLifecycle.id, status: "succeeded", summary: "spoofed lifecycle" },
    token,
  });
  assert.equal(otherDeviceLifecycleComplete.status, 403);
  assert.equal(otherDeviceLifecycleComplete.body.error, "bridge_lifecycle_not_owned");
  assert.equal(otherDeviceLifecycle.status, "running");
  assert(
    state.events.some(
      (event) =>
        event.type === "bridge_lifecycle_refused" &&
        event.data?.lifecycleActionId === otherDeviceLifecycle.id &&
        event.data?.operation === "lifecycle-complete" &&
        event.data?.reason === "bridge_lifecycle_not_owned",
    ),
    "off-device lifecycle refusal should be auditable",
  );

  const otherQueuedLifecycle = lifecycleActionFixture("lco_bridge_other_queued", {
    status: "queued",
    deviceId: "dev_other_bridge",
  });
  const nullQueuedLifecycle = lifecycleActionFixture("lco_bridge_null_queued", {
    status: "queued",
    deviceId: null,
  });
  const localQueuedLifecycle = lifecycleActionFixture("lco_bridge_local_queued", {
    status: "queued",
    deviceId: state.device.id,
  });
  state.lifecycleQueuedActions.unshift(nullQueuedLifecycle, otherQueuedLifecycle, localQueuedLifecycle);
  const lifecyclePoll = await call("/api/bridge/lifecycle-next", { token });
  assert.equal(lifecyclePoll.status, 200);
  assert.equal(lifecyclePoll.body.lifecycleActionId, localQueuedLifecycle.id);
  assert.equal(localQueuedLifecycle.status, "running");
  assert.equal(nullQueuedLifecycle.status, "queued");
  assert.equal(otherQueuedLifecycle.status, "queued");

  const localLifecycleComplete = await call("/api/bridge/lifecycle-complete", {
    method: "POST",
    body: { lifecycleActionId: localQueuedLifecycle.id, status: "succeeded", summary: "local lifecycle complete" },
    token,
  });
  assert.equal(localLifecycleComplete.status, 200);
  assert.equal(localQueuedLifecycle.status, "succeeded");

  const otherDeviceHealth = healthCheckFixture("lco_bridge_health_other", {
    status: "running",
    deviceId: "dev_other_bridge",
  });
  state.healthChecks.unshift(otherDeviceHealth);
  const otherDeviceHealthComplete = await call("/api/bridge/health-complete", {
    method: "POST",
    body: { checkId: otherDeviceHealth.id, agentId: otherDeviceHealth.agentId, status: "healthy", message: "spoofed health" },
    token,
  });
  assert.equal(otherDeviceHealthComplete.status, 403);
  assert.equal(otherDeviceHealthComplete.body.error, "health_check_not_owned");
  assert.equal(otherDeviceHealth.status, "running");
  assertBridgeOperationRefused("health_check", otherDeviceHealth.id, "health_check_not_owned");

  const otherQueuedHealth = healthCheckFixture("lco_bridge_health_other_queued", {
    status: "queued",
    deviceId: "dev_other_bridge",
  });
  const localQueuedHealth = healthCheckFixture("lco_bridge_health_local_queued", {
    status: "queued",
    deviceId: state.device.id,
  });
  state.healthChecks.unshift(otherQueuedHealth, localQueuedHealth);
  const healthPoll = await call("/api/bridge/health-next", { token });
  assert.equal(healthPoll.status, 200);
  assert.equal(healthPoll.body.checkId, localQueuedHealth.id);
  assert.equal(localQueuedHealth.status, "running");
  assert.equal(otherQueuedHealth.status, "queued");

  const otherDeviceDiscovery = discoveryRunFixture("dis_bridge_other", {
    status: "running",
    deviceId: "dev_other_bridge",
  });
  state.discoveryRuns.unshift(otherDeviceDiscovery);
  const otherDeviceDiscoveryComplete = await call("/api/bridge/discovery-complete", {
    method: "POST",
    body: { discoveryRunId: otherDeviceDiscovery.id, status: "succeeded", candidates: [] },
    token,
  });
  assert.equal(otherDeviceDiscoveryComplete.status, 403);
  assert.equal(otherDeviceDiscoveryComplete.body.error, "discovery_run_not_owned");
  assert.equal(otherDeviceDiscovery.status, "running");
  assertBridgeOperationRefused("discovery_run", otherDeviceDiscovery.id, "discovery_run_not_owned");

  const otherQueuedDiscovery = discoveryRunFixture("dis_bridge_other_queued", {
    status: "queued",
    deviceId: "dev_other_bridge",
  });
  const nullQueuedDiscovery = discoveryRunFixture("dis_bridge_null_queued", {
    status: "queued",
    deviceId: null,
  });
  const localQueuedDiscovery = discoveryRunFixture("dis_bridge_local_queued", {
    status: "queued",
    deviceId: state.device.id,
  });
  state.discoveryRuns.unshift(nullQueuedDiscovery, otherQueuedDiscovery, localQueuedDiscovery);
  const discoveryPoll = await call("/api/bridge/discovery-next", { token });
  assert.equal(discoveryPoll.status, 200);
  assert.equal(discoveryPoll.body.discoveryRunId, localQueuedDiscovery.id);
  assert.equal(localQueuedDiscovery.status, "running");
  assert.equal(nullQueuedDiscovery.status, "queued");
  assert.equal(otherQueuedDiscovery.status, "queued");

  const otherDeviceProbe = probeRunFixture("probe_bridge_other", {
    status: "running",
    deviceId: "dev_other_bridge",
  });
  state.integrationProbeRuns.unshift(otherDeviceProbe);
  const otherDeviceProbeComplete = await call("/api/bridge/probe-complete", {
    method: "POST",
    body: { probeRunId: otherDeviceProbe.id, status: "succeeded", summary: "spoofed probe" },
    token,
  });
  assert.equal(otherDeviceProbeComplete.status, 403);
  assert.equal(otherDeviceProbeComplete.body.error, "probe_run_not_owned");
  assert.equal(otherDeviceProbe.status, "running");
  assertBridgeOperationRefused("probe_run", otherDeviceProbe.id, "probe_run_not_owned");

  const otherQueuedProbe = probeRunFixture("probe_bridge_other_queued", {
    status: "queued",
    deviceId: "dev_other_bridge",
  });
  const nullQueuedProbe = probeRunFixture("probe_bridge_null_queued", {
    status: "queued",
    deviceId: null,
  });
  const localQueuedProbe = probeRunFixture("probe_bridge_local_queued", {
    status: "queued",
    deviceId: state.device.id,
  });
  state.integrationProbeRuns.unshift(nullQueuedProbe, otherQueuedProbe, localQueuedProbe);
  const probePoll = await call("/api/bridge/probe-next", { token });
  assert.equal(probePoll.status, 200);
  assert.equal(probePoll.body.probeRunId, localQueuedProbe.id);
  assert.equal(localQueuedProbe.status, "running");
  assert.equal(nullQueuedProbe.status, "queued");
  assert.equal(otherQueuedProbe.status, "queued");
}

function assertBridgeOperationRefused(operation, operationId, reason) {
  assert(
    state.events.some(
      (event) =>
        event.type === "bridge_operation_refused" &&
        event.data?.operation === operation &&
        event.data?.operationId === operationId &&
        event.data?.reason === reason,
    ),
    `${operation} refusal should be auditable`,
  );
}

function otherDeviceCliAgentFixture() {
  const demo = state.agents.find((agent) => agent.id === "agt_demo_cli");
  return {
    ...demo,
    id: "agt_other_device_cli",
    name: "Other Device CLI",
    location: { type: "local_device", deviceId: "dev_other_bridge" },
    health: { status: "healthy", checkedAt: now(), message: "Other device healthy.", nextAction: null },
  };
}

/*
 * The ownership gates are only meaningful once a SECOND device can authenticate.
 * With one device they compare the primary to itself and pass vacuously — and
 * the `dev_other_bridge` case above proves only that a fabricated delivery id is
 * rejected, not that a real second bridge is confined to its own work.
 *
 * This is the case that separates "the token names the device" from "the token
 * unlocks the bridge API": beta presents a VALID credential, so it is a
 * legitimate bridge — it simply is not alpha, and must not be able to ack, log
 * to, or complete alpha's run.
 */
test("a second device authenticates as itself and cannot touch another device's work", async () => {
  const alpha = enrollDeviceFixture("dev_alpha");
  const beta = enrollDeviceFixture("dev_beta");

  // Distinct machines get distinct credentials.
  assert.notEqual(alpha.token, beta.token);
  assert.notEqual(
    state.devices.find((device) => device.id === "dev_alpha").bridgeCredential.tokenHash,
    state.devices.find((device) => device.id === "dev_beta").bridgeCredential.tokenHash,
  );

  const alphaRun = bridgeInvocationFixture("inv_fleet_alpha", {
    status: "dispatching",
    deliveryState: "dispatching",
    deviceId: "dev_alpha",
  });
  state.invocations.unshift(alphaRun);

  // Beta holds a valid credential, so it authenticates — and is then refused on
  // ownership, not on authentication. A 401 here would mean the gate never ran.
  const spoofedAck = await call("/api/bridge/ack", {
    method: "POST",
    body: { invocationId: alphaRun.id },
    token: beta.token,
  });
  assert.equal(spoofedAck.status, 403);
  assert.equal(spoofedAck.body.error, "bridge_invocation_not_owned");
  assert.equal(alphaRun.status, "dispatching", "a refused ack must not advance the run");

  // The refusal names beta as the caller: the audit trail has to record which
  // machine actually reached for the work, not the primary device.
  assert(
    state.events.some(
      (event) =>
        event.invocationId === alphaRun.id &&
        event.type === "bridge_delivery_refused" &&
        event.data?.reason === "bridge_invocation_not_owned" &&
        event.data?.deviceId === "dev_beta",
    ),
    "the refusal should be attributed to the device that made the request",
  );

  // Alpha's own token drives alpha's run normally.
  const ownAck = await call("/api/bridge/ack", {
    method: "POST",
    body: { invocationId: alphaRun.id },
    token: alpha.token,
  });
  assert.equal(ownAck.status, 200);
  assert.equal(alphaRun.status, "running");

  // ...and beta is a working bridge in its own right, not merely a rejected one.
  const betaRun = bridgeInvocationFixture("inv_fleet_beta", {
    status: "dispatching",
    deliveryState: "dispatching",
    deviceId: "dev_beta",
  });
  state.invocations.unshift(betaRun);
  const betaAck = await call("/api/bridge/ack", {
    method: "POST",
    body: { invocationId: betaRun.id },
    token: beta.token,
  });
  assert.equal(betaAck.status, 200);
  assert.equal(betaRun.status, "running");
  assert.equal(
    state.devices.find((device) => device.id === "dev_beta").lastSeenAt !== null,
    true,
    "an authenticated bridge stamps its OWN device's liveness",
  );
});

/** Add a machine to the fleet and pair it. Stands in for P2 enrollment. */
function enrollDeviceFixture(id) {
  state.devices.push({
    id,
    ownerUserId: "usr_local",
    name: id,
    platform: "linux",
    architecture: "x64",
    bridgeVersion: "0.0.0",
    status: "offline",
    unlinkState: "linked",
    lastSeenAt: null,
    registeredCapabilities: [],
    credentialRevokedAt: null,
    bridgeCredential: null,
    maxConcurrency: 1,
    createdAt: now(),
  });
  const issued = deps.issueBridgeCredential({ deviceId: id, rotate: true });
  assert.equal(issued.issued, true, `${id} should receive its own credential`);
  return { id, token: issued.token };
}

function bridgeInvocationFixture(id, { agentId = "agt_demo_cli", status, deliveryState, deviceId }) {
  return {
    id,
    agentId,
    requestedBy: "usr_local",
    status,
    input: { task: id },
    options: {},
    delivery: {
      state: deliveryState,
      deviceId,
      dispatchAttempts: deliveryState === "dispatching" ? 1 : 0,
      lastDispatchAt: deliveryState === "dispatching" ? now() : null,
      leaseExpiresAt: null,
      bridgeCursor: null,
    },
    cancellation: { state: "none", requestedAt: null },
    result: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

function lifecycleActionFixture(id, { status, deviceId }) {
  return {
    id,
    recipeId: `rec_${id}`,
    agentId: "agt_demo_cli",
    deviceId,
    requestedBy: "usr_local",
    action: "update",
    status,
    executionEnabled: true,
    command: {
      summary: "Run the bridge-managed demo agent update fixture.",
      commandId: "demo_agent_update",
      executable: "demo-agent",
      args: ["--self-check-update"],
      shell: false,
      packageManager: null,
    },
    summary: "Test lifecycle action.",
    result: null,
    createdAt: now(),
    startedAt: status === "running" ? now() : null,
    completedAt: null,
  };
}

function healthCheckFixture(id, { status, deviceId }) {
  return {
    id,
    agentId: "agt_demo_cli",
    deviceId,
    requestedBy: "usr_local",
    operation: "health_check",
    status,
    reason: "Test health check.",
    message: "Test health check.",
    createdAt: now(),
    completedAt: null,
  };
}

function discoveryRunFixture(id, { status, deviceId }) {
  return {
    id,
    deviceId,
    requestedBy: "usr_local",
    status,
    scope: "conservative",
    options: { userProvidedPaths: [], userProvidedEndpoints: [] },
    message: "Test discovery run.",
    candidates: [],
    createdAt: now(),
    completedAt: null,
  };
}

function probeRunFixture(id, { status, deviceId }) {
  return {
    id,
    artifactId: null,
    kind: "agent_dry_probe",
    deviceId,
    requestedBy: "usr_local",
    status,
    adapter: { type: "cli", command: "demo-agent" },
    summary: "Test probe run.",
    details: [],
    tools: [],
    createdAt: now(),
    completedAt: null,
  };
}

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

test("bridge credential idle-expires past the TTL and reissues on reconnect", async () => {
  const { createBridgeCredentialRuntime } = await import("../src/runtime/bridge-auth.mjs");
  let clockMs = Date.parse("2026-07-04T00:00:00.000Z");
  const nowFn = () => new Date(clockMs).toISOString();
  const st = { device: { id: "dev_1", unlinkState: "linked", credentialRevokedAt: null } };
  const rt = createBridgeCredentialRuntime({ state: st, now: nowFn, persistStateSoon: () => {}, credentialIdleTtlMs: 1000 });

  const { token } = rt.issueBridgeCredential();
  const verify = (t) => {
    let captured = null;
    const result = rt.requireBridgeCredential({
      req: { headers: { authorization: `Bearer ${t}` } },
      res: {},
      sendJson: (_res, status, body) => { captured = { status, body }; },
    });
    return { result, captured };
  };

  clockMs += 500; // within TTL → accepted, slides lastSeenAt to now
  assert.ok(verify(token).result, "a valid token within the idle TTL is accepted");

  clockMs += 2000; // 2s idle since last activity (500) → beyond the 1s TTL
  const expired = verify(token);
  assert.equal(expired.result, null);
  assert.equal(expired.captured.body.error, "bridge_credentials_expired");

  // Reconnect: issuing reissues a fresh token because the existing one idled out.
  const reissued = rt.issueBridgeCredential();
  assert.equal(reissued.issued, true);
  assert.equal(typeof reissued.token, "string");
  assert.notEqual(reissued.token, token);
});

test("POST /api/device/relink re-pairs the device so an expired-credential bridge re-registers fresh", async () => {
  // Normalize to a paired state from whatever a prior test left (relink re-links
  // even an unlinked device and clears any stale credential).
  await call("/api/device/relink", { method: "POST" });
  const first = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "v1" } });
  assert.equal(first.status, 200);
  const firstToken = first.body.bridgeToken;
  assert.equal(state.device.status, "online");
  assert.equal(typeof state.device.bridgeCredential.tokenHash, "string");

  // The re-pair under test: the operator recovery for an idle-expired / lost-token
  // credential (register can't rotate an expired token by design). Clears + re-links.
  const relink = await call("/api/device/relink", { method: "POST" });
  assert.equal(relink.status, 200);
  assert.equal(state.device.unlinkState, "linked");
  assert.equal(state.device.bridgeCredential, null, "credential cleared → next register issues fresh");
  assert.equal(state.device.status, "offline", "offline until the bridge re-registers");

  // The bridge re-registers with no server-side credential → a FRESH one is issued.
  const second = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "v2" } });
  assert.equal(second.status, 200);
  assert.equal(typeof second.body.bridgeToken, "string");
  assert.notEqual(second.body.bridgeToken, firstToken, "a new token, not the stale one");
  assert.equal(state.device.status, "online", "device back online after re-pair");
});

/*
 * Rebase regression (the multi-machine work landing on a main that grew
 * `/api/device/relink` in the meantime).
 *
 * Registration asked "is ANYTHING in the fleet paired?" and demanded a credential
 * if so. With one device that reads correctly — the only paired device is the one
 * registering. With two it is a trap: relinking device A clears A's credential,
 * but B is still paired, so A's bridge is told to present a credential it no
 * longer has and can never re-pair. `relink` is the operator's ONLY recovery for
 * a lost token, so that failure has no way out.
 *
 * Pairing is per device: a token names its device; a request that names none is
 * claiming an UNPAIRED one.
 */
test("relinking one device in a fleet lets that device re-pair while the others stay paired", async () => {
  await call("/api/device/relink", { method: "POST" });
  const primary = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "v1" } });
  assert.equal(primary.status, 200);
  const primaryToken = primary.body.bridgeToken;

  // A second machine, paired. This is the device that used to poison the recovery.
  const { token: gammaToken } = enrollDeviceFixture("dev_gamma");
  const gamma = state.devices.find((device) => device.id === "dev_gamma");

  // Relink the PRIMARY only: its credential is cleared, gamma's is untouched.
  const relink = await call("/api/device/relink", { method: "POST" });
  assert.equal(relink.status, 200);
  assert.equal(state.device.bridgeCredential, null, "the relinked device lost its credential");
  assert.equal(typeof gamma.bridgeCredential.tokenHash, "string", "the other device stays paired");

  // The relinked bridge comes back with NO usable token and must be able to claim
  // its device again. Against the per-fleet reading this is a 401 forever.
  const rePair = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "v2" } });
  assert.equal(rePair.status, 200, "the relinked device must be able to re-pair");
  assert.equal(typeof rePair.body.bridgeToken, "string");
  assert.notEqual(rePair.body.bridgeToken, primaryToken, "and it gets a fresh credential");

  // The other device is unaffected: its old token still authenticates it.
  const poll = await call("/api/bridge/next", { token: gammaToken });
  assert.ok([200, 204].includes(poll.status), "gamma's credential still works");
});

test("a bearer-less register cannot take over a device that IS paired", async () => {
  await call("/api/device/relink", { method: "POST" });
  const paired = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "v1" } });
  assert.equal(paired.status, 200);

  // Everything in the fleet now holds a credential, so there is nothing to claim.
  // An unauthenticated register must be refused — a claim may only ever land on a
  // device with no credential.
  const hijack = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "evil" } });
  assert.equal(hijack.status, 401);
  assert.equal(hijack.body.error, "invalid_bridge_credentials");
});
