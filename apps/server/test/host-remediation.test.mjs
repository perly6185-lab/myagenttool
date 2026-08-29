import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import ssh2 from "ssh2";

import { createHostRemediationService } from "../src/services/host-remediation.mjs";
import { createSshHostConnector, SshHostConnectorError, sshHostFingerprint } from "../src/services/ssh-host-connector.mjs";

const FINGERPRINT = sshHostFingerprint(Buffer.from("remediation-test-host-key"));

function harness({ failAt = null, failCode = "ssh_fixed_command_failed", changedAddressAt = null, credentialGate = null, healthStatuses = ["unhealthy", "unhealthy", "healthy"] } = {}) {
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
  const publishScope = { id: "hfs_publish", ownerTeamId: "team_a", sshTargetId: target.id, purpose: "site_publish", status: "ready", lastResolvedAddress: scope.lastResolvedAddress, revision: 1 };
  const diagnostic = {
    id: "hdr_website", ownerTeamId: "team_a", sshTargetId: target.id, targetRevision: target.revision, createdByUserId: "usr_operator",
    version: 1, intent: "website", risk: "read_only", steps: [], summary: { severity: "warning", finding: "host_warnings_found" }, createdAt: timestamp,
  };
  const binding = {
    id: "stb_1", ownerTeamId: "team_a", siteId: "site_1", deploymentTargetId: "sdt_1", hostname: "site.example.com",
    certificateScopeId: scope.id, activationProfileId: profile.id, status: "active", certificateEnvironment: "production", certificateFingerprint: "a".repeat(64), revision: 2,
  };
  const publication = {
    id: "spb_1", ownerTeamId: "team_a", siteId: "site_1", status: "active",
    remoteDeployment: { provider: "ssh_static", verification: { contentHash: "b".repeat(64), contentBytes: 128 } },
  };
  const state = {
    hostFileScopes: [scope, publishScope], hostTlsActivationProfiles: [profile], hostDiagnosticRuns: [diagnostic], hostRemediationPlans: [],
    siteDomainTlsBindings: [binding], siteDeploymentTargets: [{ id: "sdt_1", ownerTeamId: "team_a", kind: "ssh_static", customDomain: binding.hostname, remoteProjectRef: publishScope.id }],
    sites: [{ id: "site_1", ownerTeamId: "team_a", activePublicationId: publication.id }], sitePublications: [publication],
  };
  const healthChecks = [];
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
    checkWebsiteHealth: async (healthTarget) => {
      healthChecks.push(healthTarget);
      const status = healthStatuses[Math.min(healthChecks.length - 1, healthStatuses.length - 1)];
      return { status, reason: status === "healthy" ? "website_healthy" : "website_unreachable", statusCodeClass: status === "healthy" ? 2 : null, contentMatched: status === "healthy", checkedAt: timestamp };
    },
  });
  return { actions, binding, diagnostic, events, healthChecks, profile, scope, service, state, target, setNow: (value) => { timestamp = value; } };
}

test("plans, confirms, and verifies one fixed managed website reload", async () => {
  const { actions, diagnostic, events, healthChecks, profile, service, state, target } = harness();
  const planned = await service.createPlan(target, { profileId: profile.id, diagnosticRunId: diagnostic.id }, { userId: "usr_operator" });

  assert.equal(planned.ok, true);
  assert.equal(planned.reused, false);
  assert.equal(planned.plan.status, "planned");
  assert.equal(planned.plan.targetRevision, target.revision);
  assert.equal(planned.plan.profileRevision, profile.revision);
  assert.equal(planned.plan.diagnosticRunId, diagnostic.id);
  assert.equal(JSON.stringify(planned.plan).includes("site-nginx"), false);
  assert.deepEqual(await service.confirmPlan(target, planned.plan, { expectedRevision: 1 }, { userId: "usr_operator" }), {
    ok: false, status: 400, error: "host_remediation_confirmation_required",
  });

  const result = await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 }, { userId: "usr_operator" });
  assert.equal(result.ok, true);
  assert.equal(result.plan.status, "completed");
  assert.equal(result.plan.result.outcome, "restored");
  assert.equal(healthChecks.length, 3);
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
  const { actions, diagnostic, profile, service, target } = harness();
  diagnostic.createdByUserId = "usr_a";
  const planned = await service.createPlan(target, { profileId: profile.id, diagnosticRunId: diagnostic.id }, { userId: "usr_a" });

  assert.equal(service.findPlan(target, planned.plan.id, { userId: "usr_b" }), null);
  assert.deepEqual(await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 }, { userId: "usr_b" }), {
    ok: false, status: 404, error: "host_remediation_plan_not_found",
  });
  assert.equal(actions.length, 0);
});

