import assert from "node:assert/strict";
import {
  existsSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { registerWorkflowCaseIntake } from "../src/workflow-case-intake.mjs";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function harness({ filePaths = [], sourcePatch = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "workflow-case-intake-"));
  const sourceRoot = join(root, "authorized");
  mkdirSync(sourceRoot);
  const handlers = new Map();
  const ipcMain = {
    removeHandler: (name) => handlers.delete(name),
    handle: (name, handler) => handlers.set(name, handler),
  };
  const dialog = {
    showOpenDialog: async () => ({ canceled: false, filePaths }),
  };
  const state = {
    projects: [{ id: "prj_a", path: root }],
    workflowSources: [{
      id: "wfs_a",
      projectId: "prj_a",
      relativePath: "authorized",
      state: "active",
      readMode: "supported_text",
      ...sourcePatch,
    }],
  };
  registerWorkflowCaseIntake({
    ipcMain,
    dialog,
    getWindow: () => null,
    getState: async () => state,
    now: () => "2026-07-30T12:00:00.000Z",
  });
  return { root, sourceRoot, handlers };
}

test("stages several explicitly selected formats as one case with one primary file", async () => {
  const external = mkdtempSync(join(tmpdir(), "workflow-case-files-"));
  const xlsx = join(external, "inquiry.xlsx");
  const docx = join(external, "spec.docx");
  const image = join(external, "photo.png");
  writeFileSync(xlsx, "PK-sheet");
  writeFileSync(docx, "PK-word");
  writeFileSync(image, PNG_HEADER);
  const { sourceRoot, handlers } = harness({ filePaths: [xlsx, docx, image] });

  const selection = await handlers.get("workflow-memory:pick-case-files")();
  assert.deepEqual(selection.files.map((file) => file.readiness), ["ready", "ready", "needs_ocr"]);
  const result = await handlers.get("workflow-memory:stage-case")(null, {
    requestId: "request-1",
    sourceId: "wfs_a",
    selectionId: selection.selectionId,
    primaryKey: "file:0",
    supportingRoles: { "file:1": "reference", "file:2": "reference" },
    caseName: "RFQ 1001",
    authorizationMode: "deidentified",
    confirmed: true,
  });

  assert.match(result.caseDirectory, /^incoming\/2026-07-30-RFQ-1001-/);
  assert.equal(result.primaryRelativePath.endsWith("/inquiry.xlsx"), true);
  assert.equal(result.supportingRelativePaths.length, 2);
  assert.equal(existsSync(join(sourceRoot, result.primaryRelativePath)), true);
  const manifest = JSON.parse(readFileSync(join(sourceRoot, result.caseDirectory, ".case.json"), "utf8"));
  assert.deepEqual(manifest, {
    schemaVersion: 2,
    authorizationMode: "deidentified",
    recordedAt: "2026-07-30T12:00:00.000Z",
    primaryFile: "inquiry.xlsx",
    supportingFiles: [
      { name: "spec.docx", role: "reference" },
      { name: "photo.png", role: "reference" },
    ],
  });
  assert.deepEqual(Object.values(result.supportingFileRoles), ["reference", "reference"]);
  await assert.rejects(() => handlers.get("workflow-memory:stage-case")(null, {
    requestId: "request-2",
    sourceId: "wfs_a",
    selectionId: selection.selectionId,
    primaryKey: "file:0",
    authorizationMode: "deidentified",
    confirmed: true,
  }), /expired/);
});

test("pasted text is local, bounded, idempotent, and requires authorization", async () => {
  const { sourceRoot, handlers } = harness();
  const input = {
    requestId: "paste-1",
    sourceId: "wfs_a",
    pastedText: "  询价编号：RFQ-2002\n产品：传感器\n",
    primaryKey: "text",
    caseName: "RFQ-2002",
    authorizationMode: "authorized",
    confirmed: true,
  };
  const first = await handlers.get("workflow-memory:stage-case")(null, input);
  const replay = await handlers.get("workflow-memory:stage-case")(null, input);
  assert.deepEqual(replay, first);
  assert.equal(
    readFileSync(join(sourceRoot, first.primaryRelativePath), "utf8"),
    input.pastedText,
  );
  await assert.rejects(() => handlers.get("workflow-memory:stage-case")(null, {
    ...input,
    pastedText: "different text",
  }), /reused with different data/);
  await assert.rejects(() => handlers.get("workflow-memory:stage-case")(null, {
    ...input,
    requestId: "paste-2",
    confirmed: false,
  }), /Confirm authorization/);
  await assert.rejects(() => handlers.get("workflow-memory:stage-case")(null, {
    ...input,
    requestId: "paste-3",
    pastedText: "询".repeat(40_000),
  }), /at most 96 KiB/);
});

