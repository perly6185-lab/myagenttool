// Configuration for the Zhihu Playwright renderer subprocess.
//
// Every knob is operator-tunable via the ZHIHU_* environment and bounded to a
// safe range. Mirrors tools/feishu-doc-imports/src/config.mjs; zhihu does not
// capture assets (no downloads), so there are no asset limits here.

/** @satisfies {Record<string, number>} */
const LIMITS = Object.freeze({
  // Max wait for any single Playwright navigation / selector / settle op.
  pageTimeoutMs: 90_000,
  // How many scroll-to-bottom steps to attempt (zhihu lazily hydrates long
  // columns and answer threads; scrolling surfaces data-original/src on every
  // image so the returned HTML carries them for the parent's downloadMedia).
  scrollMaxSteps: 400,
  // ms to wait between scroll steps for the page to settle.
  scrollSettleMs: 600,
});

const DEFAULTS = Object.freeze({
  headless: true,
});

/**
 * Coerce an env value to a bounded integer, falling back when absent/invalid.
 *
 * @param {string | undefined} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function boundedInteger(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

/**
 * @param {string | undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function parseBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

/**
 * Resolve the renderer config from environment.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ limits: Readonly<Record<string, number>>, headless: boolean, profileDir: string | null, channel: string | null }}
 */
export function resolveConfig(env = process.env) {
  const limits = Object.freeze({
    pageTimeoutMs: boundedInteger(env.ZHIHU_PAGE_TIMEOUT_MS, LIMITS.pageTimeoutMs, 5_000, 300_000),
    scrollMaxSteps: boundedInteger(env.ZHIHU_SCROLL_MAX_STEPS, LIMITS.scrollMaxSteps, 0, 2_000),
    scrollSettleMs: boundedInteger(env.ZHIHU_SCROLL_SETTLE_MS, LIMITS.scrollSettleMs, 0, 10_000),
  });
  const headless = parseBool(env.ZHIHU_HEADLESS, DEFAULTS.headless);
  // A persistent profile dir reuses a logged-in session (see fetch-doc.mjs):
  // when set, the engine uses launchPersistentContext instead of an ephemeral
  // context. Null → ephemeral (will not pass zhihu's WAF unauthenticated).
  const profileDir = parseString(env.ZHIHU_PROFILE_DIR);
  // Optional browser channel, e.g. "chrome" to drive the system Chrome instead
  // of Playwright's bundled chromium (needed to reuse a real Chrome profile).
  const channel = parseString(env.ZHIHU_CHANNEL);
  return Object.freeze({ limits, headless, profileDir, channel });
}

/**
 * @param {string | undefined} value
 * @returns {string | null}
 */
function parseString(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v === "" ? null : v;
}

export { LIMITS };
