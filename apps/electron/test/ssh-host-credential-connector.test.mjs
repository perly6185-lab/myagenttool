import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerSshHostCredentialConnector } from "../src/ssh-host-credential-connector.mjs";

const HOST_ID = "ssh_target_website";
const PRIVATE_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-key-material\n-----END OPENSSH PRIVATE KEY-----";

function harness({ secure = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ssh-host-credential-"));
  const handlers = new Map();
  const requests = [];
  const ipcMain = { removeHandler: (name) => handlers.delete(name), handle: (name, handler) => handlers.set(name, handler) };
  const safeStorage = {
    isEncryptionAvailable: () => secure,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (value) => Buffer.from(`protected:${value}`),
    decryptString: (value) => value.toString("utf8").replace(/^protected:/, ""),
  };
  registerSshHostCredentialConnector({
    ipcMain, safeStorage, platform: "linux", credentialRoot: root,
    requestServer: async (method, path, body) => { requests.push({ method, path, body }); },
    now: () => "2026-08-25T00:00:00.000Z",
  });
  return { root, handlers, requests };
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
