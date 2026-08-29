import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalWorkflowOcrAdapter } from "./workflow-ocr-adapter.mjs";
import {
  PRIVATE_TUTOR_MATH_AST_NODE_TYPES,
  PRIVATE_TUTOR_OCR_REVIEW_CONFIDENCE_THRESHOLD,
  PRIVATE_TUTOR_TEXTBOOK_BLOCK_TYPES,
  PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION,
  PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSIONS,
  PRIVATE_TUTOR_VERTICAL_MATH_ROW_ROLES,
} from "./private-tutor-textbook-page-schema.mjs";

export const PRIVATE_TUTOR_MATERIAL_PARSER_VERSION = 2;
export const PRIVATE_TUTOR_MATERIAL_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const PRIVATE_TUTOR_MATERIAL_MAX_LOCAL_FILE_BYTES = 512 * 1024 * 1024;
export const PRIVATE_TUTOR_MATERIAL_MAX_PDF_PAGES = 300;

const MAX_RAW_TEXT_CHARS = 500_000;
const MIN_MEANINGFUL_PAGE_CHARS = 20;
const SUPPORTED_FILE_TYPES = new Set(["markdown", "pdf", "plain_text"]);
const TEXTBOOK_BLOCK_TYPES = new Set(PRIVATE_TUTOR_TEXTBOOK_BLOCK_TYPES);
const TEXTBOOK_PAGE_SCHEMA_VERSIONS = new Set(PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSIONS);
const MATH_AST_NODE_TYPES = new Set(PRIVATE_TUTOR_MATH_AST_NODE_TYPES);
const VERTICAL_MATH_ROW_ROLES = new Set(PRIVATE_TUTOR_VERTICAL_MATH_ROW_ROLES);

export class PrivateTutorMaterialParseError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "PrivateTutorMaterialParseError";
    this.code = code;
  }
}

/**
 * Parses a browser material upload. PDFs must arrive as preserved base64 bytes;
 * text files continue to use the synchronous parser below.
 */
export async function parseUploadedMaterialDocument(input, {
  ocrAdapter = createLocalWorkflowOcrAdapter(),
  extractPdf = extractPrivateTutorPdfPages,
  sourceStore = null,
} = {}) {
  const normalizedType = normalizeFileType(input?.fileType, input?.fileName ?? "");
  if (normalizedType !== "pdf") return parseMaterialDocument(input);
  validateMaterialIdentity(input, normalizedType);
  const bytes = decodePdfBytes(input.fileContent, input.fileEncoding);
  validateFileSize(bytes.length, input.fileSize);
  return parsePrivateTutorPdfBytes(input, bytes, { ocrAdapter, extractPdf, sourceStore });
}

export async function parsePrivateTutorMaterialPath(input, {
  ocrAdapter = createLocalWorkflowOcrAdapter(),
  extractPdf = extractPrivateTutorPdfPages,
  sourceStore = null,
  maxFileBytes = PRIVATE_TUTOR_MATERIAL_MAX_LOCAL_FILE_BYTES,
} = {}) {
  const normalizedType = normalizeFileType(input?.fileType, input?.fileName ?? input?.path ?? "");
  if (normalizedType !== "pdf") throw new PrivateTutorMaterialParseError("unsupported_file_type");
  validateMaterialIdentity(input, normalizedType);
  let path;
  let info;
  try {
    path = realpathSync(input.path);
    info = statSync(path);
  } catch {
    throw new PrivateTutorMaterialParseError("private_tutor_material_source_unavailable", "The selected local file is unavailable.");
  }
  if (!info.isFile()) throw new PrivateTutorMaterialParseError("private_tutor_material_source_invalid", "The selected local path is not a file.");
  validateFileSize(info.size, input.fileSize ?? info.size, maxFileBytes);
  const bytes = readFileSync(path);
  return parsePrivateTutorPdfBytes({ ...input, fileType: normalizedType, fileSize: info.size }, bytes, {
    ocrAdapter,
    extractPdf,
    sourceStore,
  });
}

