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
        pages: [{ index: 1, text: "设备名称：腐蚀试验箱\n型号：WHQ-2000B", confidence: 0.94 }],
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
      onProgress: (value) => progress.push(value),
    });
    assert.equal(result.providerId, "codex-vision");
    assert.equal(result.localOnly, false);
    assert.equal(result.pages[0].evidence.length, 2);
    assert.deepEqual(progress, [{ completedPages: 1, totalPages: 1 }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.includes("--image"), true);
    assert.match(calls[0].options.prompt, /忠实抄录/);
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
