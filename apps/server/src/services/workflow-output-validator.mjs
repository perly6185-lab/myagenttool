import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  extractionText,
  parseWorkflowDocument,
} from "./workflow-document-parser.mjs";

export const WORKFLOW_OUTPUT_VALIDATOR_VERSION = 2;
const MAX_VALIDATION_BYTES = 512 * 1024;
const DOCUMENT_EXTENSIONS = new Set(["html", "htm", "docx", "pptx", "xlsx", "pdf"]);
const SIGNATURE_EXTENSIONS = new Set(["pdf", "docx", "pptx", "xlsx", "png", "jpg", "jpeg", "gif"]);

export function workflowOutputRulesFor(extension) {
  const normalized = String(extension ?? "").toLowerCase().replace(/^\./, "");
  const rules = ["file_nonempty"];
  if (SIGNATURE_EXTENSIONS.has(normalized)) rules.push("file_signature");
  if (DOCUMENT_EXTENSIONS.has(normalized)) rules.push("document_parse");
  if (normalized === "json") rules.push("json_syntax");
  if (["yaml", "yml"].includes(normalized)) rules.push("yaml_syntax");
  if (normalized === "csv") rules.push("csv_header");
  if (["md", "mdx"].includes(normalized)) rules.push("local_attachments");
  return rules;
}

export function workflowOutputCriterion(rule, {
  relativePath = "",
  target = "",
} = {}) {
  const criteria = {
    file_nonempty: `Output is not empty: ${relativePath}`,
    file_signature: `Output matches its planned format: ${relativePath}`,
    document_parse: `Output document is parseable: ${relativePath}`,
    json_syntax: `Output contains valid JSON: ${relativePath}`,
    yaml_syntax: `Output contains valid YAML: ${relativePath}`,
    csv_header: `Output CSV contains a header row: ${relativePath}`,
    local_attachment: `Local attachment exists: ${target}`,
    local_attachments: `All local attachments exist: ${relativePath}`,
  };
  return criteria[rule] ?? rule;
}

function result({
  rule,
  criterion,
  severity = "blocker",
  status,
  file,
  expected,
  actual,
  note,
  evidence = null,
}) {
  const resolvedCriterion = criterion ?? workflowOutputCriterion(rule, { relativePath: file });
  return {
    id: `${rule}:${file}:${resolvedCriterion}`,
    validatorVersion: WORKFLOW_OUTPUT_VALIDATOR_VERSION,
    rule,
    criterion: resolvedCriterion,
    severity,
    status,
    file,
    expected,
    actual,
    evidence,
  };
}

function signatureMatches(extension, buffer) {
  if (extension === "pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if (["docx", "pptx", "xlsx"].includes(extension)) {
    return buffer[0] === 0x50 && buffer[1] === 0x4b;
  }
  if (extension === "png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (["jpg", "jpeg"].includes(extension)) return buffer[0] === 0xff && buffer[1] === 0xd8;
  if (extension === "gif") return buffer.subarray(0, 3).toString() === "GIF";
  return true;
}

function markdownAttachments(text) {
  return [...text.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, "").slice(0, 2_048))
    .filter((target) =>
      target && !target.startsWith("#") && !/^(?:https?:|mailto:|data:)/i.test(target));
}

function localAttachmentExists(root, outputPath, target) {
  try {
    const resolved = resolve(
      dirname(realpathSync(outputPath)),
      decodeURIComponent(target.split("#")[0]),
    );
    const lexical = relative(root, resolved);
    if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) return false;
    const real = realpathSync(resolved);
    const confined = relative(root, real);
    return !(confined === ".." || confined.startsWith(`..${sep}`) || isAbsolute(confined))
      && statSync(real).isFile();
  } catch {
    return false;
  }
}

function csvHeaders(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const headers = firstLine.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
  return headers.filter(Boolean);
}

