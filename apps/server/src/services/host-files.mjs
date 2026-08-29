import { posix } from "node:path";
import { createHash } from "node:crypto";

import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { SshHostConnectorError } from "./ssh-host-connector.mjs";

const FILE_TYPE_MASK = 0o170000;
const DIRECTORY_TYPE = 0o040000;
const REGULAR_FILE_TYPE = 0o100000;
const SYMLINK_TYPE = 0o120000;
const MAX_ENTRIES = 200;
const MAX_DEPTH = 12;
export const MAX_HOST_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_HOST_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const TRANSFER_CHUNK_BYTES = 64 * 1024;
const MAX_TRANSFER_ATTEMPTS = 3;
const STALE_TRANSFER_MS = 5 * 60_000;
const FORBIDDEN_ROOTS = ["/", "/boot", "/dev", "/etc", "/proc", "/root", "/run", "/sys"];
const DISCOVERY_PARENTS = ["/srv/myagenttool-sites", "/srv/www", "/var/www", "/opt/myagenttool/sites"];
const MAX_SCOPE_SUGGESTIONS = 12;
const BLOCKED_DOWNLOAD_NAMES = new Set([".env", ".npmrc", ".pypirc", "authorized_keys", "known_hosts"]);
const BLOCKED_DOWNLOAD_EXTENSIONS = new Set([".key", ".pem", ".p12", ".pfx", ".kdbx"]);
const MAX_SEARCH_DEPTH = 5;
const MAX_SEARCH_ENTRIES = 500;
const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCH_TEXT_FILES = 40;
const MAX_SEARCH_FILE_BYTES = 128 * 1024;
const MAX_SEARCH_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 512 * 1024;
const MAX_BINARY_PREVIEW_BYTES = 8 * 1024 * 1024;
const SEARCHABLE_TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".yaml", ".yml", ".log", ".conf", ".ini", ".csv", ".xml", ".html", ".css", ".js", ".ts", ".sh"]);
const IMAGE_PREVIEW_TYPES = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".gif", "image/gif"],
  [".webp", "image/webp"], [".bmp", "image/bmp"], [".avif", "image/avif"],
]);

export class HostFileScopeError extends SshHostConnectorError {
  constructor(code, message, status = 400) {
    super(code, message);
    this.name = "HostFileScopeError";
    this.status = status;
  }
}

export function normalizeHostScopeRoot(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 1024 || raw.includes("\0") || /[\x00-\x1f\x7f]/.test(raw) || raw.includes("\\") || !raw.startsWith("/")) {
    throw new HostFileScopeError("host_file_scope_root_invalid", "The file range root must be an absolute POSIX path.");
  }
  const normalized = posix.normalize(raw);
  if (normalized !== raw.replace(/\/+$/, "") && !(raw === "/" && normalized === "/")) {
    throw new HostFileScopeError("host_file_scope_root_invalid", "The file range root must not contain redundant or parent path segments.");
  }
  const parts = normalized.split("/").filter(Boolean);
  const forbidden = FORBIDDEN_ROOTS.some((root) => normalized === root || (root !== "/" && normalized.startsWith(`${root}/`)))
    || (parts[0] === "home" && parts.length <= 2)
    || (parts[0] === "Users" && parts.length <= 2)
    || parts.includes(".ssh");
  if (forbidden) throw new HostFileScopeError("host_file_scope_root_forbidden", "Choose a dedicated content directory instead of a system or home directory.");
  return normalized;
}

export function normalizeHostRelativePath(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length > 1024 || raw.includes("\0") || /[\x00-\x1f\x7f]/.test(raw) || raw.includes("\\") || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
    throw new HostFileScopeError("host_file_path_invalid", "The remote file path must be relative to its file range.");
  }
  const parts = raw.split("/");
  if (parts.length > MAX_DEPTH || parts.some((part) => !part || part === "." || part === "..")) {
    throw new HostFileScopeError("host_file_path_invalid", "The remote file path contains an invalid or overly deep segment.");
  }
  return parts.join("/");
}

function sftpCall(sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    if (typeof sftp?.[method] !== "function") {
      reject(new HostFileScopeError("ssh_sftp_operation_unsupported", `SFTP ${method} is unavailable.`, 409));
      return;
    }
    sftp[method](...args, (error, value) => error ? reject(error) : resolve(value));
  });
}

function sftpRead(sftp, handle, buffer, offset, length, position) {
  return new Promise((resolve, reject) => {
    sftp.read(handle, buffer, offset, length, position, (error, bytesRead) => error ? reject(error) : resolve(Number(bytesRead ?? 0)));
  });
}

function sftpWrite(sftp, handle, buffer, offset, length, position) {
  return new Promise((resolve, reject) => {
    sftp.write(handle, buffer, offset, length, position, (error) => error ? reject(error) : resolve());
  });
}

async function ensureUploadCapacity(sftp, directory, requiredBytes) {
  if (typeof sftp?.ext_openssh_statvfs !== "function") return;
  let stats;
  try {
    stats = await sftpCall(sftp, "ext_openssh_statvfs", directory);
  } catch {
    // Capacity discovery is optional. The bounded SFTP write still owns the final result.
    return;
  }
  const blockSize = Number(stats?.f_frsize ?? stats?.f_bsize);
  const availableBlocks = Number(stats?.f_bavail);
  const availableBytes = blockSize * availableBlocks;
  if (Number.isFinite(availableBytes) && availableBytes >= 0 && availableBytes < requiredBytes) {
    throw new HostFileScopeError("ssh_sftp_no_space", "The remote device does not have enough available storage.", 507);
  }
}

function attrsType(attrs) {
  const mode = Number(attrs?.mode ?? 0) & FILE_TYPE_MASK;
  if (mode === DIRECTORY_TYPE) return "directory";
  if (mode === REGULAR_FILE_TYPE) return "file";
  if (mode === SYMLINK_TYPE) return "symlink";
  return "special";
}

function pathWithinRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function scopePurpose(value) {
  const purpose = String(value ?? "general_files");
  if (!["general_files", "site_publish", "backup", "tls_certificate"].includes(purpose)) throw new HostFileScopeError("host_file_scope_purpose_invalid", "The file range purpose is invalid.");
  return purpose;
}

function targetAllowsPurpose(target, purpose) {
  const required = purpose === "site_publish" ? "site_publish" : purpose === "tls_certificate" ? "tls_certificate" : "file_transfer";
  return Array.isArray(target?.purposes) && (target.purposes.includes(required) || (purpose === "tls_certificate" && target.purposes.includes("site_publish")));
}

function rootsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function assertCertificateScopeIsolation(state, target, purpose, rootPath, currentScopeId = null) {
  const conflict = state.hostFileScopes.some((scope) => scope.id !== currentScopeId
    && scope.sshTargetId === target.id
    && (purpose === "tls_certificate" || scope.purpose === "tls_certificate")
    && rootsOverlap(rootPath, scope.resolvedRootPath ?? scope.rootPath));
  if (conflict) throw new HostFileScopeError("host_tls_scope_overlaps_file_scope", "The certificate range must not overlap another managed file range.", 409);
}

function normalizeScopePermissions(value, fallback = ["list"]) {
  const requested = Array.isArray(value) ? value.map(String) : fallback;
  const allowed = ["list", "upload", "download"].filter((permission) => requested.includes(permission));
  if (!allowed.includes("list")) allowed.unshift("list");
  return allowed;
}

function scopeAllows(scope, permission) {
  return Array.isArray(scope?.permissions) && scope.permissions.includes(permission);
}

function normalizeTransferFilename(value) {
  const name = String(value ?? "").trim();
  if (!name || name.length > 255 || name === "." || name === ".." || name.includes("/") || name.includes("\\") || /[\x00-\x1f\x7f]/.test(name)) {
    throw new HostFileScopeError("host_file_name_invalid", "Choose a valid single file name.");
  }
  return name;
}

function transferPolicy(value) {
  const policy = String(value ?? "deny");
  if (!["deny", "rename", "replace"].includes(policy)) throw new HostFileScopeError("host_file_conflict_policy_invalid", "The file conflict policy is invalid.");
  return policy;
}

function missingRemoteFile(error) {
  return error?.code === 2 || error?.code === "ENOENT" || error?.code === "NO_SUCH_FILE";
}

async function optionalLstat(sftp, path) {
  try {
    return await sftpCall(sftp, "lstat", path);
  } catch (error) {
    if (missingRemoteFile(error)) return null;
    throw error;
  }
}

function ensureRegularRemoteFile(attrs) {
  const type = attrsType(attrs);
  if (type === "symlink") throw new HostFileScopeError("host_file_symlink_forbidden", "Symbolic links cannot be transferred.", 409);
  if (type !== "file") throw new HostFileScopeError("host_file_not_regular", "Only regular files can be transferred.", 409);
}

function isBlockedDownloadName(name) {
  const lower = name.toLowerCase();
  return BLOCKED_DOWNLOAD_NAMES.has(lower)
    || BLOCKED_DOWNLOAD_EXTENSIONS.has(posix.extname(lower))
    || lower.startsWith(".env.")
    || /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|credentials?|secrets?)(?:\..+)?$/.test(lower);
}

function isSensitiveRelativePath(relativePath) {
  const parts = String(relativePath ?? "").split("/").filter(Boolean);
  return parts.slice(0, -1).some((part) => part.startsWith(".")) || isBlockedDownloadName(parts.at(-1) ?? "");
}

