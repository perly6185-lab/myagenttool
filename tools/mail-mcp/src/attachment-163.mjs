import { fetch163ParsedMessage } from "./imap-163.mjs";
import { attachmentMetadataOf, previewKind } from "./message.mjs";

const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export async function read163Attachment({ messageId, attachmentId, purpose = "preview" }) {
  const { parsed } = await fetch163ParsedMessage(messageId);
  const attachments = parsed?.attachments ?? [];
  const index = attachmentIndex(attachmentId, attachments.length);
  if (index < 0) throw publicAttachmentError("attachment_not_found");
  const attachment = attachments[index];
  const metadata = attachmentMetadataOf(attachment, index);
  const content = Buffer.from(attachment?.content ?? []);
  if (purpose === "preview") {
    return attachmentPreviewPayload(metadata, content);
  }
  if (content.length > MAX_DOWNLOAD_BYTES) throw publicAttachmentError("download_too_large");
  return { ...metadata, content };
}

export function attachmentPreviewPayload(metadata, content) {
  const bytes = Buffer.from(content ?? []);
  const kind = previewKind(metadata?.contentType);
  if (!kind) throw publicAttachmentError("preview_not_supported");
  if (bytes.length > MAX_PREVIEW_BYTES) throw publicAttachmentError("preview_too_large");
  if (!signatureMatches(kind, bytes)) throw publicAttachmentError("preview_not_supported");
  return {
    ...metadata,
    kind,
    ...(kind === "text" ? { text: bytes.toString("utf8") } : { dataBase64: bytes.toString("base64") }),
  };
}

function attachmentIndex(value, count) {
  const match = /^attachment-(\d+)$/.exec(String(value ?? ""));
  const index = match ? Number(match[1]) - 1 : -1;
  return index >= 0 && index < count ? index : -1;
}

function signatureMatches(kind, content) {
  if (kind === "text") return !content.subarray(0, 4096).includes(0);
  if (kind === "pdf") return content.subarray(0, 5).toString("ascii") === "%PDF-";
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return true;
  if (["GIF87a", "GIF89a"].includes(content.subarray(0, 6).toString("ascii"))) return true;
  return content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP";
}

function publicAttachmentError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