async function parsePrivateTutorPdfBytes(input, bytes, { ocrAdapter, extractPdf, sourceStore }) {
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new PrivateTutorMaterialParseError("invalid_pdf_signature", "The uploaded file is not a valid PDF.");
  }

  const now = input.now ?? new Date().toISOString();
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  const managedSource = typeof sourceStore === "function"
    ? await sourceStore({
        bytes,
        sourceHash,
        fileName: input.fileName,
        fileType: "pdf",
      })
    : null;
  const extraction = await extractPdf(bytes);
  let pages = extraction.pages;
  const warnings = [...extraction.warnings];
  const initialQuality = pdfTextQuality(pages, extraction.pageCount);
  const initiallyNeedsOcr = initialQuality.needsOcr && !extraction.truncated;
  const ocr = {
    required: initiallyNeedsOcr,
    attempted: false,
    state: initiallyNeedsOcr ? "unavailable" : "not_required",
    providerId: null,
    reason: null,
  };

  if (initiallyNeedsOcr) {
    const readiness = safeOcrReadiness(ocrAdapter);
    ocr.providerId = readiness.providerId ?? ocrAdapter?.providerId ?? null;
    ocr.reason = readiness.reason ?? null;
    if (readiness.state === "ready" && typeof ocrAdapter?.recognizePdf === "function") {
      ocr.attempted = true;
      const temporaryRoot = mkdtempSync(join(tmpdir(), "myagenttool-private-tutor-pdf-"));
      const temporaryPdf = join(temporaryRoot, "source.pdf");
      try {
        writeFileSync(temporaryPdf, bytes, { mode: 0o600, flag: "wx" });
        const recognized = await ocrAdapter.recognizePdf({ path: temporaryPdf });
        pages = mergeOcrPages(pages, recognized?.pages, extraction.pageCount);
        ocr.state = "completed";
        ocr.providerId = recognized?.providerId ?? ocr.providerId;
        ocr.reason = null;
      } catch (error) {
        ocr.state = "failed";
        ocr.reason = String(error?.code ?? "private_tutor_ocr_failed").slice(0, 120);
        warnings.push({ code: "local_ocr_failed", detail: ocr.reason });
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    } else {
      warnings.push({ code: "local_ocr_unavailable", detail: ocr.reason ?? "workflow_ocr_provider_unavailable" });
    }
  }

  const finalQuality = pdfTextQuality(pages, extraction.pageCount);
  if (finalQuality.lowTextPageNumbers.length > 0) {
    warnings.push({ code: "pages_with_little_or_no_text", pageNumbers: finalQuality.lowTextPageNumbers });
  }
  if (extraction.truncatedPages) {
    warnings.push({ code: "pdf_page_limit_reached", limit: PRIVATE_TUTOR_MATERIAL_MAX_PDF_PAGES });
  }
  const needsOcr = finalQuality.needsOcr && !extraction.truncated;
  const status = needsOcr ? "needs_ocr" : "parsed";
  const pageText = pages.map((page) => `--- Page ${page.pageNumber} ---\n${page.text}`).join("\n");
  let sections = status === "parsed" ? parsePdfTextSections(pageText) : [];
  if (sections.length === 0 && status === "parsed") sections = pdfPageSections(pages, input.fileName);

  return {
    id: materialId(input.learningProfileId, sourceHash),
    learningProfileId: input.learningProfileId,
    fileName: input.fileName,
    fileType: "pdf",
    fileSize: bytes.length,
    sourceHash,
    ...(managedSource ? { managedSource } : {}),
    status,
    pages,
    sections,
    extraction: {
      parserVersion: PRIVATE_TUTOR_MATERIAL_PARSER_VERSION,
      state: status === "parsed" ? "ready" : "needs_ocr",
      method: pages.some((page) => page.source === "local_ocr") ? "pdf_text_with_local_ocr" : "pdf_text",
      pageCount: extraction.pageCount,
      processedPageCount: pages.length,
      characterCount: finalQuality.characterCount,
      textPageCount: finalQuality.textPageCount,
      lowTextPageNumbers: finalQuality.lowTextPageNumbers,
      truncated: extraction.truncated || extraction.truncatedPages,
      truncatedPages: extraction.truncatedPages,
      needsOcr,
      ocr,
      warnings: dedupeWarnings(warnings),
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function applyPrivateTutorOcrResult(materialDocument, recognized, now = new Date().toISOString()) {
  if (!materialDocument || materialDocument.fileType !== "pdf") {
    throw new PrivateTutorMaterialParseError("private_tutor_ocr_material_invalid", "OCR requires a PDF material document.");
  }
  const pageCount = Number(materialDocument.extraction?.pageCount) || materialDocument.pages?.length || 0;
  if (!pageCount || !Array.isArray(materialDocument.pages) || materialDocument.pages.length !== pageCount) {
    throw new PrivateTutorMaterialParseError("private_tutor_ocr_material_invalid", "OCR requires the original PDF page index.");
  }
  const pages = mergeOcrPages(materialDocument.pages, recognized?.pages, pageCount, {
    providerId: recognized?.providerId ?? null,
    providerVersion: recognized?.providerVersion ?? null,
  });
  const quality = pdfTextQuality(pages, pageCount);
  const needsOcr = quality.needsOcr;
  const ocrReview = summarizeOcrReview(pages, 1, now);
  const needsReview = !needsOcr && ocrReview.requiredPageNumbers.length > 0;
  let sections = needsOcr || needsReview ? [] : parsePdfTextSections(pages.map(
    (page) => `--- Page ${page.pageNumber} ---\n${page.text}`,
  ).join("\n"));
  if (!needsOcr && !needsReview && sections.length === 0) sections = pdfPageSections(pages, materialDocument.fileName);
  const retainedWarnings = (materialDocument.extraction?.warnings ?? []).filter((warning) => ![
    "local_ocr_unavailable",
    "local_ocr_failed",
    "pages_with_little_or_no_text",
    "ocr_pages_need_review",
  ].includes(warning.code));
  if (quality.lowTextPageNumbers.length > 0) {
    retainedWarnings.push({ code: "pages_with_little_or_no_text", pageNumbers: quality.lowTextPageNumbers });
  }
  if (needsReview) {
    retainedWarnings.push({ code: "ocr_pages_need_review", pageNumbers: ocrReview.requiredPageNumbers });
  }
  return {
    ...materialDocument,
    status: needsOcr ? "needs_ocr" : needsReview ? "needs_review" : "parsed",
    pages,
    sections,
    extraction: {
      ...materialDocument.extraction,
      state: needsOcr ? "needs_ocr" : needsReview ? "needs_review" : "ready",
      method: "pdf_text_with_local_ocr",
      processedPageCount: pages.length,
      characterCount: quality.characterCount,
      textPageCount: quality.textPageCount,
      lowTextPageNumbers: quality.lowTextPageNumbers,
      needsOcr,
      ocrReview,
      ocr: {
        required: true,
        attempted: true,
        state: needsReview ? "needs_review" : "completed",
        providerId: recognized?.providerId ?? null,
        providerVersion: recognized?.providerVersion ?? null,
        reason: needsOcr ? "private_tutor_ocr_text_quality_insufficient" : null,
      },
      warnings: dedupeWarnings(retainedWarnings),
    },
    updatedAt: now,
  };
}

export function reviewPrivateTutorOcrPage(materialDocument, input, now = new Date().toISOString()) {
  if (!materialDocument || materialDocument.fileType !== "pdf" || !Array.isArray(materialDocument.pages)) {
    throw new PrivateTutorMaterialParseError("private_tutor_ocr_material_invalid", "OCR review requires a PDF material document.");
  }
  const review = materialDocument.extraction?.ocrReview;
  if (!review || Number(input?.expectedRevision) !== Number(review.revision)) {
    throw new PrivateTutorMaterialParseError("private_tutor_ocr_review_revision_conflict", "The OCR review changed; reload before confirming this page.");
  }
  const pageNumber = Number(input?.pageNumber);
  const pageIndex = materialDocument.pages.findIndex((page) => page.pageNumber === pageNumber);
  const page = materialDocument.pages[pageIndex];
  if (!page || page.source !== "local_ocr" || page.review?.status !== "pending") {
    throw new PrivateTutorMaterialParseError("private_tutor_ocr_review_page_not_pending", "This OCR page is not waiting for review.");
  }
  if (input?.acknowledge !== true) {
    throw new PrivateTutorMaterialParseError("private_tutor_ocr_review_acknowledgement_required", "Confirm that the recognized page was checked against the source image.");
  }
  const nextText = typeof input.text === "string"
    ? input.text.replaceAll("\0", "").trim().slice(0, MAX_RAW_TEXT_CHARS)
    : page.text;
  if (!nextText) {
    throw new PrivateTutorMaterialParseError("private_tutor_ocr_review_text_required", "A reviewed OCR page must contain text.");
  }
  const textEdited = nextText !== page.text;
  const previousSource = page.blocks?.[0]?.source ?? {};
  const blocks = textEdited ? normalizeOcrBlocks(null, nextText, page.confidence, page.pageNumber, previousSource) : page.blocks;
  const nextPages = materialDocument.pages.slice();
  nextPages[pageIndex] = {
    ...page,
    text: nextText,
    characterCount: nextText.length,
    printedPageNumber: typeof input.printedPageNumber === "string"
      ? input.printedPageNumber.replaceAll("\0", "").trim().slice(0, 40) || null
      : page.printedPageNumber ?? null,
    schemaVersion: textEdited ? PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION : page.schemaVersion,
    coordinateSystem: textEdited ? "normalized" : page.coordinateSystem,
    blocks,
    review: {
      ...page.review,
      status: "confirmed",
      confirmedAt: now,
      textEdited,
    },
  };
  const nextRevision = Number(review.revision) + 1;
  const ocrReview = summarizeOcrReview(nextPages, nextRevision, now);
  const quality = pdfTextQuality(nextPages, materialDocument.extraction?.pageCount);
  const needsOcr = quality.needsOcr;
  const needsReview = !needsOcr && ocrReview.requiredPageNumbers.length > 0;
  const status = needsOcr ? "needs_ocr" : needsReview ? "needs_review" : "parsed";
  let sections = status === "parsed" ? parsePdfTextSections(nextPages.map(
    (item) => `--- Page ${item.pageNumber} ---\n${item.text}`,
  ).join("\n")) : [];
  if (status === "parsed" && sections.length === 0) sections = pdfPageSections(nextPages, materialDocument.fileName);
  const retainedWarnings = (materialDocument.extraction?.warnings ?? []).filter((warning) => ![
    "pages_with_little_or_no_text",
    "ocr_pages_need_review",
  ].includes(warning.code));
  if (quality.lowTextPageNumbers.length > 0) {
    retainedWarnings.push({ code: "pages_with_little_or_no_text", pageNumbers: quality.lowTextPageNumbers });
  }
  if (needsReview) retainedWarnings.push({ code: "ocr_pages_need_review", pageNumbers: ocrReview.requiredPageNumbers });
  return {
    ...materialDocument,
    status,
    pages: nextPages,
    sections,
    extraction: {
      ...materialDocument.extraction,
      state: status === "parsed" ? "ready" : status,
      characterCount: quality.characterCount,
      textPageCount: quality.textPageCount,
      lowTextPageNumbers: quality.lowTextPageNumbers,
      needsOcr,
      ocrReview,
      ocr: {
        ...materialDocument.extraction.ocr,
        state: status === "parsed" ? "completed" : status === "needs_review" ? "needs_review" : "completed",
        reason: needsOcr ? "private_tutor_ocr_text_quality_insufficient" : null,
      },
      warnings: dedupeWarnings(retainedWarnings),
    },
    updatedAt: now,
  };
}

/**
 * Parses user input material documents (Markdown, Plain Text, or Extracted PDF text)
 * into a structured hierarchy of sections with line and page boundaries.
 */
export function parseMaterialDocument({
  learningProfileId,
  fileName,
  fileType,
  fileContent, // string (markdown/text) or base64 (pdf/text)
  fileSize,
  now = new Date().toISOString(),
}) {
  const normalizedType = normalizeFileType(fileType, fileName);
  validateMaterialIdentity({ learningProfileId, fileName }, normalizedType);

  const rawText = decodeFileContent(fileContent, normalizedType);
  const sizeBytes = fileSize ?? Buffer.byteLength(rawText, "utf8");

  if (sizeBytes > PRIVATE_TUTOR_MATERIAL_MAX_FILE_BYTES || rawText.length > MAX_RAW_TEXT_CHARS) {
    throw new Error("file_size_exceeds_limit");
  }

  const sourceHash = createHash("sha256").update(rawText).digest("hex");
  const docId = materialId(learningProfileId, sourceHash);

  let sections = [];
  if (normalizedType === "markdown") {
    sections = parseMarkdownSections(rawText);
  } else if (normalizedType === "pdf") {
    sections = parsePdfTextSections(rawText);
  } else {
    sections = parsePlainTextSections(rawText);
  }

  // Fallback if no hierarchical headers were found
  if (sections.length === 0 && rawText.trim().length > 0) {
    sections = [
      {
        id: "sec_1",
        title: fileName.replace(/\.[^/.]+$/, ""),
        level: 1,
        pageNumber: 1,
        lineStart: 1,
        lineEnd: rawText.split("\n").length,
        content: rawText.trim(),
      },
    ];
  }

  return {
    id: docId,
    learningProfileId,
    fileName,
    fileType: normalizedType,
    fileSize: sizeBytes,
    sourceHash,
    status: sections.length > 0 ? "parsed" : "empty",
    rawText,
    sections,
    extraction: {
      parserVersion: PRIVATE_TUTOR_MATERIAL_PARSER_VERSION,
      state: sections.length > 0 ? "ready" : "empty",
      method: normalizedType === "pdf" ? "legacy_extracted_pdf_text" : "native_text",
      pageCount: normalizedType === "pdf" ? Math.max(1, ...sections.map((section) => section.pageNumber ?? 1)) : null,
      processedPageCount: normalizedType === "pdf" ? Math.max(1, ...sections.map((section) => section.pageNumber ?? 1)) : null,
      characterCount: rawText.length,
      textPageCount: normalizedType === "pdf" ? new Set(sections.map((section) => section.pageNumber ?? 1)).size : null,
      lowTextPageNumbers: [],
      truncated: false,
      truncatedPages: false,
      needsOcr: false,
      ocr: { required: false, attempted: false, state: "not_required", providerId: null, reason: null },
      warnings: normalizedType === "pdf" ? [{ code: "legacy_extracted_pdf_text" }] : [],
    },
    createdAt: now,
    updatedAt: now,
  };
}

function validateMaterialIdentity(input, normalizedType) {
  if (!input?.learningProfileId || typeof input.learningProfileId !== "string") {
    throw new PrivateTutorMaterialParseError("missing_learning_profile_id");
  }
  if (!input?.fileName || typeof input.fileName !== "string") {
    throw new PrivateTutorMaterialParseError("missing_file_name");
  }
  if (!SUPPORTED_FILE_TYPES.has(normalizedType)) {
    throw new PrivateTutorMaterialParseError("unsupported_file_type");
  }
}

function materialId(learningProfileId, sourceHash) {
  const fingerprint = createHash("sha256").update(`${learningProfileId}\0${sourceHash}`).digest("hex");
  return `mat_${fingerprint.slice(0, 16)}`;
}

function validateFileSize(actualSize, declaredSize, maxBytes = PRIVATE_TUTOR_MATERIAL_MAX_FILE_BYTES) {
  if (actualSize < 1) throw new PrivateTutorMaterialParseError("material_file_empty", "The uploaded file is empty.");
  if (actualSize > maxBytes
    || (declaredSize != null && Number(declaredSize) > maxBytes)) {
    throw new PrivateTutorMaterialParseError("file_size_exceeds_limit", `The uploaded file exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`);
  }
  if (declaredSize != null && (!Number.isSafeInteger(Number(declaredSize)) || Number(declaredSize) !== actualSize)) {
    throw new PrivateTutorMaterialParseError("material_file_size_mismatch", "The uploaded byte count does not match the declared file size.");
  }
}

function decodePdfBytes(content, encoding) {
  if (typeof content !== "string" || !content) {
    throw new PrivateTutorMaterialParseError("missing_file_content");
  }
  let base64 = content;
  const dataUrl = /^data:[^,]*;base64,(.*)$/is.exec(content);
  if (dataUrl) base64 = dataUrl[1];
  else if (encoding !== "base64") {
    throw new PrivateTutorMaterialParseError("pdf_binary_required", "PDF uploads must preserve the original bytes as base64.");
  }
  const compact = base64.replace(/\s+/g, "");
  if (!compact || compact.length > Math.ceil(PRIVATE_TUTOR_MATERIAL_MAX_FILE_BYTES / 3) * 4 + 8
    || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new PrivateTutorMaterialParseError("invalid_pdf_encoding", "The PDF byte encoding is invalid.");
  }
  const bytes = Buffer.from(compact, "base64");
  const canonicalInput = compact.replace(/=+$/, "");
  const canonicalDecoded = bytes.toString("base64").replace(/=+$/, "");
  if (canonicalInput !== canonicalDecoded) {
    throw new PrivateTutorMaterialParseError("invalid_pdf_encoding", "The PDF byte encoding is invalid.");
  }
  return bytes;
}

export async function extractPrivateTutorPdfPages(bytes) {
  let pdfjs;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    throw new PrivateTutorMaterialParseError("pdf_parser_unavailable", "The PDF parser is unavailable on this device.");
  }
  let task;
  try {
    task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: 0,
    });
    const document = await task.promise;
    const processedPageCount = Math.min(document.numPages, PRIVATE_TUTOR_MATERIAL_MAX_PDF_PAGES);
    const pages = [];
    let characters = 0;
    let truncated = false;
    try {
      for (let pageNumber = 1; pageNumber <= processedPageCount; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          let text = pdfItemsToText(content.items);
          const remaining = MAX_RAW_TEXT_CHARS - characters;
          if (remaining <= 0) {
            text = "";
            truncated = true;
          } else if (text.length > remaining) {
            text = text.slice(0, remaining);
            truncated = true;
          }
          characters += text.length;
          pages.push({
            pageNumber,
            text,
            characterCount: text.length,
            source: "pdf_text",
            confidence: text.length >= MIN_MEANINGFUL_PAGE_CHARS ? 1 : null,
          });
        } finally {
          page.cleanup();
        }
      }
    } finally {
      await task.destroy();
    }
    return {
      pages,
      pageCount: document.numPages,
      truncated,
      truncatedPages: document.numPages > PRIVATE_TUTOR_MATERIAL_MAX_PDF_PAGES,
      warnings: truncated ? [{ code: "pdf_text_limit_reached", limit: MAX_RAW_TEXT_CHARS }] : [],
    };
  } catch (error) {
    try { await task?.destroy?.(); } catch { /* best-effort parser cleanup */ }
    if (error instanceof PrivateTutorMaterialParseError) throw error;
    const marker = `${error?.name ?? ""} ${error?.code ?? ""} ${error?.message ?? ""}`;
    if (/password/i.test(marker)) {
      throw new PrivateTutorMaterialParseError("pdf_password_required", "Password-protected PDFs are not supported yet.");
    }
    if (/invalidpdf|invalid pdf|missing pdf/i.test(marker)) {
      throw new PrivateTutorMaterialParseError("invalid_pdf", "The PDF is damaged or invalid.");
    }
    throw new PrivateTutorMaterialParseError("pdf_parse_failed", "The PDF could not be parsed.");
  }
}

