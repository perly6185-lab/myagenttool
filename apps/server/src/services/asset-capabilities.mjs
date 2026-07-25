import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";

export const ASSET_CAPABILITY_VERBS = Object.freeze([
  "discover", "preview", "inspect", "create", "edit", "transform",
  "render", "compare", "export", "open_external", "attach_evidence",
]);

const FAMILY_BY_EXTENSION = Object.freeze({
  ".canvas": "canvas", ".excalidraw": "canvas",
  ".docx": "word", ".xlsx": "excel", ".pptx": "powerpoint",
  ".pdf": "pdf",
  ".md": "markdown", ".mdx": "markdown",
  ".dxf": "cad_dxf", ".dwg": "cad_dwg",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image",
  ".webp": "image", ".avif": "image", ".svg": "image",
  ".mp4": "video", ".webm": "video", ".mov": "video",
});

const MIME_BY_EXTENSION = Object.freeze({
  ".canvas": "application/vnd.myagenttool.canvas+json",
  ".excalidraw": "application/vnd.excalidraw+json",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
  ".md": "text/markdown", ".mdx": "text/mdx",
  ".dxf": "image/vnd.dxf", ".dwg": "image/vnd.dwg",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime",
});

const MATRIX = Object.freeze({
  canvas: ["discover", "preview", "inspect", "create", "edit", "render", "compare", "export", "open_external", "attach_evidence"],
  word: ["discover", "preview", "inspect", "create", "edit", "compare", "export", "open_external", "attach_evidence"],
  excel: ["discover", "preview", "inspect", "create", "edit", "compare", "export", "open_external", "attach_evidence"],
  powerpoint: ["discover", "preview", "inspect", "create", "edit", "render", "compare", "export", "open_external", "attach_evidence"],
  pdf: ["discover", "preview", "inspect", "open_external", "attach_evidence"],
  markdown: ["discover", "preview", "inspect", "create", "edit", "transform", "render", "compare", "export", "open_external", "attach_evidence"],
  cad_dxf: ["discover", "preview", "inspect", "render", "open_external", "attach_evidence"],
  cad_dwg: ["discover", "preview", "inspect", "render", "open_external", "attach_evidence"],
  image: ["discover", "preview", "inspect", "compare", "open_external", "attach_evidence"],
  video: ["discover", "preview", "inspect", "open_external", "attach_evidence"],
  unknown: ["discover", "inspect", "open_external"],
});

const DEFAULT_RUNTIME_READINESS = Object.freeze({
  canvas: true, word: true, excel: true, powerpoint: true, pdf: true, markdown: true,
  cad_dxf: true, cad_dwg: false, image: true, video: true, unknown: true,
});

export function assetCapabilityMatrix() {
  return Object.fromEntries(Object.entries(MATRIX).map(([family, verbs]) => [family, {
    family,
    capabilities: [...verbs],
    mutationGovernance: ["canvas", "word", "excel", "powerpoint"].includes(family) ? "approval_and_audit" : "capability_gated",
    nativeEditing: !["cad_dxf", "cad_dwg", "image", "video", "unknown"].includes(family),
  }]));
}

export function classifyAsset(path) {
  const extension = extname(String(path ?? "")).toLowerCase();
  return {
    family: FAMILY_BY_EXTENSION[extension] ?? "unknown",
    extension: extension || null,
    mimeType: MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
  };
}

export function resolveAssetCapabilities(path, { runtimeReadiness = {} } = {}) {
  const classification = classifyAsset(path);
  const runtimeReady = runtimeReadiness[classification.family] ?? DEFAULT_RUNTIME_READINESS[classification.family];
  const readiness = runtimeReady
    ? { state: "ready", reason: "available_on_owning_terminal" }
    : { state: "waiting_capability", reason: classification.family === "cad_dwg" ? "dwg_preview_runtime_required" : "local_application_required" };
  const capabilities = [...MATRIX[classification.family]];
  if (classification.mimeType === "image/svg+xml") {
    capabilities.splice(capabilities.indexOf("preview"), 1);
  }
  return { ...classification, capabilities, readiness };
}

