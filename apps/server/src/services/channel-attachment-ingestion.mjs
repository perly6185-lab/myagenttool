import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { validateExternalWebhookTarget } from "./auto-run-alerts.mjs";
import { classifyAsset, resolveAssetCapabilities } from "./asset-capabilities.mjs";

export const MAX_CHANNEL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const ACTIVE_EXTENSIONS = new Set([".html", ".htm", ".svg", ".js", ".mjs", ".cjs", ".exe", ".dll", ".bat", ".cmd", ".ps1", ".sh"]);

export async function ingestChannelAttachmentCandidates({
  candidates,
  projectPath,
  projectId,
  terminalId,
  fetchAttachment = fetch,
  resolveHostname,
} = {}) {
  if (!projectPath || !projectId || !terminalId) throw attachmentError("channel_attachment_binding_required");
  const list = Array.isArray(candidates) ? candidates.slice(0, MAX_ATTACHMENTS) : [];
  const assets = [];
  for (const candidate of list) {
    const sourceUrl = String(candidate?.sourceUrl ?? "").trim();
    const filename = safeFilename(candidate?.filename);
    if (!sourceUrl || !filename) throw attachmentError("invalid_channel_attachment");
    if (ACTIVE_EXTENSIONS.has(extname(filename).toLowerCase())) throw attachmentError("active_channel_attachment_refused");
    const target = await validateExternalWebhookTarget(sourceUrl, resolveHostname ? { resolveHostname } : {});
    if (!target.ok) throw attachmentError("channel_attachment_source_refused");
    const response = await fetchAttachment(target.url, { redirect: "manual" });
    if (!response?.ok) throw attachmentError("channel_attachment_download_failed");
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CHANNEL_ATTACHMENT_BYTES) {
      throw attachmentError("channel_attachment_too_large");
    }
    const bytes = await readBoundedBody(response.body, MAX_CHANNEL_ATTACHMENT_BYTES);
    assets.push(await ingestChannelAttachmentBytes({
      filename,
      bytes,
      contentType: response.headers?.get?.("content-type"),
      projectPath,
      projectId,
      terminalId,
    }));
  }
  return assets;
}

/**
 * Store bytes that have already been downloaded by a trusted provider client.
 * iLink media is downloaded and decrypted before it reaches this boundary, so
 * it must use the same MIME/signature/path checks as external attachments.
 */
export async function ingestChannelAttachmentBytes({
  filename,
  bytes,
  contentType = null,
  projectPath,
  projectId,
  terminalId,
} = {}) {
  if (!projectPath || !projectId || !terminalId) throw attachmentError("channel_attachment_binding_required");
  const safeName = safeFilename(filename);
  if (!safeName) throw attachmentError("invalid_channel_attachment");
  if (ACTIVE_EXTENSIONS.has(extname(safeName).toLowerCase())) throw attachmentError("active_channel_attachment_refused");
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (!buffer.length) throw attachmentError("channel_attachment_empty");
  if (buffer.length > MAX_CHANNEL_ATTACHMENT_BYTES) throw attachmentError("channel_attachment_too_large");
  const classification = resolveAssetCapabilities(safeName);
  assertContentType(contentType, classification.mimeType);
  assertSignature(buffer, classification.mimeType);
  const stored = storeConfinedAttachment({ projectPath, filename: safeName, bytes: buffer });
  const digest = createHash("sha256").update(buffer).digest("hex");
  return {
    id: `asset_${digest.slice(0, 24)}`,
    projectId,
    terminalId,
    path: stored.path,
    family: classification.family,
    hash: `sha256:${digest}`,
    version: digest,
    size: buffer.length,
    resourceClass: buffer.length > 10 * 1024 * 1024 ? "large" : buffer.length > 1024 * 1024 ? "medium" : "small",
    capabilities: classification.capabilities ?? [],
    readiness: { state: "ready" },
  };
}

async function readBoundedBody(body, limit) {
  if (!body?.getReader) throw attachmentError("channel_attachment_body_unavailable");
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw attachmentError("channel_attachment_too_large");
    }
    chunks.push(Buffer.from(value));
  }
  if (!total) throw attachmentError("channel_attachment_empty");
  return Buffer.concat(chunks, total);
}

function storeConfinedAttachment({ projectPath, filename, bytes }) {
  const root = realpathSync(resolve(projectPath));
  const directory = join(root, ".myagenttool", "channel-attachments");
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw attachmentError("channel_attachment_path_refused");
  mkdirSync(directory, { recursive: true });
  const realDirectory = realpathSync(directory);
  const rel = relative(root, realDirectory);
  if (rel === ".." || rel.startsWith(`..${sep}`)) throw attachmentError("channel_attachment_path_refused");
  const storedName = `${randomBytes(6).toString("hex")}-${filename}`;
  writeFileSync(join(realDirectory, storedName), bytes, { flag: "wx", mode: 0o600 });
  return { path: relative(root, join(realDirectory, storedName)).split(sep).join("/") };
}

function safeFilename(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.includes("\0") || raw.includes("/") || raw.includes("\\")) return null;
  const cleaned = basename(raw).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : null;
}

function assertContentType(value, expected) {
  const actual = String(value ?? "").split(";")[0].trim().toLowerCase();
  if (actual && expected && actual !== "application/octet-stream" && actual !== expected) {
    throw attachmentError("channel_attachment_mime_mismatch");
  }
}

function assertSignature(bytes, mimeType) {
  const valid = mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8
      : mimeType === "image/gif" ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
        : mimeType === "video/mp4" || mimeType === "video/quicktime" ? bytes.subarray(4, 8).toString("ascii") === "ftyp"
          : [".docx", ".xlsx", ".pptx"].some((extension) => classifyAsset(`x${extension}`).mimeType === mimeType)
            ? bytes.subarray(0, 2).toString("binary") === "PK"
            : true;
  if (!valid) throw attachmentError("channel_attachment_signature_mismatch");
}

function attachmentError(code) {
  return Object.assign(new Error(code), { code });
}
