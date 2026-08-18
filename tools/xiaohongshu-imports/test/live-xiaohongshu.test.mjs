// Env-gated live test against a real Xiaohongshu note page.
//
// Only runs when XIAOHONGSHU_IMPORT_LIVE=1 (skipped otherwise, so `node --test`
// in CI stays green without a browser). Override the target URL with
// XIAOHONGSHU_IMPORT_URL (defaults to a public share URL — swap if the note or
// its xsec_token rotates).
//
// IMPORTANT: xiaohongshu note data is login-gated (live matrix 2026-08-17,
// issue #1703 — anonymous plain-HTTP and anonymous browser BOTH get walls).
// Only run this test when a LOGGED-IN persistent profile is configured via
// XIAOHONGSHU_PROFILE_DIR. Seed the profile first with:
//   node src/cli.mjs --login --profile <dir>
// Then:
//   XIAOHONGSHU_IMPORT_LIVE=1 XIAOHONGSHU_PROFILE_DIR=<dir> node --test test/live-xiaohongshu.test.mjs
// Without XIAOHONGSHU_PROFILE_DIR the test will (correctly) fail at the
// content selector — that proves clean degradation, not a code bug.
//
// Frequency discipline (issue #1703): one note render per invocation; never
// point this at a list of URLs or run it in a loop.

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderXiaohongshuPage } from "../src/fetch-doc.mjs";
import { resolveConfig } from "../src/config.mjs";

const LIVE = process.env.XIAOHONGSHU_IMPORT_LIVE === "1";
const URL = process.env.XIAOHONGSHU_IMPORT_URL || "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9";

test(
  "live: render a note behind the login wall with a seeded profile",
  { skip: LIVE ? false : "set XIAOHONGSHU_IMPORT_LIVE=1 to run" },
  async () => {
    const config = resolveConfig();
    const { url, html } = await renderXiaohongshuPage({ url: URL, config });

    // A login shell is far shorter and carries none of these; their presence
    // proves the note itself rendered.
    assert.ok(html.length > 5000, `rendered HTML suspiciously short: ${html.length} chars`);
    assert.ok(
      /__INITIAL_STATE__|note-content|detail-desc|note-text/i.test(html),
      "no xiaohongshu note markers found in rendered HTML — wall may not have cleared",
    );
    // The returned url must still be on a note path. A bare xiaohongshu.com
    // root or /404 here means the render bounced (login shell / interstitial).
    assert.match(
      url,
      /^https?:\/\/[^/]*xiaohongshu\.com\/(?:explore|discovery\/item)\//i,
      `bounced off the note path (url=${url}) — likely a login-wall or /404 redirect`,
    );
  },
);
