import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";

export function registerMailAttachmentHandler({ ipcMain, dialog, getWindow, readAttachment }) {
  ipcMain.removeHandler("mail:preview-attachment");
  ipcMain.removeHandler("mail:download-attachment");
  ipcMain.removeHandler("mail:read-attachment-for-task");

  ipcMain.handle("mail:preview-attachment", async (_event, input) => {
    try {
      const preview = await readAttachment({
        messageId: bounded(input?.messageId, 998),
        folderPath: bounded(input?.folderPath ?? "INBOX", 998),
        attachmentId: bounded(input?.attachmentId, 100),
        purpose: "preview",
      });
      const { content: _content, ...publicPreview } = preview;
      return { ok: true, preview: publicPreview };
    } catch (error) {
      return { ok: false, error: publicCode(error) };
    }
  });

  ipcMain.handle("mail:download-attachment", async (_event, input) => {
    try {
      const attachment = await readAttachment({
        messageId: bounded(input?.messageId, 998),
        folderPath: bounded(input?.folderPath ?? "INBOX", 998),
        attachmentId: bounded(input?.attachmentId, 100),
        purpose: "download",
      });
      const suggestedName = safeFilename(attachment.name);
      const chosen = await dialog.showSaveDialog(getWindow(), {
        title: "保存邮件附件",
        defaultPath: suggestedName,
        buttonLabel: "保存",
      });
      if (chosen.canceled || !chosen.filePath) return { ok: true, saved: false };
      writeFileSync(chosen.filePath, attachment.content, { flag: "w" });
      return { ok: true, saved: true, name: basename(chosen.filePath) };
    } catch (error) {
      return { ok: false, error: publicCode(error) };
    }
  });

  ipcMain.handle("mail:read-attachment-for-task", async (_event, input) => {
    try {
      const attachment = await readAttachment({
        messageId: bounded(input?.messageId, 998),
        folderPath: bounded(input?.folderPath ?? "INBOX", 998),
        attachmentId: bounded(input?.attachmentId, 100),
        purpose: "download",
      });
      const bytes = attachment.content.buffer.slice(
        attachment.content.byteOffset,
        attachment.content.byteOffset + attachment.content.byteLength,
      );
      return {
        ok: true,
        attachment: {
          id: bounded(input?.attachmentId, 100),
          name: safeFilename(attachment.name),
          contentType: bounded(attachment.contentType || "application/octet-stream", 127),
          size: attachment.content.length,
          sha256: createHash("sha256").update(attachment.content).digest("hex"),
          data: bytes,
        },
      };
    } catch (error) {
      return { ok: false, error: publicCode(error) };
    }
  });
}

function bounded(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function safeFilename(value) {
  const name = basename(String(value ?? "attachment")).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return name.slice(0, 180) || "attachment";
}

function publicCode(error) {
  const code = String(error?.code ?? error?.message ?? "");
  return ["attachment_not_found", "preview_not_supported", "preview_too_large", "download_too_large"].includes(code)
    ? code
    : "attachment_unavailable";
}
