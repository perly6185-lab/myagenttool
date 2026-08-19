// Jianshu article render: a Playwright-backed provider branch for the
// article-imports pipeline.
//
// Jianshu is a Next.js SPA: the full article body ships in the first screen's
// __NEXT_DATA__ JSON, not in the SSR DOM — the generic in-process parse only
// ever saw the truncated intro (the superseded in-process attempt, PR #1664 /
// issue #1661, documented this and this plugin replaces it per issue #1705).
// This module shells out to the standalone renderer in tools/jianshu-imports
// (mirrors the feishu-doc-imports / zhihu-imports / qichacha-imports /
// xiaohongshu-imports subprocess boundary). That renderer extracts the note
// payload in-page and returns a COMPOSED HTML document plus authoritative
// {title, author, publishedAt} metadata. It writes nothing to disk and
// downloads nothing: this module hands both back to the caller, which feeds
// the HTML to the existing parseArticleDocument + downloadMedia + write
// pipeline and applies the metadata as field overrides.
//
// Frequency discipline (issue #1705): the session probe only ever loads the
// homepage, renders happen once per canonical URL (the import pipeline dedupes
// on canonicalUrl), and the session-manager registers jianshu as heartbeatTier
// "manual" so no automated sweep ever fires a request at the site.
//
// Trust boundary — identical to feishu-doc-imports.mjs / zhihu-imports.mjs /
// qichacha-imports.mjs / xiaohongshu-imports.mjs / design-render.mjs: the
// product bundles NO browser. The executable argv is product-defaulted (the
// running node plus the bundled CLI) and may be overridden by an operator env
// var; it is NEVER agent-proposed. The URL is a validated data argument
// (parseJianshuUrl inside the CLI rejects bad hosts and embedded credentials).
// execFile spawns with no shell, a bounded timeout, and a bounded buffer.
// Failure surfaces a { code: "jianshu_import_failed" } error the
// article-imports job runner maps to a clean failed state — it never blocks
// the caller silently.
//
// Two-argv-allowlists invariant: NOT applicable here. That invariant governs
// Desktop-Bridge / device-side spawns (local-execution-policy.mjs). This is a
// server-process execFile spawn with product-default / operator-override argv
// — the same mechanism feishu-doc-imports.mjs uses — and is deliberately NOT
// routed through the capability registry / Application directory (routing a
// third governed binary in there is what the invariant warns against).

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { acquireSessionProfile } from "./session-manager.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * A non-empty array of non-empty strings — the only shape acceptable as a
 * command argv. Mirrors feishu-doc-imports.mjs / zhihu-imports.mjs isArgv.
 * @param {unknown} value
 * @returns {boolean}
 */
function isArgv(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

/**
 * Absolute path to the bundled renderer CLI, resolved relative to this module
 * (<repo>/apps/server/src/services/jianshu-imports.mjs). Returns null when the
 * CLI is absent (e.g. a packaged desktop build that does not ship tools/), so
 * the caller can downgrade gracefully.
 * @returns {string | null}
 */
function defaultCliPath() {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(here, "../../../..");
  const cli = resolve(repoRoot, "tools/jianshu-imports/src/cli.mjs");
  return existsSync(cli) ? cli : null;
}

/**
 * Resolve the renderer command and execution limits from the environment.
 *
 * Operator override: `MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON` — a JSON argv
 * array (e.g. `["node","/path/to/cli.mjs"]`). When unset, the product default
 * `[<running node>, <bundled cli>]` is used if the CLI exists.
 *
 * @param {Record<string, string>} [env]
 * @returns {{ command: string[] | null, timeoutMs: number, maxBuffer: number }}
 */
export function resolveJianshuImportConfig(env = process.env) {
  let command = null;
  const raw = env.MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isArgv(parsed)) command = parsed;
    } catch {
      /* fall through to the product default */
    }
  }
  if (!command) {
    const cli = defaultCliPath();
    if (cli) command = [process.execPath, cli];
  }
  const n = Math.round(Number(env.MYAGENTTOOL_JIANSHU_IMPORT_TIMEOUT_MS));
  const timeoutMs = Number.isFinite(n) && n >= 1000 ? Math.min(n, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  return Object.freeze({ command, timeoutMs, maxBuffer: DEFAULT_MAX_BUFFER });
}