export function resolveConfinedAssetPath(projectRoot, relativePath) {
  const requested = String(relativePath ?? "").replaceAll("\\", "/");
  if (!requested || requested.includes("\0") || isAbsolute(requested)) throw assetError("invalid_asset_path");
  const root = realpathSync(resolve(projectRoot));
  const target = realpathSync(resolve(root, requested));
  const confined = relative(root, target);
  if (!confined || confined === ".." || confined.startsWith(`..${sep}`) || isAbsolute(confined)) throw assetError("asset_path_outside_project");
  return { root, target, relativePath: confined.split(sep).join("/") };
}

export function describeProjectAsset({ projectId, projectRoot, relativePath, terminalId, worktreeId = null, runtimeReadiness = {} }) {
  const confined = resolveConfinedAssetPath(projectRoot, relativePath);
  const stat = statSync(confined.target);
  if (!stat.isFile()) throw assetError("asset_not_file");
  const resolved = resolveAssetCapabilities(confined.relativePath, { runtimeReadiness });
  return {
    id: createHash("sha256").update(`${projectId}\0${worktreeId ?? ""}\0${confined.relativePath}`).digest("hex").slice(0, 24),
    projectId,
    worktreeId,
    terminalId,
    name: basename(confined.relativePath),
    path: confined.relativePath,
    family: resolved.family,
    mimeType: resolved.mimeType,
    size: stat.size,
    hash: hashFile(confined.target),
    version: `${stat.size}-${Math.trunc(stat.mtimeMs)}`,
    capabilities: resolved.capabilities,
    readiness: resolved.readiness,
    sensitivity: "project_local",
    preview: {
      available: resolved.capabilities.includes("preview") && resolved.readiness.state === "ready",
      sandboxed: true,
      remoteResources: false,
      maxInlineBytes: 8 * 1024 * 1024,
      delivery: resolved.family === "video" ? "range_stream" : "bounded",
    },
  };
}

export function evaluateAssetRequirements(descriptors, requiredCapabilities, terminalId) {
  const assets = Array.isArray(descriptors) ? descriptors : [];
  if (assets.some((asset) => asset.terminalId !== terminalId)) {
    return { state: "refused", reason: "asset_terminal_mismatch", terminalId };
  }
  for (const capability of requiredCapabilities ?? []) {
    const supported = assets.some((asset) => asset.capabilities?.includes(capability) && asset.readiness?.state === "ready");
    if (!supported) return { state: "waiting_capability", reason: `missing_local_capability:${capability}`, terminalId };
  }
  return { state: "ready", reason: "asset_requirements_satisfied", terminalId };
}

export function summarizeAssetForRemote(descriptor) {
  return {
    id: descriptor.id,
    projectId: descriptor.projectId,
    worktreeId: descriptor.worktreeId ?? null,
    terminalId: descriptor.terminalId,
    name: String(descriptor.name ?? "").slice(0, 200),
    path: String(descriptor.path ?? "").slice(0, 1_000),
    family: descriptor.family,
    size: descriptor.size,
    version: descriptor.version,
    capabilities: [...(descriptor.capabilities ?? [])],
    readiness: descriptor.readiness,
    previewAvailable: Boolean(descriptor.preview?.available),
    owningTerminalDeepLink: `/?section=documents&project=${encodeURIComponent(descriptor.projectId)}&document=${encodeURIComponent(descriptor.path)}`,
    directOperationsAllowed: false,
  };
}

function hashFile(path) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = openSync(path, "r");
  try {
    let bytes;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
  } finally {
    closeSync(fd);
  }
  return `sha256:${hash.digest("hex")}`;
}

function assetError(code) {
  return Object.assign(new Error(code), { code });
}
