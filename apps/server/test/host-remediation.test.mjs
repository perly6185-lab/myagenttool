import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import ssh2 from "ssh2";

import { createHostRemediationService } from "../src/services/host-remediation.mjs";
import { createSshHostConnector, SshHostConnectorError, sshHostFingerprint } from "../src/services/ssh-host-connector.mjs";

const FINGERPRINT = sshHostFingerprint(Buffer.from("remediation-test-host-key"));

function harness({ failAt = null, failCode = "ssh_fixed_command_failed", changedAddressAt = null, credentialGate = null } = {}) {
  let timestamp = "2026-08-29T00:00:00.000Z";
  let sequence = 0;
  const events = [];
  const actions = [];
  const target = {
    id: "ssh_target_1", ownerTeamId: "team_a", authMethod: "private_key_ref",
    credentialRef: "credential://ssh/ssh_target_1", connectionStatus: "ready",
    trustStatus: "pinned", knownHostFingerprint: FINGERPRINT, agentForwarding: false, revision: 3,
  };
  const scope = {
    id: "hfs_tls", ownerTeamId: "team_a", sshTargetId: target.id, purpose: "tls_certificate",
    status: "ready", lastResolvedAddress: "203.0.113.30", revision: 2,
  };
  const profile = {
    id: "htp_1", ownerTeamId: "team_a", sshTargetId: target.id, certificateScopeId: scope.id,
    type: "docker_nginx", containerName: "site-nginx", status: "ready", revision: 4,
  };
  const state = { hostFileScopes: [scope], hostTlsActivationProfiles: [profile], hostRemediationPlans: [] };
  const service = createHostRemediationService({
    state,
    now: () => timestamp,
    nextId: (prefix) => `${prefix}_${++sequence}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    resolveCredential: async () => {
      if (credentialGate) await credentialGate;
      return { ok: true, credential: { privateKey: "PRIVATE-KEY-MATERIAL" } };
    },
    sshHostConnector: {
      runFixedCommand: async (_target, _credential, action, parameters) => {
        actions.push({ action, parameters });
        const position = actions.length;
        if (failAt === position) throw new SshHostConnectorError(failCode, "private remote output");
        return { resolvedAddress: changedAddressAt === position ? "203.0.113.99" : scope.lastResolvedAddress, value: { output: "private remote output" } };
      },
    },
  });
  return { actions, events, profile, scope, service, state, target, setNow: (value) => { timestamp = value; } };
}

test("plans, confirms, and verifies one fixed managed website reload", async () => {
  const { actions, events, profile, service, state, target } = harness();
  const planned = service.createPlan(target, { profileId: profile.id }, { userId: "usr_operator" });

  assert.equal(planned.ok, true);
  assert.equal(planned.reused, false);
  assert.equal(planned.plan.status, "planned");
  assert.equal(planned.plan.targetRevision, target.revision);
  assert.equal(planned.plan.profileRevision, profile.revision);
  assert.equal(JSON.stringify(planned.plan).includes("site-nginx"), false);
  assert.deepEqual(await service.confirmPlan(target, planned.plan, { expectedRevision: 1 }, { userId: "usr_operator" }), {
    ok: false, status: 400, error: "host_remediation_confirmation_required",
  });

  const result = await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 }, { userId: "usr_operator" });
  assert.equal(result.ok, true);
  assert.equal(result.plan.status, "completed");
  assert.equal(result.plan.result.outcome, "restored");
  assert.deepEqual(actions.map((item) => item.action), [
    "docker_nginx_inspect", "docker_nginx_config_test", "docker_nginx_reload", "docker_nginx_inspect", "docker_nginx_config_test",
  ]);
  assert.equal(JSON.stringify(state).includes("PRIVATE-KEY-MATERIAL"), false);
  assert.equal(JSON.stringify(events).includes("private remote output"), false);
  assert.equal(JSON.stringify(events).includes("site-nginx"), false);

  const replayed = await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 }, { userId: "usr_operator" });
  assert.equal(replayed.ok, true);
  assert.equal(replayed.reused, true);
  assert.equal(actions.length, 5, "a response retry must not reload the service twice");
});

test("keeps a prepared repair bound to the user who reviewed it", async () => {
  const { actions, profile, service, target } = harness();
  const planned = service.createPlan(target, { profileId: profile.id }, { userId: "usr_a" });

  assert.equal(service.findPlan(target, planned.plan.id, { userId: "usr_b" }), null);
  assert.deepEqual(await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 }, { userId: "usr_b" }), {
    ok: false, status: 404, error: "host_remediation_plan_not_found",
  });
  assert.equal(actions.length, 0);
});

test("refuses a stale revision-bound plan before contacting the host", async () => {
  const { actions, profile, service, target } = harness();
  const planned = service.createPlan(target, { profileId: profile.id });
  target.revision += 1;

  const result = await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 });
  assert.deepEqual(result, { ok: false, status: 409, error: "host_remediation_plan_stale" });
  assert.equal(actions.length, 0);
});

test("stops before changing the host when a preflight check fails", async () => {
  const { actions, profile, service, target } = harness({ failAt: 2 });
  const planned = service.createPlan(target, { profileId: profile.id });
  const result = await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.plan.status, "failed");
  assert.deepEqual(result.plan.result, {
    outcome: "not_changed", changeAttempted: false, verification: "not_started",
    completedChecks: ["preflight_container_running"], error: "ssh_fixed_command_failed",
  });
  assert.deepEqual(actions.map((item) => item.action), ["docker_nginx_inspect", "docker_nginx_config_test"]);
});

test("reports an unknown outcome and never auto-retries after a reload", async () => {
  const { actions, profile, service, target } = harness({ failAt: 4, failCode: "ssh_fixed_command_timeout" });
  const planned = service.createPlan(target, { profileId: profile.id });
  const result = await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.plan.status, "outcome_unknown");
  assert.equal(result.plan.result.changeAttempted, true);
  assert.equal(result.plan.result.verification, "incomplete");
  assert.equal(result.plan.result.error, "ssh_fixed_command_timeout");
  assert.deepEqual(actions.map((item) => item.action), [
    "docker_nginx_inspect", "docker_nginx_config_test", "docker_nginx_reload", "docker_nginx_inspect",
  ]);

  await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 });
  assert.equal(actions.length, 4);
});

test("allows only one concurrent confirmation to reach the remote mutation", async () => {
  let releaseCredential;
  const credentialGate = new Promise((resolve) => { releaseCredential = resolve; });
  const { actions, profile, service, target } = harness({ credentialGate });
  const planned = service.createPlan(target, { profileId: profile.id });

  const first = service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 });
  const second = service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 });
  releaseCredential();
  const results = await Promise.all([first, second]);

  assert.equal(results.filter((result) => result.ok && result.plan.status === "completed").length, 1);
  assert.equal(results.filter((result) => !result.ok && result.error === "host_remediation_plan_not_executable").length, 1);
  assert.equal(actions.length, 5);
});

test("expires an unconfirmed plan without contacting the host", async () => {
  const { actions, profile, service, setNow, target } = harness();
  const planned = service.createPlan(target, { profileId: profile.id });
  setNow("2026-08-29T00:11:00.000Z");

  const result = await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 });
  assert.deepEqual(result, { ok: false, status: 409, error: "host_remediation_plan_expired" });
  assert.equal(planned.plan.status, "expired");
  assert.equal(actions.length, 0);
});

test("runs the complete repair protocol through an isolated real SSH server", async (t) => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const parsedKey = ssh2.utils.parseKey(privateKey);
  assert.equal(parsedKey instanceof Error, false);
  const fingerprint = sshHostFingerprint(parsedKey.getPublicSSH());
  const commands = [];
  const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (context) => {
      if (context.method === "password" && context.username === "deploy" && context.password === "test-password") context.accept();
      else context.reject();
    });
    client.on("ready", () => client.on("session", (acceptSession) => {
      const session = acceptSession();
      session.on("exec", (acceptExec, _rejectExec, info) => {
        commands.push(info.command);
        const stream = acceptExec();
        stream.write(info.command.startsWith("docker inspect") ? "true\n" : "ok\n");
        stream.exit(0);
        stream.end();
      });
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const connector = createSshHostConnector({
    resolveAddress: async () => ({ address: "127.0.0.1", family: 4, resolvedAddresses: ["127.0.0.1"] }),
    timeoutMs: 5_000,
  });
  const target = {
    id: "ssh_target_isolated", ownerTeamId: "team_a", host: "isolated.invalid", port: server.address().port, user: "deploy",
    authMethod: "password_ref", credentialRef: "credential://ssh/ssh_target_isolated", networkPolicy: "public_only",
    connectionStatus: "ready", trustStatus: "pinned", knownHostFingerprint: fingerprint, agentForwarding: false, revision: 1,
  };
  const scope = { id: "hfs_tls", ownerTeamId: "team_a", sshTargetId: target.id, purpose: "tls_certificate", status: "ready", lastResolvedAddress: "127.0.0.1", revision: 1 };
  const profile = { id: "htp_1", ownerTeamId: "team_a", sshTargetId: target.id, certificateScopeId: scope.id, type: "docker_nginx", containerName: "site-nginx", status: "ready", revision: 1 };
  const state = { hostFileScopes: [scope], hostTlsActivationProfiles: [profile], hostRemediationPlans: [] };
  const service = createHostRemediationService({
    state,
    now: () => "2026-08-29T00:00:00.000Z",
    nextId: () => "hrp_isolated",
    appendEvent: () => {},
    persistStateSoon: () => {},
    resolveCredential: async () => ({ ok: true, credential: { password: "test-password" } }),
    sshHostConnector: connector,
  });

  const planned = service.createPlan(target, { profileId: profile.id });
  const result = await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.plan.status, "completed");
  assert.deepEqual(commands, [
    "docker inspect --format '{{.State.Running}}' site-nginx",
    "docker exec site-nginx nginx -t",
    "docker kill --signal=HUP site-nginx",
    "docker inspect --format '{{.State.Running}}' site-nginx",
    "docker exec site-nginx nginx -t",
  ]);
});
