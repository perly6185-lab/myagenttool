import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../workers/cad-preview.py");
export const CAD_PREVIEW_EXTENSIONS = new Set([".dxf", ".dwg"]);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_WORKER_BYTES = 10 * 1024 * 1024;
const MAX_SVG_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export class CadPreviewError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function resolveCadDocument(projectPath, relativeFile) {
  const rel = String(relativeFile ?? "").trim().replaceAll("\\", "/");
  if (!rel || rel.startsWith("/") || rel.startsWith("~") || rel.split("/").includes("..") || /^[A-Za-z]:/.test(rel)) {
    throw new CadPreviewError("cad_invalid_path", "A contained project-relative CAD path is required.");
  }
  const extension = extname(rel).toLowerCase();
  if (!CAD_PREVIEW_EXTENSIONS.has(extension)) throw new CadPreviewError("cad_unsupported_type", "CAD preview supports only .dxf and .dwg files.");
  const root = realpathSync(resolve(projectPath));
  const candidate = resolve(root, rel);
  const lexical = relative(root, candidate);
  if (!lexical || lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) throw new CadPreviewError("cad_path_escape", "Requested CAD file escapes the project root.");
  if (!existsSync(candidate)) throw new CadPreviewError("cad_not_found", "Requested CAD file does not exist.");
  const target = realpathSync(candidate);
  const contained = relative(root, target);
  if (!contained || contained === ".." || contained.startsWith(`..${sep}`) || isAbsolute(contained)) throw new CadPreviewError("cad_path_escape", "Requested CAD file escapes the project root.");
  const stat = statSync(target);
  if (!stat.isFile()) throw new CadPreviewError("cad_invalid_file", "Requested CAD path is not a regular file.");
  if (stat.size > MAX_FILE_BYTES) throw new CadPreviewError("cad_file_too_large", "CAD file exceeds the 25 MiB preview limit.");
  validateCadSignature(target, extension);
  return { root, target, relPath: relative(root, target).replaceAll("\\", "/"), extension, size: stat.size };
}

function validateCadSignature(target, extension) {
  const buffer = Buffer.alloc(4096);
  const descriptor = openSync(target, "r");
  let bytes;
  try { bytes = readSync(descriptor, buffer, 0, buffer.length, 0); } finally { closeSync(descriptor); }
  const head = buffer.subarray(0, bytes);
  if (extension === ".dwg") {
    if (!/^AC10\d{2}/.test(head.subarray(0, 6).toString("ascii"))) throw new CadPreviewError("cad_invalid_signature", "DWG signature does not match its extension.");
    return;
  }
  const binary = head.subarray(0, 22).toString("binary").startsWith("AutoCAD Binary DXF");
  const ascii = /(?:^|\r?\n)\s*SECTION\s*(?:\r?\n|$)/i.test(head.toString("latin1"));
  if (!binary && !ascii) throw new CadPreviewError("cad_invalid_signature", "DXF signature does not match its extension.");
}

export async function inspectCadDocument({ projectPath, relativeFile, timeoutMs = DEFAULT_TIMEOUT_MS, run } = {}) {
  return processCadDocument({ projectPath, relativeFile, action: "inspect", timeoutMs, run });
}

export async function renderCadDocument({ projectPath, relativeFile, layout = "Model", visibleLayers, timeoutMs = DEFAULT_TIMEOUT_MS, run } = {}) {
  return processCadDocument({ projectPath, relativeFile, action: "render", layout, visibleLayers, timeoutMs, run });
}

async function processCadDocument({ projectPath, relativeFile, action, layout, visibleLayers, timeoutMs, run }) {
  if (!projectPath) throw new CadPreviewError("cad_invalid_project", "A project path is required.");
  const document = resolveCadDocument(projectPath, relativeFile);
  if (document.extension === ".dwg") throw new CadPreviewError("oda_unavailable", "DWG preview requires an approved operator-installed ODA File Converter.");
  const request = { action, file: document.target, ...(layout ? { layout: String(layout).slice(0, 120) } : {}), ...(Array.isArray(visibleLayers) ? { visibleLayers: visibleLayers.slice(0, 512).map((item) => String(item).slice(0, 255)) } : {}) };
  let output;
  try {
    output = await (run ?? runCadWorker)(request, { timeoutMs });
  } catch (error) {
    if (error instanceof CadPreviewError) throw error;
    throw new CadPreviewError("cad_processing_failed", "CAD preview worker failed.");
  }
  const parsed = typeof output === "string" ? parseWorkerOutput(output) : output;
  if (!parsed?.ok) throw new CadPreviewError(safeWorkerCode(parsed?.error), safeWorkerMessage(parsed?.message));
  const result = normalizeWorkerResult(parsed, action);
  return { path: document.relPath, size: document.size, ...result };
}

