import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createLocalWorkflowOcrAdapter,
  resolveWorkflowOcrConfig,
  runWorkflowOcrProcess,
} from "../src/services/workflow-ocr-adapter.mjs";
import {
  extractionText,
  parseWorkflowDocument,
} from "../src/services/workflow-document-parser.mjs";
import { createInquiryIntakeTriggerService } from "../src/services/inquiry-intake-triggers.mjs";

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
    supportedExtensions: [".pdf", ".png", ".jpg", ".jpeg", ".webp"],
  });
});

test("OCR adapter invokes a fixed command and validates bounded page evidence", async () => {
  const calls = [];
  const progress = [];
  const sourcePath = resolve("/tmp/source.pdf");
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
      args[2].onProgress?.({ completedPages: 1, totalPages: 1 });
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
  const result = await adapter.recognizePdf({
    path: sourcePath,
    onProgress: (value) => progress.push(value),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/usr/bin/swift");
  assert.deepEqual(calls[0][1], ["/app/ocr.swift", sourcePath]);
  assert.equal(calls[0][2].signal, undefined);
  assert.equal(typeof calls[0][2].onProgress, "function");
  assert.deepEqual(progress, [{ completedPages: 1, totalPages: 1 }]);
  assert.equal(result.pages[0].confidence, 1);
  assert.deepEqual(result.pages[0].evidence[0].box, {
    x: 0,
    y: 0.2,
    width: 1,
    height: 0.1,
  });
});

test("OCR process times out and cancels without leaving a successful result", async () => {
  await assert.rejects(
    () => runWorkflowOcrProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { timeoutMs: 20 },
    ),
    (error) => error.code === "workflow_ocr_timeout",
  );
  const controller = new AbortController();
  const pending = runWorkflowOcrProcess(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { signal: controller.signal, timeoutMs: 2_000 },
  );
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    () => pending,
    (error) => error.code === "workflow_ocr_cancelled",
  );
});

test("OCR progress callback failures are isolated from the fixed child process", async () => {
  const output = await runWorkflowOcrProcess(
    process.execPath,
    [
      "-e",
      "process.stderr.write('MYAGENTTOOL_OCR_PROGRESS 1/1\\n'); process.stdout.write('{}')",
    ],
    {
      timeoutMs: 2_000,
      onProgress: () => {
        throw new Error("UI progress listener failed");
      },
    },
  );
  assert.equal(output, "{}");
});

