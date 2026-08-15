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
// This module owns NO disk writes beyond the persistent profile's own browser
// state, and downloads NOTHING. It returns the rendered HTML for the parent's
// parseArticleDocument + downloadMedia + write pipeline.

import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
// The same selectors parseArticleDocument uses to find zhihu content, kept in
// sync deliberately. Their presence proves the browser cleared secng AND the
// article body rendered (vs a login wall / challenge interstitial).
const CONTENT_SELECTOR = ".Post-RichTextContainer, .RichContent-inner, .RichText.ztext, article";
// zhihu's auth cookie — present only in a logged-in session. Used by --login to
// detect that the operator has signed in.
const LOGIN_COOKIE = "z_c0";
const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;

/** @param {{ headless: boolean, channel: string | null }} config */
function launchOptions(config) {
  const opts = { headless: config.headless, args: ["--disable-blink-features=AutomationControlled"] };
  if (config.channel) opts.channel = config.channel;
  return opts;
}

function contextOptions() {
  return { userAgent: UA, locale: "zh-CN", timezoneId: "Asia/Shanghai" };
}

/**
 * Open a browser context — persistent (reusing a logged-in profile) when
 * config.profileDir is set, ephemeral otherwise. Returns the page and a close
 * function that tears the whole browser down.
 *
 * @param {{ headless: boolean, channel: string | null, profileDir: string | null }} config
 * @returns {Promise<{ page: import("playwright").Page, close: () => Promise<void> }>}
 */
async function openContext(config) {
  if (config.profileDir) {
    const context = await chromium.launchPersistentContext(config.profileDir, {
      ...launchOptions(config),
      ...contextOptions(),
    });
    const page = context.pages()[0] ?? (await context.newPage());
    return { page, close: () => context.close().catch(() => {}) };
  }
  const browser = await chromium.launch(launchOptions(config));
  const context = await browser.newContext(contextOptions());
  const page = await context.newPage();
  return { page, close: () => browser.close().catch(() => {}) };
}

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
      await page.waitForSelector(CONTENT_SELECTOR, { timeout: limits.pageTimeoutMs });
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
 *   homeUrl?: string,
 * }} ctx
 * @returns {Promise<void>} resolves once logged in; rejects on timeout/abort.
 */
export async function loginZhihuProfile({
  config,
  signal,
  loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
  homeUrl = "https://www.zhihu.com/",
}) {
  if (!config.profileDir) {
    throw new Error("A profile dir is required for --login (set ZHIHU_PROFILE_DIR or pass --profile <dir>).");
  }
  const headedConfig = { ...config, headless: false };
  const context = await chromium.launchPersistentContext(headedConfig.profileDir, {
    ...launchOptions(headedConfig),
    ...contextOptions(),
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: headedConfig.limits.pageTimeoutMs }).catch(() => {});
    process.stderr.write(
      `zhihu-imports --login: log into zhihu in the opened window (waiting up to ${Math.round(
        loginTimeoutMs / 1000,
      )}s for the ${LOGIN_COOKIE} cookie).\n`,
    );
    const start = Date.now();
    while (Date.now() - start < loginTimeoutMs) {
      if (signal && signal.aborted) throw new Error("Aborted");
      const cookies = await context.cookies();
      if (cookies.some((c) => c.name === LOGIN_COOKIE)) {
        process.stderr.write(`zhihu-imports --login: logged in (${LOGIN_COOKIE} captured). Profile seeded.\n`);
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Login timed out after ${loginTimeoutMs}ms — ${LOGIN_COOKIE} cookie not seen.`);
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Scroll the page to the bottom in steps to trigger lazy hydration. Stops early
 * once the document height stabilizes for several consecutive steps.
 *
 * @param {import("playwright").Page} page
 * @param {Record<string, number>} limits
 */
async function scrollToBottom(page, limits) {
  let prevHeight = 0;
  let stable = 0;
  for (let i = 0; i < limits.scrollMaxSteps; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(limits.scrollSettleMs).catch(() => {});
    const h = await page.evaluate(() => document.body.scrollHeight).catch(() => prevHeight);
    if (h === prevHeight) {
      stable++;
      if (stable >= 3) break;
    } else {
      stable = 0;
    }
    prevHeight = h;
  }
  // Final settle so trailing lazy responses flush before we snapshot.
  await page.waitForTimeout(500).catch(() => {});
}
