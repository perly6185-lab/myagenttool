// Shared browser-launch pipeline for session-backed site plugins
// (zhihu-imports today; future sites copy the contract — see README.md).
//
// Extracted verbatim from tools/zhihu-imports/src/fetch-doc.mjs (PR #1680) so
// every site plugin shares one battle-tested launch path:
//   - --disable-blink-features=AutomationControlled (anti-bot baseline),
//   - optional browser channel (e.g. "chrome" to drive the system Chrome),
//   - desktop UA + zh-CN locale + Asia/Shanghai timezone,
//   - launchPersistentContext when a profileDir is set — the ONLY proven way
//     past aggressive WAFs like zhihu's secng: reuse a logged-in real profile.
//
// The profile lock: launchPersistentContext takes an exclusive lock on
// profileDir. Two concurrent runs against the same profile collide. Callers
// that share a profile (server-side session-manager) MUST serialize per site
// (session-manager.mjs keeps a Map<site, Promise> chain for exactly this).

import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * @param {{ headless: boolean, channel: string | null }} config
 * @returns {import("playwright").LaunchOptions}
 */
export function launchOptions(config) {
  const opts = { headless: config.headless, args: ["--disable-blink-features=AutomationControlled"] };
  if (config.channel) opts.channel = config.channel;
  return opts;
}

/**
 * @returns {import("playwright").BrowserContextOptions}
 */
export function contextOptions() {
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
export async function openContext(config) {
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