test("OCR process kills provider output beyond the fixed byte ceiling", async () => {
  await assert.rejects(
    () => runWorkflowOcrProcess(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(13 * 1024 * 1024))"],
      { timeoutMs: 2_000 },
    ),
    (error) => error.code === "workflow_ocr_output_too_large",
  );
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

test("OCR adapter accepts a raster image and preserves bounded region dimensions", async () => {
  const adapter = createLocalWorkflowOcrAdapter({
    config: {
      enabled: true,
      providerId: "macos-vision",
      reason: null,
      command: "/usr/bin/swift",
      scriptPath: "/app/ocr.swift",
    },
    run: async () => JSON.stringify({
      providerId: "macos-vision",
      providerVersion: "test",
      inputKind: "image",
      pageCount: 1,
      pages: [{
        index: 1,
        width: 1600,
        height: 1200,
        text: "询价编号：IMAGE-101",
        confidence: 0.91,
        evidence: [{
          text: "询价编号：IMAGE-101",
          confidence: 0.91,
          box: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
        }],
      }],
    }),
  });
  const result = await adapter.recognize({ path: "/tmp/inquiry.png" });
  assert.equal(result.inputKind, "image");
  assert.equal(result.pages[0].width, 1600);
  assert.equal(result.pages[0].height, 1200);
});

test("real multi-format files OCR and parse locally without changing source bytes", {
  skip: process.platform !== "darwin",
  timeout: 30_000,
}, async () => {
  const pdfPath = resolve(REPO_ROOT, "demos/pdfcli/97-动态热机械分析仪DMA.pdf");
  const xlsxPath = resolve(REPO_ROOT, "demos/pdfcli/97-动态热机械分析仪DMA-信息汇总.xlsx");
  const imagePath = resolve(REPO_ROOT, "demos/excalidraw-cli/integrated-desktop.png");
  const docxPath = resolve(REPO_ROOT, "demos/officecli/officecli-demo.docx");
  const htmlPath = resolve(REPO_ROOT, "demos/officecli/officecli-demo.html");
  const before = Object.fromEntries([
    ["pdf", pdfPath],
    ["xlsx", xlsxPath],
    ["image", imagePath],
    ["docx", docxPath],
    ["html", htmlPath],
  ].map(([key, path]) => [key, fileHash(path)]));
  const adapter = createLocalWorkflowOcrAdapter();
  const progress = [];
  assert.equal(adapter.readiness().state, "ready");

  const [ocr, imageOcr, workbook, document, html] = await Promise.all([
    adapter.recognize({ path: pdfPath, onProgress: (value) => progress.push(value) }),
    adapter.recognize({ path: imagePath }),
    parseWorkflowDocument({
      path: xlsxPath,
      extension: ".xlsx",
      readMode: "supported_text",
      size: statSync(xlsxPath).size,
    }),
    parseWorkflowDocument({
      path: docxPath,
      extension: ".docx",
      readMode: "supported_text",
      size: statSync(docxPath).size,
    }),
    parseWorkflowDocument({
      path: htmlPath,
      extension: ".html",
      readMode: "supported_text",
      size: statSync(htmlPath).size,
    }),
  ]);

  assert.equal(ocr.pageCount, 6);
  assert.deepEqual(progress, [1, 2, 3, 4, 5, 6].map((completedPages) => ({
    completedPages,
    totalPages: 6,
  })));
  assert.equal(ocr.pages.every((page) => page.text.length > 50 && page.evidence.length > 0), true);
  assert.equal(ocr.pages.reduce((sum, page) => sum + page.text.length, 0) > 3_000, true);
  assert.equal(workbook.state, "ready");
  assert.match(extractionText(workbook), /97-动态热机械分析仪DMA\.pdf/);
  assert.equal(imageOcr.inputKind, "image");
  assert.equal(imageOcr.pageCount, 1);
  assert.equal(imageOcr.pages[0].width, 1440);
  assert.equal(imageOcr.pages[0].height, 900);
  assert.match(imageOcr.pages[0].text, /MyAgentTool/);
  assert.equal(document.state, "ready");
  assert.equal(extractionText(document).length > 20, true);
  assert.equal(html.state, "ready");
  assert.equal(extractionText(html).length > 20, true);

  const primaryFingerprint = before.pdf;
  const outputFingerprint = before.xlsx;
  const ocrExtraction = {
    state: "ready",
    blocks: ocr.pages.map((page) => ({
      kind: "page",
      text: page.text,
      location: { kind: "page", index: page.index },
      confidence: page.confidence,
      evidence: page.evidence,
    })),
    ocr: {
      providerId: ocr.providerId,
      providerVersion: ocr.providerVersion,
      localOnly: true,
    },
  };
  const state = {
    projects: [{ id: "prj_real", ownerTeamId: "team_real" }],
    workflowSources: [{
      id: "wfs_real",
      ownerTeamId: "team_real",
      projectId: "prj_real",
      state: "active",
      readMode: "supported_text",
    }],
    workflowArtifacts: [{
      id: "wfa_pdf",
      ownerTeamId: "team_real",
      projectId: "prj_real",
      sourceId: "wfs_real",
      name: "97-动态热机械分析仪DMA.pdf",
      extension: "pdf",
      family: "document",
      availability: "available",
      exclusion: false,
      fingerprint: primaryFingerprint,
      extraction: ocrExtraction,
    }, {
      id: "wfa_xlsx",
      ownerTeamId: "team_real",
      projectId: "prj_real",
      sourceId: "wfs_real",
      name: "97-动态热机械分析仪DMA-信息汇总.xlsx",
      extension: "xlsx",
      family: "spreadsheet",
      availability: "available",
      exclusion: false,
      fingerprint: outputFingerprint,
      extraction: workbook,
    }],
    workflowIntakeObservations: [{
      id: "wio_pdf",
      ownerTeamId: "team_real",
      projectId: "prj_real",
      sourceId: "wfs_real",
      artifactId: "wfa_pdf",
      canonicalArtifactId: "wfa_pdf",
      contentIdentity: primaryFingerprint,
      relativePath: "97-动态热机械分析仪DMA.pdf",
      state: "ready",
      revision: 2,
    }, {
      id: "wio_xlsx",
      ownerTeamId: "team_real",
      projectId: "prj_real",
      sourceId: "wfs_real",
      artifactId: "wfa_xlsx",
      canonicalArtifactId: "wfa_xlsx",
      contentIdentity: outputFingerprint,
      relativePath: "97-动态热机械分析仪DMA-信息汇总.xlsx",
      state: "ready",
      revision: 1,
    }],
    workflowIntakeReceipts: [],
    businessCases: [],
  };
  const calls = { cases: [], materializations: 0 };
  const classifications = {
    wfa_pdf: {
      id: "bdc_pdf",
      artifactId: "wfa_pdf",
      revision: 1,
      documentType: "inquiry",
      confirmationState: "proposed",
      confidence: 0.94,
      fieldProposals: [{
        key: "inquiry_number",
        value: "97",
        evidenceRefs: [{ artifactId: "wfa_pdf", kind: "page", field: "inquiry_number" }],
      }],
    },
    wfa_xlsx: {
      id: "bdc_xlsx",
      artifactId: "wfa_xlsx",
      revision: 1,
      documentType: "unknown",
      confirmationState: "proposed",
      confidence: 0.82,
      fieldProposals: [],
    },
  };
  let sequence = 0;
  const service = createInquiryIntakeTriggerService({
    state,
    now: () => "2026-07-30T12:00:00.000Z",
    nextId: (prefix) => `${prefix}_real_${++sequence}`,
    analyzeArtifact: async ({ artifactId }) => ({
      status: 200,
      body: { classification: classifications[artifactId], replayed: false },
    }),
    confirmClassification: (input) => ({
      status: 200,
      body: {
        classification: {
          ...Object.values(classifications).find((row) => row.id === input.classificationId),
          revision: 2,
          documentType: input.documentType,
          confirmationState: "confirmed",
        },
        entity: input.documentType === "inquiry_ledger" ? null : {
          id: "bent_real",
          entityType: "inquiry",
          businessKey: input.fieldCorrections.inquiry_number,
        },
      },
    }),
    createBusinessCase: (input) => {
      calls.cases.push(input);
      const businessCase = {
        id: "bcs_real",
        ownerTeamId: "team_real",
        ...input,
        artifactFingerprints: {
          wfa_pdf: primaryFingerprint,
          wfa_xlsx: outputFingerprint,
        },
      };
      state.businessCases.push(businessCase);
      return { status: 201, body: { businessCase, replayed: false } };
    },
    listRoutineDefinitions: () => ({
      status: 200,
      body: {
        routineDefinitions: [{
          id: "brd_real",
          name: "询价转报价",
          description: "读取询价并整理询价台账",
          version: 1,
          state: "published",
          triggerDocumentTypes: ["inquiry"],
          evidenceHealth: { state: "valid" },
        }],
      },
    }),
    materializeRoutineIssue: () => {
      calls.materializations += 1;
      return {
        status: 201,
        body: {
          workItem: { id: "lwi_real", localRef: "LOCAL-REAL-97" },
          execution: { run: { id: "rrn_real" } },
        },
      };
    },
  });
  const actor = { userId: "usr_real", teamId: "team_real" };
  const supporting = {
    supportingObservationIds: ["wio_xlsx"],
    supportingObservationRoles: { wio_xlsx: "historical_output" },
  };
  const inspection = await service.inspect({
    observationId: "wio_pdf",
    ...supporting,
  }, actor);
  assert.equal(inspection.status, 200);
  assert.equal(inspection.body.observation.ocrEvidence.length, 6);
  assert.equal(inspection.body.observation.supportingObservations[0].pairingEvidence
    .some((evidence) => evidence.kind === "output_references_input"), true);

  const accepted = await service.accept({
    observationId: "wio_pdf",
    expectedRevision: 2,
    idempotencyKey: "real-dma-97",
    routineDefinitionId: "brd_real",
    confirmed: true,
    fieldCorrections: { inquiry_number: "97" },
    ...supporting,
  }, actor);
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.receipt.workItemLocalRef, "LOCAL-REAL-97");
  assert.equal(calls.cases.length, 1);
  assert.equal(calls.materializations, 1);
  assert.deepEqual(calls.cases[0].artifactBindings.map((binding) => binding.roles), [
    ["trigger", "input"],
    ["output"],
  ]);
  assert.deepEqual(
    Object.fromEntries([
      ["pdf", pdfPath],
      ["xlsx", xlsxPath],
      ["image", imagePath],
      ["docx", docxPath],
      ["html", htmlPath],
    ].map(([key, path]) => [key, fileHash(path)])),
    before,
  );
});
