/*
 * app_gmail: authorization as readiness (#977, ADR 0010).
 *
 * The claim under test is a negative one, and it is the whole point: the control
 * plane never mints, transports, stores, or reads an external credential. It
 * OBSERVES one — the device reports what it holds (provider + scope, never the
 * secret), the immutable descriptor says what is required, and the two are
 * compared server-side. The device is never told what the server wants, so it
 * cannot claim a match it does not have.
 *
 * Refusals are precise in the #802 shape: "no credential on this device" and
 * "wrong scope" are different problems with different fixes, and the operator is
 * told which, on which device, and what to run.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService } from "../src/services/applications.mjs";
import { createGmailApplicationRegistration, GMAIL_APPLICATION_ID, GMAIL_READONLY_SCOPE } from "../src/services/gmail-application.mjs";

const AGENT_ID = "agt_mcp_mail";

function stateWith(credentialRows = null) {
  return {
    applications: [],
    invocations: [],
    device: {
      id: "dev_1",
      status: "online",
      updatedAt: "2026-07-14T00:00:00.000Z",
      ...(credentialRows ? { applicationCredentialReadiness: credentialRows } : {}),
    },
  };
}

const HELD = (scope = GMAIL_READONLY_SCOPE, provider = "google") => [{
  applicationId: GMAIL_APPLICATION_ID,
  provider,
  scope,
  status: "present",
  checkedAt: "2026-07-14T00:05:00.000Z",
}];

function service(state) {
  return createApplicationService({
    state,
    now: () => "2026-07-14T00:10:00.000Z",
    nextId: (prefix) => `${prefix}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
}

function register(state) {
  const svc = service(state);
  svc.registerApplication(createGmailApplicationRegistration({ agentId: AGENT_ID, autoOnline: true }));
  return svc;
}

function listUnread(svc) {
  return svc.listApplicationCapabilities(GMAIL_APPLICATION_ID)
    .find((capability) => capability.name === "app.app_gmail.list_unread");
}

test("app_gmail registers as a non-executable manual Application with agent facades", () => {
  const state = stateWith();
  const svc = register(state);
  const app = state.applications[0];

  assert.equal(app.id, GMAIL_APPLICATION_ID);
  assert.equal(app.source.type, "manual");
  assert.equal(app.source.wrapper, undefined, "no wrapper: nothing on any device will spawn for this app (ADR 0008)");
  assert.deepEqual(app.source.credential, { provider: "google", scope: GMAIL_READONLY_SCOPE });
  assert.match(app.descriptorFingerprint, /^sha256:[0-9a-f]{64}$/u, "the scope is inside the fingerprinted, immutable descriptor");

  const capabilities = svc.listApplicationCapabilities(GMAIL_APPLICATION_ID);
  const facades = capabilities.filter((capability) => capability.kind === "agent_facade");
  assert.deepEqual(facades.map((capability) => capability.name).sort(), ["app.app_gmail.fetch", "app.app_gmail.list_unread"]);
  assert.equal(facades.every((capability) => capability.metadata.execution.agentId === AGENT_ID), true);
  assert.equal(facades.every((capability) => capability.riskTags.includes("untrusted_input")), true, "mail is attacker-controlled text (#978)");
  assert.equal(capabilities.some((capability) => /send/i.test(capability.name)), false, "there is no send capability");
});

test("the registry refuses a credential scope that is not read-only", () => {
  const svc = service(stateWith());
  for (const scope of ["gmail.send", "gmail.modify", "https://mail.google.com/", "gmail.full"]) {
    assert.throws(
      () => svc.registerApplication({
        name: "gmail-write", source: { type: "manual", credential: { provider: "google", scope } },
      }),
      /not read-only|separately consented/,
      `scope ${scope} must be refused: read and write authority never share a credential`,
    );
  }
});

test("no credential on the device -> not_authorized, naming the device and the next action", () => {
  const svc = register(stateWith());
  const readiness = listUnread(svc).metadata.readiness;

  assert.equal(readiness.state, "needs_setup");
  assert.equal(readiness.reason, "no_credential_on_device");
  assert.equal(readiness.credential.status, "not_authorized");
  assert.equal(readiness.credential.deviceId, "dev_1");
  assert.match(readiness.credential.nextAction, /login flow on device dev_1/);
  assert.match(readiness.credential.nextAction, new RegExp(GMAIL_READONLY_SCOPE));
});

test("a credential with the wrong scope is a DISTINCT failure from having none", () => {
  const svc = register(stateWith(HELD("gmail.metadata")));
  const readiness = listUnread(svc).metadata.readiness;

  assert.equal(readiness.reason, "scope_mismatch", "not 'no_credential' — the fix is re-consent, not login");
  assert.equal(readiness.credential.heldScope, "gmail.metadata");
  assert.equal(readiness.credential.requiredScope, GMAIL_READONLY_SCOPE);
  assert.match(readiness.credential.nextAction, /consent to gmail\.readonly/);
});

test("a valid credential -> ready, and the capability is invokable", () => {
  const svc = register(stateWith(HELD()));
  const capability = listUnread(svc);

  assert.equal(capability.metadata.readiness.state, "ready");
  assert.equal(capability.metadata.readiness.credential.status, "authorized");
  assert.equal(capability.status, "available");
});

test("credential state gates ONLY the capabilities that depend on it", () => {
  const svc = register(stateWith());
  const inspect = svc.listApplicationCapabilities(GMAIL_APPLICATION_ID)
    .find((capability) => capability.name === "app.app_gmail.inspect");
  assert.equal(inspect.metadata.readiness.state, "ready", "an unauthorized mailbox must not make 'inspect' look broken");
});

test("a revoked credential auto-degrades the application to offline, and never auto-onlines", () => {
  const state = stateWith(HELD());
  const svc = register(state);
  const app = state.applications[0];
  app.healthProbe = { enabled: true, intervalMinutes: 5, lastCheckedAt: null };
  assert.equal(app.status, "active");

  svc.applicationHealthSweep({ force: true });
  assert.equal(app.health.status, "healthy");
  assert.equal(app.status, "active");

  // The user revokes the grant in their Google account: the sidecar goes away,
  // and the device's next readiness report no longer holds it.
  state.device.applicationCredentialReadiness = [];

  svc.applicationHealthSweep({ force: true });
  assert.equal(app.health.status, "unhealthy");
  assert.match(app.health.reason, /no_credential_on_device/);
  assert.equal(app.status, "active", "one failure does not flap the app offline");

  svc.applicationHealthSweep({ force: true });
  assert.equal(app.status, "offline", "two consecutive failures auto-degrade");

  // Re-authorized: health recovers, but status STAYS offline — re-enabling
  // execution is a human, approval-gated act.
  state.device.applicationCredentialReadiness = HELD();
  svc.applicationHealthSweep({ force: true });
  assert.equal(app.health.status, "healthy");
  assert.equal(app.status, "offline", "recovery never auto-onlines");
});

test("no credential, token, or secret appears anywhere in state or the public contract", () => {
  const state = stateWith(HELD());
  const svc = register(state);
  svc.probeApplication(GMAIL_APPLICATION_ID);

  const serialized = JSON.stringify({
    state,
    capabilities: svc.listApplicationCapabilities(GMAIL_APPLICATION_ID),
  });
  for (const secretShaped of ["refresh_token", "access_token", "client_secret", "password", "authorization", "bearer"]) {
    assert.ok(!serialized.toLowerCase().includes(secretShaped), `nothing named "${secretShaped}" may exist here`);
  }
  // What IS present is the requirement and the verdict — provider, scope, device.
  assert.ok(serialized.includes(GMAIL_READONLY_SCOPE));
  assert.ok(serialized.includes("dev_1"));
});

test("readiness and recovery guidance survive a restart", () => {
  const state = stateWith();
  register(state);

  // Restart: persisted JSON round-trip, fresh services over the restored state.
  const restored = JSON.parse(JSON.stringify(state));
  const readiness = listUnread(service(restored)).metadata.readiness;

  assert.equal(readiness.reason, "no_credential_on_device");
  assert.match(readiness.credential.nextAction, /login flow on device dev_1/);
});
