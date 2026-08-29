import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { applyPrivateTutorOcrResult, parseUploadedMaterialDocument } from "../src/services/private-tutor-material-parser.mjs";
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

test("keeps a high-confidence formula gated when its math structure is missing", () => {
  const material = {
    id: "mat_math_structure",
    learningProfileId: "learner_math_structure",
    fileName: "math.pdf",
    fileType: "pdf",
    status: "needs_ocr",
    pages: [{ pageNumber: 1, text: "", characterCount: 0, source: "pdf_text", confidence: null }],
    sections: [],
    extraction: { pageCount: 1, warnings: [], ocr: { required: true } },
  };
  const result = applyPrivateTutorOcrResult(material, {
    providerId: "codex-vision",
    providerVersion: "test-v2",
    pages: [{
      index: 1,
      text: "公式：125×8=1000。这里包含足够的教材说明文字。",
      confidence: 0.98,
      blocks: [{ order: 1, type: "formula", text: "125×8=1000", confidence: 0.98, box: { x: 0.9, y: 0.2, width: 0.8, height: 0.1 }, math: null }],
    }],
  });

  assert.equal(result.status, "needs_review");
  assert.deepEqual(result.pages[0].review.reasons, ["math_structure_missing"]);
  assert.ok(Math.abs(result.pages[0].blocks[0].box.width - 0.1) < 1e-9);
  assert.deepEqual(result.sections, []);
});

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
    assert.match(material.sections[0].title, /大数的认识/);
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