function pdfItemsToText(items) {
  const lines = [];
  let current = "";
  for (const item of items ?? []) {
    const value = String(item?.str ?? "").replaceAll("\0", "").trim();
    if (value) {
      const previous = current.at(-1) ?? "";
      const next = value[0] ?? "";
      const joinsCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(previous)
        && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(next);
      if (current && !joinsCjk && !/\s$/.test(current) && !/^[,.;:!?，。；：！？）\]}]/.test(value)) current += " ";
      current += value;
    }
    if (item?.hasEOL && current.trim()) {
      lines.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function pdfTextQuality(pages, pageCount) {
  const lowTextPageNumbers = [];
  let characterCount = 0;
  let textPageCount = 0;
  for (const page of pages) {
    const meaningfulChars = String(page.text ?? "").replace(/\s+/g, "").length;
    characterCount += String(page.text ?? "").length;
    if (meaningfulChars >= MIN_MEANINGFUL_PAGE_CHARS) textPageCount += 1;
    else lowTextPageNumbers.push(page.pageNumber);
  }
  const expectedPages = Math.max(1, Math.min(Number(pageCount) || pages.length || 1, pages.length || 1));
  const needsOcr = textPageCount < Math.ceil(expectedPages / 2)
    || characterCount < expectedPages * MIN_MEANINGFUL_PAGE_CHARS;
  return { characterCount, textPageCount, lowTextPageNumbers, needsOcr };
}

function safeOcrReadiness(adapter) {
  try {
    return adapter?.readiness?.() ?? { state: "unavailable", reason: "workflow_ocr_provider_unavailable" };
  } catch {
    return { state: "unavailable", reason: "workflow_ocr_provider_unavailable" };
  }
}

function mergeOcrPages(pdfPages, ocrPages, pageCount, provider = {}) {
  if (!Array.isArray(ocrPages) || ocrPages.length !== pageCount) {
    throw new PrivateTutorMaterialParseError("private_tutor_ocr_invalid_result", "Local OCR returned incomplete page results.");
  }
  const byPage = new Map(ocrPages.map((page) => [Number(page?.index ?? page?.pageNumber), page]));
  return pdfPages.map((page) => {
    const recognized = byPage.get(page.pageNumber);
    if (!recognized || typeof recognized.text !== "string") {
      throw new PrivateTutorMaterialParseError("private_tutor_ocr_invalid_result", "Local OCR omitted a page.");
    }
    const existingLength = page.text.replace(/\s+/g, "").length;
    const ocrText = recognized.text.replaceAll("\0", "").trim().slice(0, MAX_RAW_TEXT_CHARS);
    if (existingLength >= MIN_MEANINGFUL_PAGE_CHARS || ocrText.length <= existingLength) return page;
    const confidence = Math.max(0, Math.min(1, Number(recognized.confidence) || 0));
    const blocks = normalizeOcrBlocks(recognized.blocks, ocrText, confidence, page.pageNumber, provider);
    const reasons = [];
    if (confidence < PRIVATE_TUTOR_OCR_REVIEW_CONFIDENCE_THRESHOLD) reasons.push("low_page_confidence");
    if (blocks.some((block) => block.confidence < PRIVATE_TUTOR_OCR_REVIEW_CONFIDENCE_THRESHOLD)) reasons.push("low_block_confidence");
    const formulaBlocks = blocks.filter((block) => block.type === "formula");
    if (formulaBlocks.some((block) => !block.math?.ast && !block.math?.vertical)) reasons.push("math_structure_missing");
    if (formulaBlocks.some((block) => block.math && block.math.confidence < PRIVATE_TUTOR_OCR_REVIEW_CONFIDENCE_THRESHOLD)) reasons.push("math_structure_low_confidence");
    if (/〔不清楚〕/.test(ocrText)) reasons.push("unclear_characters");
    return {
      pageNumber: page.pageNumber,
      text: ocrText,
      characterCount: ocrText.length,
      source: "local_ocr",
      confidence,
      schemaVersion: PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION,
      coordinateSystem: "normalized",
      printedPageNumber: String(recognized.printedPageNumber ?? "").trim().slice(0, 40) || null,
      blocks,
      review: {
        status: reasons.length > 0 ? "pending" : "not_required",
        reasons: [...new Set(reasons)],
        confirmedAt: null,
        textEdited: false,
      },
    };
  });
}

function normalizeOcrBlocks(input, text, pageConfidence, pageNumber, provider) {
  const raw = Array.isArray(input) && input.length > 0
    ? input
    : blocksFromText(text, pageConfidence);
  return raw.slice(0, 2_000).map((block, offset) => {
    const confidence = boundedConfidence(block?.confidence, pageConfidence);
    return {
      id: `page_${pageNumber}_block_${offset + 1}`,
      order: offset + 1,
      type: TEXTBOOK_BLOCK_TYPES.has(block?.type) ? block.type : "other",
      text: String(block?.text ?? "").replaceAll("\0", "").trim().slice(0, 2_000),
      confidence,
      box: normalizeOcrBox(block?.box),
      math: normalizeOcrMath(block?.math, confidence),
      source: {
        providerId: provider.providerId ?? null,
        providerVersion: provider.providerVersion ?? null,
        schemaVersion: PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION,
      },
    };
  }).filter((block) => block.text);
}

function boundedConfidence(value, fallback = 0) {
  const number = Number(value);
  return Math.max(0, Math.min(1, Number.isFinite(number) ? number : Number(fallback) || 0));
}

function normalizeOcrBox(value) {
  const x = boundedConfidence(value?.x);
  const y = boundedConfidence(value?.y);
  const width = Math.min(boundedConfidence(value?.width, 1), 1 - x);
  const height = Math.min(boundedConfidence(value?.height, 1), 1 - y);
  return width > 0 && height > 0 ? { x, y, width, height } : { x: 0, y: 0, width: 1, height: 1 };
}

function normalizeOcrMath(value, blockConfidence) {
  if (!value || typeof value !== "object") return null;
  const notation = String(value.notation ?? "").replaceAll("\0", "").trim().slice(0, 1_000);
  const rawNodes = Array.isArray(value.ast?.nodes) ? value.ast.nodes.slice(0, 200) : [];
  const nodes = [];
  const ids = new Set();
  rawNodes.forEach((node, offset) => {
    let id = String(node?.id ?? "").replaceAll("\0", "").trim().slice(0, 40) || `node_${offset + 1}`;
    if (ids.has(id)) id = `node_${offset + 1}`;
    ids.add(id);
    nodes.push({
      id,
      type: MATH_AST_NODE_TYPES.has(node?.type) ? node.type : "unknown",
      value: String(node?.value ?? "").replaceAll("\0", "").trim().slice(0, 200),
      childIds: Array.isArray(node?.childIds)
        ? node.childIds.slice(0, 20).map((childId) => String(childId ?? "").trim().slice(0, 40)).filter(Boolean)
        : [],
    });
  });
  for (const node of nodes) node.childIds = node.childIds.filter((childId) => ids.has(childId) && childId !== node.id);
  const requestedRootId = String(value.ast?.rootId ?? "").trim().slice(0, 40);
  const rootId = ids.has(requestedRootId) ? requestedRootId : nodes[0]?.id;
  const byNodeId = new Map(nodes.map((node) => [node.id, node]));
  const reachable = new Set();
  const visiting = new Set();
  function visit(nodeId) {
    const node = byNodeId.get(nodeId);
    if (!node || visiting.has(nodeId)) return false;
    if (reachable.has(nodeId)) return true;
    visiting.add(nodeId);
    node.childIds = node.childIds.filter((childId) => visit(childId));
    visiting.delete(nodeId);
    reachable.add(nodeId);
    return true;
  }
  if (rootId) visit(rootId);
  const astNodes = nodes.filter((node) => reachable.has(node.id));
  const ast = rootId && astNodes.length > 0 ? { rootId, nodes: astNodes } : null;
  const rows = Array.isArray(value.vertical?.rows) ? value.vertical.rows.slice(0, 30).map((row) => ({
    role: VERTICAL_MATH_ROW_ROLES.has(row?.role) ? row.role : "operand",
    text: String(row?.text ?? "").replaceAll("\0", "").trim().slice(0, 200),
    indent: Math.max(0, Math.min(40, Math.trunc(Number(row?.indent) || 0))),
  })).filter((row) => row.text) : [];
  const vertical = rows.length > 0 ? {
    operator: ["add", "subtract", "multiply", "divide", "other"].includes(value.vertical?.operator) ? value.vertical.operator : "other",
    rows,
  } : null;
  if (!notation && !ast && !vertical) return null;
  return { notation, confidence: boundedConfidence(value.confidence, blockConfidence), ast, vertical };
}

function blocksFromText(text, confidence) {
  return String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2_000)
    .map((line, offset) => ({ order: offset + 1, type: "paragraph", text: line, confidence }));
}

