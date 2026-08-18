// Env-gated live test against a real public Qichacha firm page.
//
// Only runs when QICHACHA_IMPORT_LIVE=1 (skipped otherwise, so `node --test`
// in CI stays green without a browser). Override the target URL with
// QICHACHA_IMPORT_URL (defaults to a well-known firm page — swap if the uuid
// rotates).
//
// IMPORTANT: qichacha content sits behind a login wall and logged-in firm-page
// views consume the account's DAILY VIEW QUOTA. Only run this test when a
// LOGGED-IN persistent profile is configured via QICHACHA_PROFILE_DIR and you
// are willing to spend one quota unit. Seed the profile first with:
//   node src/cli.mjs --login --profile <dir>
// Then:
//   QICHACHA_IMPORT_LIVE=1 QICHACHA_PROFILE_DIR=<dir> node --test test/live-qichacha.test.mjs
// Without QICHACHA_PROFILE_DIR the test will (correctly) fail at the content
// selector — that proves clean degradation, not a code bug.

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderQichachaPage } from "../src/fetch-doc.mjs";
import { resolveConfig } from "../src/config.mjs";

const LIVE = process.env.QICHACHA_IMPORT_LIVE === "1";
const URL = process.env.QICHACHA_IMPORT_URL || "https://www.qcc.com/firm/9d2f2be64b8b1b03ffef31fb800d5f85.shtml";

test(
  "live: render a firm page behind the login wall with a seeded profile",
  { skip: LIVE ? false : "set QICHACHA_IMPORT_LIVE=1 to run" },
  async () => {
    const config = resolveConfig();
    const { url, html } = await renderQichachaPage({ url: URL, config });

    // A login wall / slider interstitial is far shorter and carries none of
    // these; their presence proves the firm page itself rendered.
    assert.ok(html.length > 5000, `rendered HTML suspiciously short: ${html.length} chars`);
    assert.ok(
      /header-content|firm-header|basic|法定代表人|注册资本|<table/i.test(html),
      "no qichacha firm-page markers found in rendered HTML — wall may not have cleared",
    );
    // The returned url must still be on a firm path. A bare qcc.com/ here
    // means the render bounced to the homepage or login.
    assert.match(
      url,
      /^https?:\/\/[^/]*(?:qcc|qichacha)\.com\/firm\//i,
      `bounced off the firm path (url=${url}) — likely a login-wall redirect`,
    );
  },
);
