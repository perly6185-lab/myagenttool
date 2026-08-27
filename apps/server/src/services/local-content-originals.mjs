import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { plainText, safeRelativePath, textExtension } from "./local-content-records.mjs";

export const MAX_EXTRACTED_BYTES = 256 * 1024;
const MAX_MATERIALIZED_BYTES = 50 * 1024 * 1024;
export const DOCUMENT_PREVIEW_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".pptx"]);

export function inspectOriginal(root, relativePath) {
  if (!root || !relativePath) return { available: false, reason: "original_path_unresolved", size: null, modifiedAt: null };
  try {
    const rootPath = resolve(root);
    if (!existsSync(rootPath) || lstatSync(rootPath).isSymbolicLink() || !lstatSync(rootPath).isDirectory()) {
      return { available: false, reason: "original_root_unavailable", size: null, modifiedAt: null };
    }
    const normalized = safeRelativePath(relativePath);
    if (!normalized) return { available: false, reason: "original_path_invalid", size: null, modifiedAt: null };
    const candidate = resolve(rootPath, normalized);
    const lexical = relative(rootPath, candidate);
    if (!lexical || lexical.startsWith("..") || isAbsolute(lexical)) {
      return { available: false, reason: "original_path_outside_root", size: null, modifiedAt: null };
    }
    let cursor = rootPath;
    for (const part of lexical.split(sep)) {
      cursor = join(cursor, part);
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
        return { available: false, reason: "original_path_symlink", size: null, modifiedAt: null };
      }
    }
    if (!existsSync(candidate)) return { available: false, reason: "original_missing", size: null, modifiedAt: null };
    const info = lstatSync(candidate);
    if (!info.isFile()) return { available: false, reason: "original_not_file", size: null, modifiedAt: null };
    const realRoot = realpathSync(rootPath);
    const realCandidate = realpathSync(candidate);
    const confined = relative(realRoot, realCandidate);
    if (!confined || confined.startsWith("..") || isAbsolute(confined)) {
      return { available: false, reason: "original_path_outside_root", size: null, modifiedAt: null };
    }
    return {
      available: true,
      reason: null,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      absolutePath: realCandidate,
    };
  } catch {
    return { available: false, reason: "original_unreadable", size: null, modifiedAt: null };
  }
}

export function resolveCatalogOriginal({ row, state, stateStorePath, mailArchiveRoot }) {
  if (row.storage_mode === "state_record") return resolveStateRecord(row, state);
  const locator = catalogFileLocator({ row, state, stateStorePath, mailArchiveRoot });
  if (!locator) return unresolved("local_content_original_path_invalid");
  const inspected = inspectOriginal(locator.rootPath, locator.relativePath);
  if (!inspected.available) return unresolved(inspected.reason ?? "local_content_original_unavailable", 409);
  if (inspected.size > MAX_MATERIALIZED_BYTES) return unresolved("local_content_original_too_large", 413);
  const sha256 = fileDigest(inspected.absolutePath, inspected.size);
  if (!sha256) return unresolved("local_content_original_unreadable", 409);
  if (row.sha256 && !sameDigest(row.sha256, sha256)) return unresolved("local_content_original_changed", 409);
  return {
    ok: true,
    status: 200,
    sourceType: "file",
    localPath: inspected.absolutePath,
    size: inspected.size,
    sha256,
    originalName: originalNameFor(row),
  };
}

export function catalogFileLocator({ row, state, stateStorePath, mailArchiveRoot }) {
  if (!row || row.storage_mode === "state_record") return null;
  if (row.root_kind === "application_data" && ["task-materials", "channel-knowledge", "channel-attachments"].includes(row.root_id)) {
    const relativePath = String(row.relative_path ?? "").replaceAll("\\", "/");
    const expectedPrefix = row.root_id === "task-materials"
      ? "task-materials/"
      : row.root_id === "channel-attachments"
        ? "knowledge/channel-attachments/"
        : "knowledge/channel-articles/";
    if (!relativePath.startsWith(expectedPrefix)) return null;
    return { rootPath: resolve(dirname(stateStorePath)), relativePath };
  }
  if (row.root_kind === "project") {
    return {
      rootPath: (state.projects ?? []).find((item) => item.id === row.root_id)?.path ?? null,
      relativePath: row.relative_path,
    };
  }
  if (row.root_kind === "worktree") {
    const worktree = (state.worktrees ?? []).find((item) => item.id === row.root_id);
    return { rootPath: worktree?.path ?? worktree?.worktreePath ?? null, relativePath: row.relative_path };
  }
  if (row.root_kind === "mail_archive") {
    const match = /^mailarc_([a-f0-9]{24})_[a-f0-9]{40}$/.exec(String(row.root_id ?? ""));
    if (!match) return null;
    return { rootPath: mailArchiveRoot, relativePath: `${match[1]}/${row.root_id}/message.eml` };
  }
  return null;
}

export function confinedCandidate(root, relativePath) {
  if (!root || !relativePath) return null;
  try {
    const rootPath = resolve(root);
    const normalized = safeRelativePath(relativePath);
    if (!normalized) return null;
    const candidate = resolve(rootPath, normalized);
    const lexical = relative(rootPath, candidate);
    if (!lexical || lexical.startsWith("..") || isAbsolute(lexical)) return null;
    return candidate;
  } catch {
    return null;
  }
}

