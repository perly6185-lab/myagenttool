// Playwright-based renderer for a Qichacha (企查查) company page.
//
// Anti-bot reality: qichacha content sits behind a login wall, with slider risk
// control on sign-in, short-lived sessions, and a DAILY VIEW QUOTA on firm
// pages consumed by logged-in views. The proven zhihu recipe applies directly:
// reuse a LOGGED-IN session via a persistent profile.
//   1. Seed once — `qichacha-imports --login --profile <dir>` opens a HEADED
//      window on that profile dir; the operator logs into qichacha (phone +
//      password + slider); the auth cookie persists in the dir.
//   2. Render — every later run with QICHACHA_PROFILE_DIR=<dir> reopens that
//      profile (launchPersistentContext) headless and reads the firm page.
//   To drive the SYSTEM Chrome and reuse a real existing profile, also set
//   QICHACHA_CHANNEL=chrome and point QICHACHA_PROFILE_DIR at the Chrome
//   user-data dir (Chrome must be closed — it locks its profile while running).
//   If the slider blocks the headless render, escalate: chromium persistent
//   profile → QICHACHA_CHANNEL=chrome → QICHACHA_HEADLESS=0 (a legitimate
//   escape hatch for a single-user local product).
//
// In-band discovery: the exact auth-cookie name is confirmed by --login, which
// prints cookie NAMES ONLY (never values) to stderr whenever the cookie-name
// set changes. Whichever of SITE.authCookies appears first resolves the login;
// if none of them ever appears, the printed name diff is the evidence needed
// to correct SITE.authCookies in site.mjs.
//
// Without a profile dir this module still runs (ephemeral context), but real
// qichacha content will not render — it times out on the content selector and
// the CLI exits 2 (clean degradation, never a hang, never silent corruption).
//
// The browser pipeline (launch options, persistent/ephemeral context, scroll)
// lives in @myagenttool/session-engine, shared by every session-backed site
// plugin; site specifics (selectors, auth cookies, URLs) live in site.mjs.
//
// This module owns NO disk writes beyond the persistent profile's own browser
// state, and downloads NOTHING. It returns the rendered HTML for the parent's
// parseArticleDocument + downloadMedia + write pipeline.

import { openContext } from "@myagenttool/session-engine/launch";
import { scrollToBottom } from "@myagenttool/session-engine/scroll";

import { SITE } from "./site.mjs";

const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;
const LOGIN_POLL_MS = 2_000;

/**
 * Render a Qichacha company page in a real browser and return its HTML. Reuses
 * a logged-in persistent profile when config.profileDir is set.
 *
 * @param {{
 *   url: string,
 *   config: { limits: Record<string, number>, headless: boolean, channel: string | null, profileDir: string | null },
 *   signal?: AbortSignal,
 * }} ctx
 * @returns {Promise<{ url: string, html: string }>}
 */
export async function renderQichachaPage({ url, config, signal }) {
  const limits = config.limits;
  const { page, close } = await openContext(config);
  try {
    if (signal && signal.aborted) throw new Error("Aborted");

    // goto resolves on a login-wall/slider page too (it is a loaded document).
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: limits.pageTimeoutMs });
    // Let the SPA hydrate. networkidle is unreliable on SPAs with long-polling,
    // so treat it as best-effort.
    await page.waitForLoadState("networkidle", { timeout: limits.pageTimeoutMs }).catch(() => {});

    try {
      await page.waitForSelector(SITE.contentSelector, { timeout: limits.pageTimeoutMs });
    } catch {
      throw new Error(
        "Could not find Qichacha page content. The session is likely not logged in (seed a profile with `--login`), the slider blocked the render, or the page layout changed.",
      );
    }

    // Best-effort scroll to trigger lazy-loaded firm sections / image
    // attributes so the returned HTML carries data-original / src for every
    // image.
    await scrollToBottom(page, limits);

    if (signal && signal.aborted) throw new Error("Aborted");
    return { url: page.url(), html: await page.content() };
  } finally {
    await close();
  }
}

/**
 * Seed a persistent profile with a logged-in qichacha session. Launches a
 * HEADED browser on config.profileDir, opens the login page, and polls for
 * any of the candidate auth cookies — the operator logs into qichacha in the
 * window at their leisure. The cookie then persists in the profile for later
 * headless renders.
 *
 * While polling, every CHANGE in the set of cookie names is printed to stderr
 * as names only — that listing is both the in-band discovery mechanism for the
 * true auth cookie and the permanent operational surface for diagnosing
 * sessions that silently expire. Cookie VALUES are never printed.
 *
 * @param {{
 *   config: { limits: Record<string, number>, headless: boolean, channel: string | null, profileDir: string | null },
 *   signal?: AbortSignal,
 *   loginTimeoutMs?: number,
 * }} ctx
 * @returns {Promise<void>} resolves once logged in; rejects on timeout/abort.
 */
export async function loginQichachaProfile({
  config,
  signal,
  loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
}) {
  if (!config.profileDir) {
    throw new Error("A profile dir is required for --login (set QICHACHA_PROFILE_DIR or pass --profile <dir>).");
  }
  const headedConfig = { ...config, headless: false };
  const { page, close } = await openContext(headedConfig);
  try {
    await page.goto(SITE.loginUrl, { waitUntil: "domcontentloaded", timeout: headedConfig.limits.pageTimeoutMs }).catch(() => {});
    process.stderr.write(
      `qichacha-imports --login: log into qichacha in the opened window (waiting up to ${Math.round(
        loginTimeoutMs / 1000,
      )}s for one of the ${SITE.authCookies.join(", ")} cookies).\n`,
    );
    const start = Date.now();
    let printed = "";
    while (Date.now() - start < loginTimeoutMs) {
      if (signal && signal.aborted) throw new Error("Aborted");
      const cookies = await page.context().cookies();
      const names = [...new Set(cookies.map((c) => c.name))].sort().join(", ");
      if (names !== printed) {
        // Cookie NAMES only — values may be credentials and never go to any log.
        process.stderr.write(`qichacha-imports --login: cookies now: ${names || "(none)"}\n`);
        printed = names;
      }
      const hit = SITE.authCookies.find((name) => cookies.some((c) => c.name === name));
      if (hit) {
        process.stderr.write(`qichacha-imports --login: logged in (${hit} captured). Profile seeded.\n`);
        return;
      }
      await new Promise((r) => setTimeout(r, LOGIN_POLL_MS));
    }
    throw new Error(`Login timed out after ${loginTimeoutMs}ms — none of the ${SITE.authCookies.join(", ")} cookies seen.`);
  } finally {
    await close();
  }
}
