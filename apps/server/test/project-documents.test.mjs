import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readProjectDocuments } from "../src/services/projects.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-documents-"));
  mkdirSync(join(root, "docs", "nested"), { recursive: true });
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(root, "docs", "proposal.docx"), "docx");
  writeFileSync(join(root, "docs", "budget.xlsx"), "xlsx");
  writeFileSync(join(root, "docs", "nested", "roadmap.pptx"), "pptx");
  writeFileSync(join(root, "docs", "notes.md"), "markdown");
  writeFileSync(join(root, "node_modules", "pkg", "hidden.docx"), "ignored");
  return root;
}

test("readProjectDocuments recursively returns only supported Office files", () => {
  const root = fixture();
  const result = readProjectDocuments({ id: "prj_1", path: root });
  assert.deepEqual(result.documents.map((item) => item.path), [
    "docs/budget.xlsx",
    "docs/nested/roadmap.pptx",
    "docs/proposal.docx",
  ]);
  assert.equal(result.truncated, false);
});

test("readProjectDocuments filters by type and path/name search", () => {
  const root = fixture();
  assert.deepEqual(
    readProjectDocuments({ id: "prj_1", path: root }, { type: "pptx" }).documents.map((item) => item.name),
    ["roadmap.pptx"],
  );
  assert.deepEqual(
    readProjectDocuments({ id: "prj_1", path: root }, { search: "nested" }).documents.map((item) => item.name),
    ["roadmap.pptx"],
  );
  assert.throws(() => readProjectDocuments({ id: "prj_1", path: root }, { type: "pdf" }), /Document type/);
});

test("readProjectDocuments ignores symlinks and respects the result limit", () => {
  const root = fixture();
  const outside = mkdtempSync(join(tmpdir(), "myagenttool-documents-outside-"));
  writeFileSync(join(outside, "secret.docx"), "secret");
  symlinkSync(outside, join(root, "linked"));
  const result = readProjectDocuments({ id: "prj_1", path: root }, { limit: 1 });
  assert.equal(result.documents.length, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.documents.some((item) => item.name === "secret.docx"), false);
});
