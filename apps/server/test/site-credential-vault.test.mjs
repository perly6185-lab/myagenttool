import assert from "node:assert/strict";
import { test } from "node:test";
import { createSiteCredentialVault } from "../src/services/site-credential-vault.mjs";

test("keeps desktop site credentials process-local and falls back to environment references", async () => {
  const vault = createSiteCredentialVault({ environmentResolver: async (reference) => ({ ok: true, credential: { source: reference } }) });
  assert.deepEqual(vault.provision({
    reference: "credential://aliyun/main",
    provider: "aliyun_oss_cdn",
    credential: { accessKeyId: "LTAI5exampleKey", accessKeySecret: "secret" },
  }), { ok: true, reference: "credential://aliyun/main" });
  const resolved = await vault.resolveCredential("credential://aliyun/main");
  assert.equal(resolved.source, "desktop_session");
  assert.equal(resolved.credential.accessKeySecret, "secret");
  assert.deepEqual(vault.revoke("credential://aliyun/main"), { ok: true, reference: "credential://aliyun/main" });
  assert.deepEqual(await vault.resolveCredential("credential://cloudflare/main"), { ok: true, credential: { source: "credential://cloudflare/main" } });
});

test("keeps Cloudflare credentials in the process-local vault and revokes them independently", async () => {
  const vault = createSiteCredentialVault();
  assert.deepEqual(vault.provision({
    reference: "credential://cloudflare/main",
    provider: "cloudflare_pages",
    credential: { accountId: "0123456789abcdef0123456789abcdef", apiToken: "cloudflare-token" },
  }), { ok: true, reference: "credential://cloudflare/main" });
  const resolved = await vault.resolveCredential("credential://cloudflare/main");
  assert.equal(resolved.source, "desktop_session");
  assert.deepEqual(resolved.credential, { accountId: "0123456789abcdef0123456789abcdef", apiToken: "cloudflare-token" });
  assert.deepEqual(vault.revoke("credential://cloudflare/main"), { ok: true, reference: "credential://cloudflare/main" });
});

test("keeps AliDNS credentials separate from Alibaba Cloud OSS credentials", async () => {
  const vault = createSiteCredentialVault();
  assert.deepEqual(vault.provision({
    reference: "credential://aliyun/main",
    provider: "aliyun_oss_cdn",
    credential: { accessKeyId: "LTAI5ossExampleKey", accessKeySecret: "oss-secret" },
  }), { ok: true, reference: "credential://aliyun/main" });
  assert.deepEqual(vault.provision({
    reference: "credential://alidns/main",
    provider: "alidns_acme",
    credential: { accessKeyId: "LTAI5dnsExampleKey", accessKeySecret: "dns-secret" },
  }), { ok: true, reference: "credential://alidns/main" });
  assert.equal((await vault.resolveCredential("credential://alidns/main")).credential.accessKeySecret, "dns-secret");
  assert.deepEqual(vault.revoke("credential://alidns/main"), { ok: true, reference: "credential://alidns/main" });
  assert.equal((await vault.resolveCredential("credential://aliyun/main")).credential.accessKeySecret, "oss-secret");
});

test("keeps per-host SSH private keys process-local and returns only an opaque reference", async () => {
  const vault = createSiteCredentialVault();
  const privateKey = "-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-material\n-----END OPENSSH PRIVATE KEY-----";
  assert.deepEqual(vault.provision({
    reference: "credential://ssh/website-host",
    provider: "ssh",
    credential: { authMethod: "private_key_ref", privateKey, passphrase: "key-passphrase" },
  }), { ok: true, reference: "credential://ssh/website-host" });
  const resolved = await vault.resolveCredential("credential://ssh/website-host");
  assert.equal(resolved.source, "desktop_session");
  assert.equal(resolved.credential.privateKey, privateKey);
  assert.deepEqual(vault.revoke("credential://ssh/website-host"), { ok: true, reference: "credential://ssh/website-host" });
});

test("rejects unsupported providers, references, and malformed credentials", () => {
  const vault = createSiteCredentialVault();
  assert.equal(vault.provision({ reference: "credential://aliyun/main", provider: "cloudflare_pages", credential: {} }).ok, false);
  assert.equal(vault.provision({ reference: "credential://aliyun/main", provider: "alidns_acme", credential: { accessKeyId: "LTAI5dnsExampleKey", accessKeySecret: "x" } }).ok, false);
  assert.equal(vault.provision({ reference: "credential://alidns/main", provider: "aliyun_oss_cdn", credential: { accessKeyId: "LTAI5ossExampleKey", accessKeySecret: "x" } }).ok, false);
  assert.equal(vault.provision({ reference: "credential://alidns/main", provider: "alidns_acme", credential: { accessKeyId: "short", accessKeySecret: "x" } }).ok, false);
  assert.equal(vault.provision({ reference: "credential://cloudflare/main", provider: "aliyun_oss_cdn", credential: {} }).ok, false);
  assert.equal(vault.provision({ reference: "credential://cloudflare/main", provider: "cloudflare_pages", credential: { accountId: "short", apiToken: "x" } }).ok, false);
  assert.equal(vault.provision({ reference: "credential://aliyun/../../x", provider: "aliyun_oss_cdn", credential: {} }).ok, false);
  assert.equal(vault.provision({ reference: "credential://aliyun/main", provider: "aliyun_oss_cdn", credential: { accessKeyId: "short", accessKeySecret: "x" } }).ok, false);
  assert.equal(vault.provision({ reference: "credential://ssh/../../host", provider: "ssh", credential: { authMethod: "password_ref", password: "x" } }).ok, false);
  assert.equal(vault.provision({ reference: "credential://ssh/host", provider: "ssh", credential: { authMethod: "private_key_ref", privateKey: "not-a-private-key" } }).ok, false);
});
