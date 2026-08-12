import { test } from "node:test";
import assert from "node:assert/strict";

import {
  slugify,
  formatDateStamp,
  renderFrontMatter,
  yamlScalar,
  assertConfined,
  resolveImages,
} from "../src/import-doc.mjs";

test("slugify: latin lowercases and hyphenates; punctuation dropped", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("a/b:c?d"), "a-b-c-d");
  assert.equal(slugify("   "), "");
  assert.equal(slugify(""), "");
});

test("slugify: keeps CJK glyphs", () => {
  assert.equal(slugify("从 AI 盛典"), "从-ai-盛典");
  assert.ok(slugify("从 AI 盛典").length > 0);
});

test("formatDateStamp: UTC YYYY-MM-DD", () => {
  assert.equal(formatDateStamp(new Date("2026-08-12T03:30:00Z")), "2026-08-12");
  assert.equal(formatDateStamp(new Date("2026-12-31T23:59:00Z")), "2026-12-31");
});

test("yamlScalar: quotes when needed", () => {
  assert.equal(yamlScalar("plain"), "plain");
  assert.equal(yamlScalar("https://x.feishu.cn/wiki/T"), '"https://x.feishu.cn/wiki/T"');
  assert.equal(yamlScalar('a"b'), '"a\\"b"');
  assert.equal(yamlScalar(""), '""');
});

test("renderFrontMatter: required fields, fenced", () => {
  const fm = renderFrontMatter({
    sourceUrl: "https://x.feishu.cn/wiki/Tok",
    canonicalUrl: "https://x.feishu.cn/wiki/Tok",
    title: "从 AI 盛典",
    when: new Date("2026-08-12T00:00:00Z"),
    urlHash: "abcd1234",
    blockCount: 308,
  });
  assert.ok(fm.startsWith("---\n"));
  assert.ok(fm.includes("---\n\n"));
  assert.match(fm, /source_provider: feishu/);
  assert.match(fm, /source_url: /);
  assert.match(fm, /canonical_url: /);
  assert.match(fm, /url_hash: abcd1234/);
  assert.match(fm, /block_count: 308/);
  assert.match(fm, /fetched_at: 2026-08-12T00:00:00\.000Z/);
});

test("assertConfined: accepts children, rejects escapes", () => {
  const root = process.platform === "win32" ? "C:\\tmp\\out" : "/tmp/out";
  assert.doesNotThrow(() => assertConfined(root, root + "/sub/doc.md"));
  assert.throws(() => assertConfined(root, root + "/../evil.md"));
  assert.throws(() => assertConfined(root, "/elsewhere/x"));
});

test("resolveImages: token-mapped slots get numbered assets and rewritten paths", () => {
  const markdown = "![](feishu-asset://T1)\n\n![](feishu-asset://T2)";
  const docImages = [
    { token: "T1", blockId: "b1" },
    { token: "T2", blockId: "b2" },
  ];
  const captures = [
    { bytes: Buffer.from([0x89, 0x50]), contentType: "image/png", sourceUrl: "u1", token: "T1", sha: "s1" },
    { bytes: Buffer.from([0xff, 0xd8]), contentType: "image/jpeg", sourceUrl: "u2", token: "T2", sha: "s2" },
  ];
  const { rewrittenMarkdown, files, notCaptured } = resolveImages(markdown, docImages, captures);
  assert.equal(files.length, 2);
  assert.equal(files[0].name, "01.png");
  assert.equal(files[1].name, "02.jpg");
  assert.ok(rewrittenMarkdown.includes("![](assets/01.png)"));
  assert.ok(rewrittenMarkdown.includes("![](assets/02.jpg)"));
  assert.deepEqual(notCaptured, []);
});

test("resolveImages: positional fallback when tokens are absent", () => {
  const markdown = "![](feishu-asset://X1)\n\n![](feishu-asset://X2)";
  const docImages = [
    { token: "X1", blockId: "b1" },
    { token: "X2", blockId: "b2" },
  ];
  const captures = [
    { bytes: Buffer.from("p1"), contentType: "image/png", sourceUrl: "u1", token: null, sha: "s1" },
    { bytes: Buffer.from("p2"), contentType: "image/png", sourceUrl: "u2", token: null, sha: "s2" },
  ];
  const { rewrittenMarkdown, files, notCaptured } = resolveImages(markdown, docImages, captures);
  assert.equal(files.length, 2);
  assert.ok(rewrittenMarkdown.includes("assets/01.png"));
  assert.ok(rewrittenMarkdown.includes("assets/02.png"));
  assert.deepEqual(notCaptured, []);
});

test("resolveImages: missing captures become comments and are listed", () => {
  const markdown = "![](feishu-asset://M1)\n\n![](feishu-asset://M2)";
  const docImages = [
    { token: "M1", blockId: "b1" },
    { token: "M2", blockId: "b2" },
  ];
  const captures = [
    { bytes: Buffer.from("only"), contentType: "image/png", sourceUrl: "u1", token: null, sha: "s1" },
  ];
  const { rewrittenMarkdown, notCaptured } = resolveImages(markdown, docImages, captures);
  assert.ok(rewrittenMarkdown.includes("assets/01.png"));
  assert.ok(rewrittenMarkdown.includes("<!-- image not captured -->"));
  assert.equal(notCaptured.length, 1);
});

test("resolveImages: dedupes repeated token to one asset file", () => {
  const markdown = "![](feishu-asset://D)\n\n![](feishu-asset://D)";
  const docImages = [
    { token: "D", blockId: "b1" },
    { token: "D", blockId: "b2" },
  ];
  const captures = [{ bytes: Buffer.from("p"), contentType: "image/png", sourceUrl: "u", token: "D", sha: "s" }];
  const { rewrittenMarkdown, files } = resolveImages(markdown, docImages, captures);
  assert.equal(files.length, 1);
  assert.equal((rewrittenMarkdown.match(/assets\/01\.png/g) || []).length, 2);
});
