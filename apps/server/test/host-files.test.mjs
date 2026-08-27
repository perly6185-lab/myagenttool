import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import ssh2 from "ssh2";

import {
  createHostFileService,
  normalizeHostRelativePath,
  normalizeHostScopeRoot,
} from "../src/services/host-files.mjs";
import { createSshHostConnector, sshHostFingerprint } from "../src/services/ssh-host-connector.mjs";

const DIR = 0o040755;
const FILE = 0o100644;
const LINK = 0o120777;
const SPECIAL = 0o010644;

function fakeSftp({ realpaths = {}, modes = {} } = {}) {
  return {
    lstat(path, callback) { callback(null, { mode: modes[path] ?? DIR, size: 0, mtime: 1_700_000_000 }); },
    realpath(path, callback) { callback(null, realpaths[path] ?? path); },
    readdir(_path, callback) {
      callback(null, [
        { filename: "z.txt", attrs: { mode: FILE, size: 12, mtime: 1_700_000_000 } },
        { filename: "assets", attrs: { mode: DIR, size: 0, mtime: 1_700_000_001 } },
        { filename: "current", attrs: { mode: LINK, size: 0, mtime: 1_700_000_002 } },
        { filename: "socket", attrs: { mode: SPECIAL, size: 0, mtime: 1_700_000_003 } },
        { filename: "..", attrs: { mode: DIR } },
      ]);
    },
  };
}

function harness(sftp = fakeSftp()) {
  const state = { hostFileScopes: [], hostFileTransfers: [] };
  const events = [];
  let sequence = 0;
  const service = createHostFileService({
    state,
    now: () => "2026-08-25T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++sequence}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    resolveCredential: async () => ({ ok: true, credential: { privateKey: "PRIVATE-KEY-MATERIAL" } }),
    sshHostConnector: { runSftp: async (_target, _credential, operation) => ({ value: await operation(sftp), resolvedAddress: "93.184.216.30" }) },
  });
  const target = {
    id: "ssh_target_1", ownerTeamId: "team_a", credentialRef: "credential://ssh/ssh_target_1",
    purposes: ["file_transfer", "site_publish"], connectionStatus: "ready", capabilities: { sftp: true },
  };
  return { state, events, service, target };
}

function writableSftp(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles).map(([path, value]) => [path, Buffer.from(value)]));
  const missing = () => Object.assign(new Error("missing"), { code: 2 });
  return {
    files,
    lstat(path, callback) {
      if (files.has(path)) callback(null, { mode: FILE, size: files.get(path).length, mtime: 1_700_000_000 });
      else if (["/srv", "/srv/www", "/srv/www/site"].includes(path)) callback(null, { mode: DIR, size: 0, mtime: 1_700_000_000 });
      else callback(missing());
    },
    realpath(path, callback) { callback(null, path); },
    open(path, flags, _mode, callback) {
      if (typeof _mode === "function") callback = _mode;
      if (flags === "wx" && files.has(path)) callback(Object.assign(new Error("exists"), { code: 4 }));
      else { if (flags === "wx") files.set(path, Buffer.alloc(0)); callback(null, path); }
    },
    write(handle, buffer, offset, length, position, callback) {
      const previous = files.get(handle) ?? Buffer.alloc(0);
      const next = Buffer.alloc(Math.max(previous.length, position + length));
      previous.copy(next);
      buffer.copy(next, position, offset, offset + length);
      files.set(handle, next);
      callback(null);
    },
    read(handle, buffer, offset, length, position, callback) {
      const source = files.get(handle) ?? Buffer.alloc(0);
      const bytes = Math.min(length, Math.max(0, source.length - position));
      source.copy(buffer, offset, position, position + bytes);
      callback(null, bytes, buffer);
    },
    close(_handle, callback) { callback(null); },
    rename(from, to, callback) { files.set(to, files.get(from)); files.delete(from); callback(null); },
    unlink(path, callback) { files.delete(path); callback(null); },
  };
}

