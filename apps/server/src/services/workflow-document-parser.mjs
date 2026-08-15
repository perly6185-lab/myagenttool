import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

import { parse } from "parse5";

export const WORKFLOW_DOCUMENT_PARSER_VERSION = 1;

const MAX_INPUT_BYTES = 24 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 96 * 1024;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_PDF_PAGES = 300;
const MAX_SHEETS = 100;
const MAX_CELLS = 20_000;
const OCR_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlText(xml) {
  return decodeXml(String(xml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function boundedBlocks(blocks) {
  const result = [];
  let characters = 0;
  for (const block of blocks) {
    const text = String(block.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const remaining = MAX_EXTRACTED_CHARS - characters;
    if (remaining <= 0) break;
    const bounded = text.slice(0, remaining);
    result.push({
      kind: block.kind ?? "paragraph",
      text: bounded,
      location: block.location ?? null,
    });
    characters += bounded.length;
  }
  return {
    blocks: result,
    text: result.map((block) => {
      if (block.kind === "heading") return `## ${block.text}`;
      return block.text;
    }).join("\n\n"),
    characterCount: characters,
    truncated: characters >= MAX_EXTRACTED_CHARS,
  };
}

function readBoundedFile(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const info = fstatSync(fd);
    if (!info.isFile()) throw Object.assign(new Error("Document is not a regular file."), { code: "document_not_file" });
    if (info.size > MAX_INPUT_BYTES) {
      throw Object.assign(new Error("Document exceeds the parser input limit."), { code: "document_too_large" });
    }
    const buffer = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  } finally {
    if (fd != null) closeSync(fd);
  }
}

function zipEntries(buffer) {
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65_557); index -= 1) {
    if (buffer.readUInt32LE(index) === eocdSignature) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw Object.assign(new Error("Invalid OOXML archive."), { code: "document_archive_invalid" });
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount > MAX_ZIP_ENTRIES) {
    throw Object.assign(new Error("OOXML archive has too many entries."), { code: "document_archive_limit" });
  }
  const entries = new Map();
  let offset = centralOffset;
  let expanded = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw Object.assign(new Error("Invalid OOXML central directory."), { code: "document_archive_invalid" });
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const centralEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (centralEnd > buffer.length) {
      throw Object.assign(new Error("Invalid OOXML central directory bounds."), { code: "document_archive_invalid" });
    }
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset = centralEnd;
    if (flags & 1) throw Object.assign(new Error("Encrypted Office files are not supported."), { code: "document_encrypted" });
    if (!name.endsWith(".xml")) continue;
    if (uncompressedSize > MAX_EXPANDED_BYTES || expanded + uncompressedSize > MAX_EXPANDED_BYTES) {
      throw Object.assign(new Error("OOXML expanded content exceeds the safety limit."), { code: "document_archive_limit" });
    }
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw Object.assign(new Error("Invalid OOXML local entry."), { code: "document_archive_invalid" });
    }
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    if ((localFlags & 1) || localMethod !== method) {
      throw Object.assign(new Error("OOXML local entry metadata does not match its directory."), { code: "document_archive_invalid" });
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (start > buffer.length || end > buffer.length) {
      throw Object.assign(new Error("OOXML compressed entry exceeds the archive bounds."), { code: "document_archive_invalid" });
    }
    const compressed = buffer.subarray(start, start + compressedSize);
    let data;
    if (method === 0) {
      if (compressedSize !== uncompressedSize) {
        throw Object.assign(new Error("OOXML stored entry size is inconsistent."), { code: "document_archive_invalid" });
      }
      data = compressed;
    }
    else if (method === 8) data = inflateRawSync(compressed, { maxOutputLength: Math.min(uncompressedSize + 1, MAX_EXPANDED_BYTES) });
    else continue;
    if (data.length !== uncompressedSize) {
      throw Object.assign(new Error("OOXML expanded entry size is inconsistent."), { code: "document_archive_invalid" });
    }
    expanded += data.length;
    if (expanded > MAX_EXPANDED_BYTES) {
      throw Object.assign(new Error("OOXML expanded content exceeds the safety limit."), { code: "document_archive_limit" });
    }
    entries.set(name, data.toString("utf8"));
  }
  return entries;
}

