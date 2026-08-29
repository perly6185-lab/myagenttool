import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { makeRunTx } from "../runtime/store/run-tx.mjs";
import {
  applyPrivateTutorOcrResult,
  parsePrivateTutorMaterialPath,
  reviewPrivateTutorOcrPage,
} from "./private-tutor-material-parser.mjs";

const JOB_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const MAX_OCR_PAGE_IMAGE_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function codedError(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function confined(root, path) {
  const rel = relative(root, path);
  return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function safeSegment(value) {
  return String(value ?? "unknown").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "unknown";
}

function atomicWrite(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) return;
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, bytes, { mode: 0o600, flag: "wx" });
  try {
    renameSync(temporaryPath, path);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    if (!existsSync(path)) throw error;
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function privateTutorMaterialRoot(stateStorePath) {
  const snapshotPath = resolve(stateStorePath);
  return join(dirname(snapshotPath), "private-tutor-materials");
}

export function createPrivateTutorMaterialOcrService({
  state,
  stateStorePath,
  ocrAdapter,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now()}`,
  persistStateSoon = () => {},
  store,
} = {}) {
  const configuredRoot = privateTutorMaterialRoot(stateStorePath);
  mkdirSync(configuredRoot, { recursive: true });
  const root = realpathSync(configuredRoot);
  const active = new Map();
  const runTx = makeRunTx({ store, persistStateSoon });

  function storeSource({ bytes, sourceHash, fileName, fileType }) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || !/^[a-f0-9]{64}$/.test(String(sourceHash))) {
      throw codedError("The managed material source is invalid.", "private_tutor_material_source_invalid");
    }
    const extension = fileType === "pdf" ? ".pdf" : "";
    const relativePath = `${sourceHash}/source${extension}`;
    const target = resolve(root, relativePath);
    if (!confined(root, target)) throw codedError("The managed material source path is invalid.", "private_tutor_material_source_invalid");
    atomicWrite(target, bytes);
    return {
      storage: "managed_local",
      relativePath: relativePath.replaceAll("\\", "/"),
      originalName: String(fileName ?? "material.pdf").slice(0, 240),
      sourceHash,
      byteSize: bytes.length,
    };
  }

  async function sourcePath(material) {
    const source = material?.managedSource;
    if (source?.storage !== "managed_local" || !source.relativePath || source.sourceHash !== material.sourceHash) {
      throw codedError("The original PDF is not available for retry.", "private_tutor_material_source_unavailable", 409);
    }
    const candidate = resolve(root, source.relativePath);
    if (!confined(root, candidate) || !existsSync(candidate)) {
      throw codedError("The original PDF is not available for retry.", "private_tutor_material_source_unavailable", 409);
    }
    const actual = realpathSync(candidate);
    if (!confined(root, actual) || !statSync(actual).isFile()) {
      throw codedError("The original PDF is not available for retry.", "private_tutor_material_source_unavailable", 409);
    }
    if (await sha256File(actual) !== material.sourceHash) {
      throw codedError("The original PDF changed after import.", "private_tutor_material_source_changed", 409);
    }
    return actual;
  }

  function jobFor(materialId) {
    return state.privateTutorOcrJobs.find((job) => job.materialId === materialId && !JOB_TERMINAL_STATUSES.has(job.status));
  }

  function schedule(job) {
    if (active.has(job.id)) return;
    const controller = new AbortController();
    active.set(job.id, controller);
    setImmediate(() => void run(job, controller));
  }

  async function run(job, controller) {
    try {
      if (job.status !== "queued") return;
      const material = state.privateTutorMaterialDocuments.find((item) => item.id === job.materialId);
      if (!material || material.learningProfileId !== job.learningProfileId) {
        throw codedError("The OCR source material no longer exists.", "private_tutor_material_not_found", 404);
      }
      const path = await sourcePath(material);
      const readiness = ocrAdapter?.readiness?.() ?? { state: "unavailable", reason: "workflow_ocr_provider_unavailable" };
      if (readiness.state !== "ready" || typeof ocrAdapter?.recognize !== "function") {
        throw codedError("No OCR provider is available.", readiness.reason ?? "workflow_ocr_provider_unavailable", 409);
      }
      if (readiness.requiresCloudConsent && job.cloudAllowed !== true) {
        throw codedError("Cloud OCR confirmation is required.", "workflow_ocr_cloud_confirmation_required", 409);
      }
      runTx(() => {
        job.status = "running";
        job.startedAt ??= now();
        job.updatedAt = now();
        job.attempts += 1;
        job.providerId = readiness.providerId ?? null;
      });
      const artifactRoot = join(
        root,
        material.sourceHash,
        "ocr",
        `${safeSegment(readiness.providerId)}-${safeSegment(readiness.providerVersion ?? "v1")}`,
      );
      runTx(() => {
        job.artifactKey = `${safeSegment(readiness.providerId)}-${safeSegment(readiness.providerVersion ?? "v1")}`;
      });
      const recognized = await ocrAdapter.recognize({
        path,
        cloudAllowed: job.cloudAllowed === true,
        artifactRoot,
        signal: controller.signal,
        onProgress: ({ completedPages, totalPages, resumed = false }) => {
          runTx(() => {
            job.completedPages = Number(completedPages) || 0;
            job.totalPages = Number(totalPages) || job.totalPages;
            job.resumedPages = resumed ? Math.max(job.resumedPages ?? 0, job.completedPages) : job.resumedPages ?? 0;
            job.updatedAt = now();
          });
        },
      });
      const updated = applyPrivateTutorOcrResult(material, recognized, now());
      runTx(() => {
        Object.assign(material, updated);
        material.extraction.ocr.artifactKey = job.artifactKey;
        job.status = updated.status === "parsed" ? "completed" : "needs_review";
        job.completedPages = recognized.pages.length;
        job.totalPages = recognized.pageCount ?? recognized.pages.length;
        job.failureCode = null;
        job.failureMessage = null;
        job.completedAt = now();
        job.updatedAt = job.completedAt;
      });
    } catch (error) {
      runTx(() => {
        job.status = error?.code === "workflow_ocr_cancelled" ? "cancelled" : "failed";
        job.failureCode = String(error?.code ?? "private_tutor_ocr_failed").slice(0, 120);
        job.failureMessage = String(error?.message ?? "OCR failed.").slice(0, 500);
        job.updatedAt = now();
        job.completedAt = job.updatedAt;
        const material = state.privateTutorMaterialDocuments.find((item) => item.id === job.materialId);
        if (material?.extraction?.ocr) {
          material.extraction.ocr = {
            ...material.extraction.ocr,
            attempted: true,
            state: "failed",
            providerId: job.providerId,
            reason: job.failureCode,
          };
          material.updatedAt = job.updatedAt;
        }
      });
    } finally {
      active.delete(job.id);
    }
  }

  function start(material, learningProfileId, { cloudAllowed = false } = {}) {
    if (!material || material.learningProfileId !== learningProfileId) {
      throw codedError("Material not found.", "material_not_found", 404);
    }
    if (material.fileType !== "pdf" || material.status !== "needs_ocr") {
      throw codedError("This material does not require OCR.", "private_tutor_material_ocr_not_required", 409);
    }
    const existing = jobFor(material.id);
    if (existing) return { job: existing, replayed: true };
    const at = now();
    const job = {
      id: nextId("ptocr"),
      materialId: material.id,
      learningProfileId,
      sourceHash: material.sourceHash,
      status: "queued",
      cloudAllowed: cloudAllowed === true,
      providerId: null,
      totalPages: material.extraction?.pageCount ?? null,
      completedPages: 0,
      resumedPages: 0,
      attempts: 0,
      failureCode: null,
      failureMessage: null,
      createdAt: at,
      startedAt: null,
      updatedAt: at,
      completedAt: null,
      artifactKey: null,
    };
    runTx(() => state.privateTutorOcrJobs.unshift(job));
    schedule(job);
    return { job, replayed: false };
  }

  async function importLocalPath(path, learningProfileId, { cloudAllowed = false, startOcr = false } = {}) {
    const actual = realpathSync(String(path ?? ""));
    const extension = extname(actual).toLowerCase();
    if (extension !== ".pdf") throw codedError("Select a PDF textbook.", "unsupported_file_type");
    const material = await parsePrivateTutorMaterialPath({
      path: actual,
      learningProfileId,
      fileName: basename(actual),
      fileType: "pdf",
      fileSize: statSync(actual).size,
      now: now(),
    }, {
      sourceStore: storeSource,
    });
    const existingIndex = state.privateTutorMaterialDocuments.findIndex((item) =>
      item.learningProfileId === learningProfileId && item.sourceHash === material.sourceHash);
    runTx(() => {
      if (existingIndex >= 0) state.privateTutorMaterialDocuments[existingIndex] = material;
      else state.privateTutorMaterialDocuments.push(material);
    });
    const jobResult = startOcr && material.status === "needs_ocr"
      ? start(material, learningProfileId, { cloudAllowed })
      : null;
    return {
      material,
      job: jobResult?.job ?? null,
      replayed: existingIndex >= 0,
    };
  }

  function retry(job, learningProfileId, { cloudAllowed = job?.cloudAllowed } = {}) {
    if (!job || job.learningProfileId !== learningProfileId) throw codedError("OCR job not found.", "private_tutor_ocr_job_not_found", 404);
    if (!["failed", "cancelled", "needs_review"].includes(job.status)) {
      throw codedError("Only a stopped OCR job can be retried.", "private_tutor_ocr_job_not_retryable", 409);
    }
    runTx(() => {
      job.status = "queued";
      job.cloudAllowed = cloudAllowed === true;
      job.failureCode = null;
      job.failureMessage = null;
      job.completedAt = null;
      job.updatedAt = now();
    });
    schedule(job);
    return job;
  }

  function cancel(job, learningProfileId) {
    if (!job || job.learningProfileId !== learningProfileId) throw codedError("OCR job not found.", "private_tutor_ocr_job_not_found", 404);
    if (!["queued", "running"].includes(job.status)) throw codedError("OCR job is not active.", "private_tutor_ocr_job_not_active", 409);
    if (job.status === "queued") {
      active.get(job.id)?.abort();
      runTx(() => {
        job.status = "cancelled";
        job.completedAt = now();
        job.updatedAt = job.completedAt;
      });
    } else {
      active.get(job.id)?.abort();
    }
    return job;
  }

  function reviewPage(material, learningProfileId, input) {
    if (!material || material.learningProfileId !== learningProfileId) {
      throw codedError("Material not found.", "material_not_found", 404);
    }
    let updated;
    runTx(() => {
      updated = reviewPrivateTutorOcrPage(material, input, now());
      Object.assign(material, updated);
      const job = state.privateTutorOcrJobs.find((item) =>
        item.materialId === material.id && item.learningProfileId === learningProfileId && item.status === "needs_review");
      if (job && updated.status === "parsed") {
        job.status = "completed";
        job.completedAt = updated.updatedAt;
        job.updatedAt = updated.updatedAt;
      }
    });
    return updated;
  }

  function readPageImage(material, learningProfileId, pageNumber) {
    if (!material || material.learningProfileId !== learningProfileId) {
      throw codedError("Material not found.", "material_not_found", 404);
    }
    const normalizedPageNumber = Number(pageNumber);
    const page = material.pages?.find((item) => item.pageNumber === normalizedPageNumber);
    if (!Number.isInteger(normalizedPageNumber) || normalizedPageNumber < 1 || !page || page.source !== "local_ocr") {
      throw codedError("OCR page image not found.", "private_tutor_ocr_page_image_not_found", 404);
    }
    const artifactKey = String(material.extraction?.ocr?.artifactKey ?? "");
    if (!artifactKey || artifactKey !== safeSegment(artifactKey)) {
      throw codedError("OCR page image not found.", "private_tutor_ocr_page_image_not_found", 404);
    }
    const candidate = resolve(
      root,
      material.sourceHash,
      "ocr",
      artifactKey,
      "pages",
      `page-${String(normalizedPageNumber).padStart(3, "0")}.png`,
    );
    if (!confined(root, candidate) || !existsSync(candidate)) {
      throw codedError("OCR page image not found.", "private_tutor_ocr_page_image_not_found", 404);
    }
    const actual = realpathSync(candidate);
    const info = statSync(actual);
    if (!confined(root, actual) || !info.isFile() || info.size < 8 || info.size > MAX_OCR_PAGE_IMAGE_BYTES) {
      throw codedError("OCR page image not found.", "private_tutor_ocr_page_image_not_found", 404);
    }
    const bytes = readFileSync(actual);
    if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw codedError("OCR page image not found.", "private_tutor_ocr_page_image_not_found", 404);
    }
    return {
      bytes,
      contentType: "image/png",
      fileName: `page-${String(normalizedPageNumber).padStart(3, "0")}.png`,
    };
  }

  function removeMaterialArtifacts(material) {
    if (!material?.sourceHash) return;
    const shared = state.privateTutorMaterialDocuments.some((item) => item.id !== material.id && item.sourceHash === material.sourceHash);
    if (!shared) rmSync(join(root, material.sourceHash), { recursive: true, force: true });
  }

  function resumePendingJobs() {
    const pending = state.privateTutorOcrJobs.filter((job) => ["queued", "running"].includes(job.status));
    if (!pending.length) return;
    runTx(() => {
      for (const job of pending) {
        if (job.status === "running") {
          job.status = "queued";
          job.updatedAt = now();
        }
      }
    });
    for (const job of pending) {
      if (job.status === "queued") schedule(job);
    }
  }

  queueMicrotask(resumePendingJobs);

  return {
    root,
    storeSource,
    importLocalPath,
    start,
    retry,
    cancel,
    reviewPage,
    readPageImage,
    removeMaterialArtifacts,
    resumePendingJobs,
    getJob: (id, learningProfileId) => state.privateTutorOcrJobs.find((job) => job.id === id && job.learningProfileId === learningProfileId) ?? null,
    listJobs: (learningProfileId, materialId = null) => state.privateTutorOcrJobs.filter((job) =>
      job.learningProfileId === learningProfileId && (!materialId || job.materialId === materialId)),
  };
}
