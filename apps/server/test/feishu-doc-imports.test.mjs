import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { detectArticleSource, importArticleToWorktree, inspectArticle } from "../src/services/article-imports.mjs";
import { importFeishuDocToWorktree, resolveFeishuImportConfig } from "../src/services/feishu-doc-imports.mjs";

const FEISHU_URL = "https://mynhkbykqf.feishu.cn/wiki/CHDzwTXYriLNIpk2HsRcx2VWnQe";

// A stand-in for the Phase-1 CLI, so the wrapper can be exercised without a
// browser. Selected via `--mode <name>` appended to the command argv:
//   ok      — write a bundle under --out and print the success JSON
//   fail    — exit non-zero with a stderr message
//   badjson — exit zero but print non-JSON
//   escape  — report a bundle dir outside the worktree (confinement probe)
const SHIM = String.raw`import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
let url = "", out = "", mode = "ok";
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") out = argv[++i];
  else if (a === "--mode") mode = argv[++i];
  else if (!a.startsWith("-") && !url) url = a;
}

if (mode === "fail") {
  process.stderr.write("simulated fetch failure\n");
  process.exit(2);
}
if (mode === "badjson") {
  process.stdout.write("not json\n");
  process.exit(0);
}
if (mode === "escape") {
  const escaped = resolve(out, "..", "..", "..", "..", "..", "..", "..", "..", "escaped-bundle");
  process.stdout.write(JSON.stringify({ ok: true, dir: escaped, markdown: "", manifest: "" }) + "\n");
  process.exit(0);
}

const dir = resolve(out, "test-bundle");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "doc.md"), "# Test Document\n\nbody\n");
writeFileSync(join(dir, "manifest.json"), JSON.stringify({
  schemaVersion: 2,
  source_provider: "feishu",
  canonical_url: url,
  title: "Test Document",
  asset_count: 2,
  images_not_captured: [],
  notes: [],
  fetched_at: "2026-08-12T00:00:00.000Z",
}));
process.stdout.write(JSON.stringify({
  ok: true,
  dir,
  markdown: join(dir, "doc.md"),
  manifest: join(dir, "manifest.json"),
  title: "Test Document",
  assets: 2,
  canonical_url: url,
}) + "\n");
`;

async function setup(mode) {
  const shimDir = await mkdtemp(join(tmpdir(), "feishu-shim-"));
  const shimPath = join(shimDir, "shim.mjs");
  await writeFile(shimPath, SHIM, "utf8");
  const worktreePath = await mkdtemp(join(tmpdir(), "feishu-wt-"));
  const command = [process.execPath, shimPath];
  if (mode) command.push("--mode", mode);
  const commandJson = JSON.stringify(command);
  const env = { ...process.env, MYAGENTTOOL_FEISHU_IMPORT_COMMAND_JSON: commandJson };
  const cleanup = async () => {
    await rm(shimDir, { recursive: true, force: true }).catch(() => {});
    await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
  };
  return { shimDir, shimPath, worktreePath, command, commandJson, env, cleanup };
}

test("detectArticleSource recognizes feishu and larksuite hosts", () => {
  assert.equal(detectArticleSource(FEISHU_URL), "feishu");
  assert.equal(detectArticleSource("https://tenant.larksuite.com/docx/CHDzwTXYriLNIpk2HsRcx2VWnQe"), "feishu");
  assert.equal(detectArticleSource("https://example.com/post"), "web");
});

test("resolveFeishuImportConfig prefers the operator override and bounds the timeout", () => {
  const override = JSON.stringify(["/usr/local/bin/node", "/somewhere/cli.mjs"]);
  const cfg = resolveFeishuImportConfig({ MYAGENTTOOL_FEISHU_IMPORT_COMMAND_JSON: override });
  assert.deepEqual(cfg.command, ["/usr/local/bin/node", "/somewhere/cli.mjs"]);
  assert.equal(cfg.timeoutMs, 180_000);

  const huge = resolveFeishuImportConfig({ MYAGENTTOOL_FEISHU_IMPORT_TIMEOUT_MS: "9999999" });
  assert.equal(huge.timeoutMs, 300_000);

  const tiny = resolveFeishuImportConfig({ MYAGENTTOOL_FEISHU_IMPORT_TIMEOUT_MS: "10" });
  assert.equal(tiny.timeoutMs, 180_000); // below the 1000ms floor → default

  // A malformed override falls back to the bundled CLI, which exists in this worktree.
  const malformed = resolveFeishuImportConfig({ MYAGENTTOOL_FEISHU_IMPORT_COMMAND_JSON: "not json" });
  assert.ok(Array.isArray(malformed.command));
  assert.equal(malformed.command[0], process.execPath);
  assert.ok(
    malformed.command[1].replace(/\\/g, "/").endsWith("tools/feishu-doc-imports/src/cli.mjs"),
    malformed.command[1],
  );
});

