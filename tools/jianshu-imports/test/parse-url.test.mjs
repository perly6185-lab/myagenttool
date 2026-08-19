import { test } from "node:test";
import assert from "node:assert/strict";

import { parseJianshuUrl, JianshuUrlError } from "../src/parse-url.mjs";

test("parseJianshuUrl: www article URL yields a canonical URL", () => {
  const r = parseJianshuUrl("https://www.jianshu.com/p/0285ae4ba9a6");
  assert.equal(r.canonicalUrl, "https://www.jianshu.com/p/0285ae4ba9a6");
});

test("parseJianshuUrl: bare and subdomain hosts accepted", () => {
  assert.equal(parseJianshuUrl("https://jianshu.com/p/x").canonicalUrl, "https://jianshu.com/p/x");
});

test("parseJianshuUrl: keeps the query (utm etc. are the parent's business)", () => {
  const raw = "https://www.jianshu.com/p/0285ae4ba9a6?utm_source=desktop&utm_medium=index_footer";
  assert.equal(parseJianshuUrl(raw).canonicalUrl, raw);
});

test("parseJianshuUrl: http share upgraded to https (older shares ride plain http)", () => {
  const r = parseJianshuUrl("http://www.jianshu.com/p/0285ae4ba9a6");
  assert.equal(r.canonicalUrl, "https://www.jianshu.com/p/0285ae4ba9a6");
});

test("parseJianshuUrl: strips the hash (tracking fragment) only", () => {
  const r = parseJianshuUrl("https://www.jianshu.com/p/0285ae4ba9a6#comments");
  assert.equal(r.canonicalUrl, "https://www.jianshu.com/p/0285ae4ba9a6");
});

test("parseJianshuUrl: rejects non-jianshu hosts and lookalikes", () => {
  assert.throws(() => parseJianshuUrl("https://example.com/p/x"), JianshuUrlError);
  assert.throws(() => parseJianshuUrl("https://jianshu.com.evil.example.com/p/x"), JianshuUrlError);
  assert.throws(() => parseJianshuUrl("https://jjianshu.com/p/x"), JianshuUrlError);
  assert.throws(() => parseJianshuUrl("https://myjianshu.com/p/x"), JianshuUrlError);
});

test("parseJianshuUrl: rejects embedded credentials", () => {
  assert.throws(() => parseJianshuUrl("https://user:pass@www.jianshu.com/p/x"), JianshuUrlError);
});

test("parseJianshuUrl: rejects non-http(s) schemes", () => {
  assert.throws(() => parseJianshuUrl("file:///d:/x"), JianshuUrlError);
  assert.throws(() => parseJianshuUrl("javascript:alert(1)"), JianshuUrlError);
});

test("parseJianshuUrl: rejects empty / non-string / not-a-url", () => {
  assert.throws(() => parseJianshuUrl(""), JianshuUrlError);
  assert.throws(() => parseJianshuUrl("   "), JianshuUrlError);
  assert.throws(() => parseJianshuUrl("not a url"), JianshuUrlError);
});