function parseDocx(entries) {
  const xml = entries.get("word/document.xml");
  if (!xml) throw Object.assign(new Error("Word document body is missing."), { code: "document_corrupt" });
  const blocks = [];
  let paragraph = 0;
  for (const match of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    paragraph += 1;
    const value = [...match[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((item) => decodeXml(item[1])).join("").trim();
    if (!value) continue;
    const style = match[0].match(/<w:pStyle[^>]*w:val="([^"]+)"/)?.[1] ?? "";
    blocks.push({
      kind: /heading|title/i.test(style) ? "heading" : "paragraph",
      text: value,
      location: { kind: "paragraph", index: paragraph, style: style || null },
    });
  }
  return boundedBlocks(blocks);
}

function parsePptx(entries) {
  const slides = [...entries.entries()]
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(([left], [right]) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]))
    .slice(0, 500);
  const blocks = [];
  slides.forEach(([, xml], index) => {
    blocks.push({ kind: "heading", text: `Slide ${index + 1}`, location: { kind: "slide", index: index + 1 } });
    for (const match of xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)) {
      blocks.push({
        kind: "paragraph",
        text: decodeXml(match[1]),
        location: { kind: "slide", index: index + 1 },
      });
    }
  });
  return boundedBlocks(blocks);
}

function columnName(reference) {
  return reference.match(/[A-Z]+/i)?.[0] ?? "";
}

function parseXlsx(entries) {
  const shared = [];
  for (const match of (entries.get("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[\s\S]*?<\/si>/g)) {
    shared.push(xmlText(match[0]));
  }
  const sheets = [...entries.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(([left], [right]) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]))
    .slice(0, MAX_SHEETS);
  const blocks = [];
  let cellsSeen = 0;
  sheets.forEach(([, xml], sheetIndex) => {
    blocks.push({ kind: "heading", text: `Sheet ${sheetIndex + 1}`, location: { kind: "sheet", index: sheetIndex + 1 } });
    for (const row of xml.matchAll(/<row\b[^>]*r="(\d+)"[\s\S]*?<\/row>/g)) {
      const values = [];
      for (const cell of row[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        cellsSeen += 1;
        if (cellsSeen > MAX_CELLS) break;
        const reference = cell[1].match(/\br="([^"]+)"/)?.[1] ?? "";
        const type = cell[1].match(/\bt="([^"]+)"/)?.[1] ?? "";
        const raw = cell[2].match(/<v>([\s\S]*?)<\/v>/)?.[1]
          ?? cell[2].match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1]
          ?? "";
        const value = type === "s" ? shared[Number(raw)] ?? "" : decodeXml(raw);
        if (value) values.push(`${columnName(reference)}: ${value}`);
      }
      if (values.length) {
        blocks.push({
          kind: "row",
          text: values.join(" | "),
          location: { kind: "sheet_row", sheet: sheetIndex + 1, row: Number(row[1]) },
        });
      }
      if (cellsSeen > MAX_CELLS) break;
    }
  });
  return { ...boundedBlocks(blocks), cellCount: cellsSeen };
}

function parseHtml(buffer) {
  const document = parse(buffer.toString("utf8").slice(0, MAX_INPUT_BYTES));
  const blocks = [];
  const excluded = new Set(["script", "style", "noscript", "svg", "canvas", "template"]);
  const visit = (node, path = "document") => {
    const tag = node.tagName?.toLowerCase();
    if (excluded.has(tag)) return;
    if (node.nodeName === "#text") {
      const text = String(node.value ?? "").replace(/\s+/g, " ").trim();
      if (text) blocks.push({
        kind: /^h[1-6]$/.test(node.parentNode?.tagName ?? "") ? "heading" : "paragraph",
        text,
        location: { kind: "html", path },
      });
      return;
    }
    (node.childNodes ?? []).forEach((child, index) => visit(child, `${path}/${tag ?? node.nodeName}[${index}]`));
  };
  visit(document);
  return boundedBlocks(blocks);
}

