// Configuration for the Jianshu Playwright renderer subprocess.
//
// Every knob is operator-tunable via the JIANSHU_* environment and bounded to a
// safe range. Mirrors tools/xiaohongshu-imports/src/config.mjs minus the scroll
// limits: jianshu's article body is composed from the __NEXT_DATA__ JSON (see
// fetch-doc.mjs), whose image attributes ship complete — there is no lazy
// carousel to surface, so no scroll pass exists to tune.

const LIMITS = Object.freeze({
  // Max wait for any single Playwright navigation / selector / settle op.
  pageTimeoutMs: 90_000,
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
    pageTimeoutMs: boundedInteger(env.JIANSHU_PAGE_TIMEOUT_MS, LIMITS.pageTimeoutMs, 5_000, 300_000),
  });
  const headless = parseBool(env.JIANSHU_HEADLESS, DEFAULTS.headless);
  // A persistent profile dir reuses a logged-in session (see fetch-doc.mjs):
  // when set, the engine uses launchPersistentContext instead of an ephemeral
  // context. Public articles render anonymously, but the station runs manual
  // tier (issue #1705) — the profile is what a PAID article the operator
  // purchased needs (if its full text ships in free_content; live-pass
  // question) and future-proofs against anti-bot on plain fetches.
  const profileDir = parseString(env.JIANSHU_PROFILE_DIR);
  // Optional browser channel, e.g. "chrome" to drive the system Chrome. NULL
  // (Playwright's bundled chromium) — no WAF evidence against it (2026-08-17
  // probe: anonymous plain fetches return 200 with the full __NEXT_DATA__
  // payload; issue #1705). Set JIANSHU_CHANNEL=chrome only if a live pass
  // proves otherwise.
  const channel = parseString(env.JIANSHU_CHANNEL);
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
