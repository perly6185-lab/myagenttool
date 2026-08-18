import { test } from "node:test";
import assert from "node:assert/strict";

import { parseZhihuUrl, ZhihuUrlError } from "../src/parse-url.mjs";

test("parseZhihuUrl: column article (zhuanlan) yields a canonical URL", () => {
  const r = parseZhihuUrl("https://zhuanlan.zhihu.com/p/1234567890");
  assert.equal(r.canonicalUrl, "https://zhuanlan.zhihu.com/p/1234567890");
});

test("parseZhihuUrl: www question link accepted", () => {
  const r = parseZhihuUrl("https://www.zhihu.com/question/123456789");
  assert.equal(r.canonicalUrl, "https://www.zhihu.com/question/123456789");
});

test("parseZhihuUrl: question-answer deep-link keeps pathname + query routing", () => {
  const r = parseZhihuUrl("https://www.zhihu.com/question/123456789/answer/987654321?answer_id=987654321");
  assert.equal(
    r.canonicalUrl,
    "https://www.zhihu.com/question/123456789/answer/987654321?answer_id=987654321",
  );
});

test("parseZhihuUrl: strips the hash (tracking fragment) only", () => {
  const r = parseZhihuUrl("https://zhuanlan.zhihu.com/p/1234567890#some-section");
  assert.equal(r.canonicalUrl, "https://zhuanlan.zhihu.com/p/1234567890");
});

test("parseZhihuUrl: accepts bare zhihu.com host", () => {
  const r = parseZhihuUrl("https://zhihu.com/question/123456789");
  assert.equal(r.canonicalUrl, "https://zhihu.com/question/123456789");
});

test("parseZhihuUrl: rejects non-zhihu host", () => {
  assert.throws(() => parseZhihuUrl("https://example.com/p/1234567890"), ZhihuUrlError);
  assert.throws(() => parseZhihuUrl("https://notzhihu.com/p/1234567890"), ZhihuUrlError);
  assert.throws(() => parseZhihuUrl("https://zhihu.com.evil.example.com/p/123"), ZhihuUrlError);
});

test("parseZhihuUrl: rejects embedded credentials", () => {
  assert.throws(() => parseZhihuUrl("https://user:pass@zhuanlan.zhihu.com/p/1234567890"), ZhihuUrlError);
});

test("parseZhihuUrl: rejects non-http(s) schemes", () => {
  assert.throws(() => parseZhihuUrl("file:///d:/x"), ZhihuUrlError);
  assert.throws(() => parseZhihuUrl("javascript:alert(1)"), ZhihuUrlError);
});

test("parseZhihuUrl: rejects empty / non-string / not-a-url", () => {
  assert.throws(() => parseZhihuUrl(""), ZhihuUrlError);
  assert.throws(() => parseZhihuUrl("   "), ZhihuUrlError);
  assert.throws(() => parseZhihuUrl("not a url"), ZhihuUrlError);
});
