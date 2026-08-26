import test from "node:test";
import assert from "node:assert/strict";

import { syncWechatOfficialDraft } from "../src/draft-sync.mjs";
import { createWechatArticlePackage } from "../src/article-package.mjs";
import { loginWechatOfficialProfile, probeWechatOfficialSession } from "../src/session.mjs";

function fakeBrowser({ loggedIn }) {
  let closed = false;
  const page = {
    goto: async () => {},
    waitForTimeout: async () => {},
    locator: () => ({
      count: async () => loggedIn ? 1 : 0,
      nth: () => ({ isVisible: async () => loggedIn }),
    }),
  };
  return {
    open: async () => ({ page, close: async () => { closed = true; } }),
    closed: () => closed,
  };
}

const config = { profileDir: "/tmp/test-profile", channel: "chrome", navigationTimeoutMs: 1_000, loginTimeoutMs: 1_000 };

test("probe reports the persistent profile login state and closes the browser", async () => {
  const browser = fakeBrowser({ loggedIn: true });
  const result = await probeWechatOfficialSession({ config, open: browser.open });
  assert.equal(result.loggedIn, true);
  assert.equal(browser.closed(), true);
});

test("interactive login reuses the profile and exits when the account marker appears", async () => {
  const browser = fakeBrowser({ loggedIn: true });
  const result = await loginWechatOfficialProfile({ config, open: browser.open });
  assert.equal(result.loggedIn, true);
  assert.equal(browser.closed(), true);
});

test("draft sync refuses unverified media controls before opening a browser", async () => {
  let opened = false;
  const result = await syncWechatOfficialDraft({
    config,
    open: async () => { opened = true; throw new Error("must not open"); },
    articlePackage: createWechatArticlePackage({
      title: "带封面的草稿",
      contentHtml: "<p>正文</p>",
      cover: { path: "cover.png", hash: "cover-hash" },
    }),
  });
  assert.equal(result.errorCode, "wechat_draft_media_contract_not_ready");
  assert.equal(result.sideEffectState, "not_started");
  assert.equal(opened, false);
});