test("refuses a stale revision-bound plan before contacting the host", async () => {
  const { actions, diagnostic, profile, service, target } = harness();
  diagnostic.createdByUserId = "usr_local";
  const planned = await service.createPlan(target, { profileId: profile.id, diagnosticRunId: diagnostic.id });
  target.revision += 1;

  const result = await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 });
  assert.deepEqual(result, { ok: false, status: 409, error: "host_remediation_diagnostic_stale" });
  assert.equal(actions.length, 0);
});

test("stops before changing the host when a preflight check fails", async () => {
  const { actions, diagnostic, profile, service, target } = harness({ failAt: 2 });
  diagnostic.createdByUserId = "usr_local";
  const planned = await service.createPlan(target, { profileId: profile.id, diagnosticRunId: diagnostic.id });
  const result = await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.plan.status, "failed");
  assert.deepEqual(result.plan.result, {
    outcome: "not_changed", changeAttempted: false, verification: "not_started",
    completedChecks: ["preflight_website_health", "preflight_container_running"], error: "ssh_fixed_command_failed",
  });
  assert.deepEqual(actions.map((item) => item.action), ["docker_nginx_inspect", "docker_nginx_config_test"]);
});

test("reports an unknown outcome and never auto-retries after a reload", async () => {
  const { actions, diagnostic, profile, service, target } = harness({ failAt: 4, failCode: "ssh_fixed_command_timeout" });
  diagnostic.createdByUserId = "usr_local";
  const planned = await service.createPlan(target, { profileId: profile.id, diagnosticRunId: diagnostic.id });
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
  const { actions, diagnostic, profile, service, target } = harness({ credentialGate });
  diagnostic.createdByUserId = "usr_local";
  const planned = await service.createPlan(target, { profileId: profile.id, diagnosticRunId: diagnostic.id });

  const first = service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 });
  const second = service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 });
  releaseCredential();
  const results = await Promise.all([first, second]);

  assert.equal(results.filter((result) => result.ok && result.plan.status === "completed").length, 1);
  assert.equal(results.filter((result) => !result.ok && result.error === "host_remediation_plan_not_executable").length, 1);
  assert.equal(actions.length, 5);
});

test("expires an unconfirmed plan without contacting the host", async () => {
  const { actions, diagnostic, profile, service, setNow, target } = harness();
  diagnostic.createdByUserId = "usr_local";
  const planned = await service.createPlan(target, { profileId: profile.id, diagnosticRunId: diagnostic.id });
  setNow("2026-08-29T00:11:00.000Z");

  const result = await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: 1 });
  assert.deepEqual(result, { ok: false, status: 409, error: "host_remediation_plan_expired" });
  assert.equal(planned.plan.status, "expired");
  assert.equal(actions.length, 0);
});

test("records that no repair is needed when the real website is already healthy", async () => {
  const { actions, diagnostic, healthChecks, profile, service, target } = harness({ healthStatuses: ["healthy"] });
  diagnostic.createdByUserId = "usr_local";

  const planned = await service.createPlan(target, { profileId: profile.id, diagnosticRunId: diagnostic.id });

  assert.equal(planned.ok, true);
  assert.equal(planned.plan.status, "not_needed");
  assert.equal(planned.plan.result.outcome, "already_healthy");
  assert.equal(planned.plan.result.changeAttempted, false);
  assert.equal(healthChecks.length, 1);
  assert.equal(actions.length, 0);
  const replay = await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: planned.plan.revision });
  assert.equal(replay.reused, true);
  assert.equal(actions.length, 0);
});

test("reports that the service was reloaded but the website is still unavailable", async () => {
  const { actions, diagnostic, profile, service, target } = harness({ healthStatuses: ["unhealthy", "unhealthy", "unhealthy", "healthy"] });
  diagnostic.createdByUserId = "usr_local";
  const planned = await service.createPlan(target, { profileId: profile.id, diagnosticRunId: diagnostic.id });

  const result = await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: planned.plan.revision });

  assert.equal(result.plan.status, "completed_unresolved");
  assert.equal(result.plan.result.outcome, "not_restored");
  assert.equal(result.plan.result.verification, "failed");
  assert.equal(result.plan.result.websiteHealth.status, "unhealthy");
  const rechecked = await service.recheckPlan(target, result.plan);
  assert.equal(rechecked.plan.lastRecheckedHealth.status, "healthy");
  assert.equal(actions.length, 5, "a read-only reconciliation must not reload the service again");
});

