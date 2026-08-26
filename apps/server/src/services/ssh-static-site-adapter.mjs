import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { posix } from "node:path";

import { resolveSshHostAddress, SshHostConnectorError } from "./ssh-host-connector.mjs";
import { SiteDeploymentAdapterError } from "./site-deployment-adapters.mjs";

const FILE_TYPE_MASK = 0o170000;
const DIRECTORY_TYPE = 0o040000;
const REGULAR_FILE_TYPE = 0o100000;
const SYMLINK_TYPE = 0o120000;
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 500 * 1024 * 1024;
const MAX_HEALTHCHECK_BYTES = 25 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const DEPLOYMENT_OPERATION_TIMEOUT_MS = 12 * 60_000;
const MARKER_NAME = ".myagenttool-site.json";
const SAFE_RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sftpCall(sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    if (typeof sftp?.[method] !== "function") return reject(new SiteDeploymentAdapterError("site_deployment_sftp_capability_missing", `Required SFTP operation is unavailable: ${method}.`));
    sftp[method](...args, (error, value) => error ? reject(error) : resolve(value));
  });
}

function sftpRead(sftp, handle, buffer, offset, length, position) {
  return new Promise((resolve, reject) => sftp.read(handle, buffer, offset, length, position, (error, bytesRead) => error ? reject(error) : resolve(Number(bytesRead ?? 0))));
}

function sftpWrite(sftp, handle, buffer, offset, length, position) {
  return new Promise((resolve, reject) => sftp.write(handle, buffer, offset, length, position, (error) => error ? reject(error) : resolve()));
}

function attrsType(attrs) {
  const mode = Number(attrs?.mode ?? 0) & FILE_TYPE_MASK;
  if (mode === DIRECTORY_TYPE) return "directory";
  if (mode === REGULAR_FILE_TYPE) return "file";
  if (mode === SYMLINK_TYPE) return "symlink";
  return "special";
}

function missing(error) {
  return error?.code === 2 || error?.code === "ENOENT" || error?.code === "NO_SUCH_FILE";
}

async function optionalLstat(sftp, path) {
  try { return await sftpCall(sftp, "lstat", path); } catch (error) { if (missing(error)) return null; throw error; }
}

function safeBundle(bundle) {
  const entries = Object.entries(bundle?.files ?? {});
  if (!entries.length || entries.length > MAX_FILES || typeof bundle.files["index.html"] !== "string") {
    throw new SiteDeploymentAdapterError("site_deployment_bundle_invalid", "The static site bundle is invalid.");
  }
  let total = 0;
  const files = entries.map(([path, body]) => {
    const parts = String(path).split("/");
    if (!path || Buffer.byteLength(path, "utf8") > 1_024 || parts.length > 32 || path.startsWith("/") || path.includes("\\") || parts.some((part) => !part || part === "." || part === ".." || /[\x00-\x1f\x7f]/.test(part))) {
      throw new SiteDeploymentAdapterError("site_deployment_bundle_path_invalid", "The static bundle contains an unsafe path.");
    }
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
    if (bytes.length > MAX_FILE_BYTES) throw new SiteDeploymentAdapterError("site_deployment_asset_too_large", `Static asset is too large: ${path}`);
    total += bytes.length;
    return { path, bytes, sha256: sha256(bytes) };
  });
  if (total > MAX_BUNDLE_BYTES) throw new SiteDeploymentAdapterError("site_deployment_bundle_too_large", "The static site bundle exceeds the SSH publishing limit.");
  return { files, total };
}

function parseManagedJson(bytes, code, message) {
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new SiteDeploymentAdapterError(code, message); }
}

function linkedContext(state, target) {
  const scope = state.hostFileScopes?.find((item) => item.id === target.remoteProjectRef && item.ownerTeamId === target.ownerTeamId) ?? null;
  const host = scope ? state.sshTargets?.find((item) => item.id === scope.sshTargetId && item.ownerTeamId === target.ownerTeamId) ?? null : null;
  if (!scope || !host) throw new SiteDeploymentAdapterError("site_deployment_ssh_scope_not_found", "The selected host file range is unavailable.");
  if (scope.purpose !== "site_publish" || scope.status !== "ready" || !scope.permissions?.includes("upload") || !scope.permissions?.includes("download")) {
    throw new SiteDeploymentAdapterError("site_deployment_ssh_scope_not_ready", "The selected range must be ready for site publishing, upload, and verification reads.");
  }
  if (host.connectionStatus !== "ready" || !host.purposes?.includes("site_publish") || !host.capabilities?.sftp) {
    throw new SiteDeploymentAdapterError("site_deployment_ssh_host_not_ready", "The selected SSH host is not ready for site publishing.");
  }
  if (!host.capabilities.posixRename || !host.capabilities.symlink) {
    throw new SiteDeploymentAdapterError("site_deployment_ssh_atomic_capability_required", "The host must support symbolic links and OpenSSH atomic rename.");
  }
  return { scope, host };
}

