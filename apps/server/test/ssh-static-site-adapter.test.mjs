import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { posix } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";

import { SiteDeploymentAdapterError } from "../src/services/site-deployment-adapters.mjs";
import { createSshStaticSiteAdapter } from "../src/services/ssh-static-site-adapter.mjs";

const DIR = 0o040700;
const FILE = 0o100600;
const LINK = 0o120777;
const ROOT = "/srv/www/example";

function missing() { return Object.assign(new Error("missing"), { code: 2 }); }

function memorySftp() {
  const nodes = new Map([
    ["/srv", { type: "directory" }],
    ["/srv/www", { type: "directory" }],
    [ROOT, { type: "directory" }],
  ]);
  const node = (path) => nodes.get(posix.normalize(path));
  const resolvePath = (path) => {
    const normalized = posix.normalize(path);
    const item = node(normalized);
    if (item?.type !== "symlink") return normalized;
    return posix.resolve(posix.dirname(normalized), item.target);
  };
  const attrs = (item) => ({ mode: item.type === "directory" ? DIR : item.type === "symlink" ? LINK : FILE, size: item.data?.length ?? 0, mtime: 1_700_000_000 });
  const moveTree = (from, to) => {
    const moving = [...nodes.entries()].filter(([path]) => path === from || path.startsWith(`${from}/`));
    for (const [path] of moving) nodes.delete(path);
    for (const [path, item] of moving) nodes.set(`${to}${path.slice(from.length)}`, item);
  };
  const api = {
    nodes,
    _extensions: {},
    lstat(path, callback) { const item = node(path); item ? callback(null, attrs(item)) : callback(missing()); },
    realpath(path, callback) {
      if (posix.normalize(path) === `${ROOT}/current` && api.failCurrentRealpath) { api.failCurrentRealpath = false; callback(Object.assign(new Error("connection lost after rename"), { code: "ECONNRESET" })); return; }
      const resolved = resolvePath(path); node(resolved) ? callback(null, resolved) : callback(missing());
    },
    mkdir(path, _attrs, callback) { if (typeof _attrs === "function") callback = _attrs; nodes.set(posix.normalize(path), { type: "directory" }); callback(null); },
    open(path, flags, _mode, callback) {
      if (typeof _mode === "function") callback = _mode;
      const normalized = posix.normalize(path);
      if (flags === "wx" && node(normalized)) return callback(Object.assign(new Error("exists"), { code: 4 }));
      if (flags === "wx") nodes.set(normalized, { type: "file", data: Buffer.alloc(0) });
      if (!node(normalized)) return callback(missing());
      callback(null, normalized);
    },
    write(handle, buffer, offset, length, position, callback) {
      const item = node(handle);
      const previous = item.data ?? Buffer.alloc(0);
      const next = Buffer.alloc(Math.max(previous.length, position + length));
      previous.copy(next); buffer.copy(next, position, offset, offset + length); item.data = next; callback(null);
    },
    read(handle, buffer, offset, length, position, callback) {
      const source = node(handle)?.data ?? Buffer.alloc(0);
      const bytes = Math.min(length, Math.max(0, source.length - position));
      source.copy(buffer, offset, position, position + bytes); callback(null, bytes, buffer);
    },
    close(_handle, callback) { callback(null); },
    rename(from, to, callback) { if (!node(from)) return callback(missing()); moveTree(posix.normalize(from), posix.normalize(to)); callback(null); },
    ext_openssh_rename(from, to, callback) {
      nodes.delete(posix.normalize(to)); moveTree(posix.normalize(from), posix.normalize(to));
      if (api.failAfterNextActivation) { api.failAfterNextActivation = false; api.failCurrentRealpath = true; }
      callback(null);
    },
    symlink(target, path, callback) { nodes.set(posix.normalize(path), { type: "symlink", target }); callback(null); },
    unlink(path, callback) { const existed = nodes.delete(posix.normalize(path)); callback(existed ? null : missing()); },
    readdir(path, callback) {
      const prefix = `${posix.normalize(path)}/`;
      const names = [...nodes.keys()].filter((item) => item.startsWith(prefix) && !item.slice(prefix.length).includes("/")).map((item) => ({ filename: item.slice(prefix.length) }));
      callback(null, names);
    },
    rmdir(path, callback) { nodes.delete(posix.normalize(path)); callback(null); },
    publicBody() {
      const current = resolvePath(`${ROOT}/current`);
      return node(`${current}/index.html`)?.data ?? Buffer.alloc(0);
    },
    currentRelease() { return resolvePath(`${ROOT}/current`); },
  };
  return api;
}