function parseWorkerOutput(output) {
  if (Buffer.byteLength(output, "utf8") > MAX_WORKER_BYTES) throw new CadPreviewError("cad_output_too_large", "CAD preview output exceeded its limit.");
  try { return JSON.parse(output); } catch { throw new CadPreviewError("cad_processing_failed", "CAD preview worker returned invalid output."); }
}

function normalizeWorkerResult(value, action) {
  const layouts = boundedStrings(value.layouts, 32, 255, "cad_layout_limit_exceeded");
  const layers = boundedStrings(value.layers, 512, 255, "cad_layer_limit_exceeded");
  const texts = Array.isArray(value.texts) ? value.texts.slice(0, 10_000).map((item) => ({ text: String(item?.text ?? "").slice(0, 2_000), type: String(item?.type ?? "").slice(0, 32), layer: String(item?.layer ?? "").slice(0, 255) })) : [];
  const result = { version: String(value.version ?? "unknown").slice(0, 32), units: Number.isInteger(value.units) ? value.units : 0, extents: normalizeExtents(value.extents), layouts, layers, entityCounts: normalizeEntityCounts(value.entityCounts), texts, warnings: boundedStrings(value.warnings, 500, 500, "cad_warning_limit_exceeded"), audit: { errors: boundedCount(value.audit?.errors), fixes: boundedCount(value.audit?.fixes) } };
  if (action === "render") {
    const svg = String(value.svg ?? "");
    if (Buffer.byteLength(svg, "utf8") > MAX_SVG_BYTES) throw new CadPreviewError("cad_output_too_large", "CAD SVG exceeded the 8 MiB preview limit.");
    if (!/^<svg\b/i.test(svg.trim()) || /<script\b|<foreignObject\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:|javascript:)/i.test(svg)) throw new CadPreviewError("cad_svg_rejected", "CAD SVG did not pass the safety policy.");
    result.svg = svg;
  }
  return result;
}

function normalizeExtents(value) {
  if (!value || !Array.isArray(value.min) || !Array.isArray(value.max)) return null;
  const min = value.min.slice(0, 3).map(Number);
  const max = value.max.slice(0, 3).map(Number);
  return min.length === 3 && max.length === 3 && [...min, ...max].every(Number.isFinite) ? { min, max } : null;
}

function normalizeEntityCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 256).map(([key, count]) => [String(key).slice(0, 32), boundedCount(count)]));
}

function boundedCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.min(100_000, Math.max(0, Math.trunc(count))) : 0;
}

function boundedStrings(value, maxItems, maxLength, code) {
  if (!Array.isArray(value)) return [];
  if (value.length > maxItems) throw new CadPreviewError(code, "CAD preview metadata exceeded its limit.");
  return value.map((item) => String(item ?? "").slice(0, maxLength));
}

function safeWorkerCode(value) {
  const code = String(value ?? "cad_processing_failed");
  return /^cad_[a-z0-9_]+$/.test(code) ? code : "cad_processing_failed";
}
function safeWorkerMessage(value) { return /^CAD |^DXF |^Drawing |^Requested |^Renderer /.test(String(value ?? "")) ? String(value).slice(0, 300) : "CAD preview could not be produced."; }

function runCadWorker(request, { timeoutMs }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("python3", [WORKER_PATH], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true, env: { PATH: process.env.PATH ?? "" } });
    const chunks = [];
    let bytes = 0;
    const timer = setTimeout(() => { child.kill("SIGTERM"); rejectPromise(new CadPreviewError("cad_processing_timeout", `CAD processing timed out after ${timeoutMs} ms.`)); }, timeoutMs);
    child.stdout.on("data", (chunk) => { bytes += chunk.length; if (bytes > MAX_WORKER_BYTES) { child.kill("SIGTERM"); rejectPromise(new CadPreviewError("cad_output_too_large", "CAD preview output exceeded its limit.")); } else chunks.push(chunk); });
    child.on("error", (error) => { clearTimeout(timer); rejectPromise(new CadPreviewError(error?.code === "ENOENT" ? "ezdxf_unavailable" : "cad_processing_failed", error?.code === "ENOENT" ? "Python/ezdxf preview runtime is unavailable." : "CAD preview worker failed.")); });
    child.on("close", (code) => { clearTimeout(timer); if (code !== 0) rejectPromise(new CadPreviewError("ezdxf_unavailable", "Python/ezdxf preview runtime is unavailable or unhealthy.")); else resolvePromise(Buffer.concat(chunks).toString("utf8")); });
    child.stdin.end(JSON.stringify(request));
  });
}