/**
 * Build a { code }-tagged error the article-imports job runner can surface.
 * The runner reads `error.code` first (article-imports.mjs run(job) catch).
 * @param {string} code
 * @param {string} [detail]
 * @returns {Error & { code: string }}
 */
function jianshuError(code, detail) {
  const message = detail ? `${code}: ${detail}` : code;
  return Object.assign(new Error(message), { code });
}

/** @param {unknown} value */
function nullableString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Render a Jianshu article page by shelling out to the renderer CLI. Reuses
 * the logged-in persistent profile and returns the COMPOSED HTML document plus
 * the authoritative {title, author, publishedAt} metadata; the caller
 * (article-imports.mjs inspectJianshuArticle) feeds the HTML to
 * parseArticleDocument + the existing write pipeline and applies the metadata
 * as field overrides.
 *
 * @param {string} url - a Jianshu URL (canonicalized upstream by the caller;
 *   the CLI re-validates host/scheme via parseJianshuUrl and upgrades http
 *   links to https).
 * @param {{ signal?: AbortSignal, env?: Record<string, string> }} [options]
 * @returns {Promise<{ resolvedUrl: string, html: string, meta: { title: string | null, author: string | null, publishedAt: string | null } }>}
 * @throws {Error & { code: "jianshu_import_unavailable" | "jianshu_import_failed" | "jianshu_import_canceled" }}
 */
export async function renderJianshuPage(url, { signal, env = process.env } = {}) {
  if (!url || typeof url !== "string") {
    throw jianshuError("jianshu_import_invalid_args", "url is required");
  }

  const { command, timeoutMs, maxBuffer } = resolveJianshuImportConfig(env);
  if (!command) {
    throw jianshuError(
      "jianshu_import_unavailable",
      "No renderer command is configured (MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON) and the bundled CLI was not found.",
    );
  }

  if (signal?.aborted) throw jianshuError("jianshu_import_canceled", "Aborted before launch.");

  // The render reuses the session-manager's jianshu profile (operator env →
  // registry default ~/.myagenttool-jianshu-profile) — the same logged-in
  // profile the probe/reauth flows maintain. Null (site disabled) falls back
  // to the CLI's own env/config resolution.
  const profileDir = acquireSessionProfile("jianshu", env);

  const [file, ...baseArgs] = command;
  let stdout;
  try {
    const out = await execFileAsync(file, [...baseArgs, String(url), ...(profileDir ? ["--profile", profileDir] : [])], {
      env,
      timeout: timeoutMs,
      maxBuffer,
      windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    stdout = out.stdout;
  } catch (error) {
    if (signal?.aborted) throw jianshuError("jianshu_import_canceled", "Aborted during render.");
    throw jianshuError("jianshu_import_failed", summarizeExecError(error));
  }

  /** @type {{ ok?: boolean, url?: string, html?: string, meta?: { title?: unknown, author?: unknown, publishedAt?: unknown } } | null} */
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw jianshuError("jianshu_import_failed", "Renderer exited but did not return parseable JSON output.");
  }
  if (!result || result.ok !== true || typeof result.html !== "string" || result.html === "") {
    throw jianshuError("jianshu_import_failed", "Renderer reported failure.");
  }

  const resolvedUrl = typeof result.url === "string" && result.url ? result.url : String(url);
  const meta = {
    title: nullableString(result.meta?.title),
    author: nullableString(result.meta?.author),
    publishedAt: nullableString(result.meta?.publishedAt),
  };
  return { resolvedUrl, html: result.html, meta };
}

/**
 * Reduce a child_process error to a short, safe detail string for the surfaced
 * error. Keeps stderr tails (the renderer writes its failure reason there) but
 * truncates to avoid blowing up the stored job error.
 * @param {unknown} error
 * @returns {string}
 */
function summarizeExecError(error) {
  const stderr = String(error?.stderr || "").trim();
  const code = error?.code ? ` code=${error.code}` : "";
  const tail = stderr ? ` | ${stderr.slice(-300)}` : "";
  return `${String(error?.message ?? error).slice(0, 300)}${code}${tail}`;
}
