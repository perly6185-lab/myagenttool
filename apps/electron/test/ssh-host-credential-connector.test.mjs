import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerSshHostCredentialConnector } from "../src/ssh-host-credential-connector.mjs";

const HOST_ID = "ssh_target_website";
const PRIVATE_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-key-material\n-----END OPENSSH PRIVATE KEY-----";

function harness({ secure = true, decryptString, requestServer, root = mkdtempSync(join(tmpdir(), "ssh-host-credential-")) } = {}) {
  const handlers = new Map();
  const requests = [];
  const errors = [];
  const ipcMain = { removeHandler: (name) => handlers.delete(name), handle: (name, handler) => handlers.set(name, handler) };
  const safeStorage = {
    isEncryptionAvailable: () => secure,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (value) => Buffer.from(`protected:${value}`),
    decryptString: decryptString ?? ((value) => value.toString("utf8").replace(/^protected:/, "")),
  };
  const connector = registerSshHostCredentialConnector({
    ipcMain, safeStorage, platform: "linux", credentialRoot: root,
    requestServer: requestServer ?? (async (method, path, body) => { requests.push({ method, path, body }); }),
    onError: (operation, code) => errors.push({ operation, code }),
    now: () => "2026-08-25T00:00:00.000Z",
  });
  return { root, handlers, requests, errors, connector };
}

test("encrypts a private key per host and hydrates only the process-local vault", async () => {
  const { root, handlers, requests } = harness();
  const saved = await handlers.get("ssh-host:save-credential")(null, { hostId: HOST_ID, authMethod: "private_key_ref", privateKey: PRIVATE_KEY, passphrase: "secret-passphrase" });
  assert.deepEqual(saved, { ok: true, reference: `credential://ssh/${HOST_ID}`, authMethod: "private_key_ref" });
  const path = join(root, "ssh-host-credentials", `${HOST_ID}.json`);
  const disk = readFileSync(path, "utf8");
  assert.doesNotMatch(disk, /private-key-material|secret-passphrase/);
  assert.equal(requests[0].body.credential.privateKey, PRIVATE_KEY);

  const status = await handlers.get("ssh-host:get-credential-status")(null, { hostId: HOST_ID });
  assert.deepEqual(status, { desktop: true, secureStorage: true, stored: true, ready: true, reference: `credential://ssh/${HOST_ID}`, authMethod: "private_key_ref" });
  assert.equal(JSON.stringify(status).includes("private-key-material"), false);
});

test("keeps host credentials independent, validates ids, and revokes one host", async () => {
  const { root, handlers, requests } = harness();
  assert.deepEqual(await handlers.get("ssh-host:save-credential")(null, { hostId: "../../escape", authMethod: "password_ref", password: "secret" }), { ok: false, error: "host_id_invalid" });
  await handlers.get("ssh-host:save-credential")(null, { hostId: HOST_ID, authMethod: "password_ref", password: "secret-one" });
  await handlers.get("ssh-host:save-credential")(null, { hostId: "ssh_target_backup", authMethod: "password_ref", password: "secret-two" });
  assert.deepEqual(await handlers.get("ssh-host:remove-credential")(null, { hostId: HOST_ID }), { ok: true, disconnected: true });
  assert.equal(existsSync(join(root, "ssh-host-credentials", `${HOST_ID}.json`)), false);
  assert.equal(existsSync(join(root, "ssh-host-credentials", "ssh_target_backup.json")), true);
  assert.deepEqual(requests.at(-1), { method: "DELETE", path: "/api/internal/site-credentials", body: { reference: `credential://ssh/${HOST_ID}` } });
});

test("fails closed when OS secure storage is unavailable", async () => {
  const { handlers } = harness({ secure: false });
  assert.deepEqual(await handlers.get("ssh-host:save-credential")(null, { hostId: HOST_ID, authMethod: "private_key_ref", privateKey: PRIVATE_KEY }), { ok: false, error: "secure_storage_unavailable" });
});

test("audits hydration stages without returning credential details", async () => {
  const decryptFailure = harness({ decryptString: () => { throw new Error("platform detail"); } });
  await decryptFailure.handlers.get("ssh-host:save-credential")(null, { hostId: HOST_ID, authMethod: "password_ref", password: "secret" });
  const decryptStatus = await decryptFailure.handlers.get("ssh-host:get-credential-status")(null, { hostId: HOST_ID });
  assert.equal(decryptStatus.ready, false);
  assert.deepEqual(decryptFailure.errors.at(-1), { operation: "hydrate", code: "credential_decrypt_failed" });

  let failHandoff = false;
  const handoffFailure = harness({ requestServer: async () => { if (failHandoff) throw new Error("server detail"); } });
  await handoffFailure.handlers.get("ssh-host:save-credential")(null, { hostId: HOST_ID, authMethod: "password_ref", password: "secret" });
  failHandoff = true;
  const handoffStatus = await handoffFailure.handlers.get("ssh-host:get-credential-status")(null, { hostId: HOST_ID });
  assert.equal(handoffStatus.ready, false);
  assert.deepEqual(handoffFailure.errors.at(-1), { operation: "hydrate", code: "credential_handoff_failed" });
  assert.equal(JSON.stringify(handoffFailure.errors).includes("secret"), false);
});

test("restores every valid stored host credential into a fresh process vault", async () => {
  const firstRun = harness();
  await firstRun.handlers.get("ssh-host:save-credential")(null, { hostId: HOST_ID, authMethod: "password_ref", password: "secret" });
  await firstRun.handlers.get("ssh-host:save-credential")(null, { hostId: "ssh_target_backup", authMethod: "password_ref", password: "backup-secret" });

  const restarted = harness({ root: firstRun.root });
  const recovery = await restarted.connector.hydrateStoredCredentials();
  assert.deepEqual(recovery, { stored: 2, ready: 2, failed: 0 });
  assert.deepEqual(restarted.requests.map((request) => request.body.reference).sort(), [
    "credential://ssh/ssh_target_backup",
    `credential://ssh/${HOST_ID}`,
  ]);
  assert.equal(JSON.stringify(restarted.requests).includes("backup-secret"), true);
  assert.equal(existsSync(join(firstRun.root, "ssh-host-credentials", "ssh_target_backup.json")), true);
});

test("does not block startup when the credential directory cannot be read", async () => {
  const root = mkdtempSync(join(tmpdir(), "ssh-host-credential-unreadable-"));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "ssh-host-credentials"), "not a directory");
  const restarted = harness({ root });

  assert.deepEqual(await restarted.connector.hydrateStoredCredentials(), { stored: 0, ready: 0, failed: 0 });
  assert.deepEqual(restarted.errors, [{ operation: "startup-scan", code: "credential_directory_unreadable" }]);
});
