import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createLocalWorkflowOcrAdapter,
  resolveWorkflowOcrConfig,
} from "../src/services/workflow-ocr-adapter.mjs";
import {
  extractionText,
  parseWorkflowDocument,
} from "../src/services/workflow-document-parser.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("OCR readiness is explicit and unavailable off macOS", () => {
  const config = resolveWorkflowOcrConfig({ platform: "linux", env: {} });
  assert.deepEqual(config, {
    enabled: false,
    providerId: null,
    reason: "workflow_ocr_platform_unsupported",
    command: null,
    scriptPath: config.scriptPath,
  });
  assert.deepEqual(createLocalWorkflowOcrAdapter({ config }).readiness(), {
    state: "unavailable",
    providerId: null,
    reason: "workflow_ocr_platform_unsupported",
  });
});

test("OCR adapter invokes a fixed command and validates bounded page evidence", async () => {
  const calls = [];
  const adapter = createLocalWorkflowOcrAdapter({
    config: {
      enabled: true,
      providerId: "macos-vision",
      reason: null,
      command: "/usr/bin/swift",
      scriptPath: "/app/ocr.swift",
    },
    run: async (...args) => {
      calls.push(args);
      return JSON.stringify({
        providerId: "macos-vision",
        providerVersion: "test",
        pageCount: 1,
        pages: [{
          index: 1,
          text: "设备型号：DMA850",
          confidence: 1.2,
          evidence: [{
            text: "设备型号：DMA850",
            confidence: 0.9,
            box: { x: -1, y: 0.2, width: 2, height: 0.1 },
          }],
        }],
      });
    },
  });
  const result = await adapter.recognizePdf({ path: "/tmp/source.pdf" });
  assert.deepEqual(calls, [[
    "/usr/bin/swift",
    ["/app/ocr.swift", "/tmp/source.pdf"],
    { signal: undefined },
  ]]);
  assert.equal(result.pages[0].confidence, 1);
  assert.deepEqual(result.pages[0].evidence[0].box, {
    x: 0,
    y: 0.2,
    width: 1,
    height: 0.1,
  });
});

test("OCR adapter rejects malformed provider results", async () => {
  const adapter = createLocalWorkflowOcrAdapter({
    config: {
      enabled: true,
      providerId: "macos-vision",
      reason: null,
      command: "/usr/bin/swift",
      scriptPath: "/app/ocr.swift",
    },
    run: async () => JSON.stringify({ providerId: "other", pages: [] }),
  });
  await assert.rejects(
    () => adapter.recognizePdf({ path: "/tmp/source.pdf" }),
    (error) => error.code === "workflow_ocr_invalid_result",
  );
});

test("real DMA PDF/XLSX case OCRs with page evidence and leaves both source files unchanged", {
  skip: process.platform !== "darwin",
  timeout: 30_000,
}, async () => {
  const pdfPath = resolve(REPO_ROOT, "demos/pdfcli/97-动态热机械分析仪DMA.pdf");
  const xlsxPath = resolve(REPO_ROOT, "demos/pdfcli/97-动态热机械分析仪DMA-信息汇总.xlsx");
  const before = { pdf: fileHash(pdfPath), xlsx: fileHash(xlsxPath) };
  const adapter = createLocalWorkflowOcrAdapter();
  assert.equal(adapter.readiness().state, "ready");

  const [ocr, workbook] = await Promise.all([
    adapter.recognizePdf({ path: pdfPath }),
    parseWorkflowDocument({
      path: xlsxPath,
      extension: ".xlsx",
      readMode: "supported_text",
      size: statSync(xlsxPath).size,
    }),
  ]);

  assert.equal(ocr.pageCount, 6);
  assert.equal(ocr.pages.every((page) => page.text.length > 50 && page.evidence.length > 0), true);
  assert.equal(ocr.pages.reduce((sum, page) => sum + page.text.length, 0) > 3_000, true);
  assert.equal(workbook.state, "ready");
  assert.match(extractionText(workbook), /97-动态热机械分析仪DMA\.pdf/);
  assert.deepEqual(
    { pdf: fileHash(pdfPath), xlsx: fileHash(xlsxPath) },
    before,
  );
});
