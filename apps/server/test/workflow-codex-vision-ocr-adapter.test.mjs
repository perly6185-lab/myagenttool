import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createCodexVisionOcrAdapter,
  createFallbackWorkflowOcrAdapter,
  renderPdfForVision,
  resolveCodexVisionOcrConfig,
} from "../src/services/workflow-codex-vision-ocr-adapter.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("Codex vision OCR readiness can be disabled explicitly", () => {
  assert.deepEqual(resolveCodexVisionOcrConfig({
    env: { MYAGENTTOOL_WORKFLOW_CODEX_OCR: "off" },
    cliPath: process.execPath,
  }), {
    enabled: false,
    providerId: null,
    providerVersion: null,
    reason: "workflow_codex_ocr_disabled",
    command: null,
    cliPath: null,
    model: null,
    timeoutMs: 480_000,
  });
});

test("Codex vision OCR requires cloud consent and returns normalized page evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-codex-ocr-test-"));
  const imagePath = join(root, "scan.png");
  const artifactRoot = join(root, "artifacts");
  writeFileSync(imagePath, "fixture");
  const calls = [];
  const adapter = createCodexVisionOcrAdapter({
    config: {
      enabled: true,
      providerId: "codex-vision",
      providerVersion: "codex-cli",
      reason: null,
      command: process.execPath,
      cliPath: "/app/codex.js",
      model: null,
      timeoutMs: 30_000,
    },
    run: async (_command, args, options) => {
      calls.push({ args, options });
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      writeFileSync(outputPath, JSON.stringify({
        pages: [{
          index: 1,
          printedPageNumber: "8",
          text: "设备名称：腐蚀试验箱\n型号：WHQ-2000B",
          confidence: 0.94,
          blocks: [
            { order: 1, type: "heading", text: "设备名称：腐蚀试验箱", confidence: 0.96, box: { x: 0.1, y: 0.08, width: 0.8, height: 0.08 }, math: null },
            {
              order: 2,
              type: "formula",
              text: "125×8=1000",
              confidence: 0.92,
              box: { x: 0.2, y: 0.4, width: 0.5, height: 0.1 },
              math: {
                notation: "125 \\times 8 = 1000",
                confidence: 0.91,
                ast: {
                  rootId: "eq",
                  nodes: [
                    { id: "eq", type: "relation", value: "=", childIds: ["mul", "result", "cycle"] },
                    { id: "mul", type: "operator", value: "×", childIds: ["lhs", "rhs"] },
                    { id: "lhs", type: "number", value: "125", childIds: [] },
                    { id: "rhs", type: "number", value: "8", childIds: [] },
                    { id: "result", type: "number", value: "1000", childIds: [] },
                    { id: "cycle", type: "unknown", value: "", childIds: ["eq"] },
                    { id: "orphan", type: "number", value: "999", childIds: [] },
                  ],
                },
                vertical: null,
              },
            },
          ],
        }],
      }));
    },
  });
  try {
    await assert.rejects(
      () => adapter.recognize({ path: imagePath }),
      (error) => error.code === "workflow_ocr_cloud_confirmation_required",
    );
    const progress = [];
    const result = await adapter.recognize({
      path: imagePath,
      cloudAllowed: true,
      artifactRoot,
      onProgress: (value) => progress.push(value),
    });
    assert.equal(result.providerId, "codex-vision");
    assert.equal(result.schemaVersion, "private-tutor-textbook-page-v2");
    assert.equal(result.localOnly, false);
    assert.equal(result.pages[0].evidence.length, 2);
    assert.equal(result.pages[0].printedPageNumber, "8");
    assert.equal(result.pages[0].coordinateSystem, "normalized");
    assert.equal(result.pages[0].blocks[1].type, "formula");
    assert.deepEqual(result.pages[0].blocks[1].box, { x: 0.2, y: 0.4, width: 0.5, height: 0.1 });
    assert.equal(result.pages[0].blocks[1].math.ast.nodes.length, 6);
    assert.deepEqual(result.pages[0].blocks[1].math.ast.nodes.find((node) => node.id === "cycle").childIds, []);
    assert.equal(result.pages[0].blocks[1].math.ast.nodes.some((node) => node.id === "orphan"), false);
    assert.deepEqual(progress, [{ completedPages: 1, totalPages: 1 }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.includes("--image"), true);
    assert.match(calls[0].options.prompt, /忠实抄录/);
    assert.match(calls[0].options.prompt, /归一化坐标/);
    assert.match(calls[0].options.prompt, /竖式/);

    const resumedProgress = [];
    const resumed = await adapter.recognize({
      path: imagePath,
      cloudAllowed: true,
      artifactRoot,
      onProgress: (value) => resumedProgress.push(value),
    });
    assert.equal(resumed.pages[0].text, result.pages[0].text);
    assert.equal(resumed.pages[0].blocks[1].math.ast.rootId, "eq");
    assert.equal(calls.length, 1, "a valid persisted shard must not invoke Codex again");
    assert.deepEqual(resumedProgress, [{ completedPages: 1, totalPages: 1, resumed: true }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fallback OCR prefers local recognition and otherwise exposes Codex consent", async () => {
  const local = {
    readiness: () => ({
      state: "unavailable", providerId: null, reason: "workflow_ocr_platform_unsupported",
      supportedExtensions: [".pdf"],
    }),
  };
  const calls = [];
  const codex = {
    readiness: () => ({
      state: "ready", providerId: "codex-vision", reason: null, localOnly: false,
      requiresCloudConsent: true, supportedExtensions: [".pdf"],
    }),
    recognize: async (input) => {
      calls.push(input);
      return { providerId: "codex-vision", pages: [] };
    },
  };
  const adapter = createFallbackWorkflowOcrAdapter({ localAdapter: local, codexAdapter: codex });
  assert.deepEqual(adapter.readiness(), {
    state: "ready",
    providerId: "codex-vision",
    providerVersion: null,
    reason: null,
    localOnly: false,
    requiresCloudConsent: true,
    supportedExtensions: [".pdf"],
    local: local.readiness(),
    cloudFallback: codex.readiness(),
  });
  await adapter.recognize({ path: "/tmp/scan.pdf", cloudAllowed: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cloudAllowed, true);
});

test("PDF.js renders a document into bounded temporary page images", async () => {
  const output = mkdtempSync(join(tmpdir(), "myagenttool-pdf-pages-"));
  try {
    const pages = await renderPdfForVision(
      resolve(REPO_ROOT, "demos/pdfcli/97-动态热机械分析仪DMA.pdf"),
      output,
    );
    assert.equal(pages.length, 6);
    assert.equal(pages.every((page) => existsSync(page.path) && page.width > 0 && page.height > 0), true);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("Codex vision OCR partitions and resumes a 126-page textbook", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-codex-full-book-"));
  const pdfPath = join(root, "textbook.pdf");
  const artifactRoot = join(root, "artifacts");
  writeFileSync(pdfPath, "%PDF-fixture");
  let calls = 0;
  const adapter = createCodexVisionOcrAdapter({
    config: {
      enabled: true,
      providerId: "codex-vision",
      providerVersion: "codex-cli",
      reason: null,
      command: process.execPath,
      cliPath: "/app/codex.js",
      model: null,
      timeoutMs: 30_000,
    },
    renderPdf: async () => Array.from({ length: 126 }, (_, offset) => ({
      index: offset + 1,
      path: join(root, `page-${offset + 1}.png`),
      width: 1200,
      height: 1800,
    })),
    run: async (_command, args) => {
      calls += 1;
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      const imagePaths = args.flatMap((value, index) => args[index - 1] === "--image" ? [value] : []);
      writeFileSync(outputPath, JSON.stringify({
        pages: imagePaths.map((path) => {
          const index = Number(/page-(\d+)\.png$/.exec(path)?.[1]);
          return {
            index,
            printedPageNumber: String(index),
            text: `教材第${index}页：完整的测试识别内容。`,
            confidence: 0.95,
            blocks: [{ order: 1, type: "paragraph", text: `教材第${index}页：完整的测试识别内容。`, confidence: 0.95 }],
          };
        }),
      }));
    },
  });
  try {
    const first = await adapter.recognize({ path: pdfPath, artifactRoot, cloudAllowed: true });
    assert.equal(first.pages.length, 126);
    assert.equal(calls, 16);
    const resumed = await adapter.recognize({ path: pdfPath, artifactRoot, cloudAllowed: true });
    assert.equal(resumed.pages.length, 126);
    assert.equal(calls, 16, "all sixteen persisted shards should be reused");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
