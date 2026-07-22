import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { importOfficeDocument } from "../src/routes/projects.mjs";

const packageBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

function worktree() {
  return { id: "wt_docs", path: mkdtempSync(join(tmpdir(), "myagenttool-office-import-")) };
}

test("imports an OOXML package into a nested worktree destination", () => {
  const wt = worktree();
  const result = importOfficeDocument(wt, { destination: "docs/report.docx", dataBase64: packageBytes.toString("base64") });
  assert.deepEqual(result, { path: "docs/report.docx", bytes: packageBytes.length, type: "docx" });
  assert.deepEqual(readFileSync(join(wt.path, "docs", "report.docx")), packageBytes);
});

test("rejects traversal, unsupported extensions, and non-OOXML input", () => {
  const wt = worktree();
  assert.throws(() => importOfficeDocument(wt, { destination: "../report.docx", dataBase64: packageBytes.toString("base64") }), /relative path/);
  assert.throws(() => importOfficeDocument(wt, { destination: "report.pdf", dataBase64: packageBytes.toString("base64") }), /supports only/);
  assert.throws(() => importOfficeDocument(wt, { destination: "report.docx", dataBase64: Buffer.from("not a zip").toString("base64") }), /not an OOXML/);
});

test("refuses overwrite and a symlinked destination directory", () => {
  const wt = worktree();
  const encoded = packageBytes.toString("base64");
  importOfficeDocument(wt, { destination: "report.xlsx", dataBase64: encoded });
  assert.throws(() => importOfficeDocument(wt, { destination: "report.xlsx", dataBase64: encoded }), /EEXIST|exist/i);

  const outside = mkdtempSync(join(tmpdir(), "myagenttool-office-import-outside-"));
  symlinkSync(outside, join(wt.path, "linked"));
  assert.throws(() => importOfficeDocument(wt, { destination: "linked/secret.pptx", dataBase64: encoded }), /symlink/);
  assert.equal(existsSync(join(outside, "secret.pptx")), false);
});
