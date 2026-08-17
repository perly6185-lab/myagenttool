import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  detectArticleSource,
  importArticleToWorktree,
  inspectArticle,
  inspectQichachaArticle,
} from "../src/services/article-imports.mjs";
import { renderQichachaPage, resolveQichachaImportConfig } from "../src/services/qichacha-imports.mjs";

const FIRM_URL = "https://www.qcc.com/firm/9d2f2be64b8b1b03ffef31fb800d5f85.shtml";

// A minimal rendered firm page the subprocess would return behind the login
// wall: company name in the header, the basic-info table under basic-detail,
// no author and no publish date (a company page has neither). Selectors are
// the ones parseArticleDocument reads (finalized by the live pass).
function qichachaRenderedHtml() {
  return `<!doctype html><html><head><title>某某科技有限公司 - 企查查</title></head>
<body>
  <nav><a>导航噪声</a></nav>
  <div class="header-content">
    <h1 class="header-title">某某科技有限公司</h1>
  </div>
  <section class="basic-detail">
    <table class="ntable">
      <tr><td>法定代表人</td><td>张三</td></tr>
      <tr><td>注册资本</td><td>1000万元人民币</td></tr>
    </table>
    <img data-src="https://imagetm.oss-cn-hangzhou.aliyuncs.com/firm-logo.png" alt="公司Logo">
  </section>
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
const HTML = ${JSON.stringify(qichachaRenderedHtml())};
if (mode === "fail") { process.stderr.write("simulated render failure\n"); process.exit(2); }
if (mode === "badjson") { process.stdout.write("not json\n"); process.exit(0); }
if (mode === "empty") { process.stdout.write(JSON.stringify({ ok: true, url, html: "" }) + "\n"); process.exit(0); }
process.stdout.write(JSON.stringify({ ok: true, url, html: HTML }) + "\n");
`;

async function setup(mode) {
  const shimDir = await mkdtemp(join(tmpdir(), "qichacha-shim-"));
  const shimPath = join(shimDir, "shim.mjs");
  await writeFile(shimPath, SHIM, "utf8");
  const command = [process.execPath, shimPath];
  if (mode) command.push("--mode", mode);
  const commandJson = JSON.stringify(command);
  const env = { ...process.env, MYAGENTTOOL_QICHACHA_IMPORT_COMMAND_JSON: commandJson };
  const cleanup = async () => {
    await rm(shimDir, { recursive: true, force: true }).catch(() => {});
  };
  return { shimDir, shimPath, command, commandJson, env, cleanup };
}

test("detectArticleSource recognizes qcc/qichacha hosts and rejects lookalikes", () => {
  assert.equal(detectArticleSource(FIRM_URL), "qichacha");
  assert.equal(detectArticleSource("https://www.qichacha.com/firm/x.shtml"), "qichacha");
  assert.equal(detectArticleSource("https://m.qcc.com/firm/x.shtml"), "qichacha");
  assert.equal(detectArticleSource("https://xqcc.com/firm/x.shtml"), "web");
  assert.equal(detectArticleSource("https://example.com/firm/x.shtml"), "web");
});

test("resolveQichachaImportConfig prefers the operator override and bounds the timeout", () => {
  const override = JSON.stringify(["/usr/local/bin/node", "/somewhere/cli.mjs"]);
  const cfg = resolveQichachaImportConfig({ MYAGENTTOOL_QICHACHA_IMPORT_COMMAND_JSON: override });
  assert.deepEqual(cfg.command, ["/usr/local/bin/node", "/somewhere/cli.mjs"]);
  assert.equal(cfg.timeoutMs, 180_000);

  const huge = resolveQichachaImportConfig({ MYAGENTTOOL_QICHACHA_IMPORT_TIMEOUT_MS: "9999999" });
  assert.equal(huge.timeoutMs, 300_000);

  const tiny = resolveQichachaImportConfig({ MYAGENTTOOL_QICHACHA_IMPORT_TIMEOUT_MS: "10" });
  assert.equal(tiny.timeoutMs, 180_000); // below the 1000ms floor → default

  // A malformed override falls back to the bundled CLI, which exists in this worktree.
  const malformed = resolveQichachaImportConfig({ MYAGENTTOOL_QICHACHA_IMPORT_COMMAND_JSON: "not json" });
  assert.ok(Array.isArray(malformed.command));
  assert.equal(malformed.command[0], process.execPath);
  assert.ok(
    malformed.command[1].replace(/\\/g, "/").endsWith("tools/qichacha-imports/src/cli.mjs"),
    malformed.command[1],
  );
});

test("renderQichachaPage returns the rendered HTML from the subprocess", async (t) => {
  const { env, cleanup } = await setup();
  t.after(cleanup);
  const { resolvedUrl, html } = await renderQichachaPage(FIRM_URL, { env });
  assert.equal(resolvedUrl, FIRM_URL);
  assert.ok(html.includes("basic-detail"));
});

test("renderQichachaPage surfaces qichacha_import_failed when the renderer exits non-zero", async (t) => {
  const { env, cleanup } = await setup("fail");
  t.after(cleanup);
  await assert.rejects(() => renderQichachaPage(FIRM_URL, { env }), (err) => err.code === "qichacha_import_failed");
});

test("renderQichachaPage surfaces qichacha_import_failed on unparseable output", async (t) => {
  const { env, cleanup } = await setup("badjson");
  t.after(cleanup);
  await assert.rejects(() => renderQichachaPage(FIRM_URL, { env }), (err) => err.code === "qichacha_import_failed");
});

test("renderQichachaPage surfaces qichacha_import_failed on an empty html payload", async (t) => {
  const { env, cleanup } = await setup("empty");
  t.after(cleanup);
  await assert.rejects(() => renderQichachaPage(FIRM_URL, { env }), (err) => err.code === "qichacha_import_failed");
});

test("inspectArticle returns a synthetic inspection for qichacha without launching a fetch", async () => {
  // No fetchImpl is supplied: a real fetch would hit the login wall and poll
  // anti-crawl. The short-circuit must return before any network so the
  // preview path never blocks on a browser or spends view quota.
  const inspection = await inspectArticle({ url: FIRM_URL });
  assert.equal(inspection.provider, "qichacha");
  assert.equal(inspection.contentType, "company");
  assert.equal(inspection.title, "Qichacha company page");
  assert.deepEqual(inspection.media, []);
  assert.equal(inspection.canonicalUrl, FIRM_URL);
});

test("inspectQichachaArticle parses the rendered firm page into the inspection shape", async (t) => {
  const { commandJson, cleanup } = await setup();
  t.after(cleanup);
  // inspectQichachaArticle resolves its command from process.env (like the
  // zhihu path), so wire the override there for the call.
  const prev = process.env.MYAGENTTOOL_QICHACHA_IMPORT_COMMAND_JSON;
  process.env.MYAGENTTOOL_QICHACHA_IMPORT_COMMAND_JSON = commandJson;
  try {
    const inspection = await inspectQichachaArticle({ url: FIRM_URL });
    assert.equal(inspection.provider, "qichacha");
    assert.equal(inspection.contentType, "company");
    assert.equal(inspection.title, "某某科技有限公司");
    // A firm page has no author and no publish date — both stay null.
    assert.equal(inspection.author, null);
    assert.equal(inspection.publishedAt, null);
    assert.equal(inspection.publishedAtSource, "imported");
    assert.equal(inspection.resolvedUrl, FIRM_URL);
    assert.ok(inspection.textLength > 0);
    // The basic-info table flattens (generic-first; Stage B adds provider-gated
    // table rendering only if a real page proves this unreadable).
    assert.ok(inspection.markdownPreview.includes("法定代表人"));
    assert.ok(inspection.markdownPreview.includes("1000万元人民币"));
    // One logo image registered for the parent's downloadMedia.
    assert.equal(inspection.media.length, 1);
    assert.equal(inspection.media[0].type, "image");
    assert.equal(inspection.media[0].sourceUrl, "https://imagetm.oss-cn-hangzhou.aliyuncs.com/firm-logo.png");
    assert.ok(inspection._document.markdown.length > 0);
    assert.ok(inspection._document.html.length > 0);
    assert.equal(inspection._document.media.length, 1);
  } finally {
    if (prev === undefined) delete process.env.MYAGENTTOOL_QICHACHA_IMPORT_COMMAND_JSON;
    else process.env.MYAGENTTOOL_QICHACHA_IMPORT_COMMAND_JSON = prev;
  }
});

test("importArticleToWorktree routes qichacha URLs through the renderer and downloads media", async (t) => {
  const { commandJson, cleanup: cleanupShim } = await setup();
  const worktreePath = await mkdtemp(join(tmpdir(), "qichacha-wt-"));
  t.after(async () => {
    await cleanupShim();
    await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
  });
  const prev = process.env.MYAGENTTOOL_QICHACHA_IMPORT_COMMAND_JSON;
  process.env.MYAGENTTOOL_QICHACHA_IMPORT_COMMAND_JSON = commandJson;
  try {
    const result = await importArticleToWorktree({
      url: FIRM_URL,
      worktreePath,
      workItemId: "lwi_qichacha",
      importedAt: "2026-08-13T00:00:00.000Z",
      resolveHostname: async () => [{ address: "93.184.216.34" }],
      fetchImpl: async (url) => {
        // downloadMedia fetches the logo image with Referer = resolvedUrl.
        if (String(url).includes("imagetm.oss-cn-hangzhou.aliyuncs.com")) {
          return new Response(Buffer.from([0xff, 0xd8, 0xff, 0x01]), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    assert.equal(result.inspection.provider, "qichacha");
    // publishedAt is null → the import date stamps the directory.
    assert.match(result.relativeDirectory, /^docs\/imported\/qichacha\/2026\/08\//);
    assert.ok(result.markdownPath.endsWith("/article.md"));
    assert.ok(result.htmlPath.endsWith("/article.html"));
    assert.ok(result.manifestPath.endsWith("/manifest.json"));

    const markdown = await readFile(join(worktreePath, result.markdownPath), "utf8");
    const manifest = JSON.parse(await readFile(join(worktreePath, result.manifestPath), "utf8"));
    assert.equal(manifest.sourceProvider, "qichacha");
    assert.equal(manifest.media.length, 1);
    assert.equal(manifest.warnings.length, 0);
    // The logo was downloaded and restored in-place at a local asset path.
    assert.match(markdown, /!\[公司Logo\]\(assets\/001-[^)]+\.jpg\)/);
    assert.doesNotMatch(markdown, /aliyuncs\.com/);
    const assets = await readdir(join(worktreePath, result.relativeDirectory, "assets"));
    assert.equal(assets.length, 1);
  } finally {
    if (prev === undefined) delete process.env.MYAGENTTOOL_QICHACHA_IMPORT_COMMAND_JSON;
    else process.env.MYAGENTTOOL_QICHACHA_IMPORT_COMMAND_JSON = prev;
  }
});