function trackedReleaseVerification(state, target, releasePath, hintedPublication = null) {
  if (!releasePath) return null;
  const candidates = [hintedPublication, ...(state.sitePublications ?? [])].filter(Boolean);
  const publication = candidates.find((item) => item.siteId === target.siteId
    && item.ownerTeamId === target.ownerTeamId
    && item.remoteDeployment?.provider === "ssh_static"
    && item.remoteDeployment.remoteReleasePath === releasePath
    && item.remoteDeployment.verification?.contentHash);
  return publication?.remoteDeployment?.verification ?? null;
}

async function resolveHostCredential(host, resolveCredential) {
  if (host.authMethod === "ssh_agent") {
    const agentSocket = String(process.env.SSH_AUTH_SOCK ?? "").trim();
    if (!agentSocket) throw new SiteDeploymentAdapterError("site_deployment_ssh_credential_unavailable", "The SSH agent is unavailable.");
    return { agentSocket };
  }
  const resolved = await resolveCredential(host.credentialRef);
  if (!resolved?.ok) throw new SiteDeploymentAdapterError(resolved?.error ?? "site_deployment_ssh_credential_unavailable", "The SSH credential is unavailable.");
  return resolved.credential;
}

async function ensureDirectory(sftp, path, mode = 0o700) {
  const attrs = await optionalLstat(sftp, path);
  if (attrs) {
    if (attrsType(attrs) !== "directory") throw new SiteDeploymentAdapterError("site_deployment_remote_layout_conflict", "A managed publishing directory conflicts with an existing remote item.");
    return;
  }
  await sftpCall(sftp, "mkdir", path, { mode });
}

async function readRemoteFile(sftp, path, knownAttrs = null) {
  const attrs = knownAttrs ?? await sftpCall(sftp, "lstat", path);
  if (attrsType(attrs) !== "file") throw new SiteDeploymentAdapterError("site_deployment_remote_file_invalid", "A managed release file is not a regular file.");
  const size = Number(attrs.size ?? -1);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) throw new SiteDeploymentAdapterError("site_deployment_remote_file_invalid", "A managed release file has an invalid size.");
  const output = Buffer.alloc(size);
  const handle = await sftpCall(sftp, "open", path, "r");
  try {
    let offset = 0;
    while (offset < size) {
      const count = await sftpRead(sftp, handle, output, offset, Math.min(CHUNK_BYTES, size - offset), offset);
      if (!count) throw new SiteDeploymentAdapterError("site_deployment_remote_read_incomplete", "A remote release file ended before verification completed.");
      offset += count;
    }
  } finally {
    await sftpCall(sftp, "close", handle).catch(() => {});
  }
  return output;
}

async function writeRemoteFile(sftp, path, bytes, mode = 0o600) {
  let handle = null;
  try {
    handle = await sftpCall(sftp, "open", path, "wx", mode);
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      await sftpWrite(sftp, handle, bytes, offset, Math.min(CHUNK_BYTES, bytes.length - offset), offset);
    }
    if (typeof sftp.ext_openssh_fsync === "function" && sftp?._extensions?.["fsync@openssh.com"] === "1") await sftpCall(sftp, "ext_openssh_fsync", handle);
    await sftpCall(sftp, "close", handle);
    handle = null;
  } catch (error) {
    if (handle) await sftpCall(sftp, "close", handle).catch(() => {});
    await sftpCall(sftp, "unlink", path).catch(() => {});
    throw error;
  }
}

async function verifyRoot(sftp, scope) {
  const root = scope.resolvedRootPath;
  const attrs = await sftpCall(sftp, "lstat", root);
  if (attrsType(attrs) !== "directory") throw new SiteDeploymentAdapterError("site_deployment_ssh_scope_changed", "The publishing range is no longer a real directory.");
  const resolved = posix.normalize(String(await sftpCall(sftp, "realpath", root)));
  if (resolved !== root) throw new SiteDeploymentAdapterError("site_deployment_ssh_scope_changed", "The publishing range no longer resolves to its approved path.");
  return root;
}