function readPrefix(path, size) {
  const length = Math.min(size, MAX_VALIDATION_BYTES);
  if (!length) return Buffer.alloc(0);
  const buffer = Buffer.alloc(length);
  const descriptor = openSync(path, "r");
  try {
    const bytesRead = readSync(descriptor, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

export async function validateWorkflowOutputFile({
  path,
  relativePath,
  extension,
  projectRoot,
} = {}) {
  const normalizedExtension = String(extension ?? "").toLowerCase().replace(/^\./, "");
  const stat = statSync(path);
  const bounded = readPrefix(path, stat.size);
  const matchedSignature = signatureMatches(normalizedExtension, bounded);
  const results = [
    result({
      rule: "file_nonempty",
      status: stat.size > 0 ? "passed" : "failed",
      file: relativePath,
      expected: { minimumBytes: 1 },
      actual: { bytes: stat.size },
      note: stat.size > 0 ? "Output file is not empty." : "Output file is empty.",
    }),
  ];
  if (SIGNATURE_EXTENSIONS.has(normalizedExtension)) {
    results.push(result({
      rule: "file_signature",
      status: matchedSignature ? "passed" : "failed",
      file: relativePath,
      expected: { extension: normalizedExtension },
      actual: { signatureMatched: matchedSignature },
      note: matchedSignature
        ? "File signature matches the planned format."
        : "File content does not match the planned extension.",
    }));
  }
  const headings = new Set();
  const fields = new Set();
  let text = "";

  if (["md", "mdx", "txt", "json", "yaml", "yml", "csv"].includes(normalizedExtension)) {
    text = bounded.toString("utf8");
  } else if (DOCUMENT_EXTENSIONS.has(normalizedExtension)) {
    const extraction = await parseWorkflowDocument({
      path,
      extension: `.${normalizedExtension}`,
      readMode: "supported_text",
      size: stat.size,
    });
    if (extraction.state === "failed") {
      results.push(result({
        rule: "document_parse",
        status: "failed",
        file: relativePath,
        expected: { state: "ready" },
        actual: { state: extraction.state, errorCode: extraction.errorCode ?? null },
        note: "The output document could not be parsed.",
      }));
    } else if (["needs_ocr", "limited"].includes(extraction.state)) {
      results.push(result({
        rule: "document_parse",
        severity: "warning",
        status: "warning",
        file: relativePath,
        expected: { state: "ready" },
        actual: { state: extraction.state },
        note: extraction.state === "needs_ocr"
          ? "The PDF appears scanned; content checks are incomplete."
          : "Document parsing reached a safety limit.",
      }));
    } else {
      results.push(result({
        rule: "document_parse",
        status: "passed",
        file: relativePath,
        expected: { state: "ready" },
        actual: {
          state: extraction.state,
          pageCount: extraction.pageCount ?? null,
          cellCount: extraction.cellCount ?? null,
        },
        note: "The output document was parsed successfully.",
      }));
    }
    text = extractionText(extraction);
  }

  for (const match of text.matchAll(/^(?:#{1,6}\s+|(?:section|章节)[:：]\s*)(.+)$/gim)) {
    headings.add(match[1].trim().toLowerCase());
  }
  if (["md", "mdx", "txt", ...DOCUMENT_EXTENSIONS].includes(normalizedExtension)) {
    for (const match of text.matchAll(/^([^#\n:：]{1,80})[:：]\s*.+$/gm)) {
      fields.add(match[1].trim().toLowerCase());
    }
  }

  if (normalizedExtension === "json") {
    try {
      const parsed = JSON.parse(text);
      Object.keys(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {})
        .forEach((key) => fields.add(key.toLowerCase()));
      results.push(result({
        rule: "json_syntax",
        status: "passed",
        file: relativePath,
        expected: { parseable: true },
        actual: { parseable: true },
        note: "JSON is valid.",
      }));
    } catch {
      results.push(result({
        rule: "json_syntax",
        status: "failed",
        file: relativePath,
        expected: { parseable: true },
        actual: { parseable: false },
        note: "JSON is invalid.",
      }));
    }
  }
  if (["yaml", "yml"].includes(normalizedExtension)) {
    try {
      const parsed = parseYaml(text);
      Object.keys(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {})
        .forEach((key) => fields.add(key.toLowerCase()));
      results.push(result({
        rule: "yaml_syntax",
        status: "passed",
        file: relativePath,
        expected: { parseable: true },
        actual: { parseable: true },
        note: "YAML is valid.",
      }));
    } catch {
      results.push(result({
        rule: "yaml_syntax",
        status: "failed",
        file: relativePath,
        expected: { parseable: true },
        actual: { parseable: false },
        note: "YAML is invalid.",
      }));
    }
  }
  if (normalizedExtension === "csv") {
    const headers = csvHeaders(text);
    headers.forEach((header) => fields.add(header.toLowerCase()));
    results.push(result({
      rule: "csv_header",
      status: headers.length ? "passed" : "failed",
      file: relativePath,
      expected: { minimumColumns: 1 },
      actual: { columns: headers.length, headers: headers.slice(0, 50) },
      note: headers.length ? "CSV contains a header row." : "CSV header row is missing.",
    }));
  }
  if (["md", "mdx"].includes(normalizedExtension)) {
    const confinedRoot = realpathSync(projectRoot);
    const attachments = markdownAttachments(text).slice(0, 100);
    let allAttachmentsExist = true;
    for (const attachment of attachments) {
      const exists = localAttachmentExists(confinedRoot, path, attachment);
      allAttachmentsExist &&= exists;
      results.push(result({
        rule: "local_attachment",
        criterion: workflowOutputCriterion("local_attachment", { target: attachment }),
        status: exists ? "passed" : "failed",
        file: relativePath,
        expected: { exists: true, target: attachment },
        actual: { exists },
        note: exists ? `Local attachment exists: ${attachment}` : `Local attachment is missing: ${attachment}`,
        evidence: { kind: "markdown_link", target: attachment },
      }));
    }
    results.push(result({
      rule: "local_attachments",
      status: allAttachmentsExist ? "passed" : "failed",
      file: relativePath,
      expected: { allExist: true, checked: attachments.length },
      actual: {
        allExist: allAttachmentsExist,
        missing: results.filter((item) =>
          item.rule === "local_attachment" && item.status === "failed").length,
      },
      note: allAttachmentsExist
        ? "Every local Markdown attachment exists inside the project."
        : "One or more local Markdown attachments are missing or outside the project.",
    }));
  }
  return {
    results,
    headings: [...headings],
    fields: [...fields],
    stats: {
      bytes: stat.size,
      sha256: await sha256File(path),
      modifiedAt: stat.mtime.toISOString(),
    },
  };
}
