import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  detectArticleSource,
  importArticleToWorktree,
  inspectArticle,
  inspectJianshuArticle,
} from "../src/services/article-imports.mjs";
import { renderJianshuPage, resolveJianshuImportConfig } from "../src/services/jianshu-imports.mjs";

const NOTE_URL = "https://www.jianshu.com/p/0285ae4ba9a6";
// The final URL the browser lands on after a slug-alias redirect — the utm
// query is tracking and gets stripped at re-canonicalization.
const RESOLVED_URL = "https://www.jianshu.com/p/0285ae4ba9a6?utm_source=desktop";

// The COMPOSED document the plugin CLI returns: built in
// tools/jianshu-imports/src/fetch-doc.mjs from the page's __NEXT_DATA__ note
// payload. The h1/div classes reuse jianshu's own title/author classes so the
// server-side generic selectors agree with the meta override. The first image
// rides the lazy attribute data-original-src ONLY (no src) — pinning the
// renderMedia chain — and is protocol-relative, resolved to https by
// resolveHttpUrl; the second is already absolute https.
function jianshuComposedHtml() {
  return `<!doctype html><html><head><title>黄瓜花</title></head><body><article>
<h1 class="_1RuRku">黄瓜花</h1>
<div class="_22gUMi">老树</div>
<div class="note-publish-time">2019-06-12</div>
<div class="note-content"><p>黄瓜花开得正好，一条藤上开了三朵。</p>
<img data-original-src="//upload-images.jianshu.io/upload_images/123-abc.jpg" alt="花">
<img src="https://upload-images.jianshu.io/upload_images/123-def.jpg" alt="叶">
</div></article></body></html>`;
}

const RENDER_META = { title: "黄瓜花", author: "老树", publishedAt: "2019-06-12" };

