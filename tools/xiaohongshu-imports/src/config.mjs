// Configuration for the Xiaohongshu Playwright renderer subprocess.
//
// Every knob is operator-tunable via the XIAOHONGSHU_* environment and bounded
// to a safe range. Mirrors tools/qichacha-imports/src/config.mjs; xiaohongshu
// does not capture assets (no downloads), so there are no asset limits here.

/** @satisfies {Record<string, number>} */
const LIMITS = Object.freeze({
  // Max wait for any single Playwright navigation / selector / settle op.
  pageTimeoutMs: 90_000,
  // How many scroll-to-bottom steps to attempt. Note pages lazy-hydrate their
  // image carousel; scrolling surfaces the full imageList attributes so the
  // returned HTML carries them for the parent's downloadMedia.
  scrollMaxSteps: 200,
  // ms to wait between scroll steps for the page to settle.
  scrollSettleMs: 400,
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
    pageTimeoutMs: boundedInteger(env.XIAOHONGSHU_PAGE_TIMEOUT_MS, LIMITS.pageTimeoutMs, 5_000, 300_000),
    scrollMaxSteps: boundedInteger(env.XIAOHONGSHU_SCROLL_MAX_STEPS, LIMITS.scrollMaxSteps, 0, 2_000),
    scrollSettleMs: boundedInteger(env.XIAOHONGSHU_SCROLL_SETTLE_MS, LIMITS.scrollSettleMs, 0, 10_000),
  });
  const headless = parseBool(env.XIAOHONGSHU_HEADLESS, DEFAULTS.headless);
  // A persistent profile dir reuses a logged-in session (see fetch-doc.mjs):
  // when set, the engine uses launchPersistentContext instead of an ephemeral
  // context. Null → ephemeral (WILL hit the login wall — XHS note data needs
  // a signed-in session, live matrix issue #1703).
  const profileDir = parseString(env.XIAOHONGSHU_PROFILE_DIR);
  // Optional browser channel, e.g. "chrome" to drive the system Chrome. NULL
  // (Playwright's bundled chromium) for xiaohongshu — UNLIKE qichacha: the
  // anonymous matrix (issue #1703) rendered xiaohongshu fine in bundled
  // chromium headless (no WAF block; the login modal painted, /404/sec_*
  // interstitial is a session verdict, not an automation verdict). Set
  // XIAOHONGSHU_CHANNEL=chrome only if a live pass proves otherwise.
  const channel = parseString(env.XIAOHONGSHU_CHANNEL);
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
