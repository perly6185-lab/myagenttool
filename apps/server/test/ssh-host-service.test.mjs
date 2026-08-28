import assert from "node:assert/strict";
import { test } from "node:test";
import { createTerminalService } from "../src/services/terminal.mjs";
import { sshHostFingerprint } from "../src/services/ssh-host-connector.mjs";

const FINGERPRINT = sshHostFingerprint(Buffer.from("service-test-host-key"));

function harness({ verifyError = null, credentialResult = { ok: true, credential: { privateKey: "PRIVATE-KEY-MATERIAL" } } } = {}) {
  const state = {
    device: { id: "dev_local", platform: "linux" }, projects: [], worktrees: [], users: [],
    sshTargets: [], sshConnectionTests: [], terminalSessions: [], terminalBridgeActions: [], terminalEvidenceRecords: [],
  };
  const events = [];
  const resolvedCredentials = [];
  let sequence = 0;
  const service = createTerminalService({
    state,
    now: () => "2026-08-25T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++sequence}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    summarizeText: (value, limit) => String(value).slice(0, limit),
    uniqueStrings: (values) => [...new Set(values)],
    codexSessionForInvocation: () => null,
    resolveCredential: async (reference) => {
      resolvedCredentials.push(reference);
      return credentialResult;
    },
    sshHostConnector: {
      observeFingerprint: async () => ({ fingerprint: FINGERPRINT, resolvedAddress: "203.0.113.30", resolvedAddresses: ["203.0.113.30"] }),
      verifyConnection: async () => {
        if (verifyError) throw verifyError;
        return { fingerprint: FINGERPRINT, resolvedAddress: "203.0.113.30", capabilities: { sftp: true, sftpVersion: 3, posixRename: true, symlink: true } };
      },
      runFixedCommand: async (_target, _credential, action) => ({
        resolvedAddress: "203.0.113.30",
        value: { action, ok: true, output: "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        20G   8G   12G  40% /" },
      }),
    },
  });
  return { state, events, resolvedCredentials, service };
}

test("promotes a file-transfer host from observation through explicit trust to ready", async () => {
  const { state, events, resolvedCredentials, service } = harness();
  const target = service.createSshTarget({
    name: "Website host", host: "host.example", user: "deploy", authMethod: "private_key_ref",
    purposes: ["file_transfer", "site_publish"], networkPolicy: "public_only",
  });
  assert.equal(target.workspaceRoot, null, "file transfer does not inherit the runtime workspace root");
  assert.deepEqual(target.purposes, ["file_transfer", "site_publish"]);
  assert.equal(target.credentialRef, `credential://ssh/${target.id}`);
  assert.equal(target.revision, 1);

  const observed = await service.observeSshHostFingerprint(target);
  assert.equal(observed.ok, true);
  assert.equal(target.connectionStatus, "fingerprint_pending");
  assert.equal(target.observedFingerprint, FINGERPRINT);
  assert.equal(target.revision, 2);

  assert.deepEqual(service.confirmSshHostFingerprint(target, { fingerprint: FINGERPRINT, expectedRevision: 1 }), {
    ok: false, status: 409, error: "ssh_target_revision_conflict", currentRevision: 2,
  });
  assert.equal(service.confirmSshHostFingerprint(target, { fingerprint: FINGERPRINT, expectedRevision: 2 }).ok, true);
  assert.equal(target.trustStatus, "pinned");
  assert.equal(target.revision, 3);

  const verified = await service.verifySshHostConnection(target);
  assert.equal(verified.ok, true);
  assert.equal(target.connectionStatus, "ready");
  assert.deepEqual(target.capabilities, { sftp: true, sftpVersion: 3, posixRename: true, symlink: true });
  assert.deepEqual(resolvedCredentials, [`credential://ssh/${target.id}`]);
  assert.equal(JSON.stringify(state).includes("PRIVATE-KEY-MATERIAL"), false);
  assert.equal(JSON.stringify(events).includes("PRIVATE-KEY-MATERIAL"), false);
  assert.deepEqual(events.map((event) => event.type), [
    "ssh.target.registered", "ssh.host.fingerprint_observed", "ssh.host.fingerprint_confirmed", "ssh.host.verified",
  ]);
});