export function normalizeHostFileSearchQuery(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 200 || raw.includes("\0") || /[\x00-\x1f\x7f]/.test(raw)) {
    throw new HostFileScopeError("host_file_search_query_invalid", "Enter a short file name or content keyword.");
  }
  const quoted = [...raw.matchAll(/["“”'‘’]([^"“”'‘’]{2,80})["“”'‘’]/g)].map((match) => match[1]);
  const cleaned = raw
    .toLocaleLowerCase()
    .replace(/["“”'‘’]/g, " ")
    .replace(/帮我|请|查找|搜索|寻找|找一下|找出|找到|找|看看|看下|哪个文件|哪些文件|文件名|文件|内容|里面|其中|提到|包含|关于|有关|名为|叫做|是否|的/g, " ")
    .replace(/\b(?:please|find|search|look|show|file|files|named|called|containing|contains|content|about|for|the|a|an|me)\b/gi, " ");
  const terms = [...quoted, ...cleaned.split(/[\s,，。；;:：!?！？()[\]{}]+/)]
    .map((term) => term.trim().toLocaleLowerCase())
    .filter((term) => term.length >= 2)
    .filter((term, index, items) => items.indexOf(term) === index)
    .slice(0, 6);
  if (!terms.length) throw new HostFileScopeError("host_file_search_query_invalid", "Enter a file name or content keyword.");
  return { terms };
}

function previewDescriptor(name) {
  const extension = posix.extname(String(name ?? "").toLocaleLowerCase());
  if (SEARCHABLE_TEXT_EXTENSIONS.has(extension) || extension === ".svg") return { kind: "text", contentType: "text/plain; charset=utf-8", maxBytes: MAX_TEXT_PREVIEW_BYTES };
  if (IMAGE_PREVIEW_TYPES.has(extension)) return { kind: "image", contentType: IMAGE_PREVIEW_TYPES.get(extension), maxBytes: MAX_BINARY_PREVIEW_BYTES };
  if (extension === ".pdf") return { kind: "pdf", contentType: "application/pdf", maxBytes: MAX_BINARY_PREVIEW_BYTES };
  return null;
}

function looksLikeText(bytes) {
  if (bytes.includes(0)) return false;
  const decoded = bytes.toString("utf8");
  const replacements = [...decoded].filter((character) => character === "�").length;
  return replacements <= Math.max(1, Math.floor(decoded.length * 0.01));
}

function previewSignatureValid(kind, contentType, bytes) {
  if (kind === "text") return looksLikeText(bytes);
  if (kind === "pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (contentType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (contentType === "image/gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  if (contentType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (contentType === "image/bmp") return bytes.subarray(0, 2).toString("ascii") === "BM";
  if (contentType === "image/avif") return bytes.subarray(4, 8).toString("ascii") === "ftyp" && bytes.subarray(8, 16).toString("ascii").includes("avif");
  return false;
}

async function readBoundedRemoteFile(sftp, root, relativePath, maxBytes) {
  const normalizedPath = normalizeHostRelativePath(relativePath);
  if (!normalizedPath) throw new HostFileScopeError("host_file_path_invalid", "Choose a remote file.");
  const fileName = normalizeTransferFilename(posix.basename(normalizedPath));
  const remoteDirectory = normalizedPath.includes("/") ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/")) : "";
  const directory = await inspectBrowseDirectory(sftp, root, remoteDirectory);
  const absolutePath = posix.join(directory, fileName);
  const attrs = await sftpCall(sftp, "lstat", absolutePath);
  ensureRegularRemoteFile(attrs);
  const size = Number(attrs?.size ?? -1);
  if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) throw new HostFileScopeError("host_file_preview_size_invalid", "The remote file exceeds the safe preview limit.", 413);
  const resolved = posix.normalize(String(await sftpCall(sftp, "realpath", absolutePath)));
  if (resolved !== absolutePath || !pathWithinRoot(root, resolved)) throw new HostFileScopeError("host_file_scope_escape_blocked", "The remote file moved outside its approved range.", 409);
  const bytes = Buffer.alloc(size);
  const handle = await sftpCall(sftp, "open", absolutePath, "r");
  try {
    let offset = 0;
    while (offset < size) {
      const length = Math.min(TRANSFER_CHUNK_BYTES, size - offset);
      const bytesRead = await sftpRead(sftp, handle, bytes, offset, length, offset);
      if (!bytesRead) throw new HostFileScopeError("host_file_preview_incomplete", "The remote file changed before preview completed.", 502);
      offset += bytesRead;
    }
  } finally {
    await sftpCall(sftp, "close", handle).catch(() => {});
  }
  const after = posix.normalize(String(await sftpCall(sftp, "realpath", absolutePath)));
  const afterAttrs = await sftpCall(sftp, "lstat", absolutePath);
  ensureRegularRemoteFile(afterAttrs);
  if (after !== absolutePath || !pathWithinRoot(root, after) || Number(afterAttrs?.size ?? -1) !== size) {
    throw new HostFileScopeError("host_file_preview_changed", "The remote file changed while it was being read.", 409);
  }
  return { bytes, size };
}

async function availableRenamePath(sftp, directory, filename) {
  const extension = posix.extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  for (let index = 1; index <= 100; index += 1) {
    const candidateName = `${stem} (${index})${extension}`;
    const candidatePath = posix.join(directory, candidateName);
    if (!await optionalLstat(sftp, candidatePath)) return { name: candidateName, path: candidatePath };
  }
  throw new HostFileScopeError("host_file_conflict_unresolved", "No safe alternate file name is available.", 409);
}

function transferFailure(error) {
  if (error instanceof HostFileScopeError) return { status: error.status, error: error.code };
  if (error instanceof SshHostConnectorError) return { status: error.code === "ssh_host_fingerprint_changed" ? 409 : 502, error: error.code };
  return { status: 502, error: "host_file_transfer_failed" };
}

async function inspectRoot(sftp, requestedRoot) {
  const components = requestedRoot.split("/").filter(Boolean);
  let current = "";
  for (const component of components) {
    current += `/${component}`;
    const attrs = await sftpCall(sftp, "lstat", current);
    if (attrsType(attrs) === "symlink") throw new HostFileScopeError("host_file_scope_symlink_forbidden", "A file range root cannot pass through a symbolic link.", 409);
    if (attrsType(attrs) !== "directory") throw new HostFileScopeError("host_file_scope_not_directory", "The file range root must be an existing directory.", 409);
  }
  const resolved = normalizeHostScopeRoot(await sftpCall(sftp, "realpath", requestedRoot));
  if (resolved !== requestedRoot) throw new HostFileScopeError("host_file_scope_path_changed", "The remote directory resolves to a different path and cannot be trusted.", 409);
  return resolved;
}

function safeDiscoveryName(value) {
  const name = String(value ?? "");
  return Boolean(name)
    && name.length <= 255
    && name !== "."
    && name !== ".."
    && !name.startsWith(".")
    && !name.includes("/")
    && !name.includes("\\")
    && !/[\x00-\x1f\x7f]/.test(name);
}

async function discoverScopeRoots(sftp, target) {
  const suggestions = [];
  for (const parent of DISCOVERY_PARENTS) {
    if (suggestions.length >= MAX_SCOPE_SUGGESTIONS) break;
    try {
      const parentAttrs = await optionalLstat(sftp, parent);
      if (!parentAttrs || attrsType(parentAttrs) !== "directory") continue;
      if (String(await sftpCall(sftp, "realpath", parent)) !== parent) continue;
      const rows = await sftpCall(sftp, "readdir", parent);
      if (!Array.isArray(rows)) continue;
      for (const row of rows.slice(0, MAX_ENTRIES)) {
        if (suggestions.length >= MAX_SCOPE_SUGGESTIONS || !safeDiscoveryName(row?.filename) || attrsType(row?.attrs) !== "directory") continue;
        const rootPath = posix.join(parent, row.filename);
        try {
          normalizeHostScopeRoot(rootPath);
          await inspectRoot(sftp, rootPath);
          const marker = await optionalLstat(sftp, posix.join(rootPath, ".myagenttool-site.json"));
          const managedSite = attrsType(marker) === "file";
          suggestions.push({
            rootPath,
            label: String(row.filename).replace(/[-_]+/g, " ").trim().slice(0, 80) || "Remote files",
            purpose: managedSite && targetAllowsPurpose(target, "site_publish") ? "site_publish" : "general_files",
            reason: managedSite ? "managed_site" : parent === "/srv/myagenttool-sites" ? "managed_content" : "website_directory",
            discoveryRank: managedSite ? 2 : parent === "/srv/myagenttool-sites" ? 1 : 0,
            modifiedAt: Number(marker?.mtime ?? row?.attrs?.mtime ?? 0),
          });
        } catch {
          // Discovery is best-effort. Unsafe, inaccessible, and linked directories are omitted.
        }
      }
    } catch {
      // A missing or inaccessible conventional parent is normal on many hosts.
    }
  }
  return suggestions
    .sort((left, right) => right.discoveryRank - left.discoveryRank || right.modifiedAt - left.modifiedAt || left.rootPath.localeCompare(right.rootPath))
    .map(({ discoveryRank: _discoveryRank, modifiedAt: _modifiedAt, ...suggestion }, index) => ({ ...suggestion, recommended: index === 0 }));
}

async function inspectBrowseDirectory(sftp, root, relativePath) {
  const rootAttrs = await sftpCall(sftp, "lstat", root);
  if (attrsType(rootAttrs) === "symlink") throw new HostFileScopeError("host_file_scope_symlink_forbidden", "The approved file range has become a symbolic link.", 409);
  if (attrsType(rootAttrs) !== "directory") throw new HostFileScopeError("host_file_scope_not_directory", "The approved file range is no longer a directory.", 409);
  const components = relativePath ? relativePath.split("/") : [];
  let current = root;
  for (const component of components) {
    current = posix.join(current, component);
    const attrs = await sftpCall(sftp, "lstat", current);
    if (attrsType(attrs) === "symlink") throw new HostFileScopeError("host_file_symlink_forbidden", "Symbolic links cannot be opened from the remote file browser.", 409);
    if (attrsType(attrs) !== "directory") throw new HostFileScopeError("host_file_not_directory", "The requested remote path is not a directory.", 409);
  }
  const resolved = posix.normalize(String(await sftpCall(sftp, "realpath", current)));
  if (!pathWithinRoot(root, resolved) || resolved !== current) throw new HostFileScopeError("host_file_scope_escape_blocked", "The remote path no longer matches its approved file range.", 409);
  return current;
}

function publicEntry(item, relativePath) {
  const name = String(item?.filename ?? "");
  if (!name || name.length > 255 || name === "." || name === ".." || name.includes("/") || name.includes("\\") || /[\x00-\x1f\x7f]/.test(name)) return null;
  const type = attrsType(item.attrs);
  return {
    name,
    path: relativePath ? `${relativePath}/${name}` : name,
    type,
    accessible: type === "directory" || type === "file",
    size: type === "file" && Number.isFinite(item.attrs?.size) && Number(item.attrs.size) >= 0 ? Number(item.attrs.size) : null,
    modifiedAt: Number.isFinite(item.attrs?.mtime) ? new Date(Number(item.attrs.mtime) * 1000).toISOString() : null,
  };
}

async function searchApprovedFiles(sftp, scope, search, { allowContent }) {
  const queue = [{ path: "", depth: 0 }];
  const results = [];
  let scannedEntries = 0;
  let scannedTextFiles = 0;
  let readBytes = 0;
  let skippedEntries = 0;
  let truncated = false;
  while (queue.length && scannedEntries < MAX_SEARCH_ENTRIES && results.length < MAX_SEARCH_RESULTS) {
    const current = queue.shift();
    let directory;
    try {
      directory = await inspectBrowseDirectory(sftp, scope.resolvedRootPath, current.path);
    } catch (error) {
      if (!current.path) throw error;
      skippedEntries += 1;
      truncated = true;
      continue;
    }
    let rows;
    try {
      rows = await sftpCall(sftp, "readdir", directory);
    } catch {
      skippedEntries += 1;
      truncated = true;
      continue;
    }
    if (!Array.isArray(rows)) throw new HostFileScopeError("host_file_listing_invalid", "The remote directory listing is invalid.", 502);
    const remaining = MAX_SEARCH_ENTRIES - scannedEntries;
    if (rows.length > remaining) truncated = true;
    const entries = rows.slice(0, remaining).map((row) => publicEntry(row, current.path)).filter(Boolean).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      scannedEntries += 1;
      if (entry.type === "directory") {
        if (!entry.name.startsWith(".") && current.depth < MAX_SEARCH_DEPTH) queue.push({ path: entry.path, depth: current.depth + 1 });
        else if (current.depth >= MAX_SEARCH_DEPTH) truncated = true;
        continue;
      }
      if (entry.type !== "file") {
        skippedEntries += 1;
        continue;
      }
      const searchableName = entry.path.toLocaleLowerCase();
      const nameMatch = search.terms.every((term) => searchableName.includes(term));
      const restricted = isSensitiveRelativePath(entry.path);
      if (nameMatch) {
        results.push({ ...entry, matchKind: "name", previewKind: restricted ? null : previewDescriptor(entry.name)?.kind ?? null, restricted });
        if (results.length >= MAX_SEARCH_RESULTS) { truncated = true; break; }
        continue;
      }
      const extension = posix.extname(entry.name.toLocaleLowerCase());
      const canReadText = allowContent
        && !restricted
        && !entry.name.startsWith(".")
        && SEARCHABLE_TEXT_EXTENSIONS.has(extension)
        && Number.isSafeInteger(entry.size)
        && entry.size >= 0
        && entry.size <= MAX_SEARCH_FILE_BYTES;
      if (!canReadText) continue;
      if (scannedTextFiles >= MAX_SEARCH_TEXT_FILES || readBytes + entry.size > MAX_SEARCH_TOTAL_BYTES) {
        truncated = true;
        continue;
      }
      try {
        const file = await readBoundedRemoteFile(sftp, scope.resolvedRootPath, entry.path, MAX_SEARCH_FILE_BYTES);
        scannedTextFiles += 1;
        readBytes += file.size;
        if (!looksLikeText(file.bytes)) { skippedEntries += 1; continue; }
        const content = file.bytes.toString("utf8").toLocaleLowerCase();
        if (search.terms.every((term) => content.includes(term))) {
          results.push({ ...entry, matchKind: "content", previewKind: "text", restricted: false });
          if (results.length >= MAX_SEARCH_RESULTS) { truncated = true; break; }
        }
      } catch {
        skippedEntries += 1;
        truncated = true;
      }
    }
  }
  if (queue.length || scannedEntries >= MAX_SEARCH_ENTRIES || results.length >= MAX_SEARCH_RESULTS) truncated = true;
  return {
    results,
    count: results.length,
    contentSearchEnabled: allowContent,
    boundaries: {
      scannedEntries,
      scannedTextFiles,
      readBytes,
      skippedEntries,
      truncated,
      maxDepth: MAX_SEARCH_DEPTH,
      maxEntries: MAX_SEARCH_ENTRIES,
      maxResults: MAX_SEARCH_RESULTS,
    },
  };
}

export function createHostFileService({ state, now, nextId, appendEvent, persistStateSoon, resolveCredential, sshHostConnector, store }) {
  const runTx = makeRunTx({ store, persistStateSoon });

  function reconcileInterruptedTransfers(target) {
    const timestamp = now();
    const currentTime = Date.parse(timestamp);
    if (!Number.isFinite(currentTime)) return;
    const interrupted = state.hostFileTransfers.filter((transfer) => {
      if (transfer.sshTargetId !== target.id || transfer.status !== "running") return false;
      const lastProgress = Date.parse(transfer.updatedAt ?? transfer.startedAt ?? transfer.createdAt);
      return Number.isFinite(lastProgress) && currentTime - lastProgress >= STALE_TRANSFER_MS;
    });
    if (!interrupted.length) return;
    runTx(() => {
      for (const transfer of interrupted) {
        Object.assign(transfer, { status: "failed", errorCode: "host_file_transfer_interrupted", completedAt: timestamp, updatedAt: timestamp });
        appendEvent({ invocationId: null, type: "ssh.host_file_transfer.interrupted", level: "warning", message: "A governed SSH file transfer ended without a confirmed result.", data: { targetId: target.id, scopeId: transfer.scopeId, transferId: transfer.id, direction: transfer.direction } });
      }
    });
  }

  function listScopes(target) {
    return state.hostFileScopes.filter((scope) => scope.sshTargetId === target.id);
  }

  async function suggestScopes(target) {
    try {
      if (target.connectionStatus !== "ready" || !target.capabilities?.sftp) throw new HostFileScopeError("ssh_host_not_ready", "Verify the SSH host before discovering file ranges.", 409);
      const credential = await resolveCredential(target.credentialRef);
      if (!credential?.ok) throw new HostFileScopeError(credential?.error ?? "ssh_credential_unavailable", "The SSH credential is unavailable.", 409);
      const result = await sshHostConnector.runSftp(target, credential.credential, (sftp) => discoverScopeRoots(sftp, target));
      return { ok: true, suggestions: result.value, count: result.value.length };
    } catch (error) {
      return scopeFailure(error);
    }
  }

  async function createScope(target, body = {}, actor = null) {
    try {
      if (target.connectionStatus !== "ready" || !target.capabilities?.sftp) throw new HostFileScopeError("ssh_host_not_ready", "Verify the SSH host before adding a file range.", 409);
      const purpose = scopePurpose(body.purpose);
      if (!targetAllowsPurpose(target, purpose)) throw new HostFileScopeError("host_file_scope_purpose_not_allowed", "The host connection is not approved for this file range purpose.", 409);
      const rootPath = normalizeHostScopeRoot(body.rootPath);
      const existingScope = state.hostFileScopes.find((scope) => scope.sshTargetId === target.id
        && scope.purpose === purpose
        && (scope.rootPath === rootPath || scope.resolvedRootPath === rootPath));
      if (existingScope) return { ok: true, scope: existingScope, reused: true };
      const credential = await resolveCredential(target.credentialRef);
      if (!credential?.ok) throw new HostFileScopeError(credential?.error ?? "ssh_credential_unavailable", "The SSH credential is unavailable.", 409);
      const inspected = await sshHostConnector.runSftp(target, credential.credential, (sftp) => inspectRoot(sftp, rootPath));
      const existingResolvedScope = state.hostFileScopes.find((scope) => scope.sshTargetId === target.id
        && scope.purpose === purpose
        && scope.resolvedRootPath === inspected.value);
      if (existingResolvedScope) return { ok: true, scope: existingResolvedScope, reused: true };
      assertCertificateScopeIsolation(state, target, purpose, inspected.value);
      const timestamp = now();
      const scope = {
        id: nextId("hfs"),
        ownerTeamId: target.ownerTeamId,
        sshTargetId: target.id,
        label: String(body.label ?? "Remote files").trim().slice(0, 80) || "Remote files",
        purpose,
        rootPath,
        resolvedRootPath: inspected.value,
        permissions: purpose === "tls_certificate" ? ["certificate_write"] : normalizeScopePermissions(body.permissions),
        overwritePolicy: "deny",
        limits: { maxEntries: MAX_ENTRIES, maxDepth: MAX_DEPTH },
        status: "ready",
        lastVerifiedAt: timestamp,
        lastResolvedAddress: inspected.resolvedAddress,
        revision: 1,
        createdByUserId: actor?.userId ?? "usr_local",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      runTx(() => {
        state.hostFileScopes.push(scope);
        appendEvent({ invocationId: null, type: "ssh.host_file_scope.created", level: "info", message: "A governed SSH file range was verified.", data: { targetId: target.id, scopeId: scope.id, purpose } });
      });
      return { ok: true, scope, reused: false };
    } catch (error) {
      return scopeFailure(error);
    }
  }

  async function updateScope(target, scope, body = {}) {
    try {
      if (!Number.isInteger(body.expectedRevision)) throw new HostFileScopeError("expected_revision_required", "The current file range revision is required.");
      if (body.expectedRevision !== scope.revision) return { ok: false, status: 409, error: "host_file_scope_revision_conflict", currentRevision: scope.revision };
      const purpose = body.purpose == null ? scope.purpose : scopePurpose(body.purpose);
      if (!targetAllowsPurpose(target, purpose)) throw new HostFileScopeError("host_file_scope_purpose_not_allowed", "The host connection is not approved for this file range purpose.", 409);
      const rootPath = body.rootPath == null ? scope.rootPath : normalizeHostScopeRoot(body.rootPath);
      assertCertificateScopeIsolation(state, target, purpose, rootPath, scope.id);
      const nextStatus = body.status === "disabled" ? "disabled" : "ready";
      let resolvedRootPath = scope.resolvedRootPath;
      let resolvedAddress = scope.lastResolvedAddress;
      let verifiedAt = scope.lastVerifiedAt;
      if (rootPath !== scope.rootPath || (scope.status !== "ready" && nextStatus === "ready")) {
        if (target.connectionStatus !== "ready") throw new HostFileScopeError("ssh_host_not_ready", "Verify the SSH host before changing a file range.", 409);
        const credential = await resolveCredential(target.credentialRef);
        if (!credential?.ok) throw new HostFileScopeError(credential?.error ?? "ssh_credential_unavailable", "The SSH credential is unavailable.", 409);
        const inspected = await sshHostConnector.runSftp(target, credential.credential, (sftp) => inspectRoot(sftp, rootPath));
        resolvedRootPath = inspected.value;
        resolvedAddress = inspected.resolvedAddress;
        verifiedAt = now();
      }
      runTx(() => {
        scope.label = body.label == null ? scope.label : String(body.label).trim().slice(0, 80) || scope.label;
        scope.purpose = purpose;
        scope.rootPath = rootPath;
        scope.resolvedRootPath = resolvedRootPath;
        scope.permissions = purpose === "tls_certificate" ? ["certificate_write"] : normalizeScopePermissions(body.permissions, scope.permissions);
        scope.status = nextStatus;
        scope.lastVerifiedAt = verifiedAt;
        scope.lastResolvedAddress = resolvedAddress;
        scope.revision += 1;
        scope.updatedAt = now();
        appendEvent({ invocationId: null, type: "ssh.host_file_scope.updated", level: "info", message: "A governed SSH file range was updated.", data: { targetId: target.id, scopeId: scope.id, purpose: scope.purpose, permissions: scope.permissions, status: scope.status } });
      });
      return { ok: true, scope };
    } catch (error) {
      return scopeFailure(error);
    }
  }

  async function listEntries(target, scope, rawPath) {
    try {
      if (scope.purpose === "tls_certificate") throw new HostFileScopeError("host_tls_scope_browsing_forbidden", "Certificate files cannot be browsed through the file API.", 403);
      if (scope.status !== "ready" || target.connectionStatus !== "ready") throw new HostFileScopeError("host_file_scope_not_ready", "Verify the host and file range before browsing.", 409);
      const relativePath = normalizeHostRelativePath(rawPath);
      const credential = await resolveCredential(target.credentialRef);
      if (!credential?.ok) throw new HostFileScopeError(credential?.error ?? "ssh_credential_unavailable", "The SSH credential is unavailable.", 409);
      const result = await sshHostConnector.runSftp(target, credential.credential, async (sftp) => {
        const directory = await inspectBrowseDirectory(sftp, scope.resolvedRootPath, relativePath);
        const rows = await sftpCall(sftp, "readdir", directory);
        if (!Array.isArray(rows)) throw new HostFileScopeError("host_file_listing_invalid", "The remote directory listing is invalid.", 502);
        if (rows.length > MAX_ENTRIES) throw new HostFileScopeError("host_file_listing_too_large", "This directory contains too many entries to browse safely.", 409);
        const after = posix.normalize(String(await sftpCall(sftp, "realpath", directory)));
        if (after !== directory || !pathWithinRoot(scope.resolvedRootPath, after)) throw new HostFileScopeError("host_file_scope_escape_blocked", "The remote directory changed while it was being read.", 409);
        return rows.map((row) => publicEntry(row, relativePath)).filter(Boolean).sort((a, b) => {
          if (a.type === "directory" && b.type !== "directory") return -1;
          if (a.type !== "directory" && b.type === "directory") return 1;
          return a.name.localeCompare(b.name);
        });
      });
      return { ok: true, scope, path: relativePath, entries: result.value, count: result.value.length };
    } catch (error) {
      return scopeFailure(error);
    }
  }

  async function searchFiles(target, scope, input = {}, actor = null) {
    try {
      if (scope.purpose === "tls_certificate") throw new HostFileScopeError("host_tls_scope_browsing_forbidden", "Certificate files cannot be searched through the file API.", 403);
      if (!scopeAllows(scope, "list")) throw new HostFileScopeError("host_file_search_not_allowed", "Search is not enabled for this file range.", 403);
      if (scope.status !== "ready" || target.connectionStatus !== "ready") throw new HostFileScopeError("host_file_scope_not_ready", "Verify the host and file range before searching.", 409);
      if (!Number.isInteger(input.expectedRevision)) throw new HostFileScopeError("expected_revision_required", "The current file range revision is required.");
      if (input.expectedRevision !== scope.revision) return { ok: false, status: 409, error: "host_file_scope_revision_conflict", currentRevision: scope.revision };
      const search = normalizeHostFileSearchQuery(input.query);
      const credential = await resolveCredential(target.credentialRef);
      if (!credential?.ok) throw new HostFileScopeError(credential?.error ?? "ssh_credential_unavailable", "The SSH credential is unavailable.", 409);
      const allowContent = scopeAllows(scope, "download");
      const operation = await sshHostConnector.runSftp(target, credential.credential, (sftp) => searchApprovedFiles(sftp, scope, search, { allowContent }), { operationTimeoutMs: 20_000 });
      const response = operation.value;
      runTx(() => appendEvent({
        invocationId: null,
        type: "ssh.host_file_search.completed",
        level: "info",
        message: "A bounded approved-folder file search completed.",
        data: {
          targetId: target.id,
          scopeId: scope.id,
          queryKind: allowContent ? "name_and_text" : "name_only",
          termCount: search.terms.length,
          resultCount: response.count,
          scannedEntries: response.boundaries.scannedEntries,
          scannedTextFiles: response.boundaries.scannedTextFiles,
          readBytes: response.boundaries.readBytes,
          skippedEntries: response.boundaries.skippedEntries,
          truncated: response.boundaries.truncated,
          requestedBy: actor?.userId ?? "usr_local",
        },
      }));
      return { ok: true, scopeId: scope.id, scopeRevision: scope.revision, ...response };
    } catch (error) {
      return scopeFailure(error);
    }
  }

  async function previewFile(target, scope, input = {}, actor = null) {
    try {
      if (scope.purpose === "tls_certificate") throw new HostFileScopeError("host_tls_scope_browsing_forbidden", "Certificate files cannot be previewed through the file API.", 403);
      if (!scopeAllows(scope, "download")) throw new HostFileScopeError("host_file_preview_not_allowed", "Preview is not enabled for this file range.", 403);
      if (scope.status !== "ready" || target.connectionStatus !== "ready") throw new HostFileScopeError("host_file_scope_not_ready", "Verify the host and file range before previewing.", 409);
      if (!Number.isInteger(input.expectedRevision)) throw new HostFileScopeError("expected_revision_required", "The current file range revision is required.");
      if (input.expectedRevision !== scope.revision) return { ok: false, status: 409, error: "host_file_scope_revision_conflict", currentRevision: scope.revision };
      const relativePath = normalizeHostRelativePath(input.path);
      if (!relativePath) throw new HostFileScopeError("host_file_path_invalid", "Choose a remote file to preview.");
      const fileName = normalizeTransferFilename(posix.basename(relativePath));
      if (isSensitiveRelativePath(relativePath)) throw new HostFileScopeError("host_file_preview_sensitive_blocked", "This sensitive file cannot be previewed.", 403);
      const descriptor = previewDescriptor(fileName);
      if (!descriptor) throw new HostFileScopeError("host_file_preview_type_unsupported", "This file type is not available for safe preview.", 415);
      const credential = await resolveCredential(target.credentialRef);
      if (!credential?.ok) throw new HostFileScopeError(credential?.error ?? "ssh_credential_unavailable", "The SSH credential is unavailable.", 409);
      const operation = await sshHostConnector.runSftp(target, credential.credential, (sftp) => readBoundedRemoteFile(sftp, scope.resolvedRootPath, relativePath, descriptor.maxBytes), { operationTimeoutMs: 30_000 });
      if (!previewSignatureValid(descriptor.kind, descriptor.contentType, operation.value.bytes)) throw new HostFileScopeError("host_file_preview_content_invalid", "The file content does not match a safe preview format.", 415);
      runTx(() => appendEvent({
        invocationId: null,
        type: "ssh.host_file_preview.completed",
        level: "info",
        message: "A bounded approved-folder file preview completed.",
        data: { targetId: target.id, scopeId: scope.id, kind: descriptor.kind, bytes: operation.value.size, requestedBy: actor?.userId ?? "usr_local" },
      }));
      return { ok: true, bytes: operation.value.bytes, kind: descriptor.kind, contentType: descriptor.contentType };
    } catch (error) {
      return scopeFailure(error);
    }
  }

  function listTransfers(target) {
    reconcileInterruptedTransfers(target);
    return state.hostFileTransfers
      .filter((transfer) => transfer.sshTargetId === target.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 100);
  }

  function startTransfer(target, scope, input, actor) {
    if (input.confirmed !== true) throw new HostFileScopeError("host_file_transfer_confirmation_required", "Confirm the transfer before it starts.");
    const retryOf = input.retryOf ? state.hostFileTransfers.find((item) => item.id === input.retryOf && item.ownerTeamId === scope.ownerTeamId) : null;
    if (input.retryOf && (!retryOf || retryOf.scopeId !== scope.id || retryOf.direction !== input.direction || retryOf.status !== "failed")) {
      throw new HostFileScopeError("host_file_transfer_retry_invalid", "The original transfer cannot be retried.", 409);
    }
    const attempt = retryOf ? Number(retryOf.attempt ?? 1) + 1 : 1;
    if (attempt > MAX_TRANSFER_ATTEMPTS) throw new HostFileScopeError("host_file_transfer_retry_limit", "This transfer has reached its retry limit.", 409);
    const timestamp = now();
    const task = {
      id: nextId("hft"),
      ownerTeamId: target.ownerTeamId,
      sshTargetId: target.id,
      scopeId: scope.id,
      direction: input.direction,
      status: "running",
      remotePath: input.remotePath,
      remoteDirectory: input.remoteDirectory ?? posix.dirname(input.remotePath),
      fileName: input.fileName,
      bytesTotal: input.bytesTotal,
      bytesTransferred: 0,
      progress: 0,
      conflictPolicy: input.conflictPolicy ?? null,
      sha256: input.sha256 ?? null,
      attempt,
      maxAttempts: MAX_TRANSFER_ATTEMPTS,
      retryOf: retryOf?.id ?? null,
      errorCode: null,
      createdByUserId: actor?.userId ?? "usr_local",
      createdAt: timestamp,
      startedAt: timestamp,
      completedAt: null,
      updatedAt: timestamp,
    };
    runTx(() => {
      state.hostFileTransfers.push(task);
      appendEvent({ invocationId: null, type: "ssh.host_file_transfer.started", level: "info", message: `A governed SSH ${task.direction} started.`, data: { targetId: target.id, scopeId: scope.id, transferId: task.id, direction: task.direction, attempt } });
    });
    return task;
  }

  function updateTransferProgress(task, transferred) {
    task.bytesTransferred = Math.min(task.bytesTotal, Math.max(0, transferred));
    task.progress = task.bytesTotal ? Math.min(99, Math.floor((task.bytesTransferred / task.bytesTotal) * 100)) : 0;
    task.updatedAt = now();
  }

  function completeTransfer(task, target, scope, extra = {}) {
    runTx(() => {
      Object.assign(task, extra, { status: "completed", bytesTransferred: task.bytesTotal, progress: 100, errorCode: null, completedAt: now(), updatedAt: now() });
      appendEvent({ invocationId: null, type: "ssh.host_file_transfer.completed", level: "info", message: `A governed SSH ${task.direction} completed.`, data: { targetId: target.id, scopeId: scope.id, transferId: task.id, direction: task.direction, bytes: task.bytesTotal } });
    });
  }

  function failTransfer(task, target, scope, failure) {
    runTx(() => {
      Object.assign(task, { status: "failed", errorCode: failure.error, completedAt: now(), updatedAt: now() });
      appendEvent({ invocationId: null, type: "ssh.host_file_transfer.failed", level: "warning", message: `A governed SSH ${task.direction} failed.`, data: { targetId: target.id, scopeId: scope.id, transferId: task.id, direction: task.direction, error: failure.error } });
    });
  }

  async function uploadFile(target, scope, body, options = {}, actor = null) {
    let task = null;
    try {
      if (scope.purpose === "tls_certificate") throw new HostFileScopeError("host_tls_scope_transfer_forbidden", "Certificate files can only be changed by the certificate manager.", 403);
      if (!scopeAllows(scope, "upload")) throw new HostFileScopeError("host_file_upload_not_allowed", "Uploads are not enabled for this file range.", 403);
      if (scope.status !== "ready" || target.connectionStatus !== "ready") throw new HostFileScopeError("host_file_scope_not_ready", "Verify the host and file range before uploading.", 409);
      if (!Buffer.isBuffer(body) || body.length < 1 || body.length > MAX_HOST_UPLOAD_BYTES) throw new HostFileScopeError("host_file_upload_size_invalid", "The upload is empty or exceeds the size limit.", 413);
      const remoteDirectory = normalizeHostRelativePath(options.directory);
      const requestedName = normalizeTransferFilename(options.filename);
      const policy = transferPolicy(options.conflictPolicy);
      if (policy === "replace" && options.overwriteConfirmed !== true) throw new HostFileScopeError("host_file_overwrite_confirmation_required", "Confirm replacement of the existing remote file.");
      task = startTransfer(target, scope, { direction: "upload", remotePath: remoteDirectory ? `${remoteDirectory}/${requestedName}` : requestedName, remoteDirectory, fileName: requestedName, bytesTotal: body.length, conflictPolicy: policy, sha256: createHash("sha256").update(body).digest("hex"), confirmed: options.confirmed, retryOf: options.retryOf }, actor);
      const credential = await resolveCredential(target.credentialRef);
      if (!credential?.ok) throw new HostFileScopeError(credential?.error ?? "ssh_credential_unavailable", "The SSH credential is unavailable.", 409);
      const result = await sshHostConnector.runSftp(target, credential.credential, async (sftp) => {
        const directory = await inspectBrowseDirectory(sftp, scope.resolvedRootPath, remoteDirectory);
        await ensureUploadCapacity(sftp, directory, body.length);
        let finalName = requestedName;
        let finalPath = posix.join(directory, finalName);
        const existing = await optionalLstat(sftp, finalPath);
        if (existing && policy === "deny") throw new HostFileScopeError("host_file_conflict", "A remote file with this name already exists.", 409);
        if (existing && policy === "rename") ({ name: finalName, path: finalPath } = await availableRenamePath(sftp, directory, requestedName));
        if (existing && policy === "replace") ensureRegularRemoteFile(existing);
        const tempPath = posix.join(directory, `.myagenttool-upload-${task.id}.part`);
        let handle = null;
        try {
          handle = await sftpCall(sftp, "open", tempPath, "wx", 0o600);
          for (let offset = 0; offset < body.length; offset += TRANSFER_CHUNK_BYTES) {
            const length = Math.min(TRANSFER_CHUNK_BYTES, body.length - offset);
            await sftpWrite(sftp, handle, body, offset, length, offset);
            updateTransferProgress(task, offset + length);
          }
          await sftpCall(sftp, "close", handle);
          handle = null;
          if (existing && policy === "replace") {
            if (target.capabilities?.posixRename && typeof sftp.ext_openssh_rename === "function") await sftpCall(sftp, "ext_openssh_rename", tempPath, finalPath);
            else throw new HostFileScopeError("host_file_atomic_replace_unavailable", "This host cannot safely replace a file atomically. Keep both files instead.", 409);
          } else await sftpCall(sftp, "rename", tempPath, finalPath);
        } catch (error) {
          if (handle) await sftpCall(sftp, "close", handle).catch(() => {});
          await sftpCall(sftp, "unlink", tempPath).catch(() => {});
          throw error;
        }
        const resolved = posix.normalize(String(await sftpCall(sftp, "realpath", finalPath)));
        if (resolved !== finalPath || !pathWithinRoot(scope.resolvedRootPath, resolved)) throw new HostFileScopeError("host_file_scope_escape_blocked", "The uploaded file did not remain in its approved range.", 409);
        return { fileName: finalName, remotePath: remoteDirectory ? `${remoteDirectory}/${finalName}` : finalName };
      }, { operationTimeoutMs: 120_000 });
      completeTransfer(task, target, scope, result.value);
      return { ok: true, task };
    } catch (error) {
      const failure = transferFailure(error);
      if (task) failTransfer(task, target, scope, failure);
      return { ok: false, ...failure, ...(task ? { task } : {}) };
    }
  }

  async function downloadFile(target, scope, options = {}, actor = null) {
    let task = null;
    try {
      if (scope.purpose === "tls_certificate") throw new HostFileScopeError("host_tls_scope_transfer_forbidden", "Certificate files cannot be downloaded through the file API.", 403);
      if (!scopeAllows(scope, "download")) throw new HostFileScopeError("host_file_download_not_allowed", "Downloads are not enabled for this file range.", 403);
      if (scope.status !== "ready" || target.connectionStatus !== "ready") throw new HostFileScopeError("host_file_scope_not_ready", "Verify the host and file range before downloading.", 409);
      if (options.confirmed !== true) throw new HostFileScopeError("host_file_transfer_confirmation_required", "Confirm the transfer before it starts.");
      const remotePath = normalizeHostRelativePath(options.path);
      if (!remotePath) throw new HostFileScopeError("host_file_path_invalid", "Choose a remote file to download.");
      const fileName = normalizeTransferFilename(posix.basename(remotePath));
      const remoteDirectory = remotePath.includes("/") ? remotePath.slice(0, remotePath.lastIndexOf("/")) : "";
      task = startTransfer(target, scope, { direction: "download", remotePath, remoteDirectory, fileName, bytesTotal: 0, confirmed: true, retryOf: options.retryOf }, actor);
      if (isSensitiveRelativePath(remotePath)) throw new HostFileScopeError("host_file_download_sensitive_blocked", "This sensitive file type cannot be downloaded through the browser.", 403);
      const credential = await resolveCredential(target.credentialRef);
      if (!credential?.ok) throw new HostFileScopeError(credential?.error ?? "ssh_credential_unavailable", "The SSH credential is unavailable.", 409);
      let knownSize = 0;
      const result = await sshHostConnector.runSftp(target, credential.credential, async (sftp) => {
        const directory = await inspectBrowseDirectory(sftp, scope.resolvedRootPath, remoteDirectory);
        const absolutePath = posix.join(directory, fileName);
        const attrs = await sftpCall(sftp, "lstat", absolutePath);
        ensureRegularRemoteFile(attrs);
        knownSize = Number(attrs?.size ?? -1);
        if (!Number.isSafeInteger(knownSize) || knownSize < 0 || knownSize > MAX_HOST_DOWNLOAD_BYTES) throw new HostFileScopeError("host_file_download_size_invalid", "The remote file exceeds the safe browser download limit.", 413);
        task.bytesTotal = knownSize;
        const resolved = posix.normalize(String(await sftpCall(sftp, "realpath", absolutePath)));
        if (resolved !== absolutePath || !pathWithinRoot(scope.resolvedRootPath, resolved)) throw new HostFileScopeError("host_file_scope_escape_blocked", "The remote file moved outside its approved range.", 409);
        const output = Buffer.alloc(knownSize);
        const handle = await sftpCall(sftp, "open", absolutePath, "r");
        try {
          let offset = 0;
          while (offset < knownSize) {
            const length = Math.min(TRANSFER_CHUNK_BYTES, knownSize - offset);
            const bytesRead = await sftpRead(sftp, handle, output, offset, length, offset);
            if (!bytesRead) throw new HostFileScopeError("host_file_download_incomplete", "The remote file ended before the download completed.", 502);
            offset += bytesRead;
            updateTransferProgress(task, offset);
          }
        } finally {
          await sftpCall(sftp, "close", handle).catch(() => {});
        }
        return output;
      }, { operationTimeoutMs: 120_000 });
      task.sha256 = createHash("sha256").update(result.value).digest("hex");
      completeTransfer(task, target, scope);
      return { ok: true, task, bytes: result.value, fileName };
    } catch (error) {
      const failure = transferFailure(error);
      if (task) failTransfer(task, target, scope, failure);
      return { ok: false, ...failure, ...(task ? { task } : {}) };
    }
  }

  return { listScopes, suggestScopes, createScope, updateScope, listEntries, searchFiles, previewFile, listTransfers, uploadFile, downloadFile };
}

function scopeFailure(error) {
  if (error instanceof HostFileScopeError) return { ok: false, status: error.status, error: error.code };
  if (error instanceof SshHostConnectorError) return { ok: false, status: error.code === "ssh_host_fingerprint_changed" ? 409 : 502, error: error.code };
  return { ok: false, status: 502, error: "host_file_operation_failed" };
}