async function ensureManagedLayout(sftp, target, scope) {
  const root = await verifyRoot(sftp, scope);
  const markerPath = posix.join(root, MARKER_NAME);
  const releasesPath = posix.join(root, "releases");
  const receiptsPath = posix.join(root, ".myagenttool-receipts");
  const currentPath = posix.join(root, "current");
  const markerAttrs = await optionalLstat(sftp, markerPath);
  if (!markerAttrs) {
    if (await optionalLstat(sftp, releasesPath) || await optionalLstat(sftp, receiptsPath) || await optionalLstat(sftp, currentPath)) {
      throw new SiteDeploymentAdapterError("site_deployment_remote_layout_unmanaged", "The publishing range already contains an unmanaged releases layout.");
    }
    const marker = Buffer.from(JSON.stringify({ schemaVersion: 1, siteId: target.siteId, scopeId: scope.id }), "utf8");
    const temporary = `${markerPath}.${sha256(String(target.id)).slice(0, 24)}.tmp`;
    await writeRemoteFile(sftp, temporary, marker);
    await sftpCall(sftp, "rename", temporary, markerPath);
  } else {
    const marker = parseManagedJson(await readRemoteFile(sftp, markerPath, markerAttrs), "site_deployment_remote_marker_invalid", "The managed publishing marker is invalid.");
    if (marker?.schemaVersion !== 1 || marker?.siteId !== target.siteId || marker?.scopeId !== scope.id) {
      throw new SiteDeploymentAdapterError("site_deployment_remote_layout_owned_elsewhere", "The publishing range belongs to another managed site.");
    }
  }
  await ensureDirectory(sftp, releasesPath, 0o755);
  await ensureDirectory(sftp, receiptsPath, 0o700);
  const currentAttrs = await optionalLstat(sftp, currentPath);
  if (currentAttrs) {
    if (attrsType(currentAttrs) !== "symlink") throw new SiteDeploymentAdapterError("site_deployment_remote_pointer_invalid", "The managed current pointer is not a symbolic link.");
    const currentResolved = posix.normalize(String(await sftpCall(sftp, "realpath", currentPath)));
    if (posix.dirname(currentResolved) !== releasesPath || !SAFE_RELEASE_ID.test(posix.basename(currentResolved))) {
      throw new SiteDeploymentAdapterError("site_deployment_remote_pointer_escape", "The managed current pointer does not select one managed release.");
    }
  }
  return { root, releasesPath, receiptsPath, currentPath };
}

async function removeTree(sftp, path) {
  const attrs = await optionalLstat(sftp, path);
  if (!attrs) return;
  if (attrsType(attrs) !== "directory") { await sftpCall(sftp, "unlink", path); return; }
  const entries = await sftpCall(sftp, "readdir", path);
  for (const entry of entries ?? []) {
    const name = String(entry?.filename ?? "");
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) continue;
    await removeTree(sftp, posix.join(path, name));
  }
  await sftpCall(sftp, "rmdir", path);
}