test("importFeishuDocToWorktree adapts a fetcher bundle to the article-imports shape", async (t) => {
  const { worktreePath, env, cleanup } = await setup();
  t.after(cleanup);
  const result = await importFeishuDocToWorktree({
    url: FEISHU_URL,
    worktreePath,
    importedAt: "2026-08-12T00:00:00.000Z",
    env,
  });
  assert.equal(result.replayed, false);
  assert.equal(result.htmlPath, null);
  assert.ok(result.markdownPath.startsWith("docs/imported/feishu/2026/08/"), result.markdownPath);
  assert.ok(result.markdownPath.endsWith("/doc.md"));
  assert.ok(result.manifestPath.endsWith("/manifest.json"));
  assert.equal(result.inspection.provider, "feishu");
  assert.equal(result.inspection.contentType, "document");
  assert.equal(result.inspection.title, "Test Document");
  assert.equal(result.inspection.canonicalUrl, FEISHU_URL);
  assert.deepEqual(result.mediaCounts, { images: 2, audio: 0, video: 0 });
  assert.ok(result.markdownSize > 0);
  assert.ok(result.manifestSize > 0);
  assert.ok(Array.isArray(result.warnings));
  // The bundle files exist on disk under the worktree.
  const md = await stat(join(worktreePath, result.markdownPath));
  assert.ok(md.size > 0);
});

test("inspectArticle returns a synthetic inspection for feishu without launching a fetch", async () => {
  // No fetchImpl is supplied: a real fetch would throw. The short-circuit must
  // return before any network so the preview path never blocks on a browser.
  const inspection = await inspectArticle({ url: FEISHU_URL });
  assert.equal(inspection.provider, "feishu");
  assert.equal(inspection.contentType, "document");
  assert.equal(inspection.title, "Feishu document");
  assert.deepEqual(inspection.media, []);
  assert.equal(inspection.canonicalUrl, FEISHU_URL);
});

test("importArticleToWorktree routes feishu URLs through the fetcher subprocess", async (t) => {
  const { worktreePath, commandJson, cleanup } = await setup();
  t.after(cleanup);
  // The feishu branch calls importFeishuDocToWorktree with the process env, so
  // wire the override there for the duration of the call.
  const prev = process.env.MYAGENTTOOL_FEISHU_IMPORT_COMMAND_JSON;
  process.env.MYAGENTTOOL_FEISHU_IMPORT_COMMAND_JSON = commandJson;
  try {
    const result = await importArticleToWorktree({
      url: FEISHU_URL,
      worktreePath,
      importedAt: "2026-08-12T00:00:00.000Z",
    });
    assert.equal(result.inspection.provider, "feishu");
    assert.equal(result.htmlPath, null);
    assert.ok(result.markdownPath.endsWith("/doc.md"));
    assert.ok(result.markdownPath.startsWith("docs/imported/feishu/2026/08/"));
  } finally {
    if (prev === undefined) delete process.env.MYAGENTTOOL_FEISHU_IMPORT_COMMAND_JSON;
    else process.env.MYAGENTTOOL_FEISHU_IMPORT_COMMAND_JSON = prev;
  }
});

test("importFeishuDocToWorktree surfaces feishu_import_failed when the fetcher exits non-zero", async (t) => {
  const { worktreePath, env, cleanup } = await setup("fail");
  t.after(cleanup);
  await assert.rejects(
    () => importFeishuDocToWorktree({ url: FEISHU_URL, worktreePath, env }),
    (err) => err.code === "feishu_import_failed",
  );
});

test("importFeishuDocToWorktree surfaces feishu_import_failed on unparseable output", async (t) => {
  const { worktreePath, env, cleanup } = await setup("badjson");
  t.after(cleanup);
  await assert.rejects(
    () => importFeishuDocToWorktree({ url: FEISHU_URL, worktreePath, env }),
    (err) => err.code === "feishu_import_failed",
  );
});

test("importFeishuDocToWorktree rejects a bundle dir that escapes the worktree", async (t) => {
  const { worktreePath, env, cleanup } = await setup("escape");
  t.after(cleanup);
  await assert.rejects(
    () => importFeishuDocToWorktree({ url: FEISHU_URL, worktreePath, env }),
    (err) => err.code === "feishu_import_path_refused",
  );
});
