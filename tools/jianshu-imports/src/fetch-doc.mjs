// Playwright-based renderer for a Jianshu (简书) article page.
//
// Jianshu reality (#1664 investigation + 2026-08-17 probe, issue #1705): the
// site is a Next.js SPA — the FULL article body is NOT in the SSR DOM. It ships
// in the first screen's <script id="__NEXT_DATA__"> payload under
// props.initialState.note.data.free_content (title: public_title, author:
// user.nickname, publish time: first_shared_at epoch). Images inside
// free_content carry the lazy attribute data-original-src.
//
// So this renderer does NOT return the raw page HTML (whose DOM body is just
// the truncated intro). It extracts the note payload IN-PAGE and COMPOSES a
// clean document — <article> with an h1 title, author line, date line, and the
// free_content body — and returns that plus a metadata object. The parent runs
// its generic parseArticleDocument + downloadMedia on the composed doc; all
// jianshu extraction knowledge lives HERE, server-side parsing stays generic.
//
// NEVER silently archive a shell (the xiaohongshu lesson, issue #1703): a
// missing/empty note payload is a hard, differentiated error —
//   - HTTP 404 → article deleted / wrong slug
//   - no __NEXT_DATA__ → page layout changed
//   - note data present but free_content empty → empty body
//
// Session model (station recipe, issue #1705 manual tier):
//   1. Seed once — `jianshu-imports --login --profile <dir>` opens a HEADED
//      window on the sign_in page; the operator signs in; the session persists
//      in the dir. Public articles would render anonymously, but the station
//      runs profiled: paid articles the operator purchased may need it, and the
//      profile future-proofs against anti-bot on plain fetches.
//   2. Render — every later run with JIANSHU_PROFILE_DIR=<dir> reopens that
//      profile (launchPersistentContext) headless and reads the article.
//   Escalation hatch: JIANSHU_CHANNEL=chrome → JIANSHU_HEADLESS=0.
//
// Frequency discipline (issue #1705): exactly ONE navigation per invocation, no
// retry loops. The body needs no scroll pass — free_content ships complete in
// the JSON.
//
// While --login polls, every CHANGE in the set of cookie names is printed to
// stderr as names only (remember_user_token is the candidate to watch) — the
// operational surface for diagnosing silently-expiring sessions. Cookie VALUES
// are never printed.
//
// This module owns NO disk writes beyond the persistent profile's own browser
// state, and downloads NOTHING. It returns the composed HTML for the parent's
// parseArticleDocument + downloadMedia + write pipeline.

import { openContext } from "@myagenttool/session-engine/launch";

import { SITE } from "./site.mjs";

const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;
const LOGIN_POLL_MS = 2_000;
const MARKER_SETTLE_MS = 5_000;

// first_shared_at is an epoch in SECONDS. Render as an Asia/Shanghai date so
// the published day never drifts (same rationale as the xiaohongshu epoch
// handling, issue #1703).
const SHANGHAI_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** @param {string} text */
function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Runs INSIDE the page: pull the note fields out of the embedded Next.js
// hydration state. Returns nulls (never throws) — the caller differentiates.
function NOTE_EXTRACTOR() {
  const script = document.querySelector("#__NEXT_DATA__");
  if (!script || !script.textContent) {
    return { reason: "no-next-data" };
  }
  let data;
  try {
    data = JSON.parse(script.textContent);
  } catch {
    return { reason: "no-next-data" };
  }
  const note = data?.props?.initialState?.note?.data;
  if (!note) {
    return { reason: "no-note" };
  }
  const freeContent = typeof note.free_content === "string" ? note.free_content : "";
  return {
    reason: null,
    title: typeof note.public_title === "string" ? note.public_title : null,
    author: note?.user?.nickname ?? null,
    publishedAtSeconds: typeof note.first_shared_at === "number" ? note.first_shared_at : null,
    freeContent,
  };
}

/**
 * Render a Jianshu article page and return a COMPOSED document plus metadata.
 * Reuses a logged-in persistent profile when config.profileDir is set. The
 * returned url is the page's FINAL URL — jianshu may redirect slug aliases to
 * the canonical /p/<slug>, which the parent re-canonicalizes for dedupe.
 *
 * @param {{
 *   url: string,
 *   config: { limits: Record<string, number>, headless: boolean, channel: string | null, profileDir: string | null },
 *   signal?: AbortSignal,
 * }} ctx
 * @returns {Promise<{ url: string, html: string, meta: { title: string | null, author: string | null, publishedAt: string | null } }>}
 */
