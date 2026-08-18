import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  detectArticleSource,
  importArticleToWorktree,
  inspectArticle,
  inspectXiaohongshuArticle,
} from "../src/services/article-imports.mjs";
import { renderXiaohongshuPage, resolveXiaohongshuImportConfig } from "../src/services/xiaohongshu-imports.mjs";

const NOTE_URL = "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9";
const SHORT_LINK = "https://xhslink.com/a/JIYvTxx50Yi4";
// The final URL the browser lands on after the short link's redirect chain —
// the share query (xsec_token included) survives canonicalization.
const RESOLVED_URL = "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9?xsec_source=app_share&type=normal&xsec_token=CBQ0qV-kmKok";

// A minimal rendered note page the subprocess would return behind the login
// wall. Shape mirrors the live pass (2026-08-17, issue #1703): the content
// root #detail-desc.note-content carries TEXT only — the note's images live in
// the carousel outside it and only exist as SSR imageList entries. One entry
// rides plain http (sns-webpic-qc.xhscdn.com, as the live hydration emits) to
// pin the https upgrade; the other is already https.
function xiaohongshuRenderedHtml() {
  return `<!doctype html><html><head><title>结构化笔记 - 小红书</title></head>
<body>
  <div class="login-container" style="display:none"><span>登录后浏览</span></div>
  <div id="detail-desc" class="note-content"><p>页面正文段落</p></div>
  <script>window.__INITIAL_STATE__ = ${JSON.stringify({
    note: {
      title: "结构化笔记",
      desc: "结构化说明",
      user: { nickname: "红薯作者" },
      publishTime: Date.parse("2026-07-20T10:00:00+08:00"),
      imageList: [
        { urlDefault: "http://sns-webpic-qc.xhscdn.com/202608171611/865c0a94f7ea3f741c801d0c183a6bca/1040g008322lqncfpmu105pk3j0s3cje7shuqg60!nd_dft_wlteh_webp_3" },
        { urlDefault: "https://sns-img.xhscdn.com/note-2.jpg" },
      ],
    },
    recommendations: [{
      title: "不应导入的推荐笔记",
      imageList: [{ urlDefault: "https://sns-img.xhscdn.com/unrelated.jpg" }],
    }],
  })};</script>
</body></html>`;
}

// A stand-in for the renderer CLI, so the adapter can be exercised without a
// browser. Selected via `--mode <name>` appended to the command argv:
//   ok      — print the success JSON {ok,url,html} (url = RESOLVED_URL, i.e.
//             what the browser reports after the short-link redirect chain)
//   direct  — same but url = the passed-through note URL (no redirect)
//   fail    — exit non-zero with a stderr message
//   badjson — exit zero but print non-JSON
//   empty   — report ok:true but an empty html string
const SHIM = String.raw`
const argv = process.argv.slice(2);
let url = "", mode = "ok";
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--mode") mode = argv[++i];
  else if (!a.startsWith("-") && !url) url = a;
}
const HTML = ${JSON.stringify(xiaohongshuRenderedHtml())};
const RESOLVED = ${JSON.stringify(RESOLVED_URL)};
if (mode === "fail") { process.stderr.write("simulated render failure\n"); process.exit(2); }
if (mode === "badjson") { process.stdout.write("not json\n"); process.exit(0); }
if (mode === "empty") { process.stdout.write(JSON.stringify({ ok: true, url, html: "" }) + "\n"); process.exit(0); }
if (mode === "direct") { process.stdout.write(JSON.stringify({ ok: true, url, html: HTML }) + "\n"); process.exit(0); }
process.stdout.write(JSON.stringify({ ok: true, url: RESOLVED, html: HTML }) + "\n");
`;

async function setup(mode) {
  const shimDir = await mkdtemp(join(tmpdir(), "xiaohongshu-shim-"));
  const shimPath = join(shimDir, "shim.mjs");
  await writeFile(shimPath, SHIM, "utf8");
  const command = [process.execPath, shimPath];
  if (mode) command.push("--mode", mode);
  const commandJson = JSON.stringify(command);
  const env = { ...process.env, MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON: commandJson };
  const cleanup = async () => {
    await rm(shimDir, { recursive: true, force: true }).catch(() => {});
  };
  return { shimDir, shimPath, command, commandJson, env, cleanup };
}

