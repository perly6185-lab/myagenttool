import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalWorkflowOcrAdapter } from "./workflow-ocr-adapter.mjs";

export const PRIVATE_TUTOR_MATERIAL_PARSER_VERSION = 2;
export const PRIVATE_TUTOR_MATERIAL_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const PRIVATE_TUTOR_MATERIAL_MAX_PDF_PAGES = 300;

const MAX_RAW_TEXT_CHARS = 500_000;
const MIN_MEANINGFUL_PAGE_CHARS = 20;
const SUPPORTED_FILE_TYPES = new Set(["markdown", "pdf", "plain_text"]);

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
} = {}) {
  const normalizedType = normalizeFileType(input?.fileType, input?.fileName ?? "");
  if (normalizedType !== "pdf") return parseMaterialDocument(input);
  validateMaterialIdentity(input, normalizedType);
  const bytes = decodePdfBytes(input.fileContent, input.fileEncoding);
  validateFileSize(bytes.length, input.fileSize);
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new PrivateTutorMaterialParseError("invalid_pdf_signature", "The uploaded file is not a valid PDF.");
  }

  const now = input.now ?? new Date().toISOString();
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
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

function validateFileSize(actualSize, declaredSize) {
  if (actualSize < 1) throw new PrivateTutorMaterialParseError("material_file_empty", "The uploaded file is empty.");
  if (actualSize > PRIVATE_TUTOR_MATERIAL_MAX_FILE_BYTES
    || (declaredSize != null && Number(declaredSize) > PRIVATE_TUTOR_MATERIAL_MAX_FILE_BYTES)) {
    throw new PrivateTutorMaterialParseError("file_size_exceeds_limit", "The uploaded file exceeds the 10 MB limit.");
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

function mergeOcrPages(pdfPages, ocrPages, pageCount) {
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
    return {
      pageNumber: page.pageNumber,
      text: ocrText,
      characterCount: ocrText.length,
      source: "local_ocr",
      confidence: Math.max(0, Math.min(1, Number(recognized.confidence) || 0)),
    };
  });
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
    const structuralHeading = line.trim().match(/^(第[0-9一二三四五六七八九十百]+[章回讲节篇]|Chapter\s+\d+|Unit\s+\d+|Part\s+[0-9IVXLCDM]+|[IVXLCDM]+\.|[A-Z]\.|[0-9]+(?:\.[0-9]+)*[.、]?\s+|摘要$|引言$|结论$|参考文献$|附录(?:\s*[A-Z一二三四五六七八九十])?[:：]?)/i);
    const headingMatch = markdownHeading || structuralHeading;

    if (headingMatch) {
      if (currentSection) {
        currentSection.lineEnd = i;
        currentSection.content = currentSection.contentLines.join("\n").trim();
        delete currentSection.contentLines;
        sections.push(currentSection);
      }

      const isMd = Boolean(markdownHeading);
      const title = isMd ? line.replace(/^#+\s+/, "").trim() : line.trim();
      const level = isMd ? markdownHeading[1].length : pdfStructuralHeadingLevel(title);

      currentSection = {
        id: `sec_${sectionIndex++}`,
        title,
        level,
        pageNumber: currentPage,
        lineStart: i + 1,
        lineEnd: lines.length,
        contentLines: [],
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
  if (/^[A-Z]\.\s+/.test(title) || /^第[0-9一二三四五六七八九十百]+节/.test(title)) return 2;
  const decimal = title.match(/^([0-9]+(?:\.[0-9]+)+)[.、]?\s+/);
  if (decimal) return Math.min(6, decimal[1].split(".").length);
  return 1;
}
