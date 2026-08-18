import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export const MAIL_ARCHIVE_VERSION = 1;
export const MAX_ARCHIVED_MESSAGE_BYTES = 50 * 1024 * 1024;
export const MAX_MAIL_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

const ARCHIVE_REF = /^mailarc_([a-f0-9]{24})_([a-f0-9]{40})$/;
const MANIFEST_FILE = "manifest.json";
const MESSAGE_FILE = "message.eml";

export function defaultMailArchiveRoot(env = process.env) {
  const base = env.APPDATA
    || (env.USERPROFILE && join(env.USERPROFILE, "AppData", "Roaming"))
    || (env.HOME && join(env.HOME, "AppData", "Roaming"));
  if (!base) throw archiveError("mail_archive_unavailable");
  return join(base, "myagenttool", "mail", "archive");
}

export function mailArchiveRef({ account, messageId, folderPath = "INBOX" }) {
  const normalizedAccount = bounded(account, 998).toLocaleLowerCase();
  const normalizedMessageId = bounded(messageId, 998);
  const normalizedFolder = bounded(folderPath, 998);
  if (!normalizedAccount || !normalizedMessageId || !normalizedFolder) throw archiveError("mail_archive_identity_invalid");
  const accountKey = digest(normalizedAccount).slice(0, 24);
  const messageKey = digest(`${accountKey}\0${normalizedFolder}\0${normalizedMessageId}`).slice(0, 40);
  return `mailarc_${accountKey}_${messageKey}`;
}