async function parsePdf(buffer) {
  let pdfjs;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    throw Object.assign(new Error("PDF parser is not installed on this server."), { code: "document_parser_unavailable" });
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  const document = await task.promise;
  const pageCount = Math.min(document.numPages, MAX_PDF_PAGES);
  const blocks = [];
  let textItems = 0;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => String(item.str ?? "")).join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      textItems += content.items.length;
      blocks.push({ kind: "page", text, location: { kind: "page", index: pageNumber } });
    }
    page.cleanup();
  }
  await task.destroy();
  return {
    ...boundedBlocks(blocks),
    pageCount: document.numPages,
    needsOcr: textItems < Math.max(3, Math.min(pageCount, 10)),
    truncatedPages: document.numPages > MAX_PDF_PAGES,
  };
}

export async function parseWorkflowDocument({
  path,
  extension,
  readMode,
  size,
} = {}) {
  const normalizedExtension = String(extension ?? "").toLowerCase();
  if (readMode !== "supported_text") {
    return { state: "skipped", reason: "metadata_only", parserVersion: WORKFLOW_DOCUMENT_PARSER_VERSION };
  }
  if (Number(size) > MAX_INPUT_BYTES) {
    return { state: "limited", reason: "document_too_large", parserVersion: WORKFLOW_DOCUMENT_PARSER_VERSION };
  }
  if (OCR_IMAGE_EXTENSIONS.has(normalizedExtension)) {
    return {
      state: "needs_ocr",
      parserVersion: WORKFLOW_DOCUMENT_PARSER_VERSION,
      blocks: [],
      characterCount: 0,
      truncated: false,
      pageCount: 1,
      cellCount: null,
      needsOcr: true,
      truncatedPages: false,
    };
  }
  if (![".html", ".htm", ".docx", ".pptx", ".xlsx", ".pdf"].includes(normalizedExtension)) {
    return { state: "skipped", reason: "native_text_or_unsupported", parserVersion: WORKFLOW_DOCUMENT_PARSER_VERSION };
  }
  try {
    const buffer = readBoundedFile(path);
    let result;
    if ([".html", ".htm"].includes(normalizedExtension)) result = parseHtml(buffer);
    else if (normalizedExtension === ".pdf") result = await parsePdf(buffer);
    else {
      const entries = zipEntries(buffer);
      if (normalizedExtension === ".docx") result = parseDocx(entries);
      else if (normalizedExtension === ".pptx") result = parsePptx(entries);
      else result = parseXlsx(entries);
    }
    return {
      state: result.needsOcr ? "needs_ocr" : "ready",
      parserVersion: WORKFLOW_DOCUMENT_PARSER_VERSION,
      blocks: result.blocks,
      characterCount: result.characterCount,
      truncated: result.truncated,
      pageCount: result.pageCount ?? null,
      cellCount: result.cellCount ?? null,
      needsOcr: Boolean(result.needsOcr),
      truncatedPages: Boolean(result.truncatedPages),
    };
  } catch (error) {
    if (error?.code === "document_too_large") {
      return { state: "limited", reason: "document_too_large", parserVersion: WORKFLOW_DOCUMENT_PARSER_VERSION };
    }
    return {
      state: "failed",
      parserVersion: WORKFLOW_DOCUMENT_PARSER_VERSION,
      errorCode: String(error?.code ?? "document_parse_failed").slice(0, 120),
      error: String(error instanceof Error ? error.message : error).slice(0, 500),
    };
  }
}

export function extractionText(extraction) {
  return (extraction?.blocks ?? []).map((block) => {
    if (block.kind === "heading") return `## ${block.text}`;
    return block.text;
  }).join("\n\n").slice(0, MAX_EXTRACTED_CHARS);
}