async function prepareRelease(sftp, layout, bundle, publicationId, onProgress) {
  const checked = safeBundle(bundle);
  if (!SAFE_RELEASE_ID.test(String(publicationId ?? ""))) throw new SiteDeploymentAdapterError("site_deployment_release_id_invalid", "The immutable release identifier is invalid.");
  const stagingPath = posix.join(layout.releasesPath, `.staging-${publicationId}`);
  const releasePath = posix.join(layout.releasesPath, publicationId);
  if (await optionalLstat(sftp, stagingPath) || await optionalLstat(sftp, releasePath)) throw new SiteDeploymentAdapterError("site_deployment_release_conflict", "This immutable release already exists.");
  await sftpCall(sftp, "mkdir", stagingPath, { mode: 0o755 });
  const createdDirectories = new Set([stagingPath]);
  try {
    let completed = 0;
    for (const file of checked.files) {
      const segments = file.path.split("/");
      for (let index = 1; index < segments.length; index += 1) {
        const directory = posix.join(stagingPath, ...segments.slice(0, index));
        if (!createdDirectories.has(directory)) { await ensureDirectory(sftp, directory, 0o755); createdDirectories.add(directory); }
      }
      const remotePath = posix.join(stagingPath, file.path);
      await writeRemoteFile(sftp, remotePath, file.bytes, 0o644);
      const verified = await readRemoteFile(sftp, remotePath);
      if (verified.length !== file.bytes.length || sha256(verified) !== file.sha256) throw new SiteDeploymentAdapterError("site_deployment_content_mismatch", `Remote verification failed for ${file.path}.`);
      completed += 1;
      await onProgress({ stage: "uploading", completed: 1, total: 5, itemsCompleted: completed, itemsTotal: checked.files.length });
    }
    const receiptPath = posix.join(layout.receiptsPath, `${publicationId}.json`);
    const temporaryReceiptPath = `${receiptPath}.tmp`;
    const receipt = Buffer.from(JSON.stringify({ schemaVersion: 1, publicationId, bundleHash: bundle.hash, fileCount: checked.files.length, bytes: checked.total }), "utf8");
    await writeRemoteFile(sftp, temporaryReceiptPath, receipt);
    await sftpCall(sftp, "rename", temporaryReceiptPath, receiptPath);
    await sftpCall(sftp, "rename", stagingPath, releasePath);
    return { releasePath, fileCount: checked.files.length, bytes: checked.total };
  } catch (error) {
    await removeTree(sftp, stagingPath).catch(() => {});
    await sftpCall(sftp, "unlink", posix.join(layout.receiptsPath, `${publicationId}.json`)).catch(() => {});
    await sftpCall(sftp, "unlink", posix.join(layout.receiptsPath, `${publicationId}.json.tmp`)).catch(() => {});
    throw error;
  }
}

async function activateRelease(sftp, layout, releasePath, token) {
  const normalizedReleasePath = posix.normalize(String(releasePath ?? ""));
  if (posix.dirname(normalizedReleasePath) !== layout.releasesPath || !SAFE_RELEASE_ID.test(posix.basename(normalizedReleasePath))) {
    throw new SiteDeploymentAdapterError("site_deployment_release_path_invalid", "The requested release is outside the managed releases directory.");
  }
  const releaseAttrs = await sftpCall(sftp, "lstat", normalizedReleasePath);
  if (attrsType(releaseAttrs) !== "directory") throw new SiteDeploymentAdapterError("site_deployment_release_unavailable", "The requested immutable release is unavailable.");
  const temporary = posix.join(layout.root, `.current-${sha256(String(token)).slice(0, 24)}.next`);
  await sftpCall(sftp, "unlink", temporary).catch(() => {});
  await sftpCall(sftp, "symlink", posix.relative(layout.root, normalizedReleasePath), temporary);
  await sftpCall(sftp, "ext_openssh_rename", temporary, layout.currentPath);
  const resolved = posix.normalize(String(await sftpCall(sftp, "realpath", layout.currentPath)));
  if (resolved !== normalizedReleasePath) throw new SiteDeploymentAdapterError("site_deployment_activation_mismatch", "The active site pointer does not match the confirmed release.");
}