export async function renderJianshuPage({ url, config, signal }) {
  const limits = config.limits;
  const { page, close } = await openContext(config);
  try {
    if (signal && signal.aborted) throw new Error("Aborted");

    // ONE navigation only — see the frequency discipline header. The response
    // object carries the HTTP status: a 404 is a deleted article and needs no
    // further waiting.
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: limits.pageTimeoutMs });
    if (response && response.status() === 404) {
      throw new Error("Jianshu returned 404 — the article is deleted or the slug is wrong.");
    }
    // The note payload ships in the first screen; networkidle is a best-effort
    // settle for late hydration, never required for extraction.
    await page.waitForLoadState("networkidle", { timeout: limits.pageTimeoutMs }).catch(() => {});

    let note = await page.evaluate(NOTE_EXTRACTOR);
    if (note.reason === "no-next-data" || note.reason === "no-note") {
      // Give the SPA one bounded beat to paint (slow networks), then retry the
      // extraction once. This is a selector wait on the same page, not a
      // re-navigation.
      await page.waitForSelector(SITE.contentSelector, { timeout: limits.pageTimeoutMs }).catch(() => {});
      note = await page.evaluate(NOTE_EXTRACTOR);
    }

    if (note.reason === "no-next-data") {
      throw new Error("Could not find the __NEXT_DATA__ payload — the Jianshu page layout likely changed.");
    }
    if (note.reason === "no-note" || !note.freeContent || !note.freeContent.trim()) {
      throw new Error("Jianshu article data is missing or its body is empty — the note may be deleted or need a purchased session.");
    }

    const publishedAt = note.publishedAtSeconds != null ? SHANGHAI_DATE.format(new Date(note.publishedAtSeconds * 1000)) : null;
    // Compose the clean document. The h1/div classes reuse Jianshu's own
    // title/author classes (_1RuRku/_22gUMi) so the parent's generic provider
    // selectors pick them up even without the meta override (belt and braces);
    // meta is the authoritative source.
    const html = [
      "<!doctype html><html><head>",
      `<title>${escapeHtml(note.title ?? "")}</title>`,
      "</head><body><article>",
      `<h1 class="_1RuRku">${escapeHtml(note.title ?? "")}</h1>`,
      `<div class="_22gUMi">${escapeHtml(note.author ?? "")}</div>`,
      publishedAt ? `<div class="note-publish-time">${publishedAt}</div>` : "",
      `<div class="note-content">${note.freeContent}</div>`,
      "</article></body></html>",
    ].join("");
    const meta = { title: note.title, author: note.author, publishedAt };
    if (signal && signal.aborted) throw new Error("Aborted");
    return { url: page.url(), html, meta };
  } finally {
    await close();
  }
}

/**
 * Seed a persistent profile with a logged-in jianshu session. Launches a HEADED
 * browser on config.profileDir, opens the sign_in page, and polls for the
 * header's DOM login marker — the operator signs in in the window at their
 * leisure. The session then persists in the profile for later renders.
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
export async function loginJianshuProfile({
  config,
  signal,
  loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
}) {
  if (!config.profileDir) {
    throw new Error("A profile dir is required for --login (set JIANSHU_PROFILE_DIR or pass --profile <dir>).");
  }
  const headedConfig = { ...config, headless: false };
  const { page, close } = await openContext(headedConfig);
  const markerPresent = async () =>
    (await page.locator(SITE.loginMarkerSelector).count().catch(() => 0)) > 0;
  try {
    await page.goto(SITE.loginUrl, { waitUntil: "domcontentloaded", timeout: headedConfig.limits.pageTimeoutMs }).catch(() => {});
    process.stderr.write(
      `jianshu-imports --login: sign in on jianshu in the opened window (waiting up to ${Math.round(
        loginTimeoutMs / 1000,
      )}s for the login marker ${SITE.loginMarkerSelector}; refresh the page if it does not fire after signing in).\n`,
    );
    const start = Date.now();
    let printed = "";
    while (Date.now() - start < loginTimeoutMs) {
      if (signal && signal.aborted) throw new Error("Aborted");
      if (await markerPresent()) {
        process.stderr.write("jianshu-imports --login: logged in (login marker rendered). Profile seeded.\n");
        return;
      }
      const cookies = await page.context().cookies();
      const names = [...new Set(cookies.map((c) => c.name))].sort().join(", ");
      if (names !== printed) {
        // Cookie NAMES only — values may be credentials and never go to any log.
        process.stderr.write(`jianshu-imports --login: cookies now: ${names || "(none)"}\n`);
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
      process.stderr.write("jianshu-imports --login: logged in (login marker rendered after reload). Profile seeded.\n");
      return;
    }
    throw new Error(`Login timed out after ${loginTimeoutMs}ms — login marker ${SITE.loginMarkerSelector} never rendered.`);
  } finally {
    await close();
  }
}
