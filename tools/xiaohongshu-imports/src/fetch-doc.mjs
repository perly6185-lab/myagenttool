// Playwright-based renderer for a Xiaohongshu (小红书) note page.
//
// Anti-bot reality (live matrix 2026-08-17, issue #1703): XHS note data is
// login-gated at the DATA layer — anonymous plain-HTTP note URLs 302 into
// /404/sec_<rand> (error_code=300031) and an anonymous real browser gets the
// /explore login modal with an empty noteDetailMap. There is no anonymous
// path; the proven zhihu/qichacha recipe applies:
//   1. Seed once — `xiaohongshu-imports --login --profile <dir>` opens a
//      HEADED window on that profile dir at /explore (the login modal
//      auto-pops); the operator signs in (QR / phone SMS); the session
//      persists in the dir.
//   2. Render — every later run with XIAOHONGSHU_PROFILE_DIR=<dir> reopens
//      that profile (launchPersistentContext) headless and reads the note.
//   If the risk control blocks the headless render, escalate:
//   XIAOHONGSHU_CHANNEL=chrome → XIAOHONGSHU_HEADLESS=0 (a legitimate escape
//   hatch for a single-user local product).
//
// Frequency discipline (issue #1703): XHS runs aggressive BEHAVIORAL risk
// control, so this renderer makes exactly ONE navigation per invocation, no
// retry loops, and the failure path never re-navigates. The scroll pass is
// for lazy images only, never a re-goto. Callers render a given note URL once
// per canonical URL (the import pipeline dedupes on canonicalUrl).
//
// Login detection is DOM-based: the --login poller waits for the header's
// profile-link marker (site.mjs). While polling, every CHANGE in the set of
// cookie names is printed to stderr as names only (web_session / a1 are the
// candidates to watch) — that listing is the operational surface for
// diagnosing sessions that silently expire. Cookie VALUES are never printed.
//
// Without a profile dir this module still runs (ephemeral context), but the
// note will not paint — it times out on the content selector and the CLI
// exits 2 (clean degradation, never a hang, never silent corruption).
//
// The browser pipeline (launch options, persistent/ephemeral context, scroll)
// lives in @myagenttool/session-engine, shared by every session-backed site
// plugin; site specifics (selectors, URLs) live in site.mjs.
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
 * Render a Xiaohongshu note page in a real browser and return its HTML.
 * Reuses a logged-in persistent profile when config.profileDir is set. The
 * returned url is the page's FINAL URL — for xhslink.com short links that is
 * the canonical note URL (the browser followed the redirect chain, carrying
 * the share's xsec_token), which the parent re-canonicalizes for dedupe.
 *
 * @param {{
 *   url: string,
 *   config: { limits: Record<string, number>, headless: boolean, channel: string | null, profileDir: string | null },
 *   signal?: AbortSignal,
 * }} ctx
 * @returns {Promise<{ url: string, html: string }>}
 */
export async function renderXiaohongshuPage({ url, config, signal }) {
  const limits = config.limits;
  const { page, close } = await openContext(config);
  try {
    if (signal && signal.aborted) throw new Error("Aborted");

    // goto resolves on a login-wall / /404 interstitial too (it is a loaded
    // document). ONE navigation only — see the frequency discipline header.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: limits.pageTimeoutMs });
    // Let the SPA hydrate the note data. networkidle is unreliable on SPAs
    // with long-polling, so treat it as best-effort.
    await page.waitForLoadState("networkidle", { timeout: limits.pageTimeoutMs }).catch(() => {});

    try {
      await page.waitForSelector(SITE.contentSelector, { timeout: limits.pageTimeoutMs });
    } catch {
      // Distinguish the two failure shapes the matrix documented so the
      // surfaced message tells the operator which fix applies.
      const wallHits = await page.locator(SITE.loginWallSelector).count().catch(() => 0);
      if (wallHits > 0) {
        throw new Error(
          "The Xiaohongshu login modal is showing — the session is not logged in. Seed the profile with `--login`.",
        );
      }
      throw new Error(
        "Could not find Xiaohongshu note content. The session is likely expired (re-seed with `--login`), the note needs a fresh xsec_token share link, or the page layout changed.",
      );
    }

    // Best-effort scroll to surface the lazy image carousel's attributes so
    // the returned HTML carries data-src / src for every image.
    await scrollToBottom(page, limits);

    if (signal && signal.aborted) throw new Error("Aborted");
    return { url: page.url(), html: await page.content() };
  } finally {
    await close();
  }
}

/**
 * Seed a persistent profile with a logged-in xiaohongshu session. Launches a
 * HEADED browser on config.profileDir, opens /explore (the login modal
 * auto-pops for an anonymous visitor), and polls for the header's DOM login
 * marker — the operator signs in in the window at their leisure (QR / phone
 * SMS). The session then persists in the profile for later renders.
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
export async function loginXiaohongshuProfile({
  config,
  signal,
  loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
}) {
  if (!config.profileDir) {
    throw new Error("A profile dir is required for --login (set XIAOHONGSHU_PROFILE_DIR or pass --profile <dir>).");
  }
  const headedConfig = { ...config, headless: false };
  const { page, close } = await openContext(headedConfig);
  const markerPresent = async () =>
    (await page.locator(SITE.loginMarkerSelector).count().catch(() => 0)) > 0;
  try {
    await page.goto(SITE.loginUrl, { waitUntil: "domcontentloaded", timeout: headedConfig.limits.pageTimeoutMs }).catch(() => {});
    process.stderr.write(
      `xiaohongshu-imports --login: sign in on xiaohongshu in the opened window (QR or SMS; waiting up to ${Math.round(
        loginTimeoutMs / 1000,
      )}s for the login marker ${SITE.loginMarkerSelector}; refresh the page if it does not fire after signing in).\n`,
    );
    const start = Date.now();
    let printed = "";
    while (Date.now() - start < loginTimeoutMs) {
      if (signal && signal.aborted) throw new Error("Aborted");
      if (await markerPresent()) {
        process.stderr.write("xiaohongshu-imports --login: logged in (login marker rendered). Profile seeded.\n");
        return;
      }
      const cookies = await page.context().cookies();
      const names = [...new Set(cookies.map((c) => c.name))].sort().join(", ");
      if (names !== printed) {
        // Cookie NAMES only — values may be credentials and never go to any log.
        process.stderr.write(`xiaohongshu-imports --login: cookies now: ${names || "(none)"}\n`);
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
      process.stderr.write("xiaohongshu-imports --login: logged in (login marker rendered after reload). Profile seeded.\n");
      return;
    }
    throw new Error(`Login timed out after ${loginTimeoutMs}ms — login marker ${SITE.loginMarkerSelector} never rendered.`);
  } finally {
    await close();
  }
}
