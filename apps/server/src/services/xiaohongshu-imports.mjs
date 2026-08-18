// Xiaohongshu note render: a Playwright-backed provider branch for the
// article-imports pipeline.
//
// Xiaohongshu note data is login-gated at the DATA layer (live matrix
// 2026-08-17, issue #1703): anonymous plain-HTTP note URLs 302 into
// /404/sec_<rand> (error_code=300031) and an anonymous real browser gets the
// /explore login modal with an empty noteDetailMap — so the article importer
// (inspectArticle / fetchPublicResource) cannot read xiaohongshu bodies
// (worse: it used to silently import the /404 shell as a "note"). This module
// shells out to the standalone renderer in tools/xiaohongshu-imports
// (mirrors the feishu-doc-imports / zhihu-imports / qichacha-imports
// subprocess boundary). That renderer reuses a logged-in persistent profile
// and returns the rendered HTML. It writes nothing to disk and downloads
// nothing: this module hands the HTML back to the caller, which feeds it to
// the existing parseArticleDocument (xiaohongshu selectors + note structured
// extraction) + downloadMedia + write pipeline.
//
// Frequency discipline: xiaohongshu runs aggressive behavioral risk control.
// Renders happen once per canonical URL (the import pipeline dedupes on
// canonicalUrl), the session probe only ever loads the /explore feed, and the
// session-manager registers xiaohongshu as heartbeatTier "manual" so no
// automated sweep ever fires a request at the site.
//
// Trust boundary — identical to feishu-doc-imports.mjs / zhihu-imports.mjs /
// qichacha-imports.mjs / design-render.mjs: the product bundles NO browser.
// The executable argv is product-defaulted (the running node plus the bundled
// CLI) and may be overridden by an operator env var; it is NEVER
// agent-proposed. The URL is a validated data argument (parseXiaohongshuUrl
// inside the CLI rejects bad hosts and embedded credentials). execFile spawns
// with no shell, a bounded timeout, and a bounded buffer. Failure surfaces a
// { code: "xiaohongshu_import_failed" } error the article-imports job runner
// maps to a clean failed state — it never blocks the caller silently.
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
 * (<repo>/apps/server/src/services/xiaohongshu-imports.mjs). Returns null when
 * the CLI is absent (e.g. a packaged desktop build that does not ship tools/),
 * so the caller can downgrade gracefully.
 * @returns {string | null}
 */
function defaultCliPath() {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(here, "../../../..");
  const cli = resolve(repoRoot, "tools/xiaohongshu-imports/src/cli.mjs");
  return existsSync(cli) ? cli : null;
}

/**
 * Resolve the renderer command and execution limits from the environment.
 *
 * Operator override: `MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON` — a JSON
 * argv array (e.g. `["node","/path/to/cli.mjs"]`). When unset, the product
 * default `[<running node>, <bundled cli>]` is used if the CLI exists.
 *
 * @param {Record<string, string>} [env]
 * @returns {{ command: string[] | null, timeoutMs: number, maxBuffer: number }}
 */
export function resolveXiaohongshuImportConfig(env = process.env) {
  let command = null;
  const raw = env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON;
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
  const n = Math.round(Number(env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_TIMEOUT_MS));
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
function xiaohongshuError(code, detail) {
  const message = detail ? `${code}: ${detail}` : code;
  return Object.assign(new Error(message), { code });
}

/**
 * Render a Xiaohongshu note page by shelling out to the renderer CLI. Reuses
 * the logged-in persistent profile to pass the login wall and returns the
 * rendered HTML; the caller (article-imports.mjs inspectXiaohongshuArticle)
 * feeds it to parseArticleDocument + the existing write pipeline.
 *
 * @param {string} url - a Xiaohongshu URL (canonicalized upstream by the
 *   caller; the CLI re-validates host/scheme via parseXiaohongshuUrl, and
 *   upgrades http App-share short links to https).
 * @param {{ signal?: AbortSignal, env?: Record<string, string> }} [options]
 * @returns {Promise<{ resolvedUrl: string, html: string }>}
 * @throws {Error & { code: "xiaohongshu_import_unavailable" | "xiaohongshu_import_failed" | "xiaohongshu_import_canceled" }}
 */
export async function renderXiaohongshuPage(url, { signal, env = process.env } = {}) {
  if (!url || typeof url !== "string") {
    throw xiaohongshuError("xiaohongshu_import_invalid_args", "url is required");
  }

  const { command, timeoutMs, maxBuffer } = resolveXiaohongshuImportConfig(env);
  if (!command) {
    throw xiaohongshuError(
      "xiaohongshu_import_unavailable",
      "No renderer command is configured (MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON) and the bundled CLI was not found.",
    );
  }

  if (signal?.aborted) throw xiaohongshuError("xiaohongshu_import_canceled", "Aborted before launch.");

  // The render reuses the session-manager's xiaohongshu profile (operator env
  // → registry default ~/.myagenttool-xiaohongshu-profile) — the same
  // logged-in profile the probe/reauth flows maintain. Null (site disabled)
  // falls back to the CLI's own env/config resolution.
  const profileDir = acquireSessionProfile("xiaohongshu", env);

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
    if (signal?.aborted) throw xiaohongshuError("xiaohongshu_import_canceled", "Aborted during render.");
    throw xiaohongshuError("xiaohongshu_import_failed", summarizeExecError(error));
  }

  /** @type {{ ok?: boolean, url?: string, html?: string } | null} */
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw xiaohongshuError("xiaohongshu_import_failed", "Renderer exited but did not return parseable JSON output.");
  }
  if (!result || result.ok !== true || typeof result.html !== "string" || result.html === "") {
    throw xiaohongshuError("xiaohongshu_import_failed", "Renderer reported failure.");
  }

  const resolvedUrl = typeof result.url === "string" && result.url ? result.url : String(url);
  return { resolvedUrl, html: result.html };
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