function discoverySftp() {
  const missing = () => Object.assign(new Error("missing"), { code: 2 });
  const directories = new Set(["/srv", "/srv/myagenttool-sites", "/srv/myagenttool-sites/server001-e2e", "/srv/myagenttool-sites/server001-lan-e2e"]);
  return {
    lstat(path, callback) {
      if (directories.has(path)) callback(null, { mode: DIR, size: 0, mtime: 1_700_000_000 });
      else if (path === "/srv/myagenttool-sites/server001-lan-e2e/.myagenttool-site.json") callback(null, { mode: FILE, size: 60, mtime: 1_700_000_100 });
      else if (path === "/srv/myagenttool-sites/server001-e2e/.myagenttool-site.json") callback(null, { mode: FILE, size: 60, mtime: 1_700_000_000 });
      else callback(missing());
    },
    realpath(path, callback) { callback(null, path); },
    readdir(path, callback) {
      if (path !== "/srv/myagenttool-sites") return callback(missing());
      callback(null, [
        { filename: "server001-e2e", attrs: { mode: DIR } },
        { filename: "server001-lan-e2e", attrs: { mode: DIR } },
        { filename: "current", attrs: { mode: LINK } },
        { filename: ".private", attrs: { mode: DIR } },
      ]);
    },
  };
}

test("normalizes dedicated roots and rejects unsafe relative paths", () => {
  assert.equal(normalizeHostScopeRoot("/srv/www/example"), "/srv/www/example");
  assert.equal(normalizeHostRelativePath("assets/images"), "assets/images");
  assert.equal(normalizeHostRelativePath(""), "");
  for (const root of ["/", "/etc/site", "/home/deploy", "/home/deploy/.ssh/site", "relative/path", "/srv/../etc"]) {
    assert.throws(() => normalizeHostScopeRoot(root));
  }
  for (const path of ["/etc", "../secret", "assets//images", "C:/secret", "assets\\images", "./assets"]) {
    assert.throws(() => normalizeHostRelativePath(path));
  }
});

test("creates a list-only scope after checking every root directory component", async () => {
  const { state, events, service, target } = harness();
  const result = await service.createScope(target, { label: "Website files", purpose: "site_publish", rootPath: "/srv/www/example" }, { userId: "usr_a" });
  assert.equal(result.ok, true);
  assert.equal(result.scope.resolvedRootPath, "/srv/www/example");
  assert.deepEqual(result.scope.permissions, ["list"]);
  assert.equal(result.scope.status, "ready");
  assert.equal(result.scope.revision, 1);
  assert.equal(JSON.stringify(state).includes("PRIVATE-KEY-MATERIAL"), false);
  assert.equal(JSON.stringify(events).includes("PRIVATE-KEY-MATERIAL"), false);
});

test("discovers only verified dedicated content directories and recommends managed sites", async () => {
  const { service, target } = harness(discoverySftp());
  const result = await service.suggestScopes(target);
  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.deepEqual(result.suggestions, [
    {
      rootPath: "/srv/myagenttool-sites/server001-lan-e2e",
      label: "server001 lan e2e",
      purpose: "site_publish",
      reason: "managed_site",
      recommended: true,
    },
    {
      rootPath: "/srv/myagenttool-sites/server001-e2e",
      label: "server001 e2e",
      purpose: "site_publish",
      reason: "managed_site",
      recommended: false,
    },
  ]);
});

test("isolates certificate ranges from file scopes and all browser file operations", async () => {
  const { service, target } = harness();
  const publishing = await service.createScope(target, { purpose: "site_publish", rootPath: "/srv/www/example" });
  assert.equal(publishing.ok, true);
  const overlapping = await service.createScope(target, { purpose: "tls_certificate", rootPath: "/srv/www/example/tls" });
  assert.equal(overlapping.error, "host_tls_scope_overlaps_file_scope");
  const certificate = await service.createScope(target, { purpose: "tls_certificate", rootPath: "/srv/tls/example" });
  assert.equal(certificate.ok, true);
  assert.deepEqual(certificate.scope.permissions, ["certificate_write"]);
  assert.equal((await service.listEntries(target, certificate.scope, "")).error, "host_tls_scope_browsing_forbidden");
  assert.equal((await service.uploadFile(target, certificate.scope, Buffer.from("secret"), { confirmed: true, filename: "privkey.pem" })).error, "host_tls_scope_transfer_forbidden");
  assert.equal((await service.downloadFile(target, certificate.scope, { confirmed: true, path: "privkey.pem" })).error, "host_tls_scope_transfer_forbidden");
});

test("lists bounded metadata while keeping links and special files inaccessible", async () => {
  const { service, target } = harness();
  const created = await service.createScope(target, { rootPath: "/srv/www/example" });
  const result = await service.listEntries(target, created.scope, "");
  assert.equal(result.ok, true);
  assert.deepEqual(result.entries.map((entry) => [entry.name, entry.type, entry.accessible]), [
    ["assets", "directory", true],
    ["current", "symlink", false],
    ["socket", "special", false],
    ["z.txt", "file", true],
  ]);
  assert.equal(result.entries.find((entry) => entry.name === "z.txt").size, 12);
});

