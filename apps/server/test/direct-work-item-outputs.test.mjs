import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  directWorkItemOutputDirectory,
  discoverDirectWorkItemOutputs,
} from "../src/services/direct-work-item-outputs.mjs";

test("direct task outputs are discovered only in the task revision directory", () => {
  const root = mkdtempSync(join(tmpdir(), "direct-work-item-output-"));
  const item = { id: "lwi:unsafe/id", revision: 3, projectId: "prj_a", terminalId: "dev_local" };
  const outputDirectory = directWorkItemOutputDirectory(item);
  const outputRoot = join(root, ...outputDirectory.split("/"));
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(join(outputRoot, "article.md"), "# 标题\n\n正文内容");
  writeFileSync(join(root, "unrelated.txt"), "不要登记");
  symlinkSync(join(root, "unrelated.txt"), join(outputRoot, "outside.txt"));

  const assets = discoverDirectWorkItemOutputs({
    state: { projects: [{ id: "prj_a", path: root }] },
    item,
    outputDirectory,
  });

  assert.equal(outputDirectory, "outputs/tasks/lwi-unsafe-id/revision-3");
  assert.deepEqual(assets.map((asset) => asset.path), [`${outputDirectory}/article.md`]);
  assert.equal(assets[0].family, "markdown");
  assert.match(assets[0].hash, /^sha256:/);
  assert.equal(assets[0].terminalId, "dev_local");
});

test("a missing output directory produces no fabricated assets", () => {
  const root = mkdtempSync(join(tmpdir(), "direct-work-item-empty-"));
  const assets = discoverDirectWorkItemOutputs({
    state: { projects: [{ id: "prj_a", path: root }] },
    item: { id: "lwi_empty", revision: 1, projectId: "prj_a", terminalId: "dev_local" },
  });
  assert.deepEqual(assets, []);
});