function harness({ fetchImpl, httpsRequestImpl, validatePublicHost } = {}) {
  const sftp = memorySftp();
  const host = {
    id: "ssh_target_1", ownerTeamId: "team_a", name: "官网主机", host: "example.com", authMethod: "private_key_ref",
    credentialRef: "credential://ssh/ssh_target_1", purposes: ["file_transfer", "site_publish"], connectionStatus: "ready",
    capabilities: { sftp: true, posixRename: true, symlink: true },
  };
  const scope = {
    id: "hfs_1", ownerTeamId: "team_a", sshTargetId: host.id, label: "官网文件", purpose: "site_publish", status: "ready",
    resolvedRootPath: ROOT, permissions: ["list", "upload", "download"],
  };
  const state = { sshTargets: [host], hostFileScopes: [scope], sitePublications: [] };
  const target = { id: "sdt_1", siteId: "site_1", ownerTeamId: "team_a", remoteProjectRef: scope.id, customDomain: "www.example.com" };
  const adapter = createSshStaticSiteAdapter({
    state,
    sshHostConnector: { runSftp: async (_host, credential, operation) => {
      assert.equal(credential.privateKey, "PRIVATE KEY");
      return { value: await operation(sftp), resolvedAddress: "93.184.216.34" };
    } },
    resolveCredential: async (reference) => ({ ok: reference === host.credentialRef, credential: { privateKey: "PRIVATE KEY" } }),
    validatePublicHost: validatePublicHost ?? (async () => "93.184.216.34"),
    fetchImpl: fetchImpl === undefined ? async () => new Response(sftp.publicBody(), { status: 200 }) : fetchImpl,
    ...(httpsRequestImpl ? { httpsRequestImpl } : {}),
  });
  return { adapter, host, scope, sftp, state, target };
}