export function confinedExistingContainer(root, relativePath) {
  const rootPath = root ? resolve(root) : null;
  const candidate = confinedCandidate(rootPath, relativePath);
  if (!rootPath || !candidate || !existsSync(rootPath)) return null;
  try {
    const rootInfo = lstatSync(rootPath);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return null;
    let current = existsSync(candidate) ? candidate : dirname(candidate);
    while (current !== rootPath && !existsSync(current)) current = dirname(current);
    if (!existsSync(current)) return null;
    const lexical = relative(rootPath, current);
    let cursor = rootPath;
    for (const part of lexical ? lexical.split(sep) : []) {
      cursor = join(cursor, part);
      if (lstatSync(cursor).isSymbolicLink()) return null;
    }
    const realRoot = realpathSync(rootPath);
    const realCurrent = realpathSync(current);
    const confined = relative(realRoot, realCurrent);
    if (confined.startsWith("..") || isAbsolute(confined)) return null;
    return realCurrent;
  } catch {
    return null;
  }
}

export function resolveStateRecord(row, state) {
  if (row.state_collection !== "workItems") return unresolved("local_content_original_not_materializable", 409);
  const item = (state.workItems ?? []).find((candidate) => candidate.id === row.state_id && candidate.ownerTeamId === row.owner_team_id);
  if (!item) return unresolved("local_content_original_missing", 409);
  const text = [
    `# ${item.title || item.localRef || "Local task"}`,
    item.localRef ? `Reference: ${item.localRef}` : "",
    item.body ?? "",
    ...(item.acceptanceCriteria?.length ? ["## Acceptance criteria", ...item.acceptanceCriteria.map((entry) => `- ${entry}`)] : []),
  ].filter(Boolean).join("\n\n").slice(0, MAX_MATERIALIZED_BYTES);
  const bytes = Buffer.from(`${text}\n`, "utf8");
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return {
    ok: true,
    status: 200,
    sourceType: "bytes",
    bytes,
    size: bytes.length,
    sha256,
    originalName: `${safeFileName(item.localRef || item.title || "local-task")}.md`,
  };
}

export function originalNameFor(row) {
  const extension = row.kind === "mail" ? ".eml" : extname(String(row.relative_path ?? ""));
  const base = safeFileName(row.title || basename(String(row.relative_path ?? "")) || row.kind);
  return extension && !base.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase()) ? `${base}${extension}` : base;
}

function safeFileName(value) {
  return String(value ?? "local-content")
    .replace(/[\\/\0\r\n]+/g, " ")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120) || "local-content";
}

function sameDigest(left, right) {
  return String(left).replace(/^sha256:/, "") === String(right).replace(/^sha256:/, "");
}

export function unresolved(error, status = 409) {
  return { ok: false, status, error };
}

export function defaultMailArchiveRoot(env = process.env) {
  const base = env.APPDATA
    || (env.USERPROFILE && join(env.USERPROFILE, "AppData", "Roaming"))
    || (env.HOME && join(env.HOME, "AppData", "Roaming"));
  return base ? join(base, "myagenttool", "mail", "archive") : null;
}

export function readBoundedText(path, size) {
  if (!textExtension(path) || !Number.isSafeInteger(size) || size <= 0) return "";
  const length = Math.min(size, MAX_EXTRACTED_BYTES);
  const buffer = Buffer.alloc(length);
  let fd;
  try {
    fd = openSync(path, "r");
    const bytesRead = readSync(fd, buffer, 0, length, 0);
    return plainText(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    return "";
  } finally {
    if (fd != null) closeSync(fd);
  }
}

export function readFilePrefix(path, length) {
  const buffer = Buffer.alloc(Math.max(0, length));
  let fd;
  try {
    fd = openSync(path, "r");
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    if (fd != null) closeSync(fd);
  }
}

export function readFileRange(path, offset, length) {
  const start = Math.max(0, Number(offset) || 0);
  const buffer = Buffer.alloc(Math.max(0, Number(length) || 0));
  let fd;
  try {
    fd = openSync(path, "r");
    const bytesRead = readSync(fd, buffer, 0, buffer.length, start);
    return buffer.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    if (fd != null) closeSync(fd);
  }
}

export function safeMarkupPreview(value) {
  return String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<img\b([^>]*)>/gi, (_match, attributes) => {
      const source = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1] ?? "";
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(attributes)?.[1] ?? "image";
      return source ? `[Image: ${alt}] (${source})` : `[Image: ${alt}]`;
    })
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attributes, label) => {
      const target = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1] ?? "";
      return target ? `${label} (${target})` : label;
    })
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function fileDigest(path, size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > 64 * 1024 * 1024) return null;
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(1, size)));
  let fd;
  try {
    fd = openSync(path, "r");
    let position = 0;
    while (position < size) {
      const bytesRead = readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return position === size ? `sha256:${hash.digest("hex")}` : null;
  } catch {
    return null;
  } finally {
    if (fd != null) closeSync(fd);
  }
}
