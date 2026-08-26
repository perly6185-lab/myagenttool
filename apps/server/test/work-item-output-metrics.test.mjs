import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { deriveWorkItemOutputMetrics, deriveWorkItemOutputMetricsForAssets } from "../src/services/work-item-output-metrics.mjs";

test("derives article character and section metrics from a confined local file", () => {
  const root = mkdtempSync(join(tmpdir(), "work-item-metrics-"));
  try {
    mkdirSync(join(root, "outputs"));
    writeFileSync(join(root, "outputs", "article.md"), "# 背景\n内容\n## 分析\n更多内容\n## 结论\n完成", "utf8");
    const asset = deriveWorkItemOutputMetrics({ id: "article", path: "outputs/article.md" }, { projectRoot: root });
    assert.equal(asset.contentMetrics.source, "local_file");
    assert.equal(asset.contentMetrics.sectionCount, 3);
    assert.deepEqual(asset.contentMetrics.headings, ["背景", "分析", "结论"]);
    assert.equal(asset.contentMetrics.charCount > 0, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("derives PDF page count and preserves producer-supplied media metrics", () => {
  const root = mkdtempSync(join(tmpdir(), "work-item-metrics-"));
  try {
    writeFileSync(join(root, "comic.pdf"), "%PDF-1.7 /Type /Page /Type /Page /Type /Page /Type /Page", "latin1");
    const assets = deriveWorkItemOutputMetricsForAssets([
      { id: "comic", path: "comic.pdf" },
      { id: "video", path: "video.mp4", contentMetrics: { width: 1920, height: 1080, source: "media_probe" } },
    ], { projectRoot: root });
    assert.equal(assets[0].contentMetrics.pageCount, 4);
    assert.deepEqual(assets[1].contentMetrics, { width: 1920, height: 1080, source: "media_probe" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not read missing or path-escaping assets", () => {
  const root = mkdtempSync(join(tmpdir(), "work-item-metrics-"));
  try {
    const missing = { id: "missing", path: "outputs/missing.md" };
    const escaping = { id: "escaping", path: "../outside.md" };
    assert.deepEqual(deriveWorkItemOutputMetrics(missing, { projectRoot: root }), missing);
    assert.deepEqual(deriveWorkItemOutputMetrics(escaping, { projectRoot: root }), escaping);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("media probe failure leaves audio/video metrics absent", () => {
  const root = mkdtempSync(join(tmpdir(), "work-item-media-"));
  try {
    writeFileSync(join(root, "video.mp4"), "not-a-real-video", "utf8");
    const asset = { id: "video", path: "video.mp4" };
    assert.deepEqual(deriveWorkItemOutputMetrics(asset, {
      projectRoot: root,
      probeMedia: () => null,
    }), asset);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
