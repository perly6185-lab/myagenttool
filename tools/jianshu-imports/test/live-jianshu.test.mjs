// Env-gated live test against a real Jianshu article page.
//
// Only runs when JIANSHU_IMPORT_LIVE=1 (skipped otherwise, so `node --test` in
// CI stays green without a browser). Override the target URL with
// JIANSHU_IMPORT_URL (defaults to a stable public article — swap if it is ever
// deleted).
//
// Jianshu PUBLIC articles render anonymously, but the station runs profiled
// (issue #1705 manual tier): set JIANSHU_PROFILE_DIR to the seeded profile.
// Seed once with:
//   node src/cli.mjs --login --profile <dir>
// Then:
//   JIANSHU_IMPORT_LIVE=1 JIANSHU_PROFILE_DIR=<dir> node --test test/live-jianshu.test.mjs
//
// Frequency discipline (issue #1705): one article render per invocation; never
// point this at a list of URLs or run it in a loop.

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderJianshuPage } from "../src/fetch-doc.mjs";
import { resolveConfig } from "../src/config.mjs";

const LIVE = process.env.JIANSHU_IMPORT_LIVE === "1";
const URL = process.env.JIANSHU_IMPORT_URL || "https://www.jianshu.com/p/0285ae4ba9a6";

test(
  "live: render an article and compose the __NEXT_DATA__ document",
  { skip: LIVE ? false : "set JIANSHU_IMPORT_LIVE=1 to run" },
  async () => {
    const config = resolveConfig();
    const { url, html, meta } = await renderJianshuPage({ url: URL, config });

    // The composed document carries the composed note markers; a raw shell
    // (404 / sign-in page) would have thrown instead of returning.
    assert.ok(html.includes('class="note-content"'), "composed note-content missing");
    assert.ok(html.includes("<article>"), "composed <article> missing");
    assert.ok(typeof meta.title === "string" && meta.title.length > 0, `meta.title missing: ${JSON.stringify(meta)}`);
    // The returned url must still be on an article path — a bounce off /p/
    // means the render hit a redirect shell.
    assert.match(
      url,
      /^https?:\/\/[^/]*jianshu\.com\/p\//i,
      `bounced off the article path (url=${url})`,
    );
  },
);
