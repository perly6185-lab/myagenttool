// Pure-logic tests for the shared browser pipeline — no browser launched.
//
// launch.mjs options are shape-checked without importing playwright's browser
// machinery (the import itself is cheap; openContext is never called here).
// scrollToBottom is exercised against a mock page whose scrollHeight follows
// a script, verifying the stable-3-steps early exit and the final settle.

import { test } from "node:test";
import assert from "node:assert/strict";

import { browserChannelCandidates, classifyBrowserLaunchError, launchOptions, contextOptions } from "../src/launch.mjs";
import { scrollToBottom } from "../src/scroll.mjs";

test("launchOptions: headless + anti-automation arg by default", () => {
  const opts = launchOptions({ headless: true, channel: null });
  assert.equal(opts.headless, true);
  assert.deepEqual(opts.args, ["--disable-blink-features=AutomationControlled"]);
  assert.equal(opts.channel, undefined);
});

test("launchOptions: channel passes through when set", () => {
  const opts = launchOptions({ headless: false, channel: "chrome" });
  assert.equal(opts.headless, false);
  assert.equal(opts.channel, "chrome");
  assert.ok(opts.args.includes("--disable-blink-features=AutomationControlled"));
});

test("automatic browser selection prefers the platform browser and falls back", () => {
  assert.deepEqual(browserChannelCandidates("auto", "darwin"), ["chrome", "msedge"]);
  assert.deepEqual(browserChannelCandidates("auto", "win32"), ["msedge", "chrome"]);
  assert.deepEqual(browserChannelCandidates("chrome", "win32"), ["chrome"]);
  assert.equal(launchOptions({ headless: false, channel: "auto" }).channel, undefined);
});

test("browser launch failures distinguish missing browsers from occupied profiles", () => {
  assert.equal(classifyBrowserLaunchError(new Error("Executable doesn't exist")).code, "session_browser_unavailable");
  assert.equal(classifyBrowserLaunchError(new Error("ProcessSingleton profile is locked")).code, "session_profile_in_use");
});

test("contextOptions: desktop UA, zh-CN locale, Shanghai timezone", () => {
  const ctx = contextOptions();
  assert.match(ctx.userAgent, /Mozilla\/5\.0/);
  assert.equal(ctx.locale, "zh-CN");
  assert.equal(ctx.timezoneId, "Asia/Shanghai");
});

/** Build a mock playwright Page whose scrollHeight follows the given script. */
function mockPage(heightScript) {
  const calls = { evaluate: 0, waitForTimeout: 0 };
  let readIndex = 0;
  const page = {
    calls,
    evaluate: async () => {
      // Alternate scrollTo (odd) and scrollHeight reads (even) — the loop calls
      // evaluate once to scroll, then once to read the height.
      calls.evaluate++;
      if (calls.evaluate % 2 === 0) {
        const h = heightScript[Math.min(readIndex, heightScript.length - 1)];
        readIndex++;
        return h;
      }
      return undefined;
    },
    waitForTimeout: async () => {
      calls.waitForTimeout++;
    },
  };
  return page;
}

test("scrollToBottom: stops after 3 stable height reads", async () => {
  // prevHeight starts at 0, so the first read (1000) always counts as growth;
  // the stable counter then needs 3 more reads at 1000 → 4 iterations total.
  const page = mockPage([1000]);
  await scrollToBottom(page, { scrollMaxSteps: 400, scrollSettleMs: 0 });
  // 4 iterations × (1 scroll + 1 read) evaluates + 1 final settle wait.
  assert.equal(page.calls.evaluate, 8);
  assert.equal(page.calls.waitForTimeout, 5);
});

test("scrollToBottom: growing page scrolls until it stabilizes", async () => {
  // Grows 0→1000→2000→3000 (each first-read resets the stable counter), then
  // stabilizes at 3000 for 3 consecutive reads → 8 iterations.
  const page = mockPage([1000, 1000, 2000, 2000, 3000, 3000, 3000]);
  await scrollToBottom(page, { scrollMaxSteps: 400, scrollSettleMs: 0 });
  assert.equal(page.calls.evaluate, 16);
});

test("scrollToBottom: respects scrollMaxSteps cap", async () => {
  // Always growing, cap at 2 steps → 4 evaluates + final settle.
  const page = mockPage([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]);
  await scrollToBottom(page, { scrollMaxSteps: 2, scrollSettleMs: 0 });
  assert.equal(page.calls.evaluate, 4);
  assert.equal(page.calls.waitForTimeout, 3);
});
