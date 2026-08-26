import { spawn, spawnSync } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../workers/cad-preview.py");
export const CAD_PREVIEW_EXTENSIONS = new Set([".dxf", ".dwg"]);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_WORKER_BYTES = 10 * 1024 * 1024;
const MAX_SVG_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const TERMINATE_GRACE_MS = 1_000;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const RUNTIME_ROOT = resolve(REPO_ROOT, ".runtime");

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
  const snapshot = readSnapshot(target);
  validateCadSignature(snapshot, extension);
  return { root, target, relPath: relative(root, target).replaceAll("\\", "/"), extension, size: snapshot.length, snapshot };
}

function validateCadSignature(snapshot, extension) {
  const head = snapshot.subarray(0, 4096);
  if (extension === ".dwg") {
    if (!/^AC10\d{2}/.test(head.subarray(0, 6).toString("ascii"))) throw new CadPreviewError("cad_invalid_signature", "DWG signature does not match its extension.");
    return;
  }
  const binary = head.subarray(0, 22).toString("binary").startsWith("AutoCAD Binary DXF");
  const ascii = /(?:^|\r?\n)\s*SECTION\s*(?:\r?\n|$)/i.test(head.toString("latin1"));
  if (!binary && !ascii) throw new CadPreviewError("cad_invalid_signature", "DXF signature does not match its extension.");
}

export async function inspectCadDocument({ projectPath, relativeFile, timeoutMs = DEFAULT_TIMEOUT_MS, run, signal } = {}) {
  return processCadDocument({ projectPath, relativeFile, action: "inspect", timeoutMs, run, signal });
}

export async function renderCadDocument({ projectPath, relativeFile, layout = "Model", visibleLayers, timeoutMs = DEFAULT_TIMEOUT_MS, run, signal } = {}) {
  return processCadDocument({ projectPath, relativeFile, action: "render", layout, visibleLayers, timeoutMs, run, signal });
}

async function processCadDocument({ projectPath, relativeFile, action, layout, visibleLayers, timeoutMs, run, signal }) {
  if (!projectPath) throw new CadPreviewError("cad_invalid_project", "A project path is required.");
  const document = resolveCadDocument(projectPath, relativeFile);
  if (document.extension === ".dwg") throw new CadPreviewError("oda_unavailable", "DWG preview requires an approved operator-installed ODA File Converter.");
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), "myagenttool-cad-preview-"));
  const snapshotPath = resolve(temporaryRoot, `source${document.extension}`);
  writeFileSync(snapshotPath, document.snapshot, { mode: 0o600, flag: "wx" });
  const request = { action, file: snapshotPath, ...(layout ? { layout: String(layout).slice(0, 120) } : {}), ...(Array.isArray(visibleLayers) ? { visibleLayers: visibleLayers.slice(0, 512).map((item) => String(item).slice(0, 255)) } : {}) };
  let output;
  try {
    output = await (run ?? runCadWorker)(request, { timeoutMs, signal });
  } catch (error) {
    if (error instanceof CadPreviewError) throw error;
    throw new CadPreviewError("cad_processing_failed", "CAD preview worker failed.");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  const parsed = typeof output === "string" ? parseWorkerOutput(output) : output;
  if (!parsed?.ok) throw new CadPreviewError(safeWorkerCode(parsed?.error), safeWorkerMessage(parsed?.message));
  const result = normalizeWorkerResult(parsed, action);
  return { path: document.relPath, size: document.size, ...result };
}

