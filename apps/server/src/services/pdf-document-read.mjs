import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const MAX_PDF_BYTES = 100 * 1024 * 1024;

export class PdfDocumentReadError extends Error {
  constructor(code, message) { super(message); this.name = "PdfDocumentReadError"; this.code = code; }
}

export function readProjectPdf({ projectPath, relativeFile }) {
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
    const bytes = readFileSync(descriptor);
    if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new PdfDocumentReadError("invalid_pdf", "File does not have a PDF signature.");
    }
    return { bytes, size: bytes.length };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertContained(root, target) {
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new PdfDocumentReadError("path_outside_project", "PDF path is outside the selected project or worktree.");
  }
}
