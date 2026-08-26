import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerSiteCloudCredentialConnector } from "../src/site-cloud-credential-connector.mjs";

function harness({ secure = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "site-cloud-credential-"));
  const handlers = new Map();
  const requests = [];
  const ipcMain = {
    removeHandler: (name) => handlers.delete(name),
    handle: (name, handler) => handlers.set(name, handler),
  };
  const safeStorage = {
    isEncryptionAvailable: () => secure,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (value) => Buffer.from(`protected:${value}`),
    decryptString: (value) => value.toString("utf8").replace(/^protected:/, ""),
  };
  registerSiteCloudCredentialConnector({
    ipcMain,
    safeStorage,
    platform: "linux",
    credentialRoot: root,
    requestServer: async (method, path, body) => { requests.push({ method, path, body }); },
    now: () => "2026-08-24T00:00:00.000Z",
  });
  return { root, handlers, requests };
}

test("encrypts an Alibaba Cloud credential, returns only its reference, and hydrates the server session", async () => {
  const { root, handlers, requests } = harness();
  const saved = await handlers.get("site-cloud:save-aliyun-oss-credential")(null, {
    accessKeyId: "LTAI5exampleKey",
    accessKeySecret: "plain-secret-must-not-leak",
  });
  assert.deepEqual(saved, { ok: true, reference: "credential://aliyun/main" });
  const disk = readFileSync(join(root, "site-credentials", "aliyun-main.json"), "utf8");
  assert.doesNotMatch(disk, /plain-secret-must-not-leak/);
  assert.equal(requests[0].body.credential.accessKeySecret, "plain-secret-must-not-leak");

  const status = await handlers.get("site-cloud:get-aliyun-oss-credential-status")();
  assert.deepEqual(status, { desktop: true, secureStorage: true, stored: true, ready: true, reference: "credential://aliyun/main" });
  assert.equal(JSON.stringify(status).includes("plain-secret"), false);
  assert.equal(requests.length, 2, "status rehydrates the process-local server vault");
});

test("fails closed when OS-backed encryption is unavailable and removes both copies on disconnect", async () => {
  const unavailable = harness({ secure: false });
  assert.deepEqual(await unavailable.handlers.get("site-cloud:save-aliyun-oss-credential")(null, {
    accessKeyId: "LTAI5exampleKey", accessKeySecret: "secret",
  }), { ok: false, error: "secure_storage_unavailable" });

  const connected = harness();
  await connected.handlers.get("site-cloud:save-aliyun-oss-credential")(null, {
    accessKeyId: "LTAI5exampleKey", accessKeySecret: "secret",
  });
  assert.deepEqual(await connected.handlers.get("site-cloud:remove-aliyun-oss-credential")(), { ok: true, disconnected: true });
  assert.equal(connected.requests.at(-1).method, "DELETE");
});

test("encrypts Cloudflare credentials independently and never returns the API token", async () => {
  const { root, handlers, requests } = harness();
  const saved = await handlers.get("site-cloud:save-cloudflare-credential")(null, {
    accountId: "0123456789abcdef0123456789abcdef",
    apiToken: "cloudflare-token-must-not-leak",
  });
  assert.deepEqual(saved, { ok: true, reference: "credential://cloudflare/main" });
  const disk = readFileSync(join(root, "site-credentials", "cloudflare-main.json"), "utf8");
  assert.doesNotMatch(disk, /cloudflare-token-must-not-leak/);
  assert.deepEqual(requests[0].body, {
    reference: "credential://cloudflare/main",
    provider: "cloudflare_pages",
    credential: { accountId: "0123456789abcdef0123456789abcdef", apiToken: "cloudflare-token-must-not-leak" },
  });

  const status = await handlers.get("site-cloud:get-cloudflare-credential-status")();
  assert.deepEqual(status, { desktop: true, secureStorage: true, stored: true, ready: true, reference: "credential://cloudflare/main" });
  assert.equal(JSON.stringify(status).includes("cloudflare-token"), false);
});

test("disconnecting Cloudflare leaves the Alibaba Cloud credential intact", async () => {
  const { root, handlers, requests } = harness();
  await handlers.get("site-cloud:save-aliyun-oss-credential")(null, { accessKeyId: "LTAI5exampleKey", accessKeySecret: "aliyun-secret" });
  await handlers.get("site-cloud:save-cloudflare-credential")(null, { accountId: "0123456789abcdef0123456789abcdef", apiToken: "cloudflare-token" });
  assert.deepEqual(await handlers.get("site-cloud:remove-cloudflare-credential")(), { ok: true, disconnected: true });
  assert.equal(existsSync(join(root, "site-credentials", "aliyun-main.json")), true);
  assert.equal(existsSync(join(root, "site-credentials", "cloudflare-main.json")), false);
  assert.deepEqual(requests.at(-1), { method: "DELETE", path: "/api/internal/site-credentials", body: { reference: "credential://cloudflare/main" } });
});

test("stores AliDNS separately from OSS and revokes only the DNS credential", async () => {
  const { root, handlers, requests } = harness();
  await handlers.get("site-cloud:save-aliyun-oss-credential")(null, {
    accessKeyId: "LTAI5ossExampleKey", accessKeySecret: "oss-secret",
  });
  const saved = await handlers.get("site-cloud:save-alidns-credential")(null, {
    accessKeyId: "LTAI5dnsExampleKey", accessKeySecret: "dns-secret-must-not-leak",
  });
  assert.deepEqual(saved, { ok: true, reference: "credential://alidns/main" });
  const disk = readFileSync(join(root, "site-credentials", "alidns-main.json"), "utf8");
  assert.doesNotMatch(disk, /dns-secret-must-not-leak/);
  assert.deepEqual(requests.at(-1).body, {
    reference: "credential://alidns/main",
    provider: "alidns_acme",
    credential: { accessKeyId: "LTAI5dnsExampleKey", accessKeySecret: "dns-secret-must-not-leak" },
  });

  const status = await handlers.get("site-cloud:get-alidns-credential-status")();
  assert.deepEqual(status, { desktop: true, secureStorage: true, stored: true, ready: true, reference: "credential://alidns/main" });
  assert.equal(JSON.stringify(status).includes("dns-secret"), false);

  assert.deepEqual(await handlers.get("site-cloud:remove-alidns-credential")(), { ok: true, disconnected: true });
  assert.equal(existsSync(join(root, "site-credentials", "aliyun-main.json")), true);
  assert.equal(existsSync(join(root, "site-credentials", "alidns-main.json")), false);
  assert.deepEqual(requests.at(-1), { method: "DELETE", path: "/api/internal/site-credentials", body: { reference: "credential://alidns/main" } });
});