test("does not accept a fingerprint other than the just-observed value", async () => {
  const { service } = harness();
  const target = service.createSshTarget({ host: "host.example", user: "deploy", authMethod: "private_key_ref", credentialRef: "credential://ssh/website", purpose: "file_transfer" });
  await service.observeSshHostFingerprint(target);
  const result = service.confirmSshHostFingerprint(target, { fingerprint: sshHostFingerprint(Buffer.from("other-host-key")), expectedRevision: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.error, "ssh_host_fingerprint_confirmation_invalid");
  assert.equal(target.knownHostFingerprint, null);
});

test("updates an existing host's private-network consent without replacing its credential reference", () => {
  const { events, service } = harness();
  const target = service.createSshTarget({
    host: "10.10.10.222", user: "devagent", authMethod: "password_ref",
    purposes: ["file_transfer", "site_publish"], networkPolicy: "public_only",
  });
  target.connectionStatus = "error";
  target.lastConnectionError = { code: "ssh_host_private_network_blocked", at: "2026-08-25T00:00:00.000Z" };
  const credentialRef = target.credentialRef;

  assert.deepEqual(service.updateSshTarget(target, { expectedRevision: 9, networkPolicy: "allow_private_network" }), {
    ok: false, status: 409, error: "ssh_target_revision_conflict", currentRevision: 1,
  });
  const updated = service.updateSshTarget(target, { expectedRevision: 1, networkPolicy: "allow_private_network" });
  assert.equal(updated.ok, true);
  assert.equal(target.networkPolicy, "allow_private_network");
  assert.equal(target.credentialRef, credentialRef);
  assert.equal(target.connectionStatus, "untested");
  assert.equal(target.lastConnectionError, null);
  assert.equal(target.revision, 2);
  assert.equal(events.at(-1)?.type, "ssh.target.updated");
});

test("changing host identity clears the old fingerprint before reconnecting", async () => {
  const { service } = harness();
  const target = service.createSshTarget({ host: "host.example", user: "deploy", authMethod: "password_ref", purpose: "file_transfer" });
  await service.observeSshHostFingerprint(target);
  service.confirmSshHostFingerprint(target, { fingerprint: FINGERPRINT, expectedRevision: 2 });

  const updated = service.updateSshTarget(target, { expectedRevision: 3, host: "replacement.example" });
  assert.equal(updated.ok, true);
  assert.equal(target.host, "replacement.example");
  assert.equal(target.knownHostFingerprint, null);
  assert.equal(target.observedFingerprint, null);
  assert.equal(target.trustStatus, "known_hosts_required");
});

test("runs only confirmed, allowlisted read-only diagnostics after host verification", async () => {
  const { service, events, resolvedCredentials } = harness();
  const target = service.createSshTarget({ host: "host.example", user: "deploy", authMethod: "private_key_ref", purpose: "file_transfer" });
  target.connectionStatus = "ready";
  target.trustStatus = "pinned";
  target.knownHostFingerprint = FINGERPRINT;

  const result = await service.runSshHostDiagnostic(target, "disk_usage", { userId: "usr_operator" });
  assert.equal(result.ok, true);
  assert.equal(result.command, "df -h");
  assert.match(result.output, /Filesystem/);
  assert.equal(result.summary.finding, "disk_capacity_healthy");
  assert.equal(result.summary.impact, "no_issue_detected");
  assert.deepEqual(resolvedCredentials, [`credential://ssh/${target.id}`]);
  assert.equal(events.at(-1)?.type, "ssh.host_diagnostic.completed");
  assert.equal(events.at(-1)?.data?.outputPreview, undefined);
  assert.equal(events.at(-1)?.data?.command, undefined);
  assert.equal(JSON.stringify(events.at(-1)).includes("/dev/sda1"), false);
  assert.deepEqual(events.at(-1)?.data?.summary, result.summary);

  assert.deepEqual(await service.runSshHostDiagnostic(target, "shell", { userId: "usr_operator" }), {
    ok: false, status: 400, error: "ssh_diagnostic_unsupported",
  });
});

test("normalizes site credential resolver errors at the host diagnostic boundary", async () => {
  const { service, events } = harness({ credentialResult: { ok: false, error: "site_deployment_credential_unavailable" } });
  const target = service.createSshTarget({ host: "host.example", user: "deploy", authMethod: "private_key_ref", purpose: "file_transfer" });
  target.connectionStatus = "ready";
  target.trustStatus = "pinned";
  target.knownHostFingerprint = FINGERPRINT;
  target.capabilities = { sftp: true };
  const revision = target.revision;

  const result = await service.runSshHostDiagnostic(target, "login_sessions", { userId: "usr_operator" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.error, "ssh_credential_unavailable");
  assert.equal(result.target, target);
  assert.equal(target.connectionStatus, "error");
  assert.equal(target.capabilities, null);
  assert.equal(target.lastConnectionError?.code, "ssh_credential_unavailable");
  assert.equal(target.revision, revision + 1);
  assert.equal(events.at(-1)?.type, "ssh.host_diagnostic.connection_failed");
});

test("plans ordinary host questions without producing arbitrary shell", () => {
  const { service } = harness();
  assert.deepEqual(service.planSshHostDiagnostic("查看当前监听端口"), {
    ok: true, action: "listening_ports", command: "ss -lntup", risk: "read_only",
  });
  assert.deepEqual(service.planSshHostDiagnostic("删除日志 && whoami"), {
    ok: false, status: 422, error: "ssh_diagnostic_intent_unsupported",
  });
  assert.deepEqual(service.planSshHostDiagnostic("查看 nginx 服务状态"), {
    ok: true, action: "service_status", parameters: { serviceName: "nginx" },
    command: "systemctl status --no-pager --lines=30 nginx || true", risk: "read_only",
  });
  assert.deepEqual(service.planSshHostDiagnostic("检查最近系统日志"), {
    ok: true, action: "recent_logs", command: "journalctl -n 40 --no-pager", risk: "read_only",
  });
  assert.deepEqual(service.planSshHostDiagnostic("检查网络状态"), {
    ok: true, action: "network_info", command: "ip -brief address", risk: "read_only",
  });
  assert.deepEqual(service.planSshHostDiagnostic("检查登陆情况"), {
    ok: true, action: "login_sessions", command: "who", risk: "read_only",
  });
});
