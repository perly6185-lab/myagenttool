import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { copySelectedOfficeDocument, describeLocalOfficeDocument, registerLocalOfficeDocumentPicker } from "../src/local-office-document-picker.mjs";

test("describes only a selected regular Office document", () => {
  const root = mkdtempSync(join(tmpdir(), "office-picker-"));
  const file = join(root, "Report.DOCX");
  writeFileSync(file, "PK");
  assert.deepEqual(describeLocalOfficeDocument(file), { absolutePath: realpathSync(file), name: "Report.DOCX", type: "docx", size: 2 });
  const text = join(root, "notes.txt");
  writeFileSync(text, "no");
  assert.throws(() => describeLocalOfficeDocument(text), /docx/);
});

test("the picker grant is single-use and cancellation creates no selection", async () => {
  const root = mkdtempSync(join(tmpdir(), "office-grant-"));
  const source = join(root, "source.xlsx");
  const worktree = join(root, "worktree");
  mkdirSync(worktree);
  writeFileSync(source, "PK-sheet");
  const handlers = new Map();
  const ipcMain = { removeHandler: (name) => handlers.delete(name), handle: (name, handler) => handlers.set(name, handler) };
  let canceled = false;
  const dialog = { showOpenDialog: async () => canceled ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [source] } };
  registerLocalOfficeDocumentPicker({ ipcMain, dialog, getWindow: () => null, getWorktrees: async () => [{ id: "wt", path: worktree }] });
  const selection = await handlers.get("documents:pick-local-office")();
  await handlers.get("documents:copy-selected-office")(null, { selectionId: selection.selectionId, worktreeId: "wt", destination: "data.xlsx" });
  await assert.rejects(() => handlers.get("documents:copy-selected-office")(null, { selectionId: selection.selectionId, worktreeId: "wt", destination: "again.xlsx" }), /expired/);
  canceled = true;
  assert.equal(await handlers.get("documents:pick-local-office")(), null);
});

test("copies a selected Office document only into a confined Worktree destination", () => {
  const root = mkdtempSync(join(tmpdir(), "office-copy-"));
  const source = join(root, "source.docx");
  const worktree = join(root, "worktree");
  mkdirSync(worktree);
  writeFileSync(source, "PK-office");
  assert.deepEqual(copySelectedOfficeDocument(source, worktree, "docs/report.docx"), { path: "docs/report.docx", bytes: 9, type: "docx" });
  assert.equal(readFileSync(join(worktree, "docs", "report.docx"), "utf8"), "PK-office");
  assert.throws(() => copySelectedOfficeDocument(source, worktree, "../escape.docx"), /relative/);
  assert.throws(() => copySelectedOfficeDocument(source, worktree, "docs/report.xlsx"), /keep/);
  assert.throws(() => copySelectedOfficeDocument(source, worktree, "docs/report.docx"), /already exists/);
  assert.deepEqual(copySelectedOfficeDocument(source, worktree, "docs/report.docx", { onConflict: "rename" }), { path: "docs/report (1).docx", bytes: 9, type: "docx" });
  const outside = mkdtempSync(join(tmpdir(), "office-copy-outside-"));
  symlinkSync(outside, join(worktree, "linked"));
  assert.throws(() => copySelectedOfficeDocument(source, worktree, "linked/secret.docx"), /symlink/);
  assert.equal(existsSync(join(outside, "secret.docx")), false);
});