test("detectArticleSource recognizes xiaohongshu/xhslink hosts and rejects lookalikes", () => {
  assert.equal(detectArticleSource(NOTE_URL), "xiaohongshu");
  assert.equal(detectArticleSource(SHORT_LINK), "xiaohongshu");
  assert.equal(detectArticleSource("https://www.xiaohongshu.com/discovery/item/x"), "xiaohongshu");
  assert.equal(detectArticleSource("https://xiaohongshu.com.evil.example.com/explore/x"), "web");
  assert.equal(detectArticleSource("https://xxiaohongshu.com/explore/x"), "web");
  assert.equal(detectArticleSource("https://myxhslink.com/a/x"), "web");
});

test("resolveXiaohongshuImportConfig prefers the operator override and bounds the timeout", () => {
  const override = JSON.stringify(["/usr/local/bin/node", "/somewhere/cli.mjs"]);
  const cfg = resolveXiaohongshuImportConfig({ MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON: override });
  assert.deepEqual(cfg.command, ["/usr/local/bin/node", "/somewhere/cli.mjs"]);
  assert.equal(cfg.timeoutMs, 180_000);

  const huge = resolveXiaohongshuImportConfig({ MYAGENTTOOL_XIAOHONGSHU_IMPORT_TIMEOUT_MS: "9999999" });
  assert.equal(huge.timeoutMs, 300_000);

  const tiny = resolveXiaohongshuImportConfig({ MYAGENTTOOL_XIAOHONGSHU_IMPORT_TIMEOUT_MS: "10" });
  assert.equal(tiny.timeoutMs, 180_000); // below the 1000ms floor → default

  // A malformed override falls back to the bundled CLI, which exists in this worktree.
  const malformed = resolveXiaohongshuImportConfig({ MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON: "not json" });
  assert.ok(Array.isArray(malformed.command));
  assert.equal(malformed.command[0], process.execPath);
  assert.ok(
    malformed.command[1].replace(/\\/g, "/").endsWith("tools/xiaohongshu-imports/src/cli.mjs"),
    malformed.command[1],
  );
});

test("renderXiaohongshuPage returns the rendered HTML from the subprocess", async (t) => {
  const { env, cleanup } = await setup();
  t.after(cleanup);
  const { resolvedUrl, html } = await renderXiaohongshuPage(NOTE_URL, { env });
  assert.equal(resolvedUrl, RESOLVED_URL);
  assert.ok(html.includes("__INITIAL_STATE__"));
});

test("renderXiaohongshuPage surfaces xiaohongshu_import_failed when the renderer exits non-zero", async (t) => {
  const { env, cleanup } = await setup("fail");
  t.after(cleanup);
  await assert.rejects(() => renderXiaohongshuPage(NOTE_URL, { env }), (err) => err.code === "xiaohongshu_import_failed");
});

test("renderXiaohongshuPage surfaces xiaohongshu_import_failed on unparseable output", async (t) => {
  const { env, cleanup } = await setup("badjson");
  t.after(cleanup);
  await assert.rejects(() => renderXiaohongshuPage(NOTE_URL, { env }), (err) => err.code === "xiaohongshu_import_failed");
});

test("renderXiaohongshuPage surfaces xiaohongshu_import_failed on an empty html payload", async (t) => {
  const { env, cleanup } = await setup("empty");
  t.after(cleanup);
  await assert.rejects(() => renderXiaohongshuPage(NOTE_URL, { env }), (err) => err.code === "xiaohongshu_import_failed");
});

test("inspectArticle returns a synthetic inspection for xiaohongshu without launching a fetch", async () => {
  // No fetchImpl is supplied: a real anonymous fetch would 302 into the
  // /404/sec_* interstitial and SILENTLY ARCHIVE THE SHELL as a note (live
  // matrix 2026-08-17, issue #1703). The short-circuit must return before any
  // network so the preview path never blocks on a browser and never eats a wall.
  const inspection = await inspectArticle({ url: NOTE_URL });
  assert.equal(inspection.provider, "xiaohongshu");
  assert.equal(inspection.contentType, "note");
  assert.equal(inspection.title, "Xiaohongshu note");
  assert.deepEqual(inspection.media, []);
  assert.equal(inspection.canonicalUrl, NOTE_URL);
});