test("blocks symbolic-link traversal and realpath escape on every browse", async () => {
  const linked = harness(fakeSftp({ modes: { "/srv/www/example/link": LINK } }));
  const linkedScope = (await linked.service.createScope(linked.target, { rootPath: "/srv/www/example" })).scope;
  const linkedResult = await linked.service.listEntries(linked.target, linkedScope, "link");
  assert.equal(linkedResult.ok, false);
  assert.equal(linkedResult.error, "host_file_symlink_forbidden");

  const escaped = harness(fakeSftp({ realpaths: { "/srv/www/example/assets": "/etc" } }));
  const escapedScope = (await escaped.service.createScope(escaped.target, { rootPath: "/srv/www/example" })).scope;
  const escapedResult = await escaped.service.listEntries(escaped.target, escapedScope, "assets");
  assert.equal(escapedResult.ok, false);
  assert.equal(escapedResult.error, "host_file_scope_escape_blocked");
});

test("updates scopes with optimistic revision and re-verifies changed roots", async () => {
  const { service, target } = harness();
  const scope = (await service.createScope(target, { rootPath: "/srv/www/example" })).scope;
  const stale = await service.updateScope(target, scope, { expectedRevision: 0, label: "Stale" });
  assert.deepEqual(stale, { ok: false, status: 409, error: "host_file_scope_revision_conflict", currentRevision: 1 });
  const updated = await service.updateScope(target, scope, { expectedRevision: 1, rootPath: "/srv/www/next", label: "Next" });
  assert.equal(updated.ok, true);
  assert.equal(scope.rootPath, "/srv/www/next");
  assert.equal(scope.label, "Next");
  assert.equal(scope.revision, 2);
});

test("uploads and downloads only after confirmation and records content-free transfer audit", async () => {
  const sftp = writableSftp({ "/srv/www/site/readme.txt": "remote-content" });
  const { state, events, service, target } = harness(sftp);
  const scope = (await service.createScope(target, { rootPath: "/srv/www/site", permissions: ["list", "upload", "download"] })).scope;

  const unconfirmed = await service.uploadFile(target, scope, Buffer.from("local-content"), { filename: "new.txt", confirmed: false });
  assert.equal(unconfirmed.error, "host_file_transfer_confirmation_required");
  assert.equal(state.hostFileTransfers.length, 0);

  const uploaded = await service.uploadFile(target, scope, Buffer.from("local-content"), { filename: "new.txt", directory: "", conflictPolicy: "rename", confirmed: true }, { userId: "usr_a" });
  assert.equal(uploaded.ok, true, JSON.stringify(uploaded));
  assert.equal(sftp.files.get("/srv/www/site/new.txt").toString(), "local-content");
  assert.equal(uploaded.task.progress, 100);
  assert.match(uploaded.task.sha256, /^[a-f0-9]{64}$/);

  const downloaded = await service.downloadFile(target, scope, { path: "readme.txt", confirmed: true }, { userId: "usr_a" });
  assert.equal(downloaded.ok, true, JSON.stringify(downloaded));
  assert.equal(downloaded.bytes.toString(), "remote-content");
  assert.match(downloaded.task.sha256, /^[a-f0-9]{64}$/);
  assert.equal(service.listTransfers(target).length, 2);
  assert.equal(JSON.stringify(state).includes("local-content"), false);
  assert.equal(JSON.stringify(events).includes("remote-content"), false);
});

