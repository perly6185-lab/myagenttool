import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readProjectPdf } from "../src/services/pdf-document-read.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pdf-read-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "report.pdf"), Buffer.from("%PDF-1.7\nfixture"));
  return root;
}

test("readProjectPdf returns only a signed regular PDF inside the project", () => {
  const root = fixture();
  const result = readProjectPdf({ projectPath: root, relativeFile: "docs/report.pdf" });
  assert.equal(result.size, 16);
  assert.equal(result.bytes.subarray(0, 5).toString(), "%PDF-");
});

test("readProjectPdf refuses traversal, wrong extensions, invalid signatures and missing files", () => {
  const root = fixture();
  writeFileSync(join(root, "fake.pdf"), "not a pdf");
  for (const [path, code] of [["../outside.pdf", "path_outside_project"], ["docs/report.txt", "invalid_pdf_path"], ["fake.pdf", "invalid_pdf"], ["missing.pdf", "not_found"]]) {
    assert.throws(() => readProjectPdf({ projectPath: root, relativeFile: path }), (error) => error.code === code);
  }
});

test("readProjectPdf refuses direct symbolic links even when their target is inside", () => {
  const root = fixture();
  symlinkSync(join(root, "docs", "report.pdf"), join(root, "linked.pdf"));
  assert.throws(() => readProjectPdf({ projectPath: root, relativeFile: "linked.pdf" }), (error) => error.code === "symlink_refused");
});
