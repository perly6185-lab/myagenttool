import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { renderOfficecliPreview, readOfficecliDocParagraphs, readOfficecliSheet, OfficecliPreviewError } from "../src/services/officecli-preview.mjs";

function projectWith(files = { "demo.xlsx": "x" }) {
  const root = mkdtempSync(join(tmpdir(), "officecli-preview-"));
  for (const [name, body] of Object.entries(files)) {
    const value = /\.(docx|xlsx|pptx)$/i.test(name) && typeof body === "string" && !body.startsWith("PK") ? Buffer.concat([Buffer.from("PK\x03\x04", "binary"), Buffer.from(body)]) : body;
    writeFileSync(join(root, name), value);
  }
  return root;
}

function encryptedOfficeContainer() {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(64),
    Buffer.from("EncryptionInfo\0", "utf16le"),
    Buffer.from("EncryptedPackage\0", "utf16le"),
  ]);
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

test("detects encrypted OOXML before spawning OfficeCLI", async () => {
  const root = projectWith({ "secret.docx": encryptedOfficeContainer() });
  await assert.rejects(
    renderOfficecliPreview({ projectPath: root, relativeFile: "secret.docx", run: async () => assert.fail("must not spawn") }),
    (e) => e instanceof OfficecliPreviewError && e.code === "office_password_required" && !e.message.includes("EncryptionInfo"),
  );
});

test("separates unsupported encrypted containers from malformed Office files", async () => {
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
  const unsupportedRoot = projectWith({ "legacy.xlsx": ole });
  await assert.rejects(
    renderOfficecliPreview({ projectPath: unsupportedRoot, relativeFile: "legacy.xlsx", run: async () => assert.fail("must not spawn") }),
    (e) => e instanceof OfficecliPreviewError && e.code === "office_encryption_unsupported",
  );
  const malformedRoot = projectWith({ "broken.pptx": "not-an-office-container" });
  writeFileSync(join(malformedRoot, "broken.pptx"), "not-an-office-container");
  await assert.rejects(
    renderOfficecliPreview({ projectPath: malformedRoot, relativeFile: "broken.pptx", run: async () => assert.fail("must not spawn") }),
    (e) => e instanceof OfficecliPreviewError && e.code === "office_file_corrupted",
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
    { path: "/body/p[@paraId=00100000]", type: "paragraph", text: "Introduction", style: "Heading1", complex: false, runs: [
      { text: "Introduction", bold: false, italic: false },
    ] },
    { path: "/body/p[@paraId=00100002]", type: "paragraph", text: "First paragraph.", style: null, complex: false, runs: [
      { text: "First ", bold: false, italic: false },
      { text: "paragraph.", bold: true, italic: false },
    ] },
  ]);
});

test("readOfficecliDocParagraphs flags a paragraph with inline non-run content as complex", async () => {
  const root = projectWith({ "memo.docx": "x" });
  const json = JSON.stringify({
    success: true,
    data: { results: [{ path: "/body", type: "body", children: [
      { path: "/body/p[@paraId=1]", type: "paragraph", text: "before  after", style: null, children: [
        { path: "/body/p[@paraId=1]/r[1]", type: "run", text: "before ", format: {} },
        { path: "/body/p[@paraId=1]/r[2]", type: "picture", text: "", format: {} },
        { path: "/body/p[@paraId=1]/r[3]", type: "run", text: " after", format: {} },
      ] },
    ] }] },
  });
  const out = await readOfficecliDocParagraphs({ projectPath: root, relativeFile: "memo.docx", run: async () => ({ stdout: json }) });
  assert.equal(out.paragraphs[0].complex, true, "a paragraph with an inline picture is complex");
  // only the runs are surfaced (the picture is not representable), but the flag marks it unsafe to rewrite.
  assert.deepEqual(out.paragraphs[0].runs.map((r) => r.text), ["before ", " after"]);
});

test("complex detection: hyperlink/footnote runs (flattened to type=run) are flagged; bookmark is NOT", async () => {
  const root = projectWith({ "memo.docx": "x" });
  const para = (pid, kids) => ({ path: `/body/p[@paraId=${pid}]`, type: "paragraph", text: "t", style: null, children: kids });
  const r = (pid, n, fmt = {}) => ({ path: `/body/p[@paraId=${pid}]/r[${n}]`, type: "run", text: "x", format: fmt });
  const json = JSON.stringify({ success: true, data: { results: [{ path: "/body", type: "body", children: [
    // hyperlink: inner run flattened to type:run but marked isHyperlink
    para("1", [r("1", 1), r("1", 2, { isHyperlink: true, url: "https://x" })]),
    // footnote reference run (rStyle)
    para("2", [r("2", 1), r("2", 2, { rStyle: "FootnoteReference" })]),
    // bookmark: a non-run-indexed child — safe, must stay editable
    para("3", [r("3", 1), { path: "/body/p[@paraId=3]/bookmark[1]", type: "bookmark" }]),
    // plain multi-run — editable
    para("4", [r("4", 1), r("4", 2, { bold: true })]),
  ] }] } });
  const out = await readOfficecliDocParagraphs({ projectPath: root, relativeFile: "memo.docx", run: async () => ({ stdout: json }) });
  assert.deepEqual(out.paragraphs.map((p) => p.complex), [true, true, false, false],
    "hyperlink+footnote complex; bookmark+plain editable");
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
