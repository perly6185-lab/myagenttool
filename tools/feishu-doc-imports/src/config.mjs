// Feishu doc import configuration and safety limits.
//
// Mirrors the resolveXxxConfig(env) + boundedInteger pattern from
// apps/server/src/services/article-imports.mjs (resolveArticleImportConfig /
// ARTICLE_IMPORT_LIMITS). All limits are defensive upper bounds — a public
// Feishu doc is rendered JS-side and can be arbitrarily large, so we cap
// bytes/blocks/media/scroll to keep a runaway document bounded.

export const LIMITS = Object.freeze({
  // Per-request HTTP caps (mirror article-imports).
  redirectMax: 5,
  requestTimeoutMs: 30_000,
  // Asset (image) download caps.
  assetBytes: 25 * 1024 * 1024,
  assetTotalBytes: 100 * 1024 * 1024,
  assetCount: 200,
  assetConcurrency: 4,
  // Document content caps.
  blockBytes: 30 * 1024 * 1024,
  blockMax: 12_000,
  // Render caps.
  pageTimeoutMs: 90_000,
  scrollMaxSteps: 400,
  scrollSettleMs: 600,
  // Default output directory (relative to cwd) when --out is omitted.
});

export const DEFAULTS = Object.freeze({
  outDir: "./feishu-docs",
  headless: true,
});

/**
 * Parse an integer from a raw env value, clamped to [min, max], falling back to
 * `fallback` when absent/invalid. Same semantics as article-imports boundedInteger.
 *
 * @param {string | undefined} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function boundedInteger(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.trunc(n);
}

/**
 * Resolve a runtime config from an environment-like object (defaults to
 * process.env). Returns a frozen object; never throws on bad input.
 *
 * @param {Record<string, string> | undefined} env
 * @returns {{
 *   limits: typeof LIMITS,
 *   outDir: string,
 *   headless: boolean,
 * }}
 */
export function resolveConfig(env = process.env) {
  const e = env || {};
  const limits = {
    ...LIMITS,
    redirectMax: boundedInteger(e.FEISHU_DOC_REDIRECT_MAX, LIMITS.redirectMax, 0, 20),
    requestTimeoutMs: boundedInteger(e.FEISHU_DOC_REQUEST_TIMEOUT_MS, LIMITS.requestTimeoutMs, 1000, 600_000),
    assetBytes: boundedInteger(e.FEISHU_DOC_ASSET_BYTES, LIMITS.assetBytes, 1024, 200 * 1024 * 1024),
    assetTotalBytes: boundedInteger(e.FEISHU_DOC_ASSET_TOTAL_BYTES, LIMITS.assetTotalBytes, 1024, 1024 * 1024 * 1024),
    assetCount: boundedInteger(e.FEISHU_DOC_ASSET_COUNT, LIMITS.assetCount, 1, 5000),
    assetConcurrency: boundedInteger(e.FEISHU_DOC_ASSET_CONCURRENCY, LIMITS.assetConcurrency, 1, 16),
    blockBytes: boundedInteger(e.FEISHU_DOC_BLOCK_BYTES, LIMITS.blockBytes, 1024, 200 * 1024 * 1024),
    blockMax: boundedInteger(e.FEISHU_DOC_BLOCK_MAX, LIMITS.blockMax, 1, 200_000),
    pageTimeoutMs: boundedInteger(e.FEISHU_DOC_PAGE_TIMEOUT_MS, LIMITS.pageTimeoutMs, 5000, 600_000),
    scrollMaxSteps: boundedInteger(e.FEISHU_DOC_SCROLL_MAX_STEPS, LIMITS.scrollMaxSteps, 0, 5000),
    scrollSettleMs: boundedInteger(e.FEISHU_DOC_SCROLL_SETTLE_MS, LIMITS.scrollSettleMs, 0, 30_000),
  };
  const headless = e.FEISHU_DOC_HEADLESS === undefined ? DEFAULTS.headless : e.FEISHU_DOC_HEADLESS !== "0";
  const outDir = (e.FEISHU_DOC_OUT_DIR && String(e.FEISHU_DOC_OUT_DIR)) || DEFAULTS.outDir;
  return Object.freeze({ limits: Object.freeze(limits), outDir, headless });
}
