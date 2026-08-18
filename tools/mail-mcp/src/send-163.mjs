import { existsSync, lstatSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import nodemailer from "nodemailer";

const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;

export async function verify163SendCredential({ username, authorizationCode }) {
  const transport = createTransport({ username, authorizationCode });
  try { await transport.verify(); } finally { transport.close(); }
}

export async function send163Mail(args, { credential = readSendCredential(), attachmentRoot = defaultAttachmentRoot(), transportFactory = createTransport } = {}) {
  const to = bounded(args?.to, 998);
  const subject = bounded(args?.subject, 400) || "(no subject)";
  const body = bounded(args?.body, 20_000);
  if (!to || !body) throw new Error("mail_draft_incomplete");
  const attachments = resolveAttachments(args?.attachments, attachmentRoot);
  const transport = transportFactory(credential);
  try {
    const receipt = await transport.sendMail({
      from: credential.username,
      to,
      subject,
      text: body,
      ...(args?.inReplyTo ? { inReplyTo: bounded(args.inReplyTo, 998) } : {}),
      ...(Array.isArray(args?.references) ? { references: args.references.map((item) => bounded(item, 998)).filter(Boolean).slice(0, 50) } : {}),
      attachments,
    });
    const sentMessageId = bounded(receipt?.messageId, 998);
    if (!sentMessageId) throw new Error("mail_send_receipt_missing");
    cleanupSentAttachments(args?.attachments, attachmentRoot);
    return { sent: true, sentMessageId };
  } finally {
    transport.close();
  }
}

export function cleanupSentAttachments(input, root = defaultAttachmentRoot()) {
  if (!Array.isArray(input)) return { removed: 0 };
  const resolvedRoot = resolve(root);
  let removed = 0;
  for (const item of input) {
    const ref = bounded(item?.ref, 80);
    if (!/^mailatt_[a-f0-9-]{36}$/.test(ref)) continue;
    for (const extension of ["bin", "json"]) {
      try { unlinkSync(join(resolvedRoot, `${ref}.${extension}`)); removed += 1; } catch { /* receipt is authoritative; cleanup is best effort */ }
    }
  }
  return { removed };
}

export function resolveAttachments(input, root = defaultAttachmentRoot()) {
  if (!Array.isArray(input) || input.length > MAX_FILES) throw new Error("mail_attachments_invalid");
  const resolvedRoot = resolve(root);
  let total = 0;
  return input.map((item) => {
    const ref = bounded(item?.ref, 80);
    if (!/^mailatt_[a-f0-9-]{36}$/.test(ref)) throw new Error("mail_attachments_invalid");
    const metadataPath = join(resolvedRoot, `${ref}.json`);
    const contentPath = join(resolvedRoot, `${ref}.bin`);
    if (!existsSync(metadataPath) || !existsSync(contentPath)) throw new Error("mail_attachment_not_found");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    const info = lstatSync(contentPath);
    if (!info.isFile() || info.isSymbolicLink() || dirname(realpathSync(contentPath)) !== realpathSync(resolvedRoot)) throw new Error("mail_attachment_invalid");
    if (metadata.ref !== ref || metadata.name !== item.name || metadata.contentType !== item.contentType || metadata.size !== item.size || info.size !== item.size) throw new Error("mail_attachment_changed");
    total += info.size;
    if (total > MAX_BYTES) throw new Error("mail_attachments_too_large");
    return { filename: metadata.name, contentType: metadata.contentType, path: contentPath };
  });
}

export function defaultAttachmentRoot(env = process.env) {
  const base = env.APPDATA || (env.USERPROFILE && join(env.USERPROFILE, "AppData", "Roaming"));
  if (!base) throw new Error("not_authorized: user profile is unavailable");
  return join(base, "myagenttool", "mail", "outbox-attachments");
}

export function readSendCredential(path = defaultSendCredentialPath()) {
  if (!existsSync(path)) throw new Error("not_authorized: connect 163 Mail sending in MyAgentTool");
  const record = JSON.parse(readFileSync(path, "utf8"));
  if (record.provider !== "netease" || record.scope !== "smtp.send" || !record.username || !record.protectedAuthorizationCode) throw new Error("not_authorized: the 163 send credential is invalid");
  return { username: String(record.username), authorizationCode: unprotect(String(record.protectedAuthorizationCode)) };
}

function defaultSendCredentialPath(env = process.env) {
  const base = env.APPDATA || (env.USERPROFILE && join(env.USERPROFILE, "AppData", "Roaming"));
  if (!base) throw new Error("not_authorized: user profile is unavailable");
  return join(base, "myagenttool", "mail", "163-send.json");
}

function createTransport({ username, authorizationCode }) {
  return nodemailer.createTransport({ host: "smtp.163.com", port: 465, secure: true, auth: { user: username, pass: authorizationCode }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 });
}

function unprotect(protectedValue) {
  if (process.platform !== "win32") throw new Error("not_authorized: 163 Mail credential decryption requires Windows DPAPI");
  const script = ["$ErrorActionPreference='Stop'", "$s=ConvertTo-SecureString $env:MAT_PROTECTED_SECRET", "$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)", "try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}"].join(";");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, env: { SYSTEMROOT: process.env.SYSTEMROOT, windir: process.env.windir, MAT_PROTECTED_SECRET: protectedValue } });
  if (result.status !== 0 || !result.stdout) throw new Error("not_authorized: the 163 Mail authorization code could not be decrypted");
  return result.stdout;
}

function bounded(value, max) { return String(value ?? "").trim().slice(0, max); }