async function boundedResponseBytes(response, expectedBytes = null) {
  const limit = expectedBytes == null ? MAX_HEALTHCHECK_BYTES : Math.min(MAX_HEALTHCHECK_BYTES, expectedBytes);
  const declared = Number(response.headers?.get?.("content-length") ?? NaN);
  if (Number.isFinite(declared) && (declared > limit || (expectedBytes != null && declared !== expectedBytes))) {
    throw new SiteDeploymentAdapterError("site_deployment_content_mismatch", "The public homepage size does not match the confirmed SSH release.");
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit || (expectedBytes != null && bytes.length !== expectedBytes)) throw new SiteDeploymentAdapterError("site_deployment_content_mismatch", "The public homepage size does not match the confirmed SSH release.");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > limit) {
        await reader.cancel().catch(() => {});
        throw new SiteDeploymentAdapterError("site_deployment_content_mismatch", "The public homepage exceeds the confirmed SSH release size.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock?.(); }
  if (expectedBytes != null && received !== expectedBytes) throw new SiteDeploymentAdapterError("site_deployment_content_mismatch", "The public homepage size does not match the confirmed SSH release.");
  return Buffer.concat(chunks, received);
}

function pinnedHttpsBytes(httpsRequestImpl, address, domain, path, timeoutMs, expectedBytes) {
  return new Promise((resolve, reject) => {
    const request = httpsRequestImpl({
      hostname: address, port: 443, servername: domain, method: "GET", path,
      headers: { Host: domain, Accept: "text/html", "Cache-Control": "no-cache" },
      timeout: timeoutMs,
    }, (response) => {
      const status = Number(response.statusCode ?? 0);
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new SiteDeploymentAdapterError("site_deployment_healthcheck_failed", `Published site health check failed (${status}).`, { retryable: true }));
        return;
      }
      const limit = expectedBytes == null ? MAX_HEALTHCHECK_BYTES : Math.min(MAX_HEALTHCHECK_BYTES, expectedBytes);
      const declared = Number(response.headers["content-length"] ?? NaN);
      if (Number.isFinite(declared) && (declared > limit || (expectedBytes != null && declared !== expectedBytes))) {
        response.resume();
        reject(new SiteDeploymentAdapterError("site_deployment_content_mismatch", "The public homepage size does not match the confirmed SSH release."));
        return;
      }
      const chunks = [];
      let received = 0;
      response.on("data", (chunk) => {
        received += chunk.length;
        if (received > limit) response.destroy(new SiteDeploymentAdapterError("site_deployment_content_mismatch", "The public homepage exceeds the confirmed SSH release size."));
        else chunks.push(Buffer.from(chunk));
      });
      response.once("end", () => expectedBytes != null && received !== expectedBytes
        ? reject(new SiteDeploymentAdapterError("site_deployment_content_mismatch", "The public homepage size does not match the confirmed SSH release."))
        : resolve(Buffer.concat(chunks, received)));
      response.once("error", reject);
    });
    request.once("timeout", () => request.destroy(new SiteDeploymentAdapterError("site_deployment_healthcheck_failed", "The published site HTTPS check timed out.", { retryable: true })));
    request.once("error", reject);
    request.end();
  });
}

