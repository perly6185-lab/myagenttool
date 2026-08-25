import assert from "node:assert/strict";
import { test } from "node:test";
import { createTerminalService } from "../src/services/terminal.mjs";
import { sshHostFingerprint } from "../src/services/ssh-host-connector.mjs";

const FINGERPRINT = sshHostFingerprint(Buffer.from("service-test-host-key"));

function harness({ verifyError = null } = {}) {
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
      return { ok: true, credential: { privateKey: "PRIVATE-KEY-MATERIAL" } };
    },
    sshHostConnector: {
      observeFingerprint: async () => ({ fingerprint: FINGERPRINT, resolvedAddress: "203.0.113.30", resolvedAddresses: ["203.0.113.30"] }),
      verifyConnection: async () => {
        if (verifyError) throw verifyError;
        return { fingerprint: FINGERPRINT, resolvedAddress: "203.0.113.30", capabilities: { sftp: true, sftpVersion: 3, posixRename: true, symlink: true } };
      },
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
