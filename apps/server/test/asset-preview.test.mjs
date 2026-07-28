import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AssetPreviewError, readAssetPreview } from "../src/services/asset-preview.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "asset-preview-"));
  writeFileSync(join(root, "notes.md"), "# Safe notes\n\nNo HTML execution.");
  writeFileSync(join(root, "pixel.png"), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(24)]));
  writeFileSync(join(root, "clip.mp4"), Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.alloc(32)]));
  writeFileSync(join(root, "active.svg"), "<svg><script>alert(1)</script></svg>");
  return root;
}

test("returns bounded Markdown text and validated raster image bytes", () => {
  const root = fixture();
  const markdown = readAssetPreview({ projectPath: root, relativeFile: "notes.md" });
  assert.equal(markdown.family, "markdown");
  assert.match(markdown.text, /Safe notes/);
  const image = readAssetPreview({ projectPath: root, relativeFile: "pixel.png" });
  assert.equal(image.mimeType, "image/png");
  assert.equal(image.size, 32);
});

test("video always uses a bounded byte range", () => {
  const root = fixture();
  const video = readAssetPreview({ projectPath: root, relativeFile: "clip.mp4", range: "bytes=8-15" });
  assert.deepEqual({ start: video.start, end: video.end, partial: video.partial }, { start: 8, end: 15, partial: true });
  assert.equal(video.bytes.length, 8);
});

test("refuses active SVG, bad signatures, symlinks, and traversal", () => {
  const root = fixture();
  assert.throws(() => readAssetPreview({ projectPath: root, relativeFile: "active.svg" }),
    (error) => error instanceof AssetPreviewError && error.code === "active_image_preview_refused");
  writeFileSync(join(root, "fake.png"), "not png");
  assert.throws(() => readAssetPreview({ projectPath: root, relativeFile: "fake.png" }), /signature/);
  const outside = mkdtempSync(join(tmpdir(), "asset-preview-outside-"));
  writeFileSync(join(outside, "secret.md"), "secret");
  symlinkSync(join(outside, "secret.md"), join(root, "linked.md"));
  assert.throws(() => readAssetPreview({ projectPath: root, relativeFile: "linked.md" }), /Symbolic-link/);
  assert.throws(() => readAssetPreview({ projectPath: root, relativeFile: "../secret.md" }));
});