function bundle(homepage) {
  const files = { "index.html": homepage, "assets/site.css": "body{color:#123}" };
  return { files, hash: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}

function trackRelease(state, target, publicationId, bundleValue, remoteDeployment, status = "superseded") {
  const publication = { id: publicationId, siteId: target.siteId, ownerTeamId: target.ownerTeamId, status, bundleHash: bundleValue.hash, remoteDeployment };
  state.sitePublications.push(publication);
  return publication;
}

test("SSH static adapter verifies the managed range without persisting host secrets", async () => {
  const { adapter, sftp, state, target } = harness();
  const result = await adapter.verifyConnection({ target });
  assert.equal(result.atomicActivation, true);
  assert.equal(result.rootPath, ROOT);
  assert.equal(sftp.nodes.has(`${ROOT}/.myagenttool-site.json`), true);
  assert.equal(sftp.nodes.has(`${ROOT}/releases`), true);
  assert.equal(JSON.stringify(state).includes("PRIVATE KEY"), false);
});

test("SSH static adapter uploads, reads back, and atomically activates an immutable release", async () => {
  const { adapter, sftp, target } = harness();
  const progress = [];
  const release = await adapter.deploy({ target, bundle: bundle("<h1>version one</h1>"), publicationId: "spb_0001", previousPublication: null, onProgress: async (item) => progress.push(item.stage) });
  assert.equal(sftp.currentRelease(), `${ROOT}/releases/spb_0001`);
  assert.equal(sftp.publicBody().toString(), "<h1>version one</h1>");
  assert.equal(release.remoteReleasePath, `${ROOT}/releases/spb_0001`);
  assert.equal(release.fileCount, 2);
  assert.equal(sftp.nodes.has(`${ROOT}/releases/spb_0001/.myagenttool-release.json`), false);
  assert.equal(sftp.nodes.has(`${ROOT}/.myagenttool-receipts/spb_0001.json`), true);
  assert.deepEqual([...new Set(progress)], ["validating_target", "preparing", "uploading", "activating", "checking_public", "completed"]);
});

test("SSH static adapter restores the prior pointer when HTTPS serves stale content", async () => {
  let stale = false;
  const testHarness = harness({ fetchImpl: async () => new Response(stale ? "version one" : testHarness.sftp.publicBody(), { status: 200 }) });
  const { adapter, sftp, state, target } = testHarness;
  const firstBundle = bundle("version one");
  const first = await adapter.deploy({ target, bundle: firstBundle, publicationId: "spb_0001", previousPublication: null });
  trackRelease(state, target, "spb_0001", firstBundle, first);
  stale = true;
  await assert.rejects(
    adapter.deploy({ target, bundle: bundle("version two"), publicationId: "spb_0002", previousPublication: null }),
    (error) => error instanceof SiteDeploymentAdapterError && error.code === "site_deployment_content_mismatch",
  );
  assert.equal(sftp.currentRelease(), `${ROOT}/releases/spb_0001`);
  assert.equal(sftp.publicBody().toString(), "version one");
});

test("SSH static adapter restores the prior pointer when activation acknowledgment is lost", async () => {
  const { adapter, sftp, state, target } = harness();
  const firstBundle = bundle("version one");
  const first = await adapter.deploy({ target, bundle: firstBundle, publicationId: "spb_0001", previousPublication: null });
  trackRelease(state, target, "spb_0001", firstBundle, first);
  sftp.failAfterNextActivation = true;
  await assert.rejects(adapter.deploy({ target, bundle: bundle("version two"), publicationId: "spb_0002", previousPublication: null }));
  assert.equal(sftp.currentRelease(), `${ROOT}/releases/spb_0001`);
  assert.equal(sftp.publicBody().toString(), "version one");
});

test("SSH static adapter pins the validated public address while preserving TLS SNI and Host", async () => {
  let testHarness;
  let requested;
  const httpsRequestImpl = (options, callback) => {
    requested = options;
    const request = new EventEmitter();
    request.end = () => {
      const response = Readable.from([testHarness.sftp.publicBody()]);
      response.statusCode = 200;
      response.headers = { "content-length": String(testHarness.sftp.publicBody().length) };
      response.resume = Readable.prototype.resume.bind(response);
      callback(response);
    };
    request.destroy = (error) => request.emit("error", error);
    return request;
  };
  testHarness = harness({ fetchImpl: null, httpsRequestImpl, validatePublicHost: async () => ({ address: "93.184.216.35" }) });
  await testHarness.adapter.deploy({ target: testHarness.target, bundle: bundle("pinned public check"), publicationId: "spb_0001", previousPublication: null });
  assert.equal(requested.hostname, "93.184.216.35");
  assert.equal(requested.servername, "www.example.com");
  assert.equal(requested.headers.Host, "www.example.com");
});

test("SSH static adapter validates receipts and switches a rollback release", async () => {
  const { adapter, sftp, state, target } = harness();
  const firstBundle = bundle("version one");
  const firstRemote = await adapter.deploy({ target, bundle: firstBundle, publicationId: "spb_0001", previousPublication: null });
  const firstPublication = trackRelease(state, target, "spb_0001", firstBundle, firstRemote);
  const secondBundle = bundle("version two");
  const secondRemote = await adapter.deploy({ target, bundle: secondBundle, publicationId: "spb_0002", previousPublication: firstPublication });
  trackRelease(state, target, "spb_0002", secondBundle, secondRemote, "active");
  const restored = await adapter.rollback({ target, publication: firstPublication });
  assert.equal(restored.releaseId, "spb_0001");
  assert.equal(sftp.currentRelease(), `${ROOT}/releases/spb_0001`);
});

test("SSH static adapter rejects a range without atomic host capabilities", async () => {
  const { adapter, host, target } = harness();
  host.capabilities.posixRename = false;
  await assert.rejects(adapter.verifyConnection({ target }), (error) => error.code === "site_deployment_ssh_atomic_capability_required");
});