function summarizeOcrReview(pages, revision, now) {
  const ocrPages = pages.filter((page) => page.source === "local_ocr" && TEXTBOOK_PAGE_SCHEMA_VERSIONS.has(page.schemaVersion));
  const requiredPageNumbers = ocrPages.filter((page) => page.review?.status === "pending").map((page) => page.pageNumber);
  const confirmedPageNumbers = ocrPages.filter((page) => page.review?.status === "confirmed").map((page) => page.pageNumber);
  return {
    schemaVersion: PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION,
    revision,
    status: requiredPageNumbers.length > 0 ? "pending" : confirmedPageNumbers.length > 0 ? "confirmed" : "not_required",
    confidenceThreshold: PRIVATE_TUTOR_OCR_REVIEW_CONFIDENCE_THRESHOLD,
    requiredPageNumbers,
    confirmedPageNumbers,
    confirmedAt: requiredPageNumbers.length === 0 && confirmedPageNumbers.length > 0 ? now : null,
  };
}

function pdfPageSections(pages, fileName) {
  const baseName = String(fileName ?? "PDF").replace(/\.[^/.]+$/, "") || "PDF";
  return pages.filter((page) => page.text.trim()).map((page, index) => ({
    id: `sec_page_${page.pageNumber}`,
    title: `${baseName} · 第 ${page.pageNumber} 页`,
    level: 1,
    pageNumber: page.pageNumber,
    lineStart: 1,
    lineEnd: Math.max(1, page.text.split("\n").length),
    content: page.text.trim(),
    orderIndex: index + 1,
  }));
}

