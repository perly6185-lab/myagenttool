// OfficeCLI preview (P2b): a READ-ONLY, server-side render of a project document
// to self-contained HTML, for the console's preview pane.
//
// This is the UI-convenience track, deliberately SEPARATE from the governed
// OfficeCLI Application (officecli-application.mjs). It mirrors the established
// two-track design where the project file tree / git badges shell out to git
// DIRECTLY server-side (readGitFacts / gitStatusMap in services/projects.mjs)
// rather than through the governed git Application: the Application is the
// agent/inspector path; a direct read-only shell-out is the UI path.
//
// Why a dedicated route instead of the `view html` wrapper capability: the
// wrapper result path caps stdout at 20 000 chars (application-results
// RUNNER_TEXT_CAP) and persists it to durable state — fine for a parsed summary,
// wrong for a full-fidelity preview. Here the full HTML is returned transiently
// and never stored.
//
// `officecli view <file> html` writes NOTHING to disk (html defaults to stdout,
// per `officecli view --out`), so this stays read-only. Path traversal and
// symlink escape are refused the same way safeProjectFile does for file reads.

import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep, win32 } from "node:path";
import { promisify } from "node:util";

import { parseAddr } from "./officecli-sheet-ops.mjs";
import { shapeIsEditable } from "./officecli-deck-ops.mjs";
import { inspectOfficeDocumentContainer } from "./office-document-inspection.mjs";

const execFileAsync = promisify(execFile);

export const OFFICECLI_PREVIEW_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx"]);
const DEFAULT_TIMEOUT_MS = 20_000;
// Node's execFile default is 1 MB; a rendered document can be larger. Cap high
// enough for real previews but bounded so a pathological render can't OOM.
const MAX_HTML_BYTES = 16 * 1024 * 1024;

export function resolveOfficecliInvocation(command, args = [], {
  platform = process.platform,
  env = process.env,
  fileExists = existsSync,
  nodePath = process.execPath,
} = {}) {
  if (platform !== "win32" || command !== "officecli") return { executable: command, args };
  const candidates = [
    env.APPDATA ? win32.join(env.APPDATA, "npm", "node_modules", "@officecli", "officecli", "officecli.js") : null,
    env.npm_config_prefix ? win32.join(env.npm_config_prefix, "node_modules", "@officecli", "officecli", "officecli.js") : null,
  ].filter(Boolean);
  const cli = candidates.find((candidate) => fileExists(candidate));
  return cli ? { executable: nodePath, args: [cli, ...args] } : { executable: command, args };
}

function runOfficecli(command, args, opts) {
  const invocation = resolveOfficecliInvocation(command, args);
  return execFileAsync(invocation.executable, invocation.args, {
    ...opts,
    env: { ...process.env, OFFICECLI_RESIDENT_FLUSH: "each" },
  });
}

export class OfficecliPreviewError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Resolve `relativeFile` inside `projectPath`, refusing traversal and symlink
// escape (mirrors safeProjectFile), and require an Office extension.
function resolveDocument(projectPath, relativeFile) {
  const rel = String(relativeFile ?? "").trim();
  if (!rel) throw new OfficecliPreviewError("invalid_path", "A document path is required.");
  const dot = rel.lastIndexOf(".");
  const ext = dot >= 0 ? rel.slice(dot).toLowerCase() : "";
  if (!OFFICECLI_PREVIEW_EXTENSIONS.has(ext)) {
    throw new OfficecliPreviewError("unsupported_type", "Preview supports only .docx, .xlsx, and .pptx files.");
  }
  const root = resolve(projectPath);
  const target = resolve(root, rel);
  const relPath = relative(root, target);
  if (!relPath || relPath === ".." || relPath.startsWith(`..${sep}`) || relPath.startsWith("../")) {
    throw new OfficecliPreviewError("path_escape", "Requested file escapes the project root.");
  }
  if (!existsSync(target)) {
    throw new OfficecliPreviewError("not_found", "Requested file does not exist.");
  }
  // Symlink escape: realpath both and re-verify containment.
  const realRel = relative(realpathSync(root), realpathSync(target));
  if (realRel === ".." || realRel.startsWith(`..${sep}`)) {
    throw new OfficecliPreviewError("path_escape", "Requested file escapes the project root (symlink).");
  }
  let inspection;
  try {
    inspection = inspectOfficeDocumentContainer(target);
  } catch {
    // Native filesystem/parser errors may contain absolute paths. Keep the
    // renderer-facing contract stable and sanitized.
    throw new OfficecliPreviewError("office_file_corrupted", "This file could not be inspected as an OOXML package.");
  }
  if (inspection.kind === "encrypted_ooxml") {
    throw new OfficecliPreviewError("office_password_required", "This Office document is password protected.");
  }
  if (inspection.kind === "unsupported_encryption") {
    throw new OfficecliPreviewError("office_encryption_unsupported", "This Office document uses an unsupported encrypted container.");
  }
  if (inspection.kind === "corrupted") {
    throw new OfficecliPreviewError("office_file_corrupted", "This file is not a valid OOXML package.");
  }
  return { root, relPath: relPath.replaceAll("\\", "/") };
}

