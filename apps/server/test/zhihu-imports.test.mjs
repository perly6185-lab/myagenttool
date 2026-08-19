import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  detectArticleSource,
  importArticleToWorktree,
  inspectArticle,
  inspectZhihuArticle,
} from "../src/services/article-imports.mjs";
import { renderZhihuArticle, resolveZhihuImportConfig } from "../src/services/zhihu-imports.mjs";

const ZHIHU_URL = "https://zhuanlan.zhihu.com/p/123456789";

// A minimal rendered-zhihu page the subprocess would return after clearing the
// secng challenge. Uses the real zhihu selectors parseArticleDocument relies on
// (Post-RichTextContainer / Post-Title / AuthorInfo-name) and a zhimg image
// with data-original (the attribute renderMedia already reads).
function zhihuRenderedHtml() {
  return `<!doctype html><html><head><title>知乎专栏测试标题</title></head>
<body>
  <h1 class="Post-Title">知乎专栏测试标题</h1>
  <div class="AuthorInfo-name">作者名</div>
  <div class="Post-RichTextContainer">
    <p>这是知乎专栏的正文段落。</p>
    <img data-original="https://pic1.zhimg.com/v2-test.jpg" alt="配图">
    <p>第二段正文。</p>
  </div>
</body></html>`;
}

