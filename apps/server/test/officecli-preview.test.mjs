import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { renderOfficecliPreview, readOfficecliDocParagraphs, readOfficecliSheet, OfficecliPreviewError } from "../src/services/officecli-preview.mjs";

function projectWith(files = { "demo.xlsx": "x" }) {
  const root = mkdtempSync(join(tmpdir(), "officecli-preview-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return root;
}

// A spawn stub standing in for `officecli view <file> html`.
const htmlRun = (html) => async (_cmd, argv) => {
  assert.deepEqual(argv, ["view", "demo.xlsx", "html"], "renders via the stdout-default html mode");
  return { stdout: html };
};

test("renders a document to a transient text/html artifact (no 20k cap, not persisted)", async () => {
  const root = projectWith();
  const big = "<html>" + "y".repeat(50_000) + "</html>"; // well past the wrapper's 20 000 cap
  const preview = await renderOfficecliPreview({ projectPath: root, relativeFile: "demo.xlsx", run: htmlRun(big) });
  assert.equal(preview.mime, "text/html");
  assert.equal(preview.encoding, "utf8");
  assert.equal(preview.content, big, "full HTML is returned, never truncated");
  assert.equal(preview.path, "demo.xlsx");
  assert.equal(preview.bytes, Buffer.byteLength(big, "utf8"));
});

test("refuses a non-Office extension before spawning", async () => {
  const root = projectWith({ "notes.txt": "x" });
  await assert.rejects(
    renderOfficecliPreview({ projectPath: root, relativeFile: "notes.txt", run: async () => assert.fail("must not spawn") }),
    (e) => e instanceof OfficecliPreviewError && e.code === "unsupported_type",
  );
});

test("refuses path traversal out of the project root", async () => {
  const root = projectWith();
  await assert.rejects(
    renderOfficecliPreview({ projectPath: root, relativeFile: "../../etc/passwd.xlsx", run: async () => assert.fail("must not spawn") }),
    (e) => e instanceof OfficecliPreviewError && e.code === "path_escape",
  );
});

test("refuses a symlink that escapes the root", async () => {
  const root = projectWith();
  try {
    symlinkSync("/etc/hosts", join(root, "link.xlsx"));
  } catch {
    return; // symlink not permitted in this environment — skip
  }
  await assert.rejects(
    renderOfficecliPreview({ projectPath: root, relativeFile: "link.xlsx", run: async () => ({ stdout: "<html></html>" }) }),
    (e) => e instanceof OfficecliPreviewError && e.code === "path_escape",
  );
});

test("a missing file is not_found", async () => {
  const root = projectWith();
  await assert.rejects(
    renderOfficecliPreview({ projectPath: root, relativeFile: "absent.xlsx", run: async () => assert.fail("must not spawn") }),
    (e) => e instanceof OfficecliPreviewError && e.code === "not_found",
  );
});

test("a missing officecli binary maps to officecli_unavailable", async () => {
  const root = projectWith();
  const enoent = Object.assign(new Error("spawn officecli ENOENT"), { code: "ENOENT" });
  await assert.rejects(
    renderOfficecliPreview({ projectPath: root, relativeFile: "demo.xlsx", run: async () => { throw enoent; } }),
    (e) => e instanceof OfficecliPreviewError && e.code === "officecli_unavailable",
  );
});

test("an empty render is reported, not returned as a blank preview", async () => {
  const root = projectWith();
  await assert.rejects(
    renderOfficecliPreview({ projectPath: root, relativeFile: "demo.xlsx", run: async () => ({ stdout: "   " }) }),
    (e) => e instanceof OfficecliPreviewError && e.code === "empty_render",
  );
});

// --- docx paragraph outline (paragraph-level inline editor source) ---

const GET_BODY_JSON = JSON.stringify({
  success: true,
  data: { matches: 1, results: [{ path: "/body", type: "body", children: [
    { path: "/body/p[@paraId=00100000]", type: "paragraph", text: "Introduction", style: "Heading1", children: [
      { path: "/body/p[@paraId=00100000]/r[1]", type: "run", text: "Introduction", format: {} },
    ] },
    { path: "/body/p[@paraId=00100002]", type: "paragraph", text: "First paragraph.", style: null, children: [
      { path: "/body/p[@paraId=00100002]/r[1]", type: "run", text: "First ", format: {} },
      { path: "/body/p[@paraId=00100002]/r[2]", type: "run", text: "paragraph.", format: { bold: true } },
    ] },
    { path: "/body/tbl[1]", type: "table" }, // non-paragraph child is skipped
  ] }] },
});

test("readOfficecliDocParagraphs returns path-addressed paragraphs with runs (skipping non-paragraphs)", async () => {
  const root = projectWith({ "memo.docx": "x" });
  const out = await readOfficecliDocParagraphs({
    projectPath: root,
    relativeFile: "memo.docx",
    run: async (_cmd, argv) => {
      assert.deepEqual(argv, ["get", "memo.docx", "/body", "--json", "--depth", "2"]);
      return { stdout: GET_BODY_JSON };
    },
  });
  assert.equal(out.path, "memo.docx");
  assert.deepEqual(out.paragraphs, [
    { path: "/body/p[@paraId=00100000]", type: "paragraph", text: "Introduction", style: "Heading1", runs: [
      { text: "Introduction", bold: false, italic: false },
    ] },
    { path: "/body/p[@paraId=00100002]", type: "paragraph", text: "First paragraph.", style: null, runs: [
      { text: "First ", bold: false, italic: false },
      { text: "paragraph.", bold: true, italic: false },
    ] },
  ]);
});

const WORKBOOK_JSON = JSON.stringify({
  success: true,
  data: { results: [{ path: "/", type: "workbook", children: [{ path: "/Sheet1", type: "sheet" }] }] },
});
const SHEET_JSON = JSON.stringify({
  success: true,
  data: { results: [{ path: "/Sheet1", type: "sheet", children: [
    { path: "/Sheet1/row[1]", type: "row", children: [
      { path: "/Sheet1/A1", type: "cell", text: "Name", preview: "A1", format: { type: "String" } },
      { path: "/Sheet1/B1", type: "cell", text: "Qty", preview: "B1", format: { type: "String" } },
    ] },
    { path: "/Sheet1/row[2]", type: "row", children: [
      { path: "/Sheet1/A2", type: "cell", text: "Widget", preview: "A2", format: { type: "String" } },
      { path: "/Sheet1/C2", type: "cell", text: "84", preview: "C2", format: { type: "Number", formula: "B2*2" } },
    ] },
  ] }] },
});

test("readOfficecliSheet returns a cell grid + formulas, listing sheets", async () => {
  const root = projectWith({ "grid.xlsx": "x" });
  const out = await readOfficecliSheet({
    projectPath: root,
    relativeFile: "grid.xlsx",
    run: async (_cmd, argv) => {
      // First call lists sheets (`get / --json`), second reads the sheet grid.
      if (argv[2] === "/") { assert.deepEqual(argv, ["get", "grid.xlsx", "/", "--json"]); return { stdout: WORKBOOK_JSON }; }
      assert.deepEqual(argv, ["get", "grid.xlsx", "/Sheet1", "--json", "--depth", "2"]);
      return { stdout: SHEET_JSON };
    },
  });
  assert.equal(out.sheet, "Sheet1");
  assert.deepEqual(out.sheets, ["Sheet1"]);
  assert.equal(out.maxRow, 2);
  assert.equal(out.maxCol, 3); // C = column 3
  assert.deepEqual(out.cells.A1, { text: "Name", formula: null, type: "String" });
  assert.deepEqual(out.cells.C2, { text: "84", formula: "B2*2", type: "Number" });
});

test("readOfficecliSheet refuses a non-.xlsx", async () => {
  const root = projectWith({ "memo.docx": "x" });
  await assert.rejects(
    readOfficecliSheet({ projectPath: root, relativeFile: "memo.docx", run: async () => assert.fail("must not spawn") }),
    /Grid editing is available for .xlsx/,
  );
});

test("readOfficecliDocParagraphs refuses a non-.docx and a traversal path", async () => {
  const root = projectWith({ "book.xlsx": "x" });
  await assert.rejects(
    readOfficecliDocParagraphs({ projectPath: root, relativeFile: "book.xlsx", run: async () => ({ stdout: "{}" }) }),
    (e) => e instanceof OfficecliPreviewError && e.code === "unsupported_type",
  );
  await assert.rejects(
    readOfficecliDocParagraphs({ projectPath: root, relativeFile: "../../etc/passwd.docx", run: async () => assert.fail("must not spawn") }),
    (e) => e instanceof OfficecliPreviewError && e.code === "path_escape",
  );
});