/**
 * Render a project document to self-contained HTML.
 *
 * @param {object} args
 * @param {string} args.projectPath  Absolute project (or worktree) root.
 * @param {string} args.relativeFile Project-relative document path.
 * @param {number} [args.timeoutMs]
 * @param {(cmd:string,argv:string[],opts:object)=>Promise<{stdout:string}>} [args.run]
 *        Injectable spawn (tests); defaults to execFile(officecli ...).
 * @returns {Promise<{ path:string, content:string, mime:string, encoding:string, bytes:number }>}
 */
export async function renderOfficecliPreview({ projectPath, relativeFile, timeoutMs = DEFAULT_TIMEOUT_MS, run } = {}) {
  if (!projectPath) throw new OfficecliPreviewError("invalid_project", "A project path is required.");
  const { root, relPath } = resolveDocument(projectPath, relativeFile);
  // Spawn officecli reads with OFFICECLI_RESIDENT_FLUSH=each. A resident's flush
  // mode is fixed when it is SPAWNED; a flush-less read that warms the resident
  // first would make a later governed write non-durable (its edit stays in memory,
  // so a promote could capture stale on-disk content). Setting it here keeps every
  // officecli invocation — reads and the write runner alike — flush-each, so any
  // resident is flush-each regardless of who touches the file first.
  const spawn = run ?? runOfficecli;

  let stdout;
  try {
    // `view <file> html` — html defaults to stdout, so nothing is written to disk.
    ({ stdout } = await spawn("officecli", ["view", relPath, "html"], {
      cwd: root,
      timeout: timeoutMs,
      maxBuffer: MAX_HTML_BYTES,
      encoding: "utf8",
      // Read-only render: no stdin, capture stdout, discard stderr noise.
      windowsHide: true,
    }));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new OfficecliPreviewError("officecli_unavailable", "The officecli binary is not installed on this device.");
    }
    if (error?.killed || error?.signal === "SIGTERM") {
      throw new OfficecliPreviewError("render_timeout", `Rendering timed out after ${timeoutMs} ms.`);
    }
    throw new OfficecliPreviewError("render_failed", `officecli view failed: ${error?.message ?? String(error)}`);
  }

  const content = String(stdout ?? "");
  if (!content.trim()) {
    throw new OfficecliPreviewError("empty_render", "officecli produced no HTML for this document.");
  }
  return {
    path: relPath,
    content,
    mime: "text/html",
    encoding: "utf8",
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

/**
 * Read a .docx's body paragraphs as a flat, path-addressed outline — the source
 * for the markdown-style block editor. Runs `officecli get <file> /body --json
 * --depth 2` (read-only), returning each paragraph's stable path (e.g.
 * `/body/p[@paraId=..]`), text, style, and its RUN sequence (text + bold/italic)
 * so inline formatting can be projected to markdown. Editing a paragraph maps to
 * surgical, governed ops keyed on the paraId, preserving the rest of the document
 * (unlike a markdown round-trip, which regenerates the whole file and loses
 * formatting).
 *
 * @returns {Promise<{ path:string, paragraphs:Array<{path:string,type:string,text:string,style:string|null,runs:Array<{text:string,bold:boolean,italic:boolean}>}> }>}
 */
export async function readOfficecliDocParagraphs({ projectPath, relativeFile, timeoutMs = DEFAULT_TIMEOUT_MS, run } = {}) {
  if (!projectPath) throw new OfficecliPreviewError("invalid_project", "A project path is required.");
  const { root, relPath } = resolveDocument(projectPath, relativeFile);
  if (!/\.docx$/i.test(relPath)) {
    throw new OfficecliPreviewError("unsupported_type", "Paragraph editing is available for .docx documents only.");
  }
  // Spawn officecli reads with OFFICECLI_RESIDENT_FLUSH=each. A resident's flush
  // mode is fixed when it is SPAWNED; a flush-less read that warms the resident
  // first would make a later governed write non-durable (its edit stays in memory,
  // so a promote could capture stale on-disk content). Setting it here keeps every
  // officecli invocation — reads and the write runner alike — flush-each, so any
  // resident is flush-each regardless of who touches the file first.
  const spawn = run ?? runOfficecli;

  let stdout;
  try {
    // --depth 2 nests each paragraph's runs (one call, no per-paragraph reads).
    ({ stdout } = await spawn("officecli", ["get", relPath, "/body", "--json", "--depth", "2"], {
      cwd: root,
      timeout: timeoutMs,
      maxBuffer: MAX_HTML_BYTES,
      encoding: "utf8",
      windowsHide: true,
    }));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new OfficecliPreviewError("officecli_unavailable", "The officecli binary is not installed on this device.");
    }
    if (error?.killed || error?.signal === "SIGTERM") {
      throw new OfficecliPreviewError("render_timeout", `Reading the document timed out after ${timeoutMs} ms.`);
    }
    throw new OfficecliPreviewError("read_failed", `officecli get failed: ${error?.message ?? String(error)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? ""));
  } catch {
    throw new OfficecliPreviewError("read_failed", "officecli did not return valid JSON.");
  }
  const body = parsed?.data?.results?.[0];
  const children = Array.isArray(body?.children) ? body.children : [];
  const paragraphs = children
    .filter((child) => child?.type === "paragraph" && typeof child?.path === "string")
    .map((child) => {
      const kids = Array.isArray(child.children) ? child.children : [];
      // A paragraph is `complex` if editing it via the run model (set-text /
      // run-rebuild, which removes+re-adds r[n]) would DESTROY content the markdown
      // projection can't reconstruct. That is any RUN-INDEXED (`…/r[N]`) child that
      // is not a plain run (an inline picture/OLE), a hyperlink run (its rel is lost
      // on rebuild), or a footnote/endnote/comment reference run. Non-run-indexed
      // children (a bookmark at `…/bookmark[N]`) are NOT touched by `remove r[k]`,
      // so they must NOT freeze the paragraph. officecli flattens a hyperlink/ref's
      // inner run to `type:"run"`, so type alone is insufficient — check the run's
      // format markers too.
      const complex = kids.some((c) => {
        if (!/\/r\[\d+\]$/.test(String(c?.path ?? ""))) return false;
        if (c.type !== "run") return true;
        const fmt = c.format ?? {};
        if (fmt.isHyperlink || fmt._hyperlinkParent) return true;
        const rStyle = typeof fmt.rStyle === "string" ? fmt.rStyle.toLowerCase() : "";
        return rStyle === "footnotereference" || rStyle === "endnotereference" || rStyle === "commentreference";
      });
      return {
        path: child.path,
        type: child.type,
        text: typeof child.text === "string" ? child.text : "",
        style: typeof child.style === "string" ? child.style : null,
        complex,
        runs: kids
          .filter((c) => c?.type === "run")
          .map((c) => ({
            text: typeof c.text === "string" ? c.text : "",
            bold: Boolean(c.format?.bold),
            italic: Boolean(c.format?.italic),
          })),
      };
    });
  return { path: relPath, paragraphs };
}

/**
 * Read a .xlsx worksheet as a grid for the cell editor. Runs `officecli get /
 * --json` to list sheets, then `get /<sheet> --json --depth 2` for the target
 * sheet's cells. Each cell keeps its A1 address, value, and (if any) formula.
 * Editing a cell maps to a surgical `set /<sheet>/<addr>`; the rest of the sheet is
 * untouched.
 *
 * @returns {Promise<{ path:string, sheet:string, sheets:string[], cells:Record<string,{text:string,formula:string|null,type:string|null}>, maxRow:number, maxCol:number }>}
 */
export async function readOfficecliSheet({ projectPath, relativeFile, sheet, timeoutMs = DEFAULT_TIMEOUT_MS, run } = {}) {
  if (!projectPath) throw new OfficecliPreviewError("invalid_project", "A project path is required.");
  const { root, relPath } = resolveDocument(projectPath, relativeFile);
  if (!/\.xlsx$/i.test(relPath)) {
    throw new OfficecliPreviewError("unsupported_type", "Grid editing is available for .xlsx documents only.");
  }
  // Spawn officecli reads with OFFICECLI_RESIDENT_FLUSH=each. A resident's flush
  // mode is fixed when it is SPAWNED; a flush-less read that warms the resident
  // first would make a later governed write non-durable (its edit stays in memory,
  // so a promote could capture stale on-disk content). Setting it here keeps every
  // officecli invocation — reads and the write runner alike — flush-each, so any
  // resident is flush-each regardless of who touches the file first.
  const spawn = run ?? runOfficecli;
  const getJson = async (selector, extra = []) => {
    let stdout;
    try {
      ({ stdout } = await spawn("officecli", ["get", relPath, selector, "--json", ...extra], {
        cwd: root,
        timeout: timeoutMs,
        maxBuffer: MAX_HTML_BYTES,
        encoding: "utf8",
        windowsHide: true,
      }));
    } catch (error) {
      if (error?.code === "ENOENT") throw new OfficecliPreviewError("officecli_unavailable", "The officecli binary is not installed on this device.");
      if (error?.killed || error?.signal === "SIGTERM") throw new OfficecliPreviewError("render_timeout", `Reading the document timed out after ${timeoutMs} ms.`);
      throw new OfficecliPreviewError("read_failed", `officecli get failed: ${error?.message ?? String(error)}`);
    }
    try {
      return JSON.parse(String(stdout ?? ""));
    } catch {
      throw new OfficecliPreviewError("read_failed", "officecli did not return valid JSON.");
    }
  };

  // List sheets from the workbook root; pick the requested one (or the first).
  const wb = await getJson("/");
  const sheets = (wb?.data?.results?.[0]?.children ?? [])
    .filter((c) => c?.type === "sheet" && typeof c?.path === "string")
    .map((c) => c.path.replace(/^\//, ""));
  const target = sheet && sheets.includes(sheet) ? sheet : sheets[0] ?? "Sheet1";

  const sheetData = await getJson(`/${target}`, ["--depth", "2"]);
  const rows = sheetData?.data?.results?.[0]?.children ?? [];
  const cells = {};
  let maxRow = 0;
  let maxCol = 0;
  for (const row of rows) {
    for (const c of Array.isArray(row?.children) ? row.children : []) {
      if (c?.type !== "cell" || typeof c?.preview !== "string") continue;
      const addr = c.preview;
      cells[addr] = {
        text: typeof c.text === "string" ? c.text : "",
        formula: typeof c.format?.formula === "string" ? c.format.formula : null,
        type: typeof c.format?.type === "string" ? c.format.type : null,
      };
      const parsed = parseAddr(addr);
      if (parsed) {
        maxRow = Math.max(maxRow, parsed.row);
        maxCol = Math.max(maxCol, parsed.col);
      }
    }
  }
  return { path: relPath, sheet: target, sheets, cells, maxRow, maxCol };
}

/**
 * Read a .pptx as slides of shapes for the slide text editor. One
 * `officecli get / --json --depth 2` nests each slide's shapes; a text shape
 * (textbox) carries its stable `@id` path and text. Editing a shape maps to a
 * surgical `set /slide[N]/shape[@id=..] --prop text=`.
 *
 * @returns {Promise<{ path:string, slides:Array<{ path:string, shapes:Array<{path:string,type:string,text:string,editable:boolean}> }> }>}
 */
export async function readOfficecliDeck({ projectPath, relativeFile, timeoutMs = DEFAULT_TIMEOUT_MS, run } = {}) {
  if (!projectPath) throw new OfficecliPreviewError("invalid_project", "A project path is required.");
  const { root, relPath } = resolveDocument(projectPath, relativeFile);
  if (!/\.pptx$/i.test(relPath)) {
    throw new OfficecliPreviewError("unsupported_type", "Slide editing is available for .pptx documents only.");
  }
  // Spawn officecli reads with OFFICECLI_RESIDENT_FLUSH=each. A resident's flush
  // mode is fixed when it is SPAWNED; a flush-less read that warms the resident
  // first would make a later governed write non-durable (its edit stays in memory,
  // so a promote could capture stale on-disk content). Setting it here keeps every
  // officecli invocation — reads and the write runner alike — flush-each, so any
  // resident is flush-each regardless of who touches the file first.
  const spawn = run ?? runOfficecli;
  let stdout;
  try {
    ({ stdout } = await spawn("officecli", ["get", relPath, "/", "--json", "--depth", "2"], {
      cwd: root,
      timeout: timeoutMs,
      maxBuffer: MAX_HTML_BYTES,
      encoding: "utf8",
      windowsHide: true,
    }));
  } catch (error) {
    if (error?.code === "ENOENT") throw new OfficecliPreviewError("officecli_unavailable", "The officecli binary is not installed on this device.");
    if (error?.killed || error?.signal === "SIGTERM") throw new OfficecliPreviewError("render_timeout", `Reading the document timed out after ${timeoutMs} ms.`);
    throw new OfficecliPreviewError("read_failed", `officecli get failed: ${error?.message ?? String(error)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? ""));
  } catch {
    throw new OfficecliPreviewError("read_failed", "officecli did not return valid JSON.");
  }
  const slides = (parsed?.data?.results?.[0]?.children ?? [])
    .filter((s) => s?.type === "slide" && typeof s?.path === "string")
    .map((s) => ({
      path: s.path,
      shapes: (Array.isArray(s.children) ? s.children : [])
        .filter((sh) => sh?.type && typeof sh?.path === "string")
        .map((sh) => ({
          path: sh.path,
          type: sh.type,
          text: typeof sh.text === "string" ? sh.text : "",
          editable: shapeIsEditable(sh),
        })),
    }));
  return { path: relPath, slides };
}
