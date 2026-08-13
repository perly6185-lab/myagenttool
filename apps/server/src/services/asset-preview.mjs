import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { classifyAsset } from "./asset-capabilities.mjs";
import { resolvePdfByteRange } from "./pdf-document-read.mjs";

const MAX_MARKDOWN_BYTES = 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_VIDEO_RANGE_BYTES = 4 * 1024 * 1024;

export class AssetPreviewError extends Error {
  constructor(code, message) { super(message); this.name = "AssetPreviewError"; this.code = code; }
}

export function readAssetPreview({ projectPath, relativeFile, range = null }) {
  const { target, path } = confinedRegularFile(projectPath, relativeFile);
  const classification = classifyAsset(path);
  if (!["markdown", "text", "image", "audio", "video"].includes(classification.family)) {
    throw new AssetPreviewError("asset_preview_unsupported", "This asset does not use the generic preview endpoint.");
  }
  if (classification.mimeType === "image/svg+xml") {
    throw new AssetPreviewError("active_image_preview_refused", "SVG must be opened externally because it may contain active content.");
  }
  let descriptor;
  try {
    descriptor = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    const limit = classification.family === "markdown" ? MAX_MARKDOWN_BYTES
      : classification.family === "text" ? MAX_TEXT_BYTES
      : classification.family === "image" ? MAX_IMAGE_BYTES
        : classification.family === "audio" ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES;
    if (stat.size > limit) throw new AssetPreviewError("asset_preview_too_large", "Asset exceeds the local preview limit.");
    assertSignature(descriptor, stat.size, classification.mimeType);
    if (classification.family === "video") {
      const resolved = range ? resolveVideoRange(range, stat.size) : { start: 0, end: Math.min(stat.size - 1, MAX_VIDEO_RANGE_BYTES - 1) };
      return { bytes: readBytes(descriptor, resolved.start, resolved.end), size: stat.size, ...resolved, ...classification, path, partial: true };
    }
    const bytes = readBytes(descriptor, 0, stat.size - 1);
    return {
      bytes, size: stat.size, start: 0, end: Math.max(0, stat.size - 1),
      ...classification, path, partial: false,
      ...(["markdown", "text"].includes(classification.family) ? { text: bytes.toString("utf8") } : {}),
    };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function confinedRegularFile(projectPath, relativeFile) {
  const requested = String(relativeFile ?? "").replaceAll("\\", "/");
  if (!requested || requested.includes("\0") || isAbsolute(requested)) throw new AssetPreviewError("invalid_asset_path", "Asset path must be project-relative.");
  const root = realpathSync(resolve(projectPath));
  const candidate = resolve(root, requested);
  assertContained(root, candidate);
  try {
    if (lstatSync(candidate).isSymbolicLink()) throw new AssetPreviewError("asset_symlink_refused", "Symbolic-link assets are not available for preview.");
    const target = realpathSync(candidate);
    assertContained(root, target);
    return { target, path: relative(root, target).split(sep).join("/") };
  } catch (error) {
    if (error instanceof AssetPreviewError) throw error;
    throw new AssetPreviewError("asset_not_found", "Asset was not found.");
  }
}

function resolveVideoRange(header, size) {
  let resolved;
  try {
    resolved = resolvePdfByteRange(header, size);
  } catch {
    throw new AssetPreviewError("invalid_asset_range", "Video byte range is invalid.");
  }
  if (resolved.end - resolved.start + 1 > MAX_VIDEO_RANGE_BYTES) {
    resolved.end = resolved.start + MAX_VIDEO_RANGE_BYTES - 1;
  }
  return resolved;
}

function readBytes(descriptor, start, end) {
  if (end < start) return Buffer.alloc(0);
  const bytes = Buffer.alloc(end - start + 1);
  readSync(descriptor, bytes, 0, bytes.length, start);
  return bytes;
}

function assertSignature(descriptor, size, mimeType) {
  const header = readBytes(descriptor, 0, Math.min(size, 16) - 1);
  const valid = mimeType === "image/png" ? header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === "image/jpeg" ? header[0] === 0xff && header[1] === 0xd8
      : mimeType === "image/gif" ? ["GIF87a", "GIF89a"].includes(header.subarray(0, 6).toString("ascii"))
        : mimeType === "image/webp" ? header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP"
          : mimeType === "image/avif" ? header.subarray(4, 12).toString("ascii").includes("ftyp")
            : mimeType === "video/mp4" || mimeType === "video/quicktime" ? header.subarray(4, 8).toString("ascii") === "ftyp"
              : mimeType === "video/webm" ? header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
                : mimeType === "audio/mpeg" ? header.subarray(0, 3).toString("ascii") === "ID3" || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
                  : mimeType === "audio/mp4" ? header.subarray(4, 8).toString("ascii") === "ftyp"
                    : mimeType === "audio/ogg" ? header.subarray(0, 4).toString("ascii") === "OggS"
                      : mimeType === "audio/wav" ? header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WAVE"
                : true;
  if (!valid) throw new AssetPreviewError("invalid_asset_signature", "Asset signature does not match its expected format.");
}

function assertContained(root, target) {
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new AssetPreviewError("asset_path_outside_project", "Asset path is outside the selected project.");
  }
}
