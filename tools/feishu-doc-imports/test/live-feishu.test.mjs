// Env-gated live test against a real public Feishu document.
//
// Only runs when FEISHU_DOC_IMPORT_LIVE=1 (skipped otherwise, so `node --test`
// in CI stays green without a browser). Override the target URL with
// FEISHU_DOC_IMPORT_URL (defaults to the canonical probe document).
//
// Run manually:
//   FEISHU_DOC_IMPORT_LIVE=1 node --test test/live-feishu.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { importFeishuDoc } from "../src/import-doc.mjs";
import { resolveConfig } from "../src/config.mjs";

const LIVE = process.env.FEISHU_DOC_IMPORT_LIVE === "1";
const URL = process.env.FEISHU_DOC_IMPORT_URL || "https://mynhkbykqf.feishu.cn/wiki/CHDzwTXYriLNIpk2HsRcx2VWnQe";

test(
  "live: fetch probe document — complete markdown + assets",
  { skip: LIVE ? false : "set FEISHU_DOC_IMPORT_LIVE=1 to run" },
  async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-live-"));
    try {
      const result = await importFeishuDoc({ url: URL, outDir, config: resolveConfig() });
      const md = await fs.readFile(result.markdownPath, "utf8");
      const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"));

      // Structural invariants.
      assert.ok(result.dir.startsWith(outDir), "bundle must live under outDir");
      assert.ok(result.markdownPath.endsWith("doc.md"));
      assert.ok(result.manifestPath.endsWith("manifest.json"));
      assert.equal(manifest.schemaVersion, 2);
      assert.equal(manifest.source_provider, "feishu");

      // Non-truncation: the document has hundreds of blocks; the back-half
      // must be present (tail markers that only exist in the final sections).
      assert.ok(result.blockCount > 100, `expected >100 blocks, got ${result.blockCount}`);
      assert.ok(md.length > 5000, `markdown suspiciously short: ${md.length} chars`);
      const hasTail = /最后说句实在话|Rock/.test(md);
      assert.ok(hasTail, "tail section missing — document appears truncated");

      // Images: EVERY image slot must resolve — no missing images, no
      // placeholders. This is the completeness invariant: the document has 15
      // image blocks (including grid/multi-column images that never lazy-load),
      // and the per-token drive-stream fetch must capture all of them so each is
      // restored at its exact position. asset_count must equal image_slots and
      // nothing may be left as an uncaptured placeholder.
      assert.equal(
        manifest.images_not_captured.length,
        0,
        `images not captured: ${JSON.stringify(manifest.images_not_captured)}`,
      );
      assert.equal(
        manifest.asset_count,
        manifest.image_slots,
        `asset_count (${manifest.asset_count}) != image_slots (${manifest.image_slots})`,
      );
      assert.ok(result.assetCount >= 1, `expected >=1 asset, got ${result.assetCount}`);
      assert.ok(!/<!-- image not captured -->/.test(md), "doc.md contains an uncaptured-image placeholder");
    } finally {
      await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
    }
  },
);