export function archiveMailSource({
  account,
  messageId,
  folderPath = "INBOX",
  source,
  attachments = [],
  root = defaultMailArchiveRoot(),
  now = () => new Date().toISOString(),
  maxMessageBytes = MAX_ARCHIVED_MESSAGE_BYTES,
  maxArchiveBytes = MAX_MAIL_ARCHIVE_BYTES,
} = {}) {
  const bytes = Buffer.from(source ?? []);
  if (!bytes.length || bytes.length > maxMessageBytes) throw archiveError("mail_archive_message_too_large");
  const ref = mailArchiveRef({ account, messageId, folderPath });
  const paths = archivePaths(root, ref, { create: true });

  if (existsSync(paths.directory)) {
    const existing = readMailArchive({ ref, root });
    if (existing.messageSize !== bytes.length || existing.messageSha256 !== digest(bytes)) {
      throw archiveError("mail_archive_integrity_failed");
    }
    return publicArchive(existing);
  }
  const usedBytes = archiveSize(paths.root);
  if (usedBytes + bytes.length > maxArchiveBytes) throw archiveError("mail_archive_capacity_exceeded");

  const archivedAt = now();
  const manifest = {
    version: MAIL_ARCHIVE_VERSION,
    ref,
    messageSha256: digest(bytes),
    messageSize: bytes.length,
    archivedAt,
    attachmentCount: Math.min(50, Array.isArray(attachments) ? attachments.length : 0),
    attachments: normalizeAttachments(attachments),
  };
  const temporary = join(paths.accountDirectory, `.tmp-${ref}-${process.pid}-${randomUUID()}`);
  mkdirSync(temporary, { mode: 0o700 });
  try {
    writeFileSync(join(temporary, MESSAGE_FILE), bytes, { flag: "wx", mode: 0o600 });
    writeFileSync(join(temporary, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(temporary, 0o700);
    try {
      renameSync(temporary, paths.directory);
    } catch (error) {
      if (!existsSync(paths.directory)) throw error;
    }
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
  }
  return publicArchive(readMailArchive({ ref, root }));
}

export function readMailArchive({ ref, root = defaultMailArchiveRoot() } = {}) {
  const paths = archivePaths(root, ref);
  assertPrivateDirectory(paths.root);
  assertPrivateDirectory(paths.accountDirectory);
  assertPrivateDirectory(paths.directory);
  assertRegularFile(paths.messagePath);
  assertRegularFile(paths.manifestPath);

  let manifest;
  try {
    const manifestInfo = statSync(paths.manifestPath);
    if (manifestInfo.size > 256 * 1024) throw archiveError("mail_archive_integrity_failed");
    manifest = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
  } catch (error) {
    if (error?.code?.startsWith?.("mail_archive_")) throw error;
    throw archiveError("mail_archive_integrity_failed");
  }
  validateManifest(manifest, ref);
  const messageInfo = statSync(paths.messagePath);
  if (messageInfo.size !== manifest.messageSize || messageInfo.size > MAX_ARCHIVED_MESSAGE_BYTES) {
    throw archiveError("mail_archive_integrity_failed");
  }
  const source = readFileSync(paths.messagePath);
  if (digest(source) !== manifest.messageSha256) throw archiveError("mail_archive_integrity_failed");
  return { ...manifest, source };
}

export function unavailableMailArchive(error) {
  const code = String(error?.code ?? "");
  const reason = [
    "mail_archive_message_too_large",
    "mail_archive_capacity_exceeded",
    "mail_archive_integrity_failed",
    "mail_archive_identity_invalid",
  ].includes(code) ? code : "mail_archive_unavailable";
  return { version: MAIL_ARCHIVE_VERSION, availability: "unavailable", reason };
}

function archivePaths(root, ref, { create = false } = {}) {
  const match = ARCHIVE_REF.exec(String(ref ?? ""));
  if (!match) throw archiveError("mail_archive_ref_invalid");
  const rootPath = resolve(root);
  if (create) {
    mkdirSync(rootPath, { recursive: true, mode: 0o700 });
    assertPrivateDirectory(rootPath);
    chmodSync(rootPath, 0o700);
  }
  const accountDirectory = confined(rootPath, match[1]);
  if (create) {
    mkdirSync(accountDirectory, { recursive: true, mode: 0o700 });
    assertPrivateDirectory(accountDirectory);
    chmodSync(accountDirectory, 0o700);
  }
  const directory = confined(accountDirectory, ref);
  return {
    root: rootPath,
    accountDirectory,
    directory,
    messagePath: confined(directory, MESSAGE_FILE),
    manifestPath: confined(directory, MANIFEST_FILE),
  };
}

function archiveSize(root) {
  let total = 0;
  for (const account of readdirSync(root, { withFileTypes: true })) {
    if (!account.isDirectory() || account.isSymbolicLink() || !/^[a-f0-9]{24}$/.test(account.name)) continue;
    const accountPath = confined(root, account.name);
    for (const entry of readdirSync(accountPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !ARCHIVE_REF.test(entry.name)) continue;
      const messagePath = confined(accountPath, entry.name, MESSAGE_FILE);
      if (!existsSync(messagePath) || lstatSync(messagePath).isSymbolicLink()) continue;
      const info = statSync(messagePath);
      if (info.isFile()) total += info.size;
      if (total > MAX_MAIL_ARCHIVE_BYTES) return total;
    }
  }
  return total;
}

function normalizeAttachments(input) {
  return (Array.isArray(input) ? input : []).slice(0, 50).map((item, index) => ({
    id: /^attachment-[1-9][0-9]*$/.test(String(item?.id ?? "")) ? String(item.id) : `attachment-${index + 1}`,
    name: bounded(item?.name, 255) || `attachment-${index + 1}`,
    contentType: bounded(item?.contentType, 127) || "application/octet-stream",
    size: Number.isSafeInteger(item?.size) ? Math.max(0, item.size) : 0,
    sha256: /^[a-f0-9]{64}$/.test(String(item?.sha256 ?? "")) ? String(item.sha256) : null,
    previewable: item?.previewable === true,
    ...(bounded(item?.contentId, 998) ? { contentId: bounded(item.contentId, 998) } : {}),
  }));
}

function validateManifest(manifest, ref) {
  if (!manifest || manifest.version !== MAIL_ARCHIVE_VERSION || manifest.ref !== ref
    || !/^[a-f0-9]{64}$/.test(String(manifest.messageSha256 ?? ""))
    || !Number.isSafeInteger(manifest.messageSize) || manifest.messageSize < 1
    || manifest.messageSize > MAX_ARCHIVED_MESSAGE_BYTES
    || typeof manifest.archivedAt !== "string" || manifest.archivedAt.length > 100
    || !Array.isArray(manifest.attachments) || manifest.attachments.length > 50) {
    throw archiveError("mail_archive_integrity_failed");
  }
}

function publicArchive(manifest) {
  return {
    version: manifest.version,
    ref: manifest.ref,
    availability: "available",
    sha256: manifest.messageSha256,
    size: manifest.messageSize,
    archivedAt: manifest.archivedAt,
    attachmentCount: manifest.attachmentCount,
  };
}

function assertPrivateDirectory(path) {
  if (!existsSync(path)) throw archiveError("mail_archive_not_found");
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory()) throw archiveError("mail_archive_path_invalid");
}

function assertRegularFile(path) {
  if (!existsSync(path)) throw archiveError("mail_archive_not_found");
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) throw archiveError("mail_archive_path_invalid");
}

function confined(root, ...parts) {
  const candidate = resolve(root, ...parts);
  const rel = relative(resolve(root), candidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw archiveError("mail_archive_path_invalid");
  return candidate;
}

function bounded(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function archiveError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