function dedupeWarnings(warnings) {
  const seen = new Set();
  return warnings.filter((warning) => {
    const key = JSON.stringify(warning);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeFileType(fileType, fileName) {
  if (fileType) {
    const ft = fileType.toLowerCase();
    if (ft.includes("markdown") || ft === "md") return "markdown";
    if (ft.includes("pdf")) return "pdf";
    if (ft.includes("text") || ft === "txt") return "plain_text";
  }
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "pdf") return "pdf";
  if (ext === "txt" || ext === "text") return "plain_text";
  return fileType; // Return whatever was passed or null if unknown
}

function decodeFileContent(content, fileType) {
  if (typeof content !== "string") return "";
  // Check if base64 encoded
  if (content.startsWith("data:") && content.includes(";base64,")) {
    const base64Data = content.split(";base64,")[1];
    return Buffer.from(base64Data, "base64").toString("utf8");
  }
  return content;
}

/**
 * Extracts sections from Markdown based on heading levels (#, ##, ###, etc.)
 */
export function parseMarkdownSections(markdownText) {
  const lines = markdownText.split("\n");
  const sections = [];
  let currentSection = null;
  let sectionIndex = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      if (currentSection) {
        currentSection.lineEnd = i;
        currentSection.content = currentSection.contentLines.join("\n").trim();
        delete currentSection.contentLines;
        sections.push(currentSection);
      }

      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();

      currentSection = {
        id: `sec_${sectionIndex++}`,
        title,
        level,
        pageNumber: 1, // Markdown is logical line-based
        lineStart: i + 1,
        lineEnd: lines.length,
        contentLines: [],
      };
    } else {
      if (currentSection) {
        currentSection.contentLines.push(line);
      }
    }
  }

  if (currentSection) {
    currentSection.lineEnd = lines.length;
    currentSection.content = currentSection.contentLines.join("\n").trim();
    delete currentSection.contentLines;
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Extracts sections from plain text using chapter/unit indicators (e.g. 第1章, Unit 1, Chapter 1, 一、...)
 */
export function parsePlainTextSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let currentSection = null;
  let sectionIndex = 1;

  const chapterPattern = /^(第[0-9一二三四五六七八九十百]+[章回讲节篇]|Chapter\s+\d+|Unit\s+\d+|[一二三四五六七八九十]、|[0-9]+\.[0-9]*\s+)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (chapterPattern.test(line)) {
      if (currentSection) {
        currentSection.lineEnd = i;
        currentSection.content = currentSection.contentLines.join("\n").trim();
        delete currentSection.contentLines;
        sections.push(currentSection);
      }

      currentSection = {
        id: `sec_${sectionIndex++}`,
        title: line,
        level: line.startsWith("第") && line.includes("节") ? 2 : 1,
        pageNumber: 1,
        lineStart: i + 1,
        lineEnd: lines.length,
        contentLines: [],
      };
    } else {
      if (currentSection) {
        currentSection.contentLines.push(lines[i]);
      }
    }
  }

  if (currentSection) {
    currentSection.lineEnd = lines.length;
    currentSection.content = currentSection.contentLines.join("\n").trim();
    delete currentSection.contentLines;
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Extracts sections from structured PDF text chunks containing page markers (e.g. --- Page 1 --- or [[Page 1]])
 */
export function parsePdfTextSections(pdfText) {
  const pageMarkerPattern = /(?:---|\[\[)\s*Page\s+(\d+)\s*(?:---|\]\])/i;
  const lines = pdfText.split("\n");
  const sections = [];
  let currentPage = 1;
  let currentSection = null;
  let sectionIndex = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pageMatch = line.match(pageMarkerPattern);
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1], 10);
      continue;
    }

    const markdownHeading = line.match(/^(#{1,6})\s+(.+)$/);
    const structuralHeading = line.trim().match(/^(第[0-9零〇一二三四五六七八九十百]+(?:章|回|讲|节|篇|单元|课)|Chapter\s+\d+|Unit\s+\d+|Part\s+[0-9IVXLCDM]+|[IVXLCDM]+\.|[A-Z]\.|[0-9]+(?:\.[0-9]+)*[.、]?\s+|摘要$|引言$|结论$|参考文献$|附录(?:\s*[A-Z一二三四五六七八九十])?[:：]?)/i);
    const headingMatch = markdownHeading || structuralHeading;

    if (headingMatch) {
      if (currentSection) {
        currentSection.lineEnd = i;
        currentSection.content = currentSection.contentLines.join("\n").trim();
        delete currentSection.contentLines;
        sections.push(currentSection);
      }

      const isMd = Boolean(markdownHeading);
      const structuralLine = line.trim();
      const inlineSentenceBreak = isMd ? -1 : structuralLine.search(/[。！？!?]/);
      const title = isMd
        ? line.replace(/^#+\s+/, "").trim()
        : inlineSentenceBreak > 0 ? structuralLine.slice(0, inlineSentenceBreak).trim() : structuralLine;
      const level = isMd ? markdownHeading[1].length : pdfStructuralHeadingLevel(title);

      currentSection = {
        id: `sec_${sectionIndex++}`,
        title,
        level,
        pageNumber: currentPage,
        lineStart: i + 1,
        lineEnd: lines.length,
        contentLines: inlineSentenceBreak > 0
          ? [structuralLine.slice(inlineSentenceBreak + 1).trim()].filter(Boolean)
          : [],
      };
    } else if (currentSection) {
      currentSection.contentLines.push(line);
    }
  }

  if (currentSection) {
    currentSection.lineEnd = lines.length;
    currentSection.content = currentSection.contentLines.join("\n").trim();
    delete currentSection.contentLines;
    sections.push(currentSection);
  }

  return sections;
}

function pdfStructuralHeadingLevel(title) {
  if (/^[A-Z]\.\s+/.test(title) || /^第[0-9零〇一二三四五六七八九十百]+(?:节|课)/.test(title)) return 2;
  const decimal = title.match(/^([0-9]+(?:\.[0-9]+)+)[.、]?\s+/);
  if (decimal) return Math.min(6, decimal[1].split(".").length);
  return 1;
}
