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
  });
});

test("OCR adapter invokes a fixed command and validates bounded page evidence", async () => {
  const calls = [];
  const progress = [];
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
    path: "/tmp/source.pdf",
    onProgress: (value) => progress.push(value),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/usr/bin/swift");
  assert.deepEqual(calls[0][1], ["/app/ocr.swift", "/tmp/source.pdf"]);
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
  const progress = [];
  assert.equal(adapter.readiness().state, "ready");

  const [ocr, workbook] = await Promise.all([
    adapter.recognizePdf({ path: pdfPath, onProgress: (value) => progress.push(value) }),
    parseWorkflowDocument({
      path: xlsxPath,
      extension: ".xlsx",
      readMode: "supported_text",
      size: statSync(xlsxPath).size,
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
    { pdf: fileHash(pdfPath), xlsx: fileHash(xlsxPath) },
    before,
  );
});
