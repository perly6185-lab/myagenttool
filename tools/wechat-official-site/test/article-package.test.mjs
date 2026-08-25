import test from "node:test";
import assert from "node:assert/strict";

import { createWechatArticlePackage, normalizeWechatArticlePackage } from "../src/article-package.mjs";
import { WECHAT_OFFICIAL_SITE_MANIFEST } from "../src/manifest.mjs";

test("the built-in plugin exposes draft operations but no live publish operation", () => {
  assert.deepEqual(WECHAT_OFFICIAL_SITE_MANIFEST.operations.map((operation) => operation.id), [
    "session.probe",
    "draft.sync",
  ]);
});

test("normalizes a safe article package", () => {
  const result = normalizeWechatArticlePackage(createWechatArticlePackage({
    title: "一次可靠的公众号草稿",
    author: "作者",
    digest: "摘要",
    contentHtml: "<p>正文</p>",
  }));
  assert.equal(result.title, "一次可靠的公众号草稿");
  assert.equal(result.bodyImages.length, 0);
});

test("rejects script-bearing HTML and unbound packages", () => {
  assert.throws(() => normalizeWechatArticlePackage({
    title: "危险内容",
    contentHtml: "<script>alert(1)</script>",
    packageDigest: `sha256:${"a".repeat(64)}`,
  }), /invalid_wechat_article_package/);
  assert.throws(() => normalizeWechatArticlePackage({ title: "缺少指纹", contentHtml: "<p>正文</p>" }), /invalid_wechat_article_package/);
  assert.throws(() => normalizeWechatArticlePackage({
    ...createWechatArticlePackage({ title: "原始标题", contentHtml: "<p>正文</p>" }),
    title: "指纹后被修改",
  }), /wechat_article_package_digest_mismatch/);
});
