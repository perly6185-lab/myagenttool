// Env-gated live test against a real public Zhihu article.
//
// Only runs when ZHIHU_IMPORT_LIVE=1 (skipped otherwise, so `node --test` in CI
// stays green without a browser). Override the target URL with
// ZHIHU_IMPORT_URL (defaults to a public column article).
//
// IMPORTANT: zhihu's secng WAF blocks unauthenticated automated browsers (see
// src/fetch-doc.mjs). This test only passes when a LOGGED-IN persistent profile
// is configured via ZHIHU_PROFILE_DIR. Seed one first with:
//   node src/cli.mjs --login --profile <dir>
// Then:
//   ZHIHU_IMPORT_LIVE=1 ZHIHU_PROFILE_DIR=<dir> node --test test/live-zhihu.test.mjs
// Without ZHIHU_PROFILE_DIR the test will (correctly) fail at the content
// selector — that proves clean degradation, not a code bug.

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderZhihuDoc } from "../src/fetch-doc.mjs";
import { resolveConfig } from "../src/config.mjs";

const LIVE = process.env.ZHIHU_IMPORT_LIVE === "1";
const URL = process.env.ZHIHU_IMPORT_URL || "https://zhuanlan.zhihu.com/p/665711991";

test(
  "live: render public column article — clears secng challenge, real article body",
  { skip: LIVE ? false : "set ZHIHU_IMPORT_LIVE=1 to run" },
  async () => {
    const config = resolveConfig();
    const { url, html } = await renderZhihuDoc({ url: URL, config });

    // The challenge page (~584 bytes) has none of these; their presence proves
    // the browser passed secng and the article body rendered.
    assert.ok(html.length > 5000, `rendered HTML suspiciously short: ${html.length} chars`);
    assert.ok(
      /Post-RichTextContainer|RichContent-inner|RichText ztext|<article/i.test(html),
      "no zhihu content selector found in rendered HTML — challenge may not have cleared",
    );
    // The returned url must still be on an *article* path. A bare zhihu.com/ here
    // means the id was invalid and zhihu redirected to the homepage feed (which
    // contains RichContent-inner for feed cards and would false-pass the checks
    // above). Requiring /p/<digits> or /question/<digits> rejects that.
    assert.match(
      url,
      /^https?:\/\/[^/]*zhihu\.com\/(p|question)\/\d+/i,
      `redirected off the article path (url=${url}) — likely an invalid id bounced to the homepage`,
    );
  },
);