function readSnapshot(target) {
  let descriptor;
  try {
    descriptor = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new CadPreviewError("cad_invalid_file", "Requested CAD path is not a regular file.");
    if (stat.size > MAX_FILE_BYTES) throw new CadPreviewError("cad_file_too_large", "CAD file exceeds the 25 MiB preview limit.");
    return readFileSync(descriptor);
  } catch (error) {
    if (error instanceof CadPreviewError) throw error;
    throw new CadPreviewError("cad_read_failed", "CAD file could not be snapshotted safely.");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseWorkerOutput(output) {
  if (Buffer.byteLength(output, "utf8") > MAX_WORKER_BYTES) throw new CadPreviewError("cad_output_too_large", "CAD preview output exceeded its limit.");
  try { return JSON.parse(output); } catch { throw new CadPreviewError("cad_processing_failed", "CAD preview worker returned invalid output."); }
}

function normalizeWorkerResult(value, action) {
  const layouts = boundedStrings(value.layouts, 32, 255, "cad_layout_limit_exceeded");
  const layers = boundedStrings(value.layers, 512, 255, "cad_layer_limit_exceeded");
  const texts = Array.isArray(value.texts) ? value.texts.slice(0, 10_000).map((item) => ({ text: String(item?.text ?? "").slice(0, 2_000), type: String(item?.type ?? "").slice(0, 32), layer: String(item?.layer ?? "").slice(0, 255), layout: String(item?.layout ?? "Model").slice(0, 255), x: finiteCoordinate(item?.x), y: finiteCoordinate(item?.y) })) : [];
  const layoutExtents = Object.fromEntries(layouts.map((name) => [name, normalizeExtents(value.layoutExtents?.[name])]));
  const result = { version: String(value.version ?? "unknown").slice(0, 32), units: Number.isInteger(value.units) ? value.units : 0, extents: normalizeExtents(value.extents), layoutExtents, layouts, layers, entityCounts: normalizeEntityCounts(value.entityCounts), texts, warnings: boundedStrings(value.warnings, 500, 500, "cad_warning_limit_exceeded"), audit: { errors: boundedCount(value.audit?.errors), fixes: boundedCount(value.audit?.fixes) } };
  if (action === "render") {
    const svg = String(value.svg ?? "");
    if (Buffer.byteLength(svg, "utf8") > MAX_SVG_BYTES) throw new CadPreviewError("cad_output_too_large", "CAD SVG exceeded the 8 MiB preview limit.");
    if (!/^<svg\b/i.test(svg.trim()) || /<script\b|<foreignObject\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:|javascript:)/i.test(svg)) throw new CadPreviewError("cad_svg_rejected", "CAD SVG did not pass the safety policy.");
    result.svg = svg;
  }
  return result;
}

function finiteCoordinate(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }

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

export function runCadWorker(request, { timeoutMs, signal, spawnProcess = spawn, python = resolveCadPython(), terminateGraceMs = TERMINATE_GRACE_MS }) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) { rejectPromise(new CadPreviewError("cad_processing_cancelled", "CAD processing was cancelled.")); return; }
    const child = spawnProcess(python, [WORKER_PATH], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true, env: {} });
    const chunks = [];
    let bytes = 0;
    let failure = null;
    let killTimer = null;
    const stop = (error) => {
      if (failure) return;
      failure = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, terminateGraceMs);
    };
    const abort = () => stop(new CadPreviewError("cad_processing_cancelled", "CAD processing was cancelled."));
    const timer = setTimeout(() => stop(new CadPreviewError("cad_processing_timeout", `CAD processing timed out after ${timeoutMs} ms.`)), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const cleanup = () => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); signal?.removeEventListener("abort", abort); };
    child.stdout.on("data", (chunk) => { bytes += chunk.length; if (bytes > MAX_WORKER_BYTES) stop(new CadPreviewError("cad_output_too_large", "CAD preview output exceeded its limit.")); else chunks.push(chunk); });
    child.on("error", (error) => { cleanup(); rejectPromise(new CadPreviewError(error?.code === "ENOENT" ? "ezdxf_unavailable" : "cad_processing_failed", error?.code === "ENOENT" ? "Managed Python/ezdxf preview runtime is unavailable." : "CAD preview worker failed.")); });
    child.on("close", (code) => { cleanup(); if (failure) rejectPromise(failure); else if (code !== 0) rejectPromise(new CadPreviewError("ezdxf_unavailable", "Managed Python/ezdxf preview runtime is unavailable or unhealthy.")); else resolvePromise(Buffer.concat(chunks).toString("utf8")); });
    child.stdin.end(JSON.stringify(request));
  });
}

export function resolveCadPython(configured = process.env.MYAGENTTOOL_CAD_PYTHON || activeRuntimePython()) {
  if (!isAbsolute(configured) || !existsSync(configured)) throw new CadPreviewError("ezdxf_unavailable", "Managed Python/ezdxf preview runtime is not installed.");
  if (!statSync(configured).isFile()) throw new CadPreviewError("ezdxf_unavailable", "Managed Python/ezdxf preview runtime is invalid.");
  // Keep the venv launcher path: resolving its interpreter symlink would bypass
  // the venv's site-packages and silently select the ambient base interpreter.
  return resolve(configured);
}

function activeRuntimePython() {
  let slot = "cad-preview";
  try { slot = JSON.parse(readFileSync(resolve(RUNTIME_ROOT, "cad-preview-active.json"), "utf8")).slot; } catch {}
  if (!/^cad-preview(?:-[ab])?$/.test(String(slot))) return resolve(RUNTIME_ROOT, "missing");
  return process.platform === "win32" ? resolve(RUNTIME_ROOT, slot, "Scripts/python.exe") : resolve(RUNTIME_ROOT, slot, "bin/python");
}

export function cleanupCadPreviewTemps(root = tmpdir()) {
  let removed = 0;
  for (const name of readdirSync(root)) {
    if (!name.startsWith("myagenttool-cad-preview-")) continue;
    rmSync(resolve(root, name), { recursive: true, force: true }); removed += 1;
  }
  return removed;
}

export function cadRuntimeReadiness() {
  try {
    const python = resolveCadPython();
    const probe = spawnSync(python, ["-c", "import sys,ezdxf,PIL; print(sys.version_info[:2] == (3,12) and ezdxf.__version__ == '1.4.4' and PIL.__version__ == '12.3.0')"], { encoding: "utf8", timeout: 5_000, windowsHide: true, env: {} });
    const ready = probe.status === 0 && probe.stdout.trim() === "True";
    return { state: ready ? "ready" : "repair_required", ready, summary: ready ? "Managed DXF runtime is ready." : "Managed DXF runtime failed its pinned-version probe." };
  } catch {
    return { state: "not_installed", ready: false, summary: "Managed DXF runtime is not installed." };
  }
}
