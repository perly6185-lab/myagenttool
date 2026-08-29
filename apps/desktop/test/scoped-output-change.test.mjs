import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  directWorkItemOutputChanged,
  directWorkItemOutputPath,
  snapshotDirectWorkItemOutput,
} from "../src/scoped-output-change.mjs";

const root = mkdtempSync(join(tmpdir(), "myagenttool-output-change-"));
after(() => rmSync(root, { recursive: true, force: true }));

function work(outputDirectory = "outputs/tasks/item/revision-1") {
  return { options: { metadata: { directWorkItem: { outputDirectory } } } };
}

test("resolves only a confined relative direct-work-item output directory", () => {
  assert.equal(directWorkItemOutputPath(work(), root), join(root, "outputs/tasks/item/revision-1"));
  assert.equal(directWorkItemOutputPath(work("../outside"), root), null);
  assert.equal(directWorkItemOutputPath(work(root), root), null);
  assert.equal(directWorkItemOutputPath(work("."), root), null);
});

test("detects a newly-created artifact in the isolated output directory", () => {
  const item = work("outputs/tasks/new/revision-1");
  const before = snapshotDirectWorkItemOutput(item, root);
  mkdirSync(before.path, { recursive: true });
  writeFileSync(join(before.path, "result.xlsx"), "workbook");
  const after = snapshotDirectWorkItemOutput(item, root);

  assert.equal(before.exists, false);
  assert.equal(after.exists, true);
  assert.equal(directWorkItemOutputChanged(before, after), true);
});

test("does not report a change when the isolated output tree is unchanged", () => {
  const item = work("outputs/tasks/stable/revision-1");
  const path = directWorkItemOutputPath(item, root);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "result.txt"), "stable");

  const before = snapshotDirectWorkItemOutput(item, root);
  const after = snapshotDirectWorkItemOutput(item, root);
  assert.equal(directWorkItemOutputChanged(before, after), false);
});