test("inspectXiaohongshuArticle parses the rendered note into the inspection shape", async (t) => {
  const { commandJson, cleanup } = await setup("direct");
  t.after(cleanup);
  const prev = process.env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON;
  process.env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON = commandJson;
  try {
    const inspection = await inspectXiaohongshuArticle({ url: NOTE_URL });
    assert.equal(inspection.provider, "xiaohongshu");
    assert.equal(inspection.contentType, "note");
    assert.equal(inspection.title, "结构化笔记");
    assert.equal(inspection.author, "红薯作者");
    // Epoch publishTime renders as an Asia/Shanghai date with no day drift
    // (2026-07-20T10:00:00+08:00 stays 2026-07-20).
    assert.equal(inspection.publishedAt, "2026-07-20");
    assert.equal(inspection.publishedAtSource, "source");
    assert.equal(inspection.resolvedUrl, NOTE_URL);
    assert.ok(inspection.textLength > 0);
    assert.deepEqual(inspection.mediaCounts, { images: 2, audio: 0, video: 0 });
    // The http xhscdn entry registered as https (the CDN serves the same path
    // over https; http would be refused at download time).
    assert.ok(
      inspection._document.media.every((item) => item.sourceUrl.startsWith("https://")),
      inspection._document.media.map((item) => item.sourceUrl).join(" "),
    );
    // The recommendation feed entry must NOT be imported.
    assert.ok(!inspection.markdownPreview.includes("不应导入的推荐笔记"));
    assert.ok(inspection._document.markdown.length > 0);
    assert.ok(inspection._document.media.length >= 1);
  } finally {
    if (prev === undefined) delete process.env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON;
    else process.env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON = prev;
  }
});

test("inspectXiaohongshuArticle recanonicalizes xhslink short links from the resolved note URL", async (t) => {
  const { commandJson, cleanup } = await setup(); // shim reports the RESOLVED note URL
  t.after(cleanup);
  const prev = process.env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON;
  process.env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON = commandJson;
  try {
    const inspection = await inspectXiaohongshuArticle({ url: SHORT_LINK });
    // sourceUrl keeps what the user pasted…
    assert.equal(inspection.sourceUrl, SHORT_LINK);
    // …but dedupe/hash key on the note URL the browser landed on (with the
    // share query intact — xsec_token is not a tracking param). A second short
    // link to the same note canonicalizes identically → dedupe holds.
    assert.equal(inspection.canonicalUrl, RESOLVED_URL);
    assert.equal(inspection.resolvedUrl, RESOLVED_URL);
    assert.equal(inspection.title, "结构化笔记");
  } finally {
    if (prev === undefined) delete process.env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON;
    else process.env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON = prev;
  }
});

test("importArticleToWorktree routes xiaohongshu URLs through the renderer and downloads media", async (t) => {
  const { commandJson, cleanup: cleanupShim } = await setup();
  const worktreePath = await mkdtemp(join(tmpdir(), "xiaohongshu-wt-"));
  t.after(async () => {
    await cleanupShim();
    await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
  });
  const prev = process.env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON;
  process.env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON = commandJson;
  try {
    const result = await importArticleToWorktree({
      url: SHORT_LINK,
      worktreePath,
      workItemId: "lwi_xiaohongshu",
      importedAt: "2026-08-17T00:00:00.000Z",
      resolveHostname: async () => [{ address: "93.184.216.34" }],
      fetchImpl: async (url) => {
        // downloadMedia fetches the note images (Referer = resolvedUrl). Both
        // arrive as https — the http webpic entry was upgraded at registration.
        if (String(url).includes("xhscdn.com/")) {
          return new Response(Buffer.from([0xff, 0xd8, 0xff, 0x01]), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    assert.equal(result.inspection.provider, "xiaohongshu");
    assert.equal(result.inspection.canonicalUrl, RESOLVED_URL);
    // The note carries a real publish date → the directory keys on it.
    assert.match(result.relativeDirectory, /^docs\/imported\/xiaohongshu\/2026\/07\//);
    assert.ok(result.markdownPath.endsWith("/article.md"));
    assert.ok(result.htmlPath.endsWith("/article.html"));
    assert.ok(result.manifestPath.endsWith("/manifest.json"));

    const markdown = await readFile(join(worktreePath, result.markdownPath), "utf8");
    const manifest = JSON.parse(await readFile(join(worktreePath, result.manifestPath), "utf8"));
    assert.equal(manifest.sourceProvider, "xiaohongshu");
    assert.equal(manifest.contentType, "note");
    assert.ok(manifest.media.length >= 2);
    assert.equal(manifest.warnings.length, 0);
    // The note images were downloaded and restored in-place at local asset paths.
    assert.match(markdown, /!\[.*\]\(assets\/001-[^)]+\.jpg\)/);
    assert.match(markdown, /!\[.*\]\(assets\/002-[^)]+\.jpg\)/);
    assert.doesNotMatch(markdown, /xhscdn\.com/);
    const assets = await readdir(join(worktreePath, result.relativeDirectory, "assets"));
    assert.equal(assets.length, 2);
  } finally {
    if (prev === undefined) delete process.env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON;
    else process.env.MYAGENTTOOL_XIAOHONGSHU_IMPORT_COMMAND_JSON = prev;
  }
});
