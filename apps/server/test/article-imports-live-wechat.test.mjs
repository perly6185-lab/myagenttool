// Env-gated live test against real public WeChat articles (issue #1696).
//
// Only runs when WECHAT_IMPORT_LIVE=1 (skipped otherwise, so `node --test` in
// CI stays green without network access). Override the targets with
// WECHAT_IMPORT_URL — a comma-separated list of mp.weixin.qq.com/s/ links
// (defaults to one URL from the 2026-08 live matrix that held up across 8
// back-to-back fetches).
//
//   WECHAT_IMPORT_LIVE=1 node --test test/article-imports-live-wechat.test.mjs
//
// A verification challenge (article_download_challenge) fails the test on
// purpose: the plain-HTTP path must never import an empty article silently.

import { test } from "node:test";
import assert from "node:assert/strict";

import { inspectArticle } from "../src/services/article-imports.mjs";

const LIVE = process.env.WECHAT_IMPORT_LIVE === "1";
const URLS = (process.env.WECHAT_IMPORT_URL || "https://mp.weixin.qq.com/s/Ph1qd775-vfKevf8fZ_ZTA")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

test(
  "live: inspect real public WeChat articles over the plain HTTP path",
  { skip: LIVE ? false : "set WECHAT_IMPORT_LIVE=1 to run" },
  async () => {
    assert.ok(URLS.length > 0, "no target URLs resolved");
    for (const url of URLS) {
      const result = await inspectArticle({ url });
      assert.equal(result.provider, "wechat", `provider mismatch for ${url}`);
      assert.ok(result.title && result.title.length > 0, `no title extracted for ${url}`);
      assert.ok(result.textLength > 0, `empty body for ${url}`);
      assert.ok(
        result.mediaCounts.images >= 1,
        `expected at least one image for ${url}, got ${JSON.stringify(result.mediaCounts)}`,
      );
    }
  },
);