async function verifyPublic(fetchImpl, httpsRequestImpl, validatePublicHost, domain, expectedHash, expectedBytes, timeoutMs) {
  let resolved;
  try { resolved = await validatePublicHost(domain); } catch { throw new SiteDeploymentAdapterError("site_deployment_healthcheck_failed", "The public domain does not resolve to an allowed internet address.", { retryable: true }); }
  const url = new URL(`https://${domain}/`);
  url.searchParams.set("myagenttool_verify", Date.now().toString(36));
  let bytes;
  try {
    if (fetchImpl) {
      const response = await fetchImpl(url, { headers: { Accept: "text/html", "Cache-Control": "no-cache" }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new SiteDeploymentAdapterError("site_deployment_healthcheck_failed", `Published site health check failed (${response.status}).`, { retryable: true });
      bytes = await boundedResponseBytes(response, expectedBytes);
    } else {
      const address = typeof resolved === "string" ? resolved : resolved?.address;
      if (!address) throw new SiteDeploymentAdapterError("site_deployment_healthcheck_failed", "The public domain has no allowed address.", { retryable: true });
      bytes = await pinnedHttpsBytes(httpsRequestImpl, address, domain, `${url.pathname}${url.search}`, timeoutMs, expectedBytes);
    }
  } catch (error) {
    if (error instanceof SiteDeploymentAdapterError) throw error;
    throw new SiteDeploymentAdapterError("site_deployment_healthcheck_failed", "The published site could not be reached over HTTPS.", { retryable: true });
  }
  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash) throw new SiteDeploymentAdapterError("site_deployment_content_mismatch", "The public homepage does not match the confirmed SSH release.");
  return { checkedAt: new Date().toISOString(), contentHash: actualHash, contentBytes: bytes.length, resolvedAddress: typeof resolved === "string" ? resolved : resolved?.address };
}

function adapterError(error) {
  if (error instanceof SiteDeploymentAdapterError) return error;
  if (error instanceof SshHostConnectorError) {
    const code = error.code === "ssh_host_fingerprint_changed" ? "site_deployment_ssh_fingerprint_changed" : "site_deployment_ssh_connection_failed";
    return new SiteDeploymentAdapterError(code, "The SSH publishing connection failed.", { retryable: code !== "site_deployment_ssh_fingerprint_changed" });
  }
  return new SiteDeploymentAdapterError("site_deployment_ssh_operation_failed", "The SSH site operation did not complete.", { retryable: true });
}

export function createSshStaticSiteAdapter({
  state,
  sshHostConnector,
  resolveCredential,
  fetchImpl = null,
  httpsRequestImpl = httpsRequest,
  validatePublicHost = (domain) => resolveSshHostAddress(domain, { networkPolicy: "public_only" }),
  timeoutMs = 30_000,
} = {}) {
  if (!state || !sshHostConnector || typeof resolveCredential !== "function" || (fetchImpl && typeof fetchImpl !== "function") || typeof httpsRequestImpl !== "function") throw new TypeError("SSH static site adapter dependencies are required");

  async function withSftp(target, operation) {
    try {
      const { scope, host } = linkedContext(state, target);
      const credential = await resolveHostCredential(host, resolveCredential);
      const result = await sshHostConnector.runSftp(host, credential, (sftp) => operation(sftp, scope, host), { operationTimeoutMs: DEPLOYMENT_OPERATION_TIMEOUT_MS });
      return result.value;
    } catch (error) { throw adapterError(error); }
  }

  async function verifyConnection({ target }) {
    return withSftp(target, async (sftp, scope, host) => {
      const layout = await ensureManagedLayout(sftp, target, scope);
      const activeReleasePath = await optionalLstat(sftp, layout.currentPath) ? posix.normalize(String(await sftpCall(sftp, "realpath", layout.currentPath))) : null;
      if (activeReleasePath && !trackedReleaseVerification(state, target, activeReleasePath)) {
        throw new SiteDeploymentAdapterError("site_deployment_remote_pointer_untracked", "The active SSH release is not backed by a verified publication record.");
      }
      return {
        provider: "ssh_static", hostId: host.id, hostName: host.name, scopeId: scope.id, scopeLabel: scope.label,
        rootPath: layout.root, publicUrl: `https://${target.customDomain}/`, activeReleasePath, atomicActivation: true,
      };
    });
  }

  async function deploy({ target, bundle, publicationId, previousPublication = null, onProgress = async () => {} }) {
    safeBundle(bundle);
    await onProgress({ stage: "validating_target", completed: 0, total: 5 });
    const homepageHash = sha256(Buffer.from(bundle.files["index.html"], "utf8"));
    const deployed = await withSftp(target, async (sftp, scope) => {
      const layout = await ensureManagedLayout(sftp, target, scope);
      const currentReleasePath = await optionalLstat(sftp, layout.currentPath) ? posix.normalize(String(await sftpCall(sftp, "realpath", layout.currentPath))) : null;
      const previousVerification = trackedReleaseVerification(state, target, currentReleasePath, previousPublication);
      if (currentReleasePath && !previousVerification) throw new SiteDeploymentAdapterError("site_deployment_remote_pointer_untracked", "The active SSH release is not backed by a verified publication record.");
      await onProgress({ stage: "preparing", completed: 0, total: 5 });
      const release = await prepareRelease(sftp, layout, bundle, publicationId, onProgress);
      await onProgress({ stage: "activating", completed: 2, total: 5, itemsCompleted: release.fileCount, itemsTotal: release.fileCount });
      try {
        await activateRelease(sftp, layout, release.releasePath, publicationId);
      } catch (error) {
        await onProgress({ stage: "recovering_previous", completed: 3, total: 5, itemsCompleted: release.fileCount, itemsTotal: release.fileCount });
        try {
          if (currentReleasePath) await activateRelease(sftp, layout, currentReleasePath, `activation-undo-${publicationId}`);
          else if (await optionalLstat(sftp, layout.currentPath)) await sftpCall(sftp, "unlink", layout.currentPath);
        } catch {
          throw new SiteDeploymentAdapterError("site_deployment_recovery_failed", "The SSH release switch failed and the prior live pointer could not be restored.");
        }
        throw error;
      }
      return { ...release, layout, previousReleasePath: currentReleasePath, previousVerification };
    });
    let verification;
    try {
      await onProgress({ stage: "checking_public", completed: 4, total: 5, itemsCompleted: deployed.fileCount, itemsTotal: deployed.fileCount });
      verification = await verifyPublic(fetchImpl, httpsRequestImpl, validatePublicHost, target.customDomain, homepageHash, Buffer.byteLength(bundle.files["index.html"], "utf8"), timeoutMs);
    } catch (error) {
      await onProgress({ stage: "recovering_previous", completed: 3, total: 5, itemsCompleted: deployed.fileCount, itemsTotal: deployed.fileCount });
      try {
        await withSftp(target, async (sftp, scope) => {
          const layout = await ensureManagedLayout(sftp, target, scope);
          if (deployed.previousReleasePath) await activateRelease(sftp, layout, deployed.previousReleasePath, `rollback-${publicationId}`);
          else if (await optionalLstat(sftp, layout.currentPath)) await sftpCall(sftp, "unlink", layout.currentPath);
        });
        if (deployed.previousReleasePath && deployed.previousVerification) {
          await verifyPublic(fetchImpl, httpsRequestImpl, validatePublicHost, target.customDomain, deployed.previousVerification.contentHash, deployed.previousVerification.contentBytes ?? null, timeoutMs);
        }
      } catch {
        throw new SiteDeploymentAdapterError("site_deployment_recovery_failed", "The new SSH release failed verification and the previous live pointer could not be restored.");
      }
      throw error;
    }
    await onProgress({ stage: "completed", completed: 5, total: 5, itemsCompleted: deployed.fileCount, itemsTotal: deployed.fileCount });
    return {
      provider: "ssh_static", releaseId: publicationId, remoteReleasePath: deployed.releasePath,
      activePointerPath: deployed.layout.currentPath, previousReleasePath: deployed.previousReleasePath,
      fileCount: deployed.fileCount, bytes: deployed.bytes, bundleHash: bundle.hash,
      url: `https://${target.customDomain}/`, verification,
    };
  }

  async function rollback({ target, publication }) {
    const remote = publication?.remoteDeployment;
    if (remote?.provider !== "ssh_static" || !remote.remoteReleasePath || !remote.verification?.contentHash) {
      throw new SiteDeploymentAdapterError("site_deployment_rollback_unavailable", "The SSH release has no verified rollback receipt.");
    }
    if (!SAFE_RELEASE_ID.test(String(publication?.id ?? ""))) throw new SiteDeploymentAdapterError("site_deployment_rollback_receipt_invalid", "The rollback publication identifier is invalid.");
    let previousActive = null;
    let previousVerification = null;
    await withSftp(target, async (sftp, scope) => {
      const layout = await ensureManagedLayout(sftp, target, scope);
      previousActive = await optionalLstat(sftp, layout.currentPath) ? posix.normalize(String(await sftpCall(sftp, "realpath", layout.currentPath))) : null;
      if (!previousActive) throw new SiteDeploymentAdapterError("site_deployment_rollback_unavailable", "The currently active SSH release cannot be preserved for rollback recovery.");
      previousVerification = trackedReleaseVerification(state, target, previousActive);
      if (!previousVerification) throw new SiteDeploymentAdapterError("site_deployment_remote_pointer_untracked", "The active SSH release is not backed by a verified publication record.");
      const receiptPath = posix.join(layout.receiptsPath, `${publication.id}.json`);
      const receipt = parseManagedJson(await readRemoteFile(sftp, receiptPath), "site_deployment_rollback_receipt_invalid", "The remote rollback receipt is invalid.");
      if (receipt?.publicationId !== publication.id || receipt?.bundleHash !== publication.bundleHash) throw new SiteDeploymentAdapterError("site_deployment_rollback_receipt_mismatch", "The remote rollback release no longer matches its publication receipt.");
      try {
        await activateRelease(sftp, layout, remote.remoteReleasePath, `restore-${publication.id}`);
      } catch (error) {
        try { await activateRelease(sftp, layout, previousActive, `switch-undo-${publication.id}`); } catch {
          throw new SiteDeploymentAdapterError("site_deployment_recovery_failed", "The SSH rollback switch failed and the prior live pointer could not be restored.");
        }
        throw error;
      }
    });
    try {
      const verification = await verifyPublic(fetchImpl, httpsRequestImpl, validatePublicHost, target.customDomain, remote.verification.contentHash, remote.verification.contentBytes ?? null, timeoutMs);
      return { provider: "ssh_static", releaseId: publication.id, url: `https://${target.customDomain}/`, verification };
    } catch (error) {
      if (previousActive) {
        try {
          await withSftp(target, async (sftp, scope) => activateRelease(sftp, await ensureManagedLayout(sftp, target, scope), previousActive, `undo-${publication.id}`));
          await verifyPublic(fetchImpl, httpsRequestImpl, validatePublicHost, target.customDomain, previousVerification.contentHash, previousVerification.contentBytes ?? null, timeoutMs);
        } catch {
          throw new SiteDeploymentAdapterError("site_deployment_recovery_failed", "The rollback failed verification and the prior live pointer could not be restored.");
        }
      }
      throw error;
    }
  }

  return { verifyConnection, deploy, rollback };
}
