import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const MAX_PDF_BYTES = 100 * 1024 * 1024;

export class PdfDocumentReadError extends Error {
  constructor(code, message) { super(message); this.name = "PdfDocumentReadError"; this.code = code; }
}

export function readProjectPdf({ projectPath, relativeFile, range = null }) {
  const requested = String(relativeFile ?? "");
  if (!requested || requested.includes("\0") || !/\.pdf$/i.test(requested)) {
    throw new PdfDocumentReadError("invalid_pdf_path", "PDF path must be a relative .pdf file.");
  }
  const root = realpathSync(resolve(projectPath));
  const candidate = resolve(root, requested);
  assertContained(root, candidate);
  let realFile;
  try {
    if (lstatSync(candidate).isSymbolicLink()) throw new PdfDocumentReadError("symlink_refused", "Symbolic-link PDFs are not available for preview.");
    realFile = realpathSync(candidate);
  } catch (error) {
    if (error instanceof PdfDocumentReadError) throw error;
    throw new PdfDocumentReadError("not_found", "PDF file was not found.");
  }
  assertContained(root, realFile);
  let descriptor;
  try {
    descriptor = openSync(realFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new PdfDocumentReadError("not_regular_file", "PDF path is not a regular file.");
    if (stat.size > MAX_PDF_BYTES) throw new PdfDocumentReadError("pdf_too_large", "PDF exceeds the 100 MB preview limit.");
    const signature = Buffer.alloc(Math.min(5, stat.size));
    readSync(descriptor, signature, 0, signature.length, 0);
    if (signature.length < 5 || signature.toString("ascii") !== "%PDF-") {
      throw new PdfDocumentReadError("invalid_pdf", "File does not have a PDF signature.");
    }
    if (!range) return { bytes: readFileSync(descriptor), size: stat.size, start: 0, end: stat.size - 1 };
    const parsed = resolvePdfByteRange(range, stat.size);
    const bytes = Buffer.alloc(parsed.end - parsed.start + 1);
    readSync(descriptor, bytes, 0, bytes.length, parsed.start);
    return { bytes, size: stat.size, ...parsed };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function resolvePdfByteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? "").trim());
  if (!match || size < 1) throw new PdfDocumentReadError("invalid_range", "PDF byte range is invalid.");
  let start; let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw new PdfDocumentReadError("invalid_range", "PDF byte range is invalid.");
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new PdfDocumentReadError("range_not_satisfiable", "PDF byte range is outside the file.");
  return { start, end: Math.min(end, size - 1) };
}

function assertContained(root, target) {
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new PdfDocumentReadError("path_outside_project", "PDF path is outside the selected project or worktree.");
  }
}