test("desktop local import defers OCR until it is explicitly scheduled", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-private-tutor-ocr-import-"));
  const state = { privateTutorMaterialDocuments: [], privateTutorOcrJobs: [] };
  let recognitionCalls = 0;
  const service = createPrivateTutorMaterialOcrService({
    state,
    stateStorePath: join(root, "state.json"),
    nextId: () => "ptocr_import",
    ocrAdapter: {
      readiness: () => ({ state: "ready", providerId: "codex-vision", requiresCloudConsent: true }),
      recognize: async () => {
        recognitionCalls += 1;
        throw new Error("OCR should not run during import.");
      },
    },
  });
  try {
    const path = fileURLToPath(new URL("../../../demos/pdfcli/97-动态热机械分析仪DMA.pdf", import.meta.url));
    const imported = await service.importLocalPath(path, "learner_import", { startOcr: false, cloudAllowed: false });

    assert.equal(imported.material.status, "needs_ocr");
    assert.equal(imported.material.managedSource.storage, "managed_local");
    assert.equal(imported.job, null);
    assert.equal(recognitionCalls, 0);
    assert.deepEqual(state.privateTutorOcrJobs, []);
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

test("keeps low-confidence textbook pages out of the knowledge map until reviewed", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-private-tutor-ocr-review-"));
  const state = { privateTutorMaterialDocuments: [], privateTutorOcrJobs: [] };
  const service = createPrivateTutorMaterialOcrService({
    state,
    stateStorePath: join(root, "state.json"),
    nextId: () => "ptocr_review",
    ocrAdapter: {
      readiness: () => ({ state: "ready", providerId: "codex-vision", providerVersion: "test-v2", requiresCloudConsent: true }),
      recognize: async (input) => {
        const pagesDirectory = join(input.artifactRoot, "pages");
        mkdirSync(pagesDirectory, { recursive: true });
        const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("review-page")]);
        writeFileSync(join(pagesDirectory, "page-001.png"), png);
        writeFileSync(join(pagesDirectory, "page-002.png"), png);
        return {
        providerId: "codex-vision",
        providerVersion: "test-v2",
        pageCount: 2,
        pages: [
          {
            index: 1,
            printedPageNumber: "12",
            text: "例题：计算 125×8，并说明乘法计算过程。这里是完整教材内容。",
            confidence: 0.72,
            blocks: [
              { order: 1, type: "worked_example", text: "例题：计算 125×8", confidence: 0.72, box: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 } },
              {
                order: 2,
                type: "formula",
                text: "125×8=1000",
                confidence: 0.68,
                box: { x: 0.2, y: 0.35, width: 0.5, height: 0.2 },
                math: {
                  notation: "125 \\times 8 = 1000",
                  confidence: 0.7,
                  ast: { rootId: "mul", nodes: [{ id: "mul", type: "operator", value: "×", childIds: ["left", "right"] }, { id: "left", type: "number", value: "125", childIds: [] }, { id: "right", type: "number", value: "8", childIds: [] }] },
                  vertical: { operator: "multiply", rows: [{ role: "operand", text: "125", indent: 0 }, { role: "operator", text: "× 8", indent: 0 }, { role: "separator", text: "——", indent: 0 }, { role: "result", text: "1000", indent: 0 }] },
                },
              },
            ],
          },
          {
            index: 2,
            printedPageNumber: "13",
            text: "练习：根据乘法结合律完成下面的问题，并写出完整答案。",
            confidence: 0.97,
            blocks: [{ order: 1, type: "exercise", text: "练习：根据乘法结合律完成问题", confidence: 0.97 }],
          },
        ],
      };
      },
    },
  });
  try {
    const bytes = Buffer.from("%PDF-review-source", "utf8");
    const material = await parseUploadedMaterialDocument({
      learningProfileId: "learner_review",
      fileName: "review-math.pdf",
      fileType: "pdf",
      fileContent: bytes.toString("base64"),
      fileEncoding: "base64",
      fileSize: bytes.length,
    }, {
      ocrAdapter: unavailableOcr,
      sourceStore: service.storeSource,
      extractPdf: async () => ({
        pages: [1, 2].map((pageNumber) => ({ pageNumber, text: "", characterCount: 0, source: "pdf_text", confidence: null })),
        pageCount: 2,
        warnings: [],
        truncated: false,
        truncatedPages: false,
      }),
    });
    state.privateTutorMaterialDocuments.push(material);
    const started = service.start(material, material.learningProfileId, { cloudAllowed: true });
    const waiting = await waitFor(() => started.job.status === "needs_review" && started.job);

    assert.equal(material.status, "needs_review");
    assert.deepEqual(material.sections, []);
    assert.equal(material.pages[0].schemaVersion, "private-tutor-textbook-page-v2");
    assert.equal(material.pages[0].coordinateSystem, "normalized");
    assert.equal(material.pages[0].blocks[1].type, "formula");
    assert.equal(material.pages[0].blocks[1].math.ast.nodes.length, 3);
    assert.equal(material.pages[0].blocks[1].math.vertical.rows.length, 4);
    assert.deepEqual(material.pages[0].blocks[1].box, { x: 0.2, y: 0.35, width: 0.5, height: 0.2 });
    assert.equal(material.pages[0].review.reasons.includes("math_structure_low_confidence"), true);
    assert.equal(material.extraction.ocr.artifactKey, "codex-vision-test-v2");
    assert.deepEqual(material.extraction.ocrReview.requiredPageNumbers, [1]);
    assert.equal(material.extraction.ocrReview.revision, 1);
    assert.equal(waiting.status, "needs_review");

    const image = service.readPageImage(material, material.learningProfileId, 1);
    assert.equal(image.contentType, "image/png");
    assert.equal(image.bytes.subarray(1, 4).toString("ascii"), "PNG");
    assert.throws(
      () => service.readPageImage(material, "other_learner", 1),
      (error) => error.code === "material_not_found" && error.status === 404,
    );
    assert.throws(
      () => service.readPageImage(material, material.learningProfileId, 3),
      (error) => error.code === "private_tutor_ocr_page_image_not_found" && error.status === 404,
    );
    const artifactKey = material.extraction.ocr.artifactKey;
    material.extraction.ocr.artifactKey = "../outside";
    assert.throws(
      () => service.readPageImage(material, material.learningProfileId, 1),
      (error) => error.code === "private_tutor_ocr_page_image_not_found" && error.status === 404,
    );
    material.extraction.ocr.artifactKey = artifactKey;

    assert.throws(
      () => service.reviewPage(material, material.learningProfileId, { pageNumber: 1, expectedRevision: 0, acknowledge: true }),
      (error) => error.code === "private_tutor_ocr_review_revision_conflict",
    );
    assert.throws(
      () => service.reviewPage(material, material.learningProfileId, { pageNumber: 1, expectedRevision: 1 }),
      (error) => error.code === "private_tutor_ocr_review_acknowledgement_required",
    );

    const reviewed = service.reviewPage(material, material.learningProfileId, {
      pageNumber: 1,
      expectedRevision: 1,
      printedPageNumber: "十二",
      text: "例题：计算 125×8=1000，并说明乘法结合律的完整计算过程。",
      acknowledge: true,
    });
    assert.equal(reviewed.status, "parsed");
    assert.equal(reviewed.pages[0].review.status, "confirmed");
    assert.equal(reviewed.pages[0].review.textEdited, true);
    assert.equal(reviewed.pages[0].schemaVersion, "private-tutor-textbook-page-v2");
    assert.equal(reviewed.pages[0].blocks.every((block) => block.math === null), true);
    assert.equal(reviewed.pages[0].printedPageNumber, "十二");
    assert.equal(reviewed.extraction.ocrReview.revision, 2);
    assert.deepEqual(reviewed.extraction.ocrReview.requiredPageNumbers, []);
    assert.ok(reviewed.sections.length > 0);
    assert.equal(started.job.status, "completed");
    assert.throws(
      () => service.reviewPage(material, "other_learner", { pageNumber: 1, expectedRevision: 2, acknowledge: true }),
      (error) => error.code === "material_not_found" && error.status === 404,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
