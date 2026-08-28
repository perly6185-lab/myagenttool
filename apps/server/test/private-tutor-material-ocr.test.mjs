import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { parseUploadedMaterialDocument } from "../src/services/private-tutor-material-parser.mjs";
import { createPrivateTutorMaterialOcrService } from "../src/services/private-tutor-material-ocr.mjs";

const unavailableOcr = {
  readiness: () => ({ state: "unavailable", reason: "test_ocr_deferred" }),
};

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for OCR job.");
}

test("persists a scanned source and completes a resumable private tutor OCR job", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-private-tutor-ocr-"));
  const state = { privateTutorMaterialDocuments: [], privateTutorOcrJobs: [] };
  let sequence = 0;
  let recognitionInput;
  const service = createPrivateTutorMaterialOcrService({
    state,
    stateStorePath: join(root, "state.json"),
    nextId: (prefix) => `${prefix}_${++sequence}`,
    persistStateSoon: () => {},
    ocrAdapter: {
      readiness: () => ({
        state: "ready",
        providerId: "codex-vision",
        providerVersion: "test-v1",
        requiresCloudConsent: true,
      }),
      recognize: async (input) => {
        recognitionInput = input;
        input.onProgress({ completedPages: 1, totalPages: 2 });
        input.onProgress({ completedPages: 2, totalPages: 2, resumed: true });
        return {
          providerId: "codex-vision",
          providerVersion: "test-v1",
          pageCount: 2,
          pages: [
            { index: 1, text: "第一单元 大数的认识。这里包含足够的教材文字。", confidence: 0.98 },
            { index: 2, text: "例题：一万有多大？练习并说明计数单位。", confidence: 0.96 },
          ],
        };
      },
    },
  });
  try {
    const bytes = Buffer.from("%PDF-test-scanned-source", "utf8");
    const material = await parseUploadedMaterialDocument({
      learningProfileId: "learner_ocr",
      fileName: "grade-four-math.pdf",
      fileType: "pdf",
      fileContent: bytes.toString("base64"),
      fileEncoding: "base64",
      fileSize: bytes.length,
    }, {
      ocrAdapter: unavailableOcr,
      sourceStore: service.storeSource,
      extractPdf: async () => ({
        pages: [
          { pageNumber: 1, text: "", characterCount: 0, source: "pdf_text", confidence: null },
          { pageNumber: 2, text: "", characterCount: 0, source: "pdf_text", confidence: null },
        ],
        pageCount: 2,
        warnings: [],
        truncated: false,
        truncatedPages: false,
      }),
    });
    state.privateTutorMaterialDocuments.push(material);

    assert.equal(material.status, "needs_ocr");
    assert.equal(material.managedSource.storage, "managed_local");
    assert.equal(existsSync(join(service.root, material.managedSource.relativePath)), true);

    const started = service.start(material, "learner_ocr", { cloudAllowed: true });
    assert.equal(started.replayed, false);
    const completed = await waitFor(() => started.job.status === "completed" && started.job);

    assert.equal(completed.completedPages, 2);
    assert.equal(completed.resumedPages, 2);
    assert.equal(material.status, "parsed");
    assert.equal(material.extraction.ocr.providerId, "codex-vision");
    assert.match(material.sections[0].content, /大数的认识/);
    assert.equal(recognitionInput.cloudAllowed, true);
    assert.match(recognitionInput.artifactRoot, /codex-vision-test-v1$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requires explicit cloud confirmation before scheduling Codex OCR", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-private-tutor-ocr-consent-"));
  const state = { privateTutorMaterialDocuments: [], privateTutorOcrJobs: [] };
  const service = createPrivateTutorMaterialOcrService({
    state,
    stateStorePath: join(root, "state.json"),
    nextId: () => "ptocr_consent",
    ocrAdapter: {
      readiness: () => ({ state: "ready", providerId: "codex-vision", requiresCloudConsent: true }),
      recognize: async () => assert.fail("recognition must not start without consent"),
    },
  });
  try {
    const bytes = Buffer.from("%PDF-consent", "utf8");
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    const material = {
      id: "mat_consent",
      learningProfileId: "learner_consent",
      fileType: "pdf",
      status: "needs_ocr",
      sourceHash,
      managedSource: service.storeSource({ bytes, sourceHash, fileName: "consent.pdf", fileType: "pdf" }),
      extraction: { pageCount: 1 },
    };
    state.privateTutorMaterialDocuments.push(material);
    const started = service.start(material, material.learningProfileId);
    const failed = await waitFor(() => started.job.status === "failed" && started.job);
    assert.equal(failed.failureCode, "workflow_ocr_cloud_confirmation_required");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cancels a running OCR job through its abort signal", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-private-tutor-ocr-cancel-"));
  const state = { privateTutorMaterialDocuments: [], privateTutorOcrJobs: [] };
  let signal;
  let markRecognitionStarted;
  const recognitionStarted = new Promise((resolve) => {
    markRecognitionStarted = resolve;
  });
  const service = createPrivateTutorMaterialOcrService({
    state,
    stateStorePath: join(root, "state.json"),
    nextId: () => "ptocr_cancel",
    ocrAdapter: {
      readiness: () => ({ state: "ready", providerId: "codex-vision", requiresCloudConsent: true }),
      recognize: async (input) => {
        signal = input.signal;
        markRecognitionStarted();
        return await new Promise((resolve, reject) => {
          input.signal.addEventListener("abort", () => {
            const error = new Error("OCR cancelled.");
            error.code = "workflow_ocr_cancelled";
            reject(error);
          }, { once: true });
        });
      },
    },
  });
  try {
    const bytes = Buffer.from("%PDF-cancel", "utf8");
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    const material = {
      id: "mat_cancel",
      learningProfileId: "learner_cancel",
      fileType: "pdf",
      status: "needs_ocr",
      sourceHash,
      managedSource: service.storeSource({ bytes, sourceHash, fileName: "cancel.pdf", fileType: "pdf" }),
      extraction: { pageCount: 1 },
    };
    state.privateTutorMaterialDocuments.push(material);

    const started = service.start(material, material.learningProfileId, { cloudAllowed: true });
    await recognitionStarted;
    const cancelled = service.cancel(started.job, material.learningProfileId);

    assert.equal(signal.aborted, true);
    assert.equal(cancelled.id, started.job.id);
    const completed = await waitFor(() => started.job.status === "cancelled" && started.job);
    assert.equal(completed.failureCode, "workflow_ocr_cancelled");
    assert.equal(material.status, "needs_ocr");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
