import { createHash } from "node:crypto";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_RAW_TEXT_CHARS = 500_000; // 500k chars limit
const SUPPORTED_FILE_TYPES = new Set(["markdown", "pdf", "plain_text"]);

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
  if (!learningProfileId || typeof learningProfileId !== "string") {
    throw new Error("missing_learning_profile_id");
  }
  if (!fileName || typeof fileName !== "string") {
    throw new Error("missing_file_name");
  }
  const normalizedType = normalizeFileType(fileType, fileName);
  if (!SUPPORTED_FILE_TYPES.has(normalizedType)) {
    throw new Error("unsupported_file_type");
  }

  const rawText = decodeFileContent(fileContent, normalizedType);
  const sizeBytes = fileSize ?? Buffer.byteLength(rawText, "utf8");

  if (sizeBytes > MAX_FILE_SIZE_BYTES || rawText.length > MAX_RAW_TEXT_CHARS) {
    throw new Error("file_size_exceeds_limit");
  }

  const sourceHash = createHash("sha256").update(rawText).digest("hex");
  const docId = `mat_${sourceHash.slice(0, 16)}`;

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
    createdAt: now,
    updatedAt: now,
  };
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

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/) || line.trim().match(/^(第[0-9一二三四五六七八九十百]+[章回讲节篇]|Chapter\s+\d+|[0-9]+\.[0-9]*\s+)/i);

    if (headingMatch) {
      if (currentSection) {
        currentSection.lineEnd = i;
        currentSection.content = currentSection.contentLines.join("\n").trim();
        delete currentSection.contentLines;
        sections.push(currentSection);
      }

      const isMd = !!line.match(/^(#{1,6})\s+(.+)$/);
      const title = isMd ? line.replace(/^#+\s+/, "").trim() : line.trim();
      const level = isMd ? line.match(/^(#{1,6})/)[1].length : 1;

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
