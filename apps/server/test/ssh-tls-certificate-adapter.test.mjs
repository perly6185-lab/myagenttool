import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { posix, join } from "node:path";
import { test } from "node:test";

import { createSshTlsCertificateAdapter } from "../src/services/ssh-tls-certificate-adapter.mjs";

const DIR = 0o040700;
const FILE = 0o100600;
const LINK = 0o120777;
const ROOT = "/srv/myagenttool-tls/site-1";

function missing() { return Object.assign(new Error("missing"), { code: 2 }); }

function certificateFixture(commonName) {
  const directory = mkdtempSync(join(tmpdir(), "myagenttool-tls-test-"));
  try {
    const keyPath = join(directory, "key.pem");
    const certPath = join(directory, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "2", "-subj", `/CN=${commonName}`, "-addext", `subjectAltName=DNS:${commonName}`], { stdio: "ignore" });
    const privateKey = readFileSync(keyPath);
    const certificate = readFileSync(certPath);
    const fingerprint = createHash("sha256").update(new X509Certificate(certificate).raw).digest("hex");
    return { privateKey, certificate, fingerprint, hostname: commonName };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function memorySftp() {
  const nodes = new Map([
    ["/srv", { type: "directory", mode: 0o700 }],
    ["/srv/myagenttool-tls", { type: "directory", mode: 0o700 }],
    [ROOT, { type: "directory", mode: 0o700 }],
  ]);
  const node = (path) => nodes.get(posix.normalize(path));
  const resolvePath = (path) => {
    const normalized = posix.normalize(path);
    const item = node(normalized);
    return item?.type === "symlink" ? posix.resolve(posix.dirname(normalized), item.target) : normalized;
  };
  const attrs = (item) => ({ mode: item.type === "directory" ? DIR : item.type === "symlink" ? LINK : FILE, size: item.data?.length ?? 0 });
  const moveTree = (from, to) => {
    const rows = [...nodes.entries()].filter(([path]) => path === from || path.startsWith(`${from}/`));
    for (const [path] of rows) nodes.delete(path);
    for (const [path, item] of rows) nodes.set(`${to}${path.slice(from.length)}`, item);
  };
  return {
    nodes,
    lstat(path, callback) { const item = node(path); item ? callback(null, attrs(item)) : callback(missing()); },
    realpath(path, callback) { const resolved = resolvePath(path); node(resolved) ? callback(null, resolved) : callback(missing()); },
    mkdir(path, _attrs, callback) { nodes.set(posix.normalize(path), { type: "directory", mode: 0o700 }); callback(null); },
    chmod(path, mode, callback) { const item = node(path); if (!item) return callback(missing()); item.mode = mode; callback(null); },
    open(path, flags, mode, callback) {
      if (typeof mode === "function") { callback = mode; mode = 0o600; }
      const normalized = posix.normalize(path);
      if (flags === "wx" && node(normalized)) return callback(Object.assign(new Error("exists"), { code: 4 }));
      if (flags === "wx") nodes.set(normalized, { type: "file", mode, data: Buffer.alloc(0) });
      if (!node(normalized)) return callback(missing());
      callback(null, normalized);
    },
    write(handle, buffer, offset, length, position, callback) {
      const item = node(handle); const previous = item.data ?? Buffer.alloc(0); const next = Buffer.alloc(Math.max(previous.length, position + length));
      previous.copy(next); buffer.copy(next, position, offset, offset + length); item.data = next; callback(null);
    },
    read(handle, buffer, offset, length, position, callback) {
      const source = node(handle)?.data ?? Buffer.alloc(0); const bytes = Math.min(length, Math.max(0, source.length - position));
      source.copy(buffer, offset, position, position + bytes); callback(null, bytes, buffer);
    },
    close(_handle, callback) { callback(null); },
    rename(from, to, callback) { if (!node(from)) return callback(missing()); moveTree(posix.normalize(from), posix.normalize(to)); callback(null); },
    ext_openssh_rename(from, to, callback) {
      if (this.failBeforeSwitch) { this.failBeforeSwitch = false; callback(Object.assign(new Error("acknowledgment lost"), { code: "ECONNRESET" })); return; }
      nodes.delete(posix.normalize(to)); moveTree(posix.normalize(from), posix.normalize(to));
      if (this.failAfterSwitch) { this.failAfterSwitch = false; callback(Object.assign(new Error("acknowledgment lost"), { code: "ECONNRESET" })); return; }
      callback(null);
    },
    symlink(target, path, callback) { nodes.set(posix.normalize(path), { type: "symlink", target }); callback(null); },
    unlink(path, callback) { const existed = nodes.delete(posix.normalize(path)); callback(existed ? null : missing()); },
    rmdir(path, callback) { nodes.delete(posix.normalize(path)); callback(null); },
    current() { return resolvePath(`${ROOT}/current`); },
  };
}

function harness({ verifyHttps } = {}) {
  const sftp = memorySftp();
  const actions = [];
  const host = { id: "ssh_1", ownerTeamId: "team_a", credentialRef: "credential://ssh/ssh_1", purposes: ["site_publish"], connectionStatus: "ready", capabilities: { sftp: true, posixRename: true, symlink: true } };
  const publishScope = { id: "hfs_publish", ownerTeamId: "team_a", sshTargetId: host.id, purpose: "site_publish", status: "ready", lastResolvedAddress: "10.10.10.222", permissions: ["list", "upload", "download"] };
  const certificateScope = { id: "hfs_tls", ownerTeamId: "team_a", sshTargetId: host.id, purpose: "tls_certificate", status: "ready", resolvedRootPath: ROOT, lastResolvedAddress: "10.10.10.222", permissions: ["certificate_write"] };
  const profile = { id: "htp_1", ownerTeamId: "team_a", sshTargetId: host.id, certificateScopeId: certificateScope.id, type: "docker_nginx", containerName: "site-nginx", status: "ready" };
  const state = { sshTargets: [host], hostFileScopes: [publishScope, certificateScope], hostTlsActivationProfiles: [profile], siteDeploymentTargets: [{ id: "sdt_1", ownerTeamId: "team_a", kind: "ssh_static", remoteProjectRef: publishScope.id }] };
  const connector = {
    runSftp: async (_host, _credential, operation) => ({ value: await operation(sftp), resolvedAddress: "10.10.10.222" }),
    runFixedCommand: async (_host, _credential, action, params) => { actions.push({ action, params }); return { value: { ok: true }, resolvedAddress: "10.10.10.222" }; },
  };
  const adapter = createSshTlsCertificateAdapter({ state, sshHostConnector: connector, resolveCredential: async () => ({ ok: true, credential: { privateKey: "SSH KEY" } }), stagingCaPem: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----", verifyHttps });
  const binding = { id: "stb_1", ownerTeamId: "team_a", deploymentTargetId: "sdt_1", hostname: "lan.example.com", certificateScopeId: certificateScope.id, activationProfileId: profile.id };
  return { adapter, binding, sftp, actions };
}

test("uploads a staging certificate with private permissions and atomically activates it", async () => {
  const artifact = certificateFixture("lan.example.com");
  const checked = [];
  const { adapter, binding, sftp, actions } = harness({ verifyHttps: async (input) => checked.push(input) });
  binding.certificateFingerprint = artifact.fingerprint;
  const result = await adapter.deployStaging({ binding, artifact });
  assert.equal(sftp.current(), result.releasePath);
  assert.equal(sftp.nodes.get(`${result.releasePath}/privkey.pem`).mode, 0o600);
  assert.equal(sftp.nodes.get(`${result.releasePath}/fullchain.pem`).mode, 0o644);
  assert.deepEqual(actions.map((item) => item.action), ["docker_nginx_config_test", "docker_nginx_reload"]);
  assert.equal(checked[0].hostname, "lan.example.com");
  assert.equal(JSON.stringify(result).includes("PRIVATE KEY"), false);
});

test("restores the previous certificate pointer and reloads after HTTPS verification fails", async () => {
  const first = certificateFixture("lan.example.com");
  const second = certificateFixture("lan.example.com");
  let failFingerprint = null;
  const { adapter, binding, sftp, actions } = harness({ verifyHttps: async ({ fingerprint }) => {
    if (fingerprint === failFingerprint) throw Object.assign(new Error("failed"), { code: "site_tls_https_check_failed" });
  } });
  binding.certificateFingerprint = first.fingerprint;
  const active = await adapter.deployStaging({ binding, artifact: first });
  failFingerprint = second.fingerprint;
  binding.certificateFingerprint = second.fingerprint;
  await assert.rejects(adapter.deployStaging({ binding, artifact: second }));
  assert.equal(sftp.current(), active.releasePath);
  assert.equal([...sftp.nodes.keys()].some((path) => path.includes(second.fingerprint.slice(0, 32))), false);
  assert.deepEqual(actions.slice(-4).map((item) => item.action), ["docker_nginx_config_test", "docker_nginx_reload", "docker_nginx_config_test", "docker_nginx_reload"]);
});

test("restores the previous certificate when atomic switch acknowledgement is lost", async () => {
  const first = certificateFixture("lan.example.com");
  const second = certificateFixture("lan.example.com");
  const { adapter, binding, sftp, actions } = harness({ verifyHttps: async () => {} });
  binding.certificateFingerprint = first.fingerprint;
  const active = await adapter.deployStaging({ binding, artifact: first });
  binding.certificateFingerprint = second.fingerprint;
  sftp.failAfterSwitch = true;
  await assert.rejects(adapter.deployStaging({ binding, artifact: second }));
  assert.equal(sftp.current(), active.releasePath);
  assert.equal([...sftp.nodes.keys()].some((path) => path.includes(second.fingerprint.slice(0, 32))), false);
  assert.deepEqual(actions.slice(-2).map((item) => item.action), ["docker_nginx_config_test", "docker_nginx_reload"]);
});

test("cleans a promoted release when the previous release cannot be verified", async () => {
  const first = certificateFixture("lan.example.com");
  const second = certificateFixture("lan.example.com");
  const { adapter, binding, sftp } = harness({ verifyHttps: async () => {} });
  binding.certificateFingerprint = first.fingerprint;
  const active = await adapter.deployStaging({ binding, artifact: first });
  sftp.nodes.get(`${active.releasePath}/manifest.json`).data = Buffer.from("{}\n");
  binding.certificateFingerprint = second.fingerprint;
  await assert.rejects(adapter.deployStaging({ binding, artifact: second }), { code: "site_tls_previous_release_invalid" });
  assert.equal(sftp.current(), active.releasePath);
  assert.equal([...sftp.nodes.keys()].some((path) => path.includes(second.fingerprint.slice(0, 32))), false);
});

test("recovers a first switch whose failure happened before the pointer existed", async () => {
  const artifact = certificateFixture("lan.example.com");
  const { adapter, binding, sftp, actions } = harness({ verifyHttps: async () => {} });
  binding.certificateFingerprint = artifact.fingerprint;
  sftp.failBeforeSwitch = true;
  await assert.rejects(adapter.deployStaging({ binding, artifact }), { code: "site_tls_upload_result_uncertain" });
  assert.equal(sftp.nodes.has(`${ROOT}/current`), false);
  assert.equal([...sftp.nodes.keys()].some((path) => path.includes(artifact.fingerprint.slice(0, 32))), false);
  assert.deepEqual(actions, []);
});
