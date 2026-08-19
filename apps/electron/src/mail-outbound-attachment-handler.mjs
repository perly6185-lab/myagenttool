import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export function registerMailOutboundAttachmentHandler({ ipcMain, dialog, getWindow, attachmentRoot, getReferencedAttachmentRefs = null }) {
  ipcMain.removeHandler("mail:pick-outbound-attachments");
  ipcMain.removeHandler("mail:stage-pasted-attachments");
  if (typeof getReferencedAttachmentRefs === "function") {
    void Promise.resolve()
      .then(() => getReferencedAttachmentRefs())
      .then((referencedRefs) => pruneStagedMailAttachments(attachmentRoot, { referencedRefs }))
      .catch(() => { /* startup cleanup must never make live draft attachments unavailable */ });
  }

  ipcMain.handle("mail:pick-outbound-attachments", async () => {
    const chosen = await dialog.showOpenDialog(getWindow(), {
      title: "选择邮件附件",
      buttonLabel: "添加附件",
      properties: ["openFile", "multiSelections"],
    });
    if (chosen.canceled || !chosen.filePaths?.length) return { ok: true, attachments: [] };
    try {
      if (chosen.filePaths.length > MAX_FILES) throw publicError("attachment_invalid");
      const files = chosen.filePaths.map((path) => {
        const info = lstatSync(path);
        if (!info.isFile() || info.isSymbolicLink()) throw publicError("attachment_invalid");
        return { path: realpathSync(path), name: safeFilename(path), size: info.size, contentType: contentTypeOf(path) };
      });
      enforceLimits(files);
      return { ok: true, attachments: files.map((file) => stageFile(attachmentRoot, file)) };
    } catch (error) {
      return { ok: false, error: publicCode(error) };
    }
  });

  ipcMain.handle("mail:stage-pasted-attachments", async (_event, input) => {
    try {
      const incoming = Array.isArray(input?.files) ? input.files : [];
      if (incoming.length > MAX_FILES) throw publicError("attachment_invalid");
      const files = incoming.map((file) => {
        const bytes = Buffer.from(file?.data instanceof ArrayBuffer ? file.data : new Uint8Array(file?.data ?? []));
        return { bytes, name: safeFilename(file?.name), size: bytes.length, contentType: boundedType(file?.contentType) };
      });
      enforceLimits(files);
      return { ok: true, attachments: files.map((file) => stageBytes(attachmentRoot, file)) };
    } catch (error) {
      return { ok: false, error: publicCode(error) };
    }
  });
}

export function pruneStagedMailAttachments(root, { now = Date.now(), retentionMs = DEFAULT_RETENTION_MS, referencedRefs = null } = {}) {
  if (!root || !existsSync(root)) return { removed: 0 };
  if (!referencedRefs || typeof referencedRefs[Symbol.iterator] !== "function") return { removed: 0 };
  const liveRefs = new Set([...referencedRefs].map((value) => String(value ?? "")));
  let removed = 0;
  for (const name of readdirSync(root)) {
    const match = /^(mailatt_[a-f0-9-]{36})\.(?:bin|json)$/.exec(name);
    if (!match || liveRefs.has(match[1])) continue;
    const path = join(root, name);
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || now - info.mtimeMs < retentionMs) continue;
    try { unlinkSync(path); removed += 1; } catch { /* best-effort orphan cleanup */ }
  }
  return { removed };
}

function stageFile(root, file) {
  const attachment = metadata(file);
  ensureRoot(root);
  copyFileSync(file.path, join(root, `${attachment.ref}.bin`));
  chmodSync(join(root, `${attachment.ref}.bin`), 0o600);
  writeMetadata(root, attachment);
  return attachment;
}

function stageBytes(root, file) {
  const attachment = metadata(file);
  ensureRoot(root);
  writeFileSync(join(root, `${attachment.ref}.bin`), file.bytes, { flag: "wx", mode: 0o600 });
  writeMetadata(root, attachment);
  return attachment;
}

function metadata(file) {
  return { ref: `mailatt_${randomUUID()}`, name: file.name, contentType: file.contentType, size: file.size };
}

function writeMetadata(root, attachment) {
  writeFileSync(join(root, `${attachment.ref}.json`), `${JSON.stringify(attachment)}\n`, { flag: "wx", encoding: "utf8", mode: 0o600 });
}

function ensureRoot(root) { mkdirSync(root, { recursive: true, mode: 0o700 }); }

function enforceLimits(files) {
  if (!files.length || files.length > MAX_FILES) throw publicError("attachment_invalid");
  if (files.some((file) => !Number.isInteger(file.size) || file.size < 0 || file.size > MAX_TOTAL_BYTES)) throw publicError("attachment_too_large");
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw publicError("attachment_too_large");
}

function safeFilename(value) {
  return (basename(String(value ?? "attachment")).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 180) || "attachment");
}

function boundedType(value) {
  const type = String(value ?? "application/octet-stream").trim().toLowerCase().slice(0, 127);
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) ? type : "application/octet-stream";
}

function contentTypeOf(path) {
  const extension = basename(path).split(".").pop()?.toLowerCase();
  return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", txt: "text/plain", csv: "text/csv", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" })[extension] ?? "application/octet-stream";
}

function publicError(code) { const error = new Error(code); error.code = code; return error; }
function publicCode(error) { return ["attachment_invalid", "attachment_too_large"].includes(error?.code) ? error.code : "attachment_stage_failed"; }