test("converges a transfer left running after restart to an unconfirmed result", () => {
  const { state, events, service, target } = harness();
  state.hostFileTransfers.push({
    id: "hft_interrupted", ownerTeamId: "team_a", sshTargetId: target.id, scopeId: "hfs_1", direction: "upload", status: "running",
    remotePath: "report.txt", remoteDirectory: "", fileName: "report.txt", bytesTotal: 100, bytesTransferred: 50, progress: 50,
    conflictPolicy: "rename", attempt: 1, maxAttempts: 3, retryOf: null, errorCode: null,
    createdAt: "2026-08-24T23:50:00.000Z", startedAt: "2026-08-24T23:50:00.000Z", updatedAt: "2026-08-24T23:54:59.000Z", completedAt: null,
  });
  state.hostFileTransfers.push({
    id: "hft_active", ownerTeamId: "team_a", sshTargetId: target.id, scopeId: "hfs_1", direction: "download", status: "running",
    remotePath: "active.txt", remoteDirectory: "", fileName: "active.txt", bytesTotal: 100, bytesTransferred: 75, progress: 75,
    conflictPolicy: null, attempt: 1, maxAttempts: 3, retryOf: null, errorCode: null,
    createdAt: "2026-08-24T23:50:00.000Z", startedAt: "2026-08-24T23:50:00.000Z", updatedAt: "2026-08-24T23:55:01.000Z", completedAt: null,
  });

  const transfers = service.listTransfers(target);
  const transfer = transfers.find((item) => item.id === "hft_interrupted");
  const active = transfers.find((item) => item.id === "hft_active");
  assert.equal(transfer.status, "failed");
  assert.equal(transfer.errorCode, "host_file_transfer_interrupted");
  assert.equal(transfer.completedAt, "2026-08-25T00:00:00.000Z");
  assert.equal(active.status, "running");
  assert.equal(active.errorCode, null);
  assert.equal(events.at(-1).type, "ssh.host_file_transfer.interrupted");
  assert.equal(JSON.stringify(events).includes("report.txt"), false);
});

test("stops an upload before writing when OpenSSH reports insufficient capacity", async () => {
  const sftp = writableSftp();
  sftp.ext_openssh_statvfs = (_path, callback) => callback(null, { f_frsize: 4096, f_bavail: 0 });
  const { service, target } = harness(sftp);
  const scope = (await service.createScope(target, { rootPath: "/srv/www/site", permissions: ["list", "upload"] })).scope;

  const result = await service.uploadFile(target, scope, Buffer.from("content"), { filename: "report.txt", conflictPolicy: "rename", confirmed: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, "ssh_sftp_no_space");
  assert.equal(result.status, 507);
  assert.equal(result.task.status, "failed");
  assert.equal(sftp.files.has("/srv/www/site/report.txt"), false);
});

test("applies upload conflict policy and blocks sensitive browser downloads", async () => {
  const sftp = writableSftp({ "/srv/www/site/report.txt": "old", "/srv/www/site/.env": "SECRET=value" });
  const { state, service, target } = harness(sftp);
  const scope = (await service.createScope(target, { rootPath: "/srv/www/site", permissions: ["list", "upload", "download"] })).scope;
  const denied = await service.uploadFile(target, scope, Buffer.from("new"), { filename: "report.txt", conflictPolicy: "deny", confirmed: true });
  assert.equal(denied.error, "host_file_conflict");
  assert.equal(sftp.files.get("/srv/www/site/report.txt").toString(), "old");
  const renamed = await service.uploadFile(target, scope, Buffer.from("new"), { filename: "report.txt", conflictPolicy: "rename", confirmed: true, retryOf: denied.task.id });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.task.fileName, "report (1).txt");
  assert.equal(renamed.task.attempt, 2);
  const blocked = await service.downloadFile(target, scope, { path: ".env", confirmed: true });
  assert.equal(blocked.error, "host_file_download_sensitive_blocked");
  assert.equal(blocked.task.status, "failed");
  assert.equal(state.hostFileTransfers.length, 3);
});

