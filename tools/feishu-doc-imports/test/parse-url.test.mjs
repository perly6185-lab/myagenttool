import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFeishuUrl, FeishuUrlError } from "../src/parse-url.mjs";

test("parseFeishuUrl: wiki link yields kind/token/canonical", async () => {
  const r = await parseFeishuUrl("https://mynhkbykqf.feishu.cn/wiki/CHDzwTXYriLNIpk2HsRcx2VWnQe");
  assert.equal(r.kind, "wiki");
  assert.equal(r.token, "CHDzwTXYriLNIpk2HsRcx2VWnQe");
  assert.equal(r.host, "mynhkbykqf.feishu.cn");
  assert.equal(r.origin, "https://mynhkbykqf.feishu.cn");
  assert.equal(r.canonicalUrl, "https://mynhkbykqf.feishu.cn/wiki/CHDzwTXYriLNIpk2HsRcx2VWnQe");
  assert.match(r.urlHash, /^[0-9a-f]{8}$/);
});

test("parseFeishuUrl: docx link + trailing title segment ignored", async () => {
  const r = await parseFeishuUrl("https://acme.feishu.cn/docx/DOCXabcd1234someTokenXYZ/the-doc-title");
  assert.equal(r.kind, "docx");
  assert.equal(r.token, "DOCXabcd1234someTokenXYZ");
  assert.equal(r.canonicalUrl, "https://acme.feishu.cn/docx/DOCXabcd1234someTokenXYZ");
});

test("parseFeishuUrl: larksuite domain accepted, http upgraded to https canonical", async () => {
  const r = await parseFeishuUrl("http://acme.larksuite.com/wiki/nodeTokAbcDefGhI");
  assert.equal(r.host, "acme.larksuite.com");
  assert.equal(r.canonicalUrl, "https://acme.larksuite.com/wiki/nodeTokAbcDefGhI");
});

test("parseFeishuUrl: urlHash is deterministic for the same canonical url", async () => {
  const a = await parseFeishuUrl("https://x.feishu.cn/wiki/AAAAAAAAAAAAAAAA");
  const b = await parseFeishuUrl("https://x.feishu.cn/wiki/AAAAAAAAAAAAAAAA/?extra=query#frag");
  assert.equal(a.urlHash, b.urlHash);
});

test("parseFeishuUrl: rejects non-feishu host", async () => {
  await assert.rejects(() => parseFeishuUrl("https://example.com/wiki/TokTokTokTokTok"), FeishuUrlError);
});

test("parseFeishuUrl: rejects embedded credentials", async () => {
  await assert.rejects(() => parseFeishuUrl("https://user:pass@mynhkbykqf.feishu.cn/wiki/TokTokTokTokTok"), FeishuUrlError);
});

test("parseFeishuUrl: rejects unsupported doc types (sheets/share)", async () => {
  await assert.rejects(() => parseFeishuUrl("https://x.feishu.cn/sheets/TokTokTokTokTok"), FeishuUrlError);
  await assert.rejects(() => parseFeishuUrl("https://x.feishu.cn/share/TokTokTokTokTok"), FeishuUrlError);
});

test("parseFeishuUrl: rejects missing token and traversal-shaped tokens", async () => {
  await assert.rejects(() => parseFeishuUrl("https://x.feishu.cn/wiki/"), FeishuUrlError);
  await assert.rejects(() => parseFeishuUrl("https://x.feishu.cn/wiki/..%2fetc"), FeishuUrlError);
});

test("parseFeishuUrl: rejects empty / non-string", async () => {
  await assert.rejects(() => parseFeishuUrl(""), FeishuUrlError);
  await assert.rejects(() => parseFeishuUrl("not a url"), FeishuUrlError);
});
