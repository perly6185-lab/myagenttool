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
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const OFFICECLI_PREVIEW_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx"]);
const DEFAULT_TIMEOUT_MS = 20_000;
// Node's execFile default is 1 MB; a rendered document can be larger. Cap high
// enough for real previews but bounded so a pathological render can't OOM.
const MAX_HTML_BYTES = 16 * 1024 * 1024;

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
  const spawn = run ?? ((cmd, argv, opts) => execFileAsync(cmd, argv, opts));

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