// A stand-in for the renderer CLI, so the adapter can be exercised without a
// browser. Selected via `--mode <name>` appended to the command argv:
//   ok      — print the success JSON {ok,url,html,meta} (url = RESOLVED_URL,
//             i.e. what the browser reports after the slug-alias redirect)
//   direct  — same but url = the passed-through article URL (no redirect)
//   fail    — exit non-zero with a stderr message (deleted-article shape)
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
const HTML = ${JSON.stringify(jianshuComposedHtml())};
const META = ${JSON.stringify(RENDER_META)};
const RESOLVED = ${JSON.stringify(RESOLVED_URL)};
if (mode === "fail") { process.stderr.write("jianshu-imports failed: Jianshu returned 404 — the article is deleted or the slug is wrong.\n"); process.exit(2); }
if (mode === "badjson") { process.stdout.write("not json\n"); process.exit(0); }
if (mode === "empty") { process.stdout.write(JSON.stringify({ ok: true, url, html: "", meta: META }) + "\n"); process.exit(0); }
if (mode === "direct") { process.stdout.write(JSON.stringify({ ok: true, url, html: HTML, meta: META }) + "\n"); process.exit(0); }
process.stdout.write(JSON.stringify({ ok: true, url: RESOLVED, html: HTML, meta: META }) + "\n");
`;

async function setup(mode) {
  const shimDir = await mkdtemp(join(tmpdir(), "jianshu-shim-"));
  const shimPath = join(shimDir, "shim.mjs");
  await writeFile(shimPath, SHIM, "utf8");
  const command = [process.execPath, shimPath];
  if (mode) command.push("--mode", mode);
  const commandJson = JSON.stringify(command);
  const env = { ...process.env, MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON: commandJson };
  const cleanup = async () => {
    await rm(shimDir, { recursive: true, force: true }).catch(() => {});
  };
  return { shimDir, shimPath, command, commandJson, env, cleanup };
}

test("detectArticleSource recognizes jianshu hosts and rejects lookalikes", () => {
  assert.equal(detectArticleSource(NOTE_URL), "jianshu");
  assert.equal(detectArticleSource("https://jianshu.com/p/x"), "jianshu");
  assert.equal(detectArticleSource("https://jianshu.com.evil.example.com/p/x"), "web");
  assert.equal(detectArticleSource("https://jjianshu.com/p/x"), "web");
  assert.equal(detectArticleSource("https://myjianshu.com/p/x"), "web");
});

test("resolveJianshuImportConfig prefers the operator override and bounds the timeout", () => {
  const override = JSON.stringify(["/usr/local/bin/node", "/somewhere/cli.mjs"]);
  const cfg = resolveJianshuImportConfig({ MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON: override });
  assert.deepEqual(cfg.command, ["/usr/local/bin/node", "/somewhere/cli.mjs"]);
  assert.equal(cfg.timeoutMs, 180_000);

  const huge = resolveJianshuImportConfig({ MYAGENTTOOL_JIANSHU_IMPORT_TIMEOUT_MS: "9999999" });
  assert.equal(huge.timeoutMs, 300_000);

  const tiny = resolveJianshuImportConfig({ MYAGENTTOOL_JIANSHU_IMPORT_TIMEOUT_MS: "10" });
  assert.equal(tiny.timeoutMs, 180_000); // below the 1000ms floor → default

  // A malformed override falls back to the bundled CLI, which exists in this worktree.
  const malformed = resolveJianshuImportConfig({ MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON: "not json" });
  assert.ok(Array.isArray(malformed.command));
  assert.equal(malformed.command[0], process.execPath);
  assert.ok(
    malformed.command[1].replace(/\\/g, "/").endsWith("tools/jianshu-imports/src/cli.mjs"),
    malformed.command[1],
  );
});

test("renderJianshuPage returns the composed HTML and metadata from the subprocess", async (t) => {
  const { env, cleanup } = await setup();
  t.after(cleanup);
  const { resolvedUrl, html, meta } = await renderJianshuPage(NOTE_URL, { env });
  assert.equal(resolvedUrl, RESOLVED_URL);
  assert.ok(html.includes('class="note-content"'));
  assert.deepEqual(meta, RENDER_META);
});

test("renderJianshuPage surfaces jianshu_import_failed when the renderer exits non-zero (deleted article)", async (t) => {
  const { env, cleanup } = await setup("fail");
  t.after(cleanup);
  await assert.rejects(
    () => renderJianshuPage(NOTE_URL, { env }),
    (err) => err.code === "jianshu_import_failed" && /404/.test(err.message),
  );
});

test("renderJianshuPage surfaces jianshu_import_failed on unparseable output", async (t) => {
  const { env, cleanup } = await setup("badjson");
  t.after(cleanup);
  await assert.rejects(() => renderJianshuPage(NOTE_URL, { env }), (err) => err.code === "jianshu_import_failed");
});

test("renderJianshuPage surfaces jianshu_import_failed on an empty html payload", async (t) => {
  const { env, cleanup } = await setup("empty");
  t.after(cleanup);
  await assert.rejects(() => renderJianshuPage(NOTE_URL, { env }), (err) => err.code === "jianshu_import_failed");
});

test("inspectArticle returns a synthetic inspection for jianshu without launching a fetch", async () => {
  // No fetchImpl is supplied: the SSR DOM only carries the truncated intro
  // (the body lives in __NEXT_DATA__), so a plain anonymous fetch would
  // silently preview the WRONG text. The short-circuit must return before any
  // network so the preview path never blocks on a browser either.
  const inspection = await inspectArticle({ url: NOTE_URL });
  assert.equal(inspection.provider, "jianshu");
  assert.equal(inspection.contentType, "article");
  assert.equal(inspection.title, "Jianshu article");
  assert.deepEqual(inspection.media, []);
  assert.equal(inspection.canonicalUrl, NOTE_URL);
});

test("inspectJianshuArticle parses the composed note into the inspection shape", async (t) => {
  const { commandJson, cleanup } = await setup("direct");
  t.after(cleanup);
  const prev = process.env.MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON;
  process.env.MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON = commandJson;
  try {
    const inspection = await inspectJianshuArticle({ url: NOTE_URL });
    assert.equal(inspection.provider, "jianshu");
    assert.equal(inspection.contentType, "article");
    // The __NEXT_DATA__ metadata (via the renderer's meta) is authoritative…
    assert.equal(inspection.title, "黄瓜花");
    assert.equal(inspection.author, "老树");
    assert.equal(inspection.publishedAt, "2019-06-12");
    assert.equal(inspection.publishedAtSource, "source");
    assert.equal(inspection.resolvedUrl, NOTE_URL);
    assert.ok(inspection.textLength > 0);
    assert.deepEqual(inspection.mediaCounts, { images: 2, audio: 0, video: 0 });
    // Both images registered as absolute https — the data-original-src-only
    // entry proves the renderMedia chain fix, the protocol-relative form the
    // resolveHttpUrl resolution.
    assert.ok(
      inspection._document.media.every((item) => item.sourceUrl.startsWith("https://")),
      inspection._document.media.map((item) => item.sourceUrl).join(" "),
    );
    assert.ok(inspection._document.markdown.length > 0);
  } finally {
    if (prev === undefined) delete process.env.MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON;
    else process.env.MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON = prev;
  }
});

test("inspectJianshuArticle recanonicalizes slug-alias redirects from the resolved article URL", async (t) => {
  const { commandJson, cleanup } = await setup(); // shim reports the RESOLVED article URL
  t.after(cleanup);
  const prev = process.env.MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON;
  process.env.MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON = commandJson;
  try {
    const inspection = await inspectJianshuArticle({ url: NOTE_URL });
    // sourceUrl keeps what the user pasted…
    assert.equal(inspection.sourceUrl, NOTE_URL);
    // …but dedupe/hash key on the URL the browser landed on, tracking params
    // (utm_source) stripped.
    assert.equal(inspection.canonicalUrl, NOTE_URL);
    assert.equal(inspection.resolvedUrl, RESOLVED_URL);
    assert.equal(inspection.title, "黄瓜花");
  } finally {
    if (prev === undefined) delete process.env.MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON;
    else process.env.MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON = prev;
  }
});

test("importArticleToWorktree routes jianshu URLs through the renderer and downloads media", async (t) => {
  const { commandJson, cleanup: cleanupShim } = await setup();
  const worktreePath = await mkdtemp(join(tmpdir(), "jianshu-wt-"));
  t.after(async () => {
    await cleanupShim();
    await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
  });
  const prev = process.env.MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON;
  process.env.MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON = commandJson;
  try {
    const result = await importArticleToWorktree({
      url: NOTE_URL,
      worktreePath,
      workItemId: "lwi_jianshu",
      importedAt: "2026-08-17T00:00:00.000Z",
      resolveHostname: async () => [{ address: "93.184.216.34" }],
      fetchImpl: async (url) => {
        // downloadMedia fetches the article images. Both arrive as absolute
        // https — the data-original-src entry was resolved against the page URL.
        if (String(url).includes("upload-images.jianshu.io/")) {
          return new Response(Buffer.from([0xff, 0xd8, 0xff, 0x01]), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    assert.equal(result.inspection.provider, "jianshu");
    assert.equal(result.inspection.canonicalUrl, NOTE_URL);
    // The note carries a real publish date → the directory keys on it.
    assert.match(result.relativeDirectory, /^docs\/imported\/jianshu\/2019\/06\//);
    assert.ok(result.markdownPath.endsWith("/article.md"));
    assert.ok(result.htmlPath.endsWith("/article.html"));
    assert.ok(result.manifestPath.endsWith("/manifest.json"));

    const markdown = await readFile(join(worktreePath, result.markdownPath), "utf8");
    const manifest = JSON.parse(await readFile(join(worktreePath, result.manifestPath), "utf8"));
    assert.equal(manifest.sourceProvider, "jianshu");
    assert.equal(manifest.contentType, "article");
    assert.ok(manifest.media.length >= 2);
    assert.equal(manifest.warnings.length, 0);
    // The article images were downloaded and restored in-place at local asset paths.
    assert.match(markdown, /!\[.*\]\(assets\/001-[^)]+\.jpg\)/);
    assert.match(markdown, /!\[.*\]\(assets\/002-[^)]+\.jpg\)/);
    assert.doesNotMatch(markdown, /jianshu\.io/);
    const assets = await readdir(join(worktreePath, result.relativeDirectory, "assets"));
    assert.equal(assets.length, 2);
  } finally {
    if (prev === undefined) delete process.env.MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON;
    else process.env.MYAGENTTOOL_JIANSHU_IMPORT_COMMAND_JSON = prev;
  }
});
