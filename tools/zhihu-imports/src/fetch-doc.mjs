// Playwright-based renderer for a public Zhihu article.
//
// Anti-bot reality (probed 2026-08-13): zhihu's secng WAF detects Playwright and
// force-logins fresh browser sessions. EVERY ephemeral context we tried —
// chromium (headless, headed, +navigator.webdriver patch, +homepage session
// warmup), firefox, and webkit — gets 403 and is redirected to /signin, with a
// `gdxidpyhxdE` anti-automation cookie set. The gating is no longer a solvable
// JS challenge; it is bot-detection + forced login. An unauthenticated
// automated browser cannot read zhihu content.
//
// The proven path is to reuse a LOGGED-IN session via a persistent Chrome
// profile:
//   1. Seed once — `zhihu-imports --login --profile <dir>` opens a HEADED
//      window on that profile dir; the operator logs into zhihu; the z_c0
//      login cookie persists in the dir.
//   2. Render — every later run with ZHIHU_PROFILE_DIR=<dir> reopens that
//      profile (launchPersistentContext) headless and reads the article.
//   To drive the SYSTEM Chrome and reuse a real existing profile, also set
//   ZHIHU_CHANNEL=chrome and point ZHIHU_PROFILE_DIR at the Chrome user-data
//   dir (Chrome must be closed — it locks its profile while running).
//
// Without a profile dir this module still runs (ephemeral context), but real
// zhihu content will not render — it times out on the content selector and the
// CLI exits 2 (clean degradation, never a hang, never a silent corruption).
//
// The browser pipeline (launch options, persistent/ephemeral context, scroll)
// lives in @myagenttool/session-engine, shared by every session-backed site
// plugin; site specifics (selectors, auth cookie, URLs) live in site.mjs.
//
// This module owns NO disk writes beyond the persistent profile's own browser
// state, and downloads NOTHING. It returns the rendered HTML for the parent's
// parseArticleDocument + downloadMedia + write pipeline.

import { openContext } from "@myagenttool/session-engine/launch";
import { scrollToBottom } from "@myagenttool/session-engine/scroll";

import { SITE } from "./site.mjs";

const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;

/**
 * Render a public Zhihu article in a real browser and return its HTML. Reuses
 * a logged-in persistent profile when config.profileDir is set.
 *
 * @param {{
 *   url: string,
 *   config: { limits: Record<string, number>, headless: boolean, channel: string | null, profileDir: string | null },
 *   signal?: AbortSignal,
 * }} ctx
 * @returns {Promise<{ url: string, html: string }>}
 */
export async function renderZhihuDoc({ url, config, signal }) {
  const limits = config.limits;
  const { page, close } = await openContext(config);
  try {
    if (signal && signal.aborted) throw new Error("Aborted");

    // goto resolves on a 4xx challenge/login page too (it is a loaded document).
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: limits.pageTimeoutMs });
    // Let the challenge JS + SPA hydrate. networkidle is unreliable on SPAs
    // with long-polling, so treat it as best-effort.
    await page.waitForLoadState("networkidle", { timeout: limits.pageTimeoutMs }).catch(() => {});

    try {
      await page.waitForSelector(SITE.contentSelector, { timeout: limits.pageTimeoutMs });
    } catch {
      throw new Error(
        "Could not find Zhihu article content. The session is likely not logged in (seed a profile with `--login`), or the link requires login / is private, or the page layout changed.",
      );
    }

    // Best-effort scroll to trigger lazy-loaded content / image attributes so
    // the returned HTML carries data-original / src for every image.
    await scrollToBottom(page, limits);

    if (signal && signal.aborted) throw new Error("Aborted");
    return { url: page.url(), html: await page.content() };
  } finally {
    await close();
  }
}

/**
 * Seed a persistent profile with a logged-in zhihu session. Launches a HEADED
 * browser on config.profileDir, opens the zhihu homepage, and polls for the
 * z_c0 login cookie — the operator logs into zhihu in the window at their
 * leisure. The cookie then persists in the profile for later headless renders.
 *
 * @param {{
 *   config: { limits: Record<string, number>, headless: boolean, channel: string | null, profileDir: string | null },
 *   signal?: AbortSignal,
 *   loginTimeoutMs?: number,
 * }} ctx
 * @returns {Promise<void>} resolves once logged in; rejects on timeout/abort.
 */
export async function loginZhihuProfile({
  config,
  signal,
  loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
}) {
  if (!config.profileDir) {
    throw new Error("A profile dir is required for --login (set ZHIHU_PROFILE_DIR or pass --profile <dir>).");
  }
  const headedConfig = { ...config, headless: false };
  const { page, close } = await openContext(headedConfig);
  try {
    await page.goto(SITE.loginUrl, { waitUntil: "domcontentloaded", timeout: headedConfig.limits.pageTimeoutMs }).catch(() => {});
    process.stderr.write(
      `zhihu-imports --login: log into zhihu in the opened window (waiting up to ${Math.round(
        loginTimeoutMs / 1000,
      )}s for the ${SITE.authCookie} cookie).\n`,
    );
    const start = Date.now();
    while (Date.now() - start < loginTimeoutMs) {
      if (signal && signal.aborted) throw new Error("Aborted");
      const cookies = await page.context().cookies();
      if (cookies.some((c) => c.name === SITE.authCookie)) {
        process.stderr.write(`zhihu-imports --login: logged in (${SITE.authCookie} captured). Profile seeded.\n`);
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Login timed out after ${loginTimeoutMs}ms — ${SITE.authCookie} cookie not seen.`);
  } finally {
    await close();
  }
}