test("requires a recent website diagnostic before checking or repairing a managed site", async () => {
  const { diagnostic, healthChecks, profile, service, target } = harness();
  diagnostic.createdByUserId = "usr_local";
  diagnostic.intent = "performance";

  assert.deepEqual(await service.createPlan(target, { profileId: profile.id, diagnosticRunId: diagnostic.id }), {
    ok: false, status: 409, error: "host_remediation_diagnostic_not_applicable",
  });
  assert.equal(healthChecks.length, 0);
});

test("recovers an interrupted post-confirmation repair as outcome unknown and exposes history", async () => {
  const { diagnostic, events, profile, service, state, target } = harness();
  diagnostic.createdByUserId = "usr_local";
  const planned = await service.createPlan(target, { profileId: profile.id, diagnosticRunId: diagnostic.id });
  Object.assign(planned.plan, { status: "running", phase: "change_pending", revision: 2 });

  const restored = createHostRemediationService({
    state,
    now: () => "2026-08-29T00:01:00.000Z",
    nextId: () => "unused",
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    resolveCredential: async () => ({ ok: false }),
    sshHostConnector: {},
    checkWebsiteHealth: async () => ({ status: "unhealthy", reason: "website_unreachable" }),
  });

  assert.equal(planned.plan.status, "outcome_unknown");
  assert.equal(planned.plan.result.error, "host_remediation_interrupted");
  assert.equal(planned.plan.result.changeAttempted, true);
  assert.deepEqual(restored.listPlans(target).map((plan) => plan.id), [planned.plan.id]);
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
  const publishScope = { id: "hfs_publish", ownerTeamId: "team_a", sshTargetId: target.id, purpose: "site_publish", status: "ready", lastResolvedAddress: scope.lastResolvedAddress, revision: 1 };
  const diagnostic = { id: "hdr_isolated", ownerTeamId: "team_a", sshTargetId: target.id, targetRevision: target.revision, createdByUserId: "usr_local", version: 1, intent: "website", risk: "read_only", steps: [], summary: { severity: "warning", finding: "host_warnings_found" }, createdAt: "2026-08-29T00:00:00.000Z" };
  const state = {
    hostFileScopes: [scope, publishScope], hostTlsActivationProfiles: [profile], hostDiagnosticRuns: [diagnostic], hostRemediationPlans: [],
    siteDomainTlsBindings: [{ id: "stb_1", ownerTeamId: "team_a", siteId: "site_1", deploymentTargetId: "sdt_1", hostname: "isolated.example.com", certificateScopeId: scope.id, activationProfileId: profile.id, status: "active", certificateEnvironment: "production", certificateFingerprint: "a".repeat(64), revision: 1 }],
    siteDeploymentTargets: [{ id: "sdt_1", ownerTeamId: "team_a", kind: "ssh_static", customDomain: "isolated.example.com", remoteProjectRef: publishScope.id }],
    sites: [{ id: "site_1", ownerTeamId: "team_a", activePublicationId: "spb_1" }],
    sitePublications: [{ id: "spb_1", ownerTeamId: "team_a", siteId: "site_1", status: "active", remoteDeployment: { provider: "ssh_static", verification: { contentHash: "b".repeat(64), contentBytes: 128 } } }],
  };
  let healthCheck = 0;
  const service = createHostRemediationService({
    state,
    now: () => "2026-08-29T00:00:00.000Z",
    nextId: () => "hrp_isolated",
    appendEvent: () => {},
    persistStateSoon: () => {},
    resolveCredential: async () => ({ ok: true, credential: { password: "test-password" } }),
    sshHostConnector: connector,
    checkWebsiteHealth: async () => {
      healthCheck += 1;
      const healthy = healthCheck === 3;
      return { status: healthy ? "healthy" : "unhealthy", reason: healthy ? "website_healthy" : "website_unreachable", statusCodeClass: healthy ? 2 : null, contentMatched: healthy, checkedAt: "2026-08-29T00:00:00.000Z" };
    },
  });

  const planned = await service.createPlan(target, { profileId: profile.id, diagnosticRunId: diagnostic.id });
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
