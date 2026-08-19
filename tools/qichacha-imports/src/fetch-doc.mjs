// Playwright-based renderer for a Qichacha (企查查) company page.
//
// Anti-bot reality: qichacha content sits behind a login wall, with slider risk
// control on sign-in, short-lived sessions, and a DAILY VIEW QUOTA on firm
// pages consumed by logged-in views. The proven zhihu recipe applies directly:
// reuse a LOGGED-IN session via a persistent profile.
//   1. Seed once — `qichacha-imports --login --profile <dir>` opens a HEADED
//      window on that profile dir; the operator logs into qichacha (QR / SMS /
//      password + slider); the session persists in the dir.
//   2. Render — every later run with QICHACHA_PROFILE_DIR=<dir> reopens that
//      profile (launchPersistentContext) headless and reads the firm page.
//   To drive the SYSTEM Chrome and reuse a real existing profile, also set
//   QICHACHA_CHANNEL=chrome and point QICHACHA_PROFILE_DIR at the Chrome
//   user-data dir (Chrome must be closed — it locks its profile while running).
//   If the slider blocks the headless render, escalate: chromium persistent
//   profile → QICHACHA_CHANNEL=chrome → QICHACHA_HEADLESS=0 (a legitimate
//   escape hatch for a single-user local product).
//
// Login detection is DOM-based: the poller waits for the header's login marker
// (site.mjs records the 2026-08-17 live-pass finding that no cookie NAME
// distinguishes qichacha's logged-in state — the session rides server-side on
// QCCSESSID, which exists logged-out too). While polling, every CHANGE in the
// set of cookie names is still printed to stderr as names only — that listing
// is the operational surface for diagnosing sessions that silently expire.
// Cookie VALUES are never printed.
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
const MARKER_SETTLE_MS = 5_000;

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
 * HEADED browser on config.profileDir, opens the homepage (login is a modal
 * there), and polls for the header's DOM login marker — the operator logs
 * into qichacha in the window at their leisure. The session then persists in
 * the profile for later renders.
 *
 * While polling, every CHANGE in the set of cookie names is printed to stderr
 * as names only — that listing is the operational surface for diagnosing
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
  const markerPresent = async () =>
    (await page.locator(SITE.loginMarkerSelector).count().catch(() => 0)) > 0;
  try {
    await page.goto(SITE.loginUrl, { waitUntil: "domcontentloaded", timeout: headedConfig.limits.pageTimeoutMs }).catch(() => {});
    process.stderr.write(
      `qichacha-imports --login: log into qichacha in the opened window (waiting up to ${Math.round(
        loginTimeoutMs / 1000,
      )}s for the login marker ${SITE.loginMarkerSelector}; refresh the page if it does not fire after signing in).\n`,
    );
    const start = Date.now();
    let printed = "";
    while (Date.now() - start < loginTimeoutMs) {
      if (signal && signal.aborted) throw new Error("Aborted");
      if (await markerPresent()) {
        process.stderr.write("qichacha-imports --login: logged in (login marker rendered). Profile seeded.\n");
        return;
      }
      const cookies = await page.context().cookies();
      const names = [...new Set(cookies.map((c) => c.name))].sort().join(", ");
      if (names !== printed) {
        // Cookie NAMES only — values may be credentials and never go to any log.
        process.stderr.write(`qichacha-imports --login: cookies now: ${names || "(none)"}\n`);
        printed = names;
      }
      await new Promise((r) => setTimeout(r, LOGIN_POLL_MS));
    }
    // The SPA header usually swaps to the signed-in state without a repaint;
    // if the marker never fired, one final reload before declaring failure
    // (the operator may have signed in via a redirect the poller's page did
    // not observe). Never an automatic reload loop.
    await page.reload({ waitUntil: "domcontentloaded", timeout: headedConfig.limits.pageTimeoutMs }).catch(() => {});
    await new Promise((r) => setTimeout(r, MARKER_SETTLE_MS));
    if (await markerPresent()) {
      process.stderr.write("qichacha-imports --login: logged in (login marker rendered after reload). Profile seeded.\n");
      return;
    }
    throw new Error(`Login timed out after ${loginTimeoutMs}ms — login marker ${SITE.loginMarkerSelector} never rendered.`);
  } finally {
    await close();
  }
}