test("creates and browses a scope through an isolated real SSH/SFTP server", async (t) => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const parsedKey = ssh2.utils.parseKey(privateKey);
  assert.equal(parsedKey instanceof Error, false);
  const fingerprint = sshHostFingerprint(parsedKey.getPublicSSH());
  const remoteFiles = new Map([["/srv/www/site/index.html", Buffer.from("<h1>isolated</h1>")]]);
  const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (context) => {
      if (context.method === "password" && context.username === "deploy" && context.password === "test-password") context.accept();
      else context.reject();
    });
    client.on("ready", () => client.on("session", (acceptSession) => {
      const session = acceptSession();
      session.on("sftp", (acceptSftp) => {
        const sftp = acceptSftp();
        let directoryRead = false;
        let handleCounter = 1;
        const handles = new Map();
        const attrs = { mode: DIR, uid: 1000, gid: 1000, size: 0, atime: 1_700_000_000, mtime: 1_700_000_000 };
        sftp.on("LSTAT", (reqid, path) => {
          const content = remoteFiles.get(path);
          if (content) sftp.attrs(reqid, { ...attrs, mode: FILE, size: content.length });
          else if (["/srv", "/srv/www", "/srv/www/site"].includes(path)) sftp.attrs(reqid, attrs);
          else sftp.status(reqid, 2);
        });
        sftp.on("REALPATH", (reqid, path) => sftp.name(reqid, [{ filename: path, longname: path, attrs }]));
        sftp.on("OPENDIR", (reqid) => { const handle = Buffer.from([0, 0, 0, handleCounter++]); handles.set(handle.toString("hex"), { directory: true }); sftp.handle(reqid, handle); });
        sftp.on("READDIR", (reqid) => {
          if (directoryRead) sftp.status(reqid, 1);
          else {
            directoryRead = true;
            sftp.name(reqid, [
              { filename: "assets", longname: "drwxr-xr-x assets", attrs },
              { filename: "index.html", longname: "-rw-r--r-- index.html", attrs: { ...attrs, mode: FILE, size: remoteFiles.get("/srv/www/site/index.html").length } },
            ]);
          }
        });
        sftp.on("OPEN", (reqid, path) => {
          if (!remoteFiles.has(path)) remoteFiles.set(path, Buffer.alloc(0));
          const handle = Buffer.from([0, 0, 0, handleCounter++]);
          handles.set(handle.toString("hex"), { path });
          sftp.handle(reqid, handle);
        });
        sftp.on("WRITE", (reqid, handle, offset, data) => {
          const path = handles.get(handle.toString("hex"))?.path;
          if (!path) return sftp.status(reqid, 2);
          const previous = remoteFiles.get(path) ?? Buffer.alloc(0);
          const next = Buffer.alloc(Math.max(previous.length, Number(offset) + data.length));
          previous.copy(next);
          data.copy(next, Number(offset));
          remoteFiles.set(path, next);
          sftp.status(reqid, 0);
        });
        sftp.on("READ", (reqid, handle, offset, length) => {
          const path = handles.get(handle.toString("hex"))?.path;
          const content = path ? remoteFiles.get(path) : null;
          if (!content) return sftp.status(reqid, 2);
          const chunk = content.subarray(Number(offset), Number(offset) + length);
          if (!chunk.length) sftp.status(reqid, 1);
          else sftp.data(reqid, chunk);
        });
        sftp.on("RENAME", (reqid, from, to) => { remoteFiles.set(to, remoteFiles.get(from)); remoteFiles.delete(from); sftp.status(reqid, 0); });
        sftp.on("REMOVE", (reqid, path) => { remoteFiles.delete(path); sftp.status(reqid, 0); });
        sftp.on("CLOSE", (reqid, handle) => { handles.delete(handle.toString("hex")); sftp.status(reqid, 0); });
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
  const state = { hostFileScopes: [], hostFileTransfers: [] };
  const service = createHostFileService({
    state,
    now: () => "2026-08-25T00:00:00.000Z",
    nextId: () => "hfs_real",
    appendEvent: () => {},
    persistStateSoon: () => {},
    resolveCredential: async () => ({ ok: true, credential: { password: "test-password" } }),
    sshHostConnector: connector,
  });
  const target = {
    id: "ssh_target_real", ownerTeamId: "team_a", host: "isolated.invalid", port: server.address().port, user: "deploy",
    authMethod: "password_ref", credentialRef: "credential://ssh/ssh_target_real", networkPolicy: "public_only",
    knownHostFingerprint: fingerprint, trustStatus: "pinned", purposes: ["file_transfer"], connectionStatus: "ready", capabilities: { sftp: true },
  };

  const created = await service.createScope(target, { rootPath: "/srv/www/site", purpose: "general_files", permissions: ["list", "upload", "download"] });
  assert.equal(created.ok, true);
  const listed = await service.listEntries(target, created.scope, "");
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.entries.map((entry) => [entry.name, entry.type, entry.size]), [
    ["assets", "directory", null],
    ["index.html", "file", 17],
  ]);
  const uploaded = await service.uploadFile(target, created.scope, Buffer.from("real-sftp-upload"), { filename: "notes.txt", conflictPolicy: "deny", confirmed: true });
  assert.equal(uploaded.ok, true, JSON.stringify(uploaded));
  assert.equal(remoteFiles.get("/srv/www/site/notes.txt").toString(), "real-sftp-upload");
  const downloaded = await service.downloadFile(target, created.scope, { path: "index.html", confirmed: true });
  assert.equal(downloaded.ok, true, JSON.stringify(downloaded));
  assert.equal(downloaded.bytes.toString(), "<h1>isolated</h1>");
});