test("a signature-validated image can be staged as the primary inquiry for OCR", async () => {
  const external = mkdtempSync(join(tmpdir(), "workflow-case-image-"));
  const image = join(external, "scan.jpg");
  writeFileSync(image, JPEG_HEADER);
  const { sourceRoot, handlers } = harness({ filePaths: [image] });
  const selection = await handlers.get("workflow-memory:pick-case-files")();
  const result = await handlers.get("workflow-memory:stage-case")(null, {
    requestId: "image-1",
    sourceId: "wfs_a",
    selectionId: selection.selectionId,
    primaryKey: "file:0",
    authorizationMode: "authorized",
    confirmed: true,
  });
  assert.equal(result.primaryRelativePath.endsWith("/scan.jpg"), true);
  assert.equal(existsSync(join(sourceRoot, result.primaryRelativePath)), true);
});

test("an image extension with a mismatched signature is rejected before authorization", async () => {
  const external = mkdtempSync(join(tmpdir(), "workflow-case-bad-image-"));
  const image = join(external, "scan.png");
  writeFileSync(image, "not a png");
  const { handlers } = harness({ filePaths: [image] });
  await assert.rejects(
    () => handlers.get("workflow-memory:pick-case-files")(),
    /does not match its file type/,
  );
});

test("only an XLSX supporting file can be declared as a historical inquiry ledger", async () => {
  const external = mkdtempSync(join(tmpdir(), "workflow-case-role-"));
  const inquiry = join(external, "inquiry.txt");
  const image = join(external, "output.png");
  writeFileSync(inquiry, "RFQ");
  writeFileSync(image, PNG_HEADER);
  const { handlers } = harness({ filePaths: [inquiry, image] });
  const selection = await handlers.get("workflow-memory:pick-case-files")();
  await assert.rejects(() => handlers.get("workflow-memory:stage-case")(null, {
    requestId: "invalid-historical-output",
    sourceId: "wfs_a",
    selectionId: selection.selectionId,
    primaryKey: "file:0",
    supportingRoles: { "file:1": "historical_output" },
    authorizationMode: "authorized",
    confirmed: true,
  }), /must be an XLSX/);
});

test("a file changed after selection is rejected without a partial case", async () => {
  const external = mkdtempSync(join(tmpdir(), "workflow-case-changed-"));
  const inquiry = join(external, "inquiry.txt");
  writeFileSync(inquiry, "first");
  const { sourceRoot, handlers } = harness({ filePaths: [inquiry] });
  const selection = await handlers.get("workflow-memory:pick-case-files")();
  writeFileSync(inquiry, "changed after selection");
  await assert.rejects(() => handlers.get("workflow-memory:stage-case")(null, {
    requestId: "changed-1",
    sourceId: "wfs_a",
    selectionId: selection.selectionId,
    primaryKey: "file:0",
    authorizationMode: "authorized",
    confirmed: true,
  }), /changed after authorization/);
  assert.deepEqual(readdirSync(join(sourceRoot, "incoming")), []);
});

test("a symlinked intake destination cannot escape the authorized source", async () => {
  const { sourceRoot, handlers } = harness();
  const outside = mkdtempSync(join(tmpdir(), "workflow-case-outside-"));
  symlinkSync(outside, join(sourceRoot, "incoming"));
  await assert.rejects(() => handlers.get("workflow-memory:stage-case")(null, {
    requestId: "escape-1",
    sourceId: "wfs_a",
    pastedText: "RFQ",
    primaryKey: "text",
    authorizationMode: "authorized",
    confirmed: true,
  }), /not safe/);
  assert.equal(existsSync(join(outside, "pasted-inquiry.txt")), false);
});