// A stand-in for the renderer CLI, so the adapter can be exercised without a
// browser. Selected via `--mode <name>` appended to the command argv:
//   ok      — print the success JSON {ok,url,html}
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
const HTML = ${JSON.stringify(zhihuRenderedHtml())};
if (mode === "fail") { process.stderr.write("simulated render failure\n"); process.exit(2); }
if (mode === "badjson") { process.stdout.write("not json\n"); process.exit(0); }
if (mode === "empty") { process.stdout.write(JSON.stringify({ ok: true, url, html: "" }) + "\n"); process.exit(0); }
process.stdout.write(JSON.stringify({ ok: true, url, html: HTML }) + "\n");
`;

async function setup(mode) {
  const shimDir = await mkdtemp(join(tmpdir(), "zhihu-shim-"));
  const shimPath = join(shimDir, "shim.mjs");
  await writeFile(shimPath, SHIM, "utf8");
  const command = [process.execPath, shimPath];
  if (mode) command.push("--mode", mode);
  const commandJson = JSON.stringify(command);
  const env = { ...process.env, MYAGENTTOOL_ZHIHU_IMPORT_COMMAND_JSON: commandJson };
  const cleanup = async () => {
    await rm(shimDir, { recursive: true, force: true }).catch(() => {});
  };
  return { shimDir, shimPath, command, commandJson, env, cleanup };
}

test("detectArticleSource recognizes zhihu hosts", () => {
  assert.equal(detectArticleSource(ZHIHU_URL), "zhihu");
  assert.equal(detectArticleSource("https://www.zhihu.com/question/123"), "zhihu");
  assert.equal(detectArticleSource("https://example.com/post"), "web");
});

test("resolveZhihuImportConfig prefers the operator override and bounds the timeout", () => {
  const override = JSON.stringify(["/usr/local/bin/node", "/somewhere/cli.mjs"]);
  const cfg = resolveZhihuImportConfig({ MYAGENTTOOL_ZHIHU_IMPORT_COMMAND_JSON: override });
  assert.deepEqual(cfg.command, ["/usr/local/bin/node", "/somewhere/cli.mjs"]);
  assert.equal(cfg.timeoutMs, 180_000);

  const huge = resolveZhihuImportConfig({ MYAGENTTOOL_ZHIHU_IMPORT_TIMEOUT_MS: "9999999" });
  assert.equal(huge.timeoutMs, 300_000);

  const tiny = resolveZhihuImportConfig({ MYAGENTTOOL_ZHIHU_IMPORT_TIMEOUT_MS: "10" });
  assert.equal(tiny.timeoutMs, 180_000); // below the 1000ms floor → default

  // A malformed override falls back to the bundled CLI, which exists in this worktree.
  const malformed = resolveZhihuImportConfig({ MYAGENTTOOL_ZHIHU_IMPORT_COMMAND_JSON: "not json" });
  assert.ok(Array.isArray(malformed.command));
  assert.equal(malformed.command[0], process.execPath);
  assert.ok(
    malformed.command[1].replace(/\\/g, "/").endsWith("tools/zhihu-imports/src/cli.mjs"),
    malformed.command[1],
  );
});

test("renderZhihuArticle returns the rendered HTML from the subprocess", async (t) => {
  const { env, cleanup } = await setup();
  t.after(cleanup);
  const { resolvedUrl, html } = await renderZhihuArticle(ZHIHU_URL, { env });
  assert.equal(resolvedUrl, ZHIHU_URL);
  assert.ok(html.includes("Post-RichTextContainer"));
});

test("renderZhihuArticle surfaces zhihu_import_failed when the renderer exits non-zero", async (t) => {
  const { env, cleanup } = await setup("fail");
  t.after(cleanup);
  await assert.rejects(() => renderZhihuArticle(ZHIHU_URL, { env }), (err) => err.code === "zhihu_import_failed");
});

test("renderZhihuArticle surfaces zhihu_import_failed on unparseable output", async (t) => {
  const { env, cleanup } = await setup("badjson");
  t.after(cleanup);
  await assert.rejects(() => renderZhihuArticle(ZHIHU_URL, { env }), (err) => err.code === "zhihu_import_failed");
});

test("renderZhihuArticle surfaces zhihu_import_failed on an empty html payload", async (t) => {
  const { env, cleanup } = await setup("empty");
  t.after(cleanup);
  await assert.rejects(() => renderZhihuArticle(ZHIHU_URL, { env }), (err) => err.code === "zhihu_import_failed");
});

test("inspectArticle returns a synthetic inspection for zhihu without launching a fetch", async () => {
  // No fetchImpl is supplied: a real fetch would throw. The short-circuit must
  // return before any network so the preview path never blocks on a browser.
  const inspection = await inspectArticle({ url: ZHIHU_URL });
  assert.equal(inspection.provider, "zhihu");
  assert.equal(inspection.contentType, "article");
  assert.equal(inspection.title, "Zhihu article");
  assert.deepEqual(inspection.media, []);
  assert.equal(inspection.canonicalUrl, ZHIHU_URL);
});

test("inspectZhihuArticle parses the rendered HTML into the inspection shape", async (t) => {
  const { commandJson, cleanup } = await setup();
  t.after(cleanup);
  // inspectZhihuArticle resolves its command from process.env (like the feishu
  // importArticleToWorktree path), so wire the override there for the call.
  const prev = process.env.MYAGENTTOOL_ZHIHU_IMPORT_COMMAND_JSON;
  process.env.MYAGENTTOOL_ZHIHU_IMPORT_COMMAND_JSON = commandJson;
  try {
    const inspection = await inspectZhihuArticle({ url: ZHIHU_URL });
    assert.equal(inspection.provider, "zhihu");
    assert.equal(inspection.contentType, "article");
    assert.equal(inspection.title, "知乎专栏测试标题");
    assert.equal(inspection.author, "作者名");
    assert.equal(inspection.resolvedUrl, ZHIHU_URL);
    assert.ok(inspection.textLength > 0);
    assert.ok(inspection.markdownPreview.includes("正文段落"));
    // One zhimg image registered for the parent's downloadMedia.
    assert.equal(inspection.media.length, 1);
    assert.equal(inspection.media[0].type, "image");
    assert.equal(inspection.media[0].sourceUrl, "https://pic1.zhimg.com/v2-test.jpg");
    // _document carries the parsed markdown/html for the write pipeline.
    assert.ok(inspection._document.markdown.length > 0);
    assert.ok(inspection._document.html.length > 0);
    assert.equal(inspection._document.media.length, 1);
  } finally {
    if (prev === undefined) delete process.env.MYAGENTTOOL_ZHIHU_IMPORT_COMMAND_JSON;
    else process.env.MYAGENTTOOL_ZHIHU_IMPORT_COMMAND_JSON = prev;
  }
});

test("importArticleToWorktree routes zhihu URLs through the renderer and downloads images", async (t) => {
  const { commandJson, cleanup: cleanupShim } = await setup();
  const worktreePath = await mkdtemp(join(tmpdir(), "zhihu-wt-"));
  t.after(async () => {
    await cleanupShim();
    await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
  });
  const prev = process.env.MYAGENTTOOL_ZHIHU_IMPORT_COMMAND_JSON;
  process.env.MYAGENTTOOL_ZHIHU_IMPORT_COMMAND_JSON = commandJson;
  try {
    const result = await importArticleToWorktree({
      url: ZHIHU_URL,
      worktreePath,
      workItemId: "lwi_zhihu",
      importedAt: "2026-08-13T00:00:00.000Z",
      resolveHostname: async () => [{ address: "93.184.216.34" }],
      fetchImpl: async (url) => {
        // downloadMedia fetches the zhimg image with Referer = resolvedUrl.
        if (String(url).includes("zhimg.com")) {
          return new Response(Buffer.from([0xff, 0xd8, 0xff, 0x01]), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    assert.equal(result.inspection.provider, "zhihu");
    assert.match(result.relativeDirectory, /^docs\/imported\/zhihu\/2026\/08\//);
    assert.ok(result.markdownPath.endsWith("/article.md"));
    assert.ok(result.htmlPath.endsWith("/article.html"));
    assert.ok(result.manifestPath.endsWith("/manifest.json"));

    const markdown = await readFile(join(worktreePath, result.markdownPath), "utf8");
    const manifest = JSON.parse(await readFile(join(worktreePath, result.manifestPath), "utf8"));
    assert.equal(manifest.sourceProvider, "zhihu");
    assert.equal(manifest.media.length, 1);
    assert.equal(manifest.warnings.length, 0);
    // The zhimg image was downloaded and restored in-place at a local asset path.
    assert.match(markdown, /!\[配图\]\(assets\/001-[^)]+\.jpg\)/);
    assert.doesNotMatch(markdown, /zhimg\.com/);
    const assets = await readdir(join(worktreePath, result.relativeDirectory, "assets"));
    assert.equal(assets.length, 1);
  } finally {
    if (prev === undefined) delete process.env.MYAGENTTOOL_ZHIHU_IMPORT_COMMAND_JSON;
    else process.env.MYAGENTTOOL_ZHIHU_IMPORT_COMMAND_JSON = prev;
  }
});
