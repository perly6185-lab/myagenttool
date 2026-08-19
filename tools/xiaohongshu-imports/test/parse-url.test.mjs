import { test } from "node:test";
import assert from "node:assert/strict";

import { parseXiaohongshuUrl, XiaohongshuUrlError } from "../src/parse-url.mjs";

test("parseXiaohongshuUrl: www explore note URL yields a canonical URL", () => {
  const r = parseXiaohongshuUrl("https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9");
  assert.equal(r.canonicalUrl, "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9");
});

test("parseXiaohongshuUrl: discovery item URL keeps the share query (xsec_token is not tracking)", () => {
  const raw = "https://www.xiaohongshu.com/discovery/item/6956513d000000001e022eda?xsec_source=app_share&type=video&xsec_token=CBN5iG8TDFpUuJ-E06YleVt2cZgHH_HNBeR4VKTL2H3fo=";
  const r = parseXiaohongshuUrl(raw);
  assert.equal(r.canonicalUrl, raw);
});

test("parseXiaohongshuUrl: xhslink.com short links accepted (both /a/ and /o/)", () => {
  assert.equal(
    parseXiaohongshuUrl("https://xhslink.com/a/sCkSkah9nnqcb").canonicalUrl,
    "https://xhslink.com/a/sCkSkah9nnqcb",
  );
  assert.equal(
    parseXiaohongshuUrl("https://xhslink.com/o/2AekhokTCiX").canonicalUrl,
    "https://xhslink.com/o/2AekhokTCiX",
  );
});

test("parseXiaohongshuUrl: http App share short link upgraded to https (matrix P0, issue #1703)", () => {
  const r = parseXiaohongshuUrl("http://xhslink.com/a/JIYvTxx50Yi4");
  assert.equal(r.canonicalUrl, "https://xhslink.com/a/JIYvTxx50Yi4");
});

test("parseXiaohongshuUrl: http direct note URL upgraded to https too", () => {
  const r = parseXiaohongshuUrl("http://www.xiaohongshu.com/explore/6411cf99000000001300b6d9");
  assert.equal(r.canonicalUrl, "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9");
});

test("parseXiaohongshuUrl: strips the hash (tracking fragment) only", () => {
  const r = parseXiaohongshuUrl("https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9#note");
  assert.equal(r.canonicalUrl, "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9");
});

test("parseXiaohongshuUrl: rejects non-xiaohongshu/xhslink hosts and lookalikes", () => {
  assert.throws(() => parseXiaohongshuUrl("https://example.com/explore/x"), XiaohongshuUrlError);
  assert.throws(() => parseXiaohongshuUrl("https://xiaohongshu.com.evil.example.com/explore/x"), XiaohongshuUrlError);
  assert.throws(() => parseXiaohongshuUrl("https://xhslink.com.evil.example.com/a/x"), XiaohongshuUrlError);
  assert.throws(() => parseXiaohongshuUrl("https://xxiaohongshu.com/explore/x"), XiaohongshuUrlError);
  assert.throws(() => parseXiaohongshuUrl("https://myxhslink.com/a/x"), XiaohongshuUrlError);
});

test("parseXiaohongshuUrl: rejects embedded credentials", () => {
  assert.throws(() => parseXiaohongshuUrl("https://user:pass@www.xiaohongshu.com/explore/x"), XiaohongshuUrlError);
  assert.throws(() => parseXiaohongshuUrl("https://user:pass@xhslink.com/a/x"), XiaohongshuUrlError);
});

test("parseXiaohongshuUrl: rejects non-http(s) schemes", () => {
  assert.throws(() => parseXiaohongshuUrl("file:///d:/x"), XiaohongshuUrlError);
  assert.throws(() => parseXiaohongshuUrl("javascript:alert(1)"), XiaohongshuUrlError);
});

test("parseXiaohongshuUrl: rejects empty / non-string / not-a-url", () => {
  assert.throws(() => parseXiaohongshuUrl(""), XiaohongshuUrlError);
  assert.throws(() => parseXiaohongshuUrl("   "), XiaohongshuUrlError);
  assert.throws(() => parseXiaohongshuUrl("not a url"), XiaohongshuUrlError);
});
