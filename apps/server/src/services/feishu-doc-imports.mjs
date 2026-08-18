// Feishu public-document import: a Playwright-backed provider branch for the
// article-imports pipeline.
//
// Feishu docs are JS-rendered SPAs that the plain-HTTP article importer
// (inspectArticle / fetchPublicResource) cannot read, so this module shells
// out to the standalone fetcher in tools/feishu-doc-imports (Phase 1). That
// fetcher renders the page, paginates the block tree from runtime
// window.DATA.clientVars plus the in-page content API, captures
// browser-decrypted images, and writes an atomic markdown bundle.
//
// Trust boundary — identical to design-render.mjs: the product bundles NO
// browser. The executable argv is product-defaulted (the running node plus the
// bundled CLI) and may be overridden by an operator env var; it is NEVER
// agent-proposed. The URL is a validated data argument (parseFeishuUrl inside
// the CLI rejects bad hosts and tokens). execFile spawns with no shell, a
// bounded timeout, and a bounded buffer. Failure surfaces a
// { code: "feishu_import_failed" } error that the article-imports job runner
// maps to a clean failed state — it never blocks the caller silently.
//
// The returned shape mirrors importArticleToWorktree (article-imports.mjs) so
// the existing writeback — outputAssets, source/content labels, the import
// comment, and the review transition — applies unchanged, with htmlPath null
// (the fetcher emits doc.md + manifest.json only, no article.html).

import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * A non-empty array of non-empty strings — the only shape acceptable as a
 * command argv. Mirrors design-render.mjs isArgv.
 * @param {unknown} value
 * @returns {boolean}
 */
