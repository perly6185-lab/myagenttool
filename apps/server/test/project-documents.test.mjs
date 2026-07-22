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
  writeFileSync(join(root, "docs", "manual.pdf"), "%PDF-1.7\n");
  writeFileSync(join(root, "docs", "plan.dxf"), "0\nSECTION\n");
  writeFileSync(join(root, "docs", "model.dwg"), "AC1032");
  writeFileSync(join(root, "docs", "notes.md"), "markdown");
  writeFileSync(join(root, "node_modules", "pkg", "hidden.docx"), "ignored");
  return root;
}

test("readProjectDocuments recursively returns supported Office, PDF, and CAD files", () => {
  const root = fixture();
  const result = readProjectDocuments({ id: "prj_1", path: root });
  assert.deepEqual(result.documents.map((item) => item.path), [
    "docs/budget.xlsx",
    "docs/manual.pdf",
    "docs/model.dwg",
    "docs/nested/roadmap.pptx",
    "docs/plan.dxf",
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
  assert.deepEqual(
    readProjectDocuments({ id: "prj_1", path: root }, { type: "pdf" }).documents.map((item) => item.name),
    ["manual.pdf"],
  );
  assert.deepEqual(readProjectDocuments({ id: "prj_1", path: root }, { type: "dxf" }).documents.map((item) => item.name), ["plan.dxf"]);
  assert.throws(() => readProjectDocuments({ id: "prj_1", path: root }, { type: "txt" }), /Document type/);
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
