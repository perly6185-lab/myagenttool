import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { manageOfficeDocument } from "../src/routes/projects.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-office-manage-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "report.docx"), "office-package");
  return { root, worktree: { path: root } };
}

test("copies, moves, and renames an Office document without overwriting", () => {
  const { root, worktree } = fixture();
  manageOfficeDocument(worktree, { operation: "copy", source: "docs/report.docx", destination: "copies/report.docx" });
  assert.equal(readFileSync(join(root, "copies", "report.docx"), "utf8"), "office-package");
  manageOfficeDocument(worktree, { operation: "move", source: "copies/report.docx", destination: "archive/report.docx" });
  assert.equal(existsSync(join(root, "copies", "report.docx")), false);
  manageOfficeDocument(worktree, { operation: "rename", source: "archive/report.docx", destination: "archive/final.docx" });
  assert.equal(existsSync(join(root, "archive", "final.docx")), true);
  assert.throws(() => manageOfficeDocument(worktree, { operation: "copy", source: "docs/report.docx", destination: "archive/final.docx" }), /already exists/);
});

test("deletes only an existing regular Office document", () => {
  const { root, worktree } = fixture();
  manageOfficeDocument(worktree, { operation: "delete", source: "docs/report.docx" });
  assert.equal(existsSync(join(root, "docs", "report.docx")), false);
  assert.throws(() => manageOfficeDocument(worktree, { operation: "delete", source: "docs/report.docx" }), /does not exist/);
});

test("rejects traversal, type changes, symlinks, and unsupported operations", () => {
  const { root, worktree } = fixture();
  const outside = mkdtempSync(join(tmpdir(), "myagenttool-office-outside-"));
  symlinkSync(outside, join(root, "linked"));
  assert.throws(() => manageOfficeDocument(worktree, { operation: "move", source: "docs/report.docx", destination: "../report.docx" }), /relative/);
  assert.throws(() => manageOfficeDocument(worktree, { operation: "rename", source: "docs/report.docx", destination: "docs/report.xlsx" }), /keep the source document type/);
  assert.throws(() => manageOfficeDocument(worktree, { operation: "copy", source: "docs/report.docx", destination: "linked/report.docx" }), /symlink/);
  assert.throws(() => manageOfficeDocument(worktree, { operation: "publish", source: "docs/report.docx" }), /Unsupported/);
});