function isArgv(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

/**
 * Absolute path to the bundled Phase-1 CLI, resolved relative to this module
 * (<repo>/apps/server/src/services/feishu-doc-imports.mjs). Returns null when
 * the CLI is absent (e.g. a packaged desktop build that does not ship tools/),
 * so the caller can downgrade gracefully.
 * @returns {string | null}
 */
function defaultCliPath() {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(here, "../../../..");
  const cli = resolve(repoRoot, "tools/feishu-doc-imports/src/cli.mjs");
  return existsSync(cli) ? cli : null;
}

/**
 * Resolve the fetcher command and execution limits from the environment.
 *
 * Operator override: `MYAGENTTOOL_FEISHU_IMPORT_COMMAND_JSON` — a JSON argv
 * array (e.g. `["node","/path/to/cli.mjs"]`). When unset, the product default
 * `[<running node>, <bundled cli>]` is used if the CLI exists.
 *
 * @param {Record<string, string>} [env]
 * @returns {{ command: string[] | null, timeoutMs: number, maxBuffer: number }}
 */
export function resolveFeishuImportConfig(env = process.env) {
  let command = null;
  const raw = env.MYAGENTTOOL_FEISHU_IMPORT_COMMAND_JSON;
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
  const n = Math.round(Number(env.MYAGENTTOOL_FEISHU_IMPORT_TIMEOUT_MS));
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
function feishuError(code, detail) {
  const message = detail ? `${code}: ${detail}` : code;
  return Object.assign(new Error(message), { code });
}

/**
 * Reject any target that escapes `root`. Mirrors article-imports assertConfined.
 * @param {string} root
 * @param {string} target
 */
function assertConfined(root, target) {
  const rel = relative(resolve(root), resolve(target));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw feishuError("feishu_import_path_refused", `Output path escapes the worktree: ${target}`);
  }
}

/** Normalize OS path separators to forward slashes for stored state paths. */
function toForwardSlashes(p) {
  return p.split(sep).join("/");
}

/**
 * Import a public Feishu document into a worktree by shelling out to the
 * Phase-1 fetcher CLI. Returns the article-imports result shape.
 *
 * @param {{
 *   url: string,
 *   worktreePath: string,
 *   workItemId?: string,
 *   importedAt?: string,
 *   signal?: AbortSignal,
 *   env?: Record<string, string>,
 * }} args
 * @returns {Promise<{
 *   replayed: false,
 *   relativeDirectory: string,
 *   markdownPath: string,
 *   htmlPath: null,
 *   manifestPath: string,
 *   markdownSize: number,
 *   htmlSize: 0,
 *   manifestSize: number,
 *   mediaCounts: { images: number, audio: number, video: number },
 *   warnings: string[],
 *   inspection: object,
 * }>}
 */
export async function importFeishuDocToWorktree({
  url,
  worktreePath,
  workItemId,
  importedAt = new Date().toISOString(),
  signal,
  env = process.env,
} = {}) {
  void workItemId; // accepted for call-site symmetry with importArticleToWorktree
  if (!url || !worktreePath) {
    throw feishuError("feishu_import_invalid_args", "url and worktreePath are required");
  }

  const { command, timeoutMs, maxBuffer } = resolveFeishuImportConfig(env);
  if (!command) {
    throw feishuError(
      "feishu_import_unavailable",
      "No fetcher command is configured (MYAGENTTOOL_FEISHU_IMPORT_COMMAND_JSON) and the bundled CLI was not found.",
    );
  }

  const root = realpathSync(resolve(worktreePath));
  const when = new Date(importedAt);
  const date = Number.isNaN(when.getTime()) ? new Date() : when;
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  // Lands under docs/imported/feishu/<YYYY>/<MM>, matching buildArticleRelativeDirectory's
  // docs/imported/<provider>/<year>/<month> scheme so the directory layout is uniform.
  const outDir = resolve(root, "docs", "imported", "feishu", year, month);
  assertConfined(root, outDir);

  if (signal?.aborted) throw feishuError("feishu_import_canceled", "Aborted before launch.");

  const [file, ...baseArgs] = command;
  let stdout;
  try {
    const out = await execFileAsync(file, [...baseArgs, String(url), "--out", outDir], {
      cwd: root,
      env,
      timeout: timeoutMs,
      maxBuffer,
      windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    stdout = out.stdout;
  } catch (error) {
    if (signal?.aborted) throw feishuError("feishu_import_canceled", "Aborted during fetch.");
    throw feishuError("feishu_import_failed", summarizeExecError(error));
  }

  /** @type {{ ok?: boolean, dir?: string, markdown?: string, manifest?: string, title?: string, assets?: number, canonical_url?: string, error?: string } | null} */
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw feishuError("feishu_import_failed", "Fetcher exited but did not return parseable JSON output.");
  }
  if (!result || result.ok !== true || !result.dir) {
    throw feishuError(
      "feishu_import_failed",
      result && result.error ? String(result.error) : "Fetcher reported failure.",
    );
  }

  const bundleDir = resolve(result.dir);
  assertConfined(root, bundleDir);

  const markdownAbs = resolve(result.markdown || resolve(bundleDir, "doc.md"));
  const manifestAbs = resolve(result.manifest || resolve(bundleDir, "manifest.json"));
  assertConfined(root, markdownAbs);
  assertConfined(root, manifestAbs);

  const relativeDirectory = toForwardSlashes(relative(root, bundleDir));
  const markdownPath = `${relativeDirectory}/doc.md`;
  const manifestPath = `${relativeDirectory}/manifest.json`;

  /** @type {{ asset_count?: number, images_not_captured?: string[], notes?: string[], title?: string, canonical_url?: string, fetched_at?: string }} */
  let manifest = {};
  let markdownSize = 0;
  let manifestSize = 0;
  try {
    const [mdStat, mfStat, mfText] = await Promise.all([
      stat(markdownAbs),
      stat(manifestAbs),
      readFile(manifestAbs, "utf8"),
    ]);
    markdownSize = mdStat.size;
    manifestSize = mfStat.size;
    manifest = JSON.parse(mfText);
  } catch {
    throw feishuError("feishu_import_failed", "Fetcher exited but its output bundle is unreadable.");
  }

  const assets = Number(result.assets ?? manifest.asset_count ?? 0);
  const notCaptured = Array.isArray(manifest.images_not_captured) ? manifest.images_not_captured : [];
  const warnings = Array.isArray(manifest.notes) && manifest.notes.length
    ? manifest.notes
    : notCaptured.length
      ? [`${notCaptured.length} image slot(s) could not be resolved; see feishu-asset placeholders in doc.md.`]
      : [];

  const title = result.title || manifest.title || "Feishu document";
  const canonicalUrl = result.canonical_url || manifest.canonical_url || String(url);
  const mediaCounts = { images: assets, audio: 0, video: 0 };

  return {
    replayed: false,
    relativeDirectory,
    markdownPath,
    htmlPath: null,
    manifestPath,
    markdownSize,
    htmlSize: 0,
    manifestSize,
    mediaCounts,
    warnings,
    inspection: {
      sourceUrl: String(url),
      canonicalUrl,
      resolvedUrl: canonicalUrl,
      provider: "feishu",
      contentType: "document",
      title,
      author: null,
      publishedAt: manifest.fetched_at ? String(manifest.fetched_at).slice(0, 10) : null,
      publishedAtSource: "imported",
      textLength: 0,
      media: [],
      mediaCounts,
      markdownPreview: "",
      fetchedAt: importedAt,
    },
  };
}

/**
 * Reduce a child_process error to a short, safe detail string for the surfaced
 * error. Keeps stderr tails (the fetcher writes its failure reason there) but
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
