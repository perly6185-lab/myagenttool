#!/usr/bin/env node
// CLI entry: fetch a public Feishu document to a local markdown bundle.
//
// Usage:
//   node tools/feishu-doc-imports/src/cli.mjs <url> [--out <dir>] [--headed]
//
// Exit codes: 0 on success, 1 on usage/import error, 2 on fetch failure.

import { importFeishuDoc } from "./import-doc.mjs";
import { resolveConfig } from "./config.mjs";

const HELP = `feishu-doc-imports — fetch a public Feishu wiki/docx document to local markdown.

Usage:
  feishu:import <url> [--out <dir>] [--headed]

Options:
  <url>            Public Feishu wiki/docx URL (https://<tenant>.feishu.cn/wiki/<token>).
  --out <dir>      Output directory (default: ./feishu-docs).
  --headed         Show the browser window (default: headless).
  -h, --help       Show this help.

Environment overrides (see src/config.mjs): FEISHU_DOC_OUT_DIR, FEISHU_DOC_HEADLESS,
  FEISHU_DOC_PAGE_TIMEOUT_MS, FEISHU_DOC_SCROLL_MAX_STEPS, FEISHU_DOC_ASSET_COUNT, ...`;

function parseArgs(argv) {
  const positional = [];
  const opts = { out: undefined, headless: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--headed") opts.headless = false;
    else if (a.startsWith("--out=")) opts.out = a.slice("--out=".length);
    else positional.push(a);
  }
  return { positional, opts };
}

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  if (opts.help || positional.length === 0) {
    process.stdout.write(HELP + "\n");
    return 0;
  }
  const url = positional[0];
  if (positional.length > 1) {
    process.stderr.write(`Unexpected extra argument: ${positional[1]}\n${HELP}\n`);
    return 1;
  }

  const env = { ...process.env };
  if (opts.out) env.FEISHU_DOC_OUT_DIR = opts.out;
  if (opts.headless === false) env.FEISHU_DOC_HEADLESS = "0";
  const config = resolveConfig(env);

  try {
    const result = await importFeishuDoc({ url, outDir: config.outDir, config });
    process.stdout.write(JSON.stringify({
      ok: true,
      dir: result.dir,
      markdown: result.markdownPath,
      manifest: result.manifestPath,
      title: result.title,
      blocks: result.blockCount,
      assets: result.assetCount,
      canonical_url: result.canonicalUrl,
    }, null, 2) + "\n");
    return 0;
  } catch (err) {
    process.stderr.write(`feishu-doc-imports failed: ${err && err.message ? err.message : String(err)}\n`);
    return 2;
  }
}

const code = await main();
process.exit(code);
