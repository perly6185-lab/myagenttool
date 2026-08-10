import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { revealAssetInFileManager } from "../src/services/asset-reveal.mjs";

test("reveals a confined file with the native file manager", async () => {
  const root = mkdtempSync(join(tmpdir(), "asset-reveal-service-"));
  const target = join(root, "report.xlsx");
  writeFileSync(target, "PK-sheet");
  const launches = [];
  const result = await revealAssetInFileManager({
    projectRoot: root,
    relativePath: "report.xlsx",
    platform: "win32",
    launch: async (...input) => launches.push(input),
  });

  assert.deepEqual(result, { revealed: true, path: "report.xlsx" });
  assert.deepEqual(launches[0][0], "explorer.exe");
  assert.deepEqual(launches[0][1], [`/select,${realpathSync(target)}`]);
  assert.equal(launches[0][2].detached, true);
});

test("refuses paths outside the selected project", async () => {
  const root = mkdtempSync(join(tmpdir(), "asset-reveal-root-"));
  const outside = mkdtempSync(join(tmpdir(), "asset-reveal-outside-"));
  writeFileSync(join(outside, "secret.xlsx"), "PK-sheet");
  await assert.rejects(() => revealAssetInFileManager({
    projectRoot: root,
    relativePath: join(outside, "secret.xlsx"),
    platform: "win32",
    launch: async () => assert.fail("unsafe path must not launch the file manager"),
  }));
});
