import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { extname, isAbsolute, relative, resolve } from "node:path";

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;
const MAX_TEMPLATE_BYTES = 64 * 1_024;
const MAX_DRAFT_BYTES = 128 * 1_024;
const MAX_TEMPLATE_PLACEHOLDERS = 20;
const UNSAFE_MARKDOWN_TEMPLATE_RE =
  /<\/?[a-z][^>]*>|javascript\s*:|on[a-z]+\s*=|!\[[^\]]*\]\(\s*https?:/i;
const PLACEHOLDER_IN_MARKDOWN_DESTINATION_RE =
  /!?\[[^\]]*\]\([^)\r\n]*\{\{/i;
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]{0,119})\s*\}\}/g;

function relativePath(value) {
  const path = String(value ?? "").trim().replaceAll("\\", "/");
  if (!path
    || path.length > 1_000
    || path.startsWith("/")
    || WINDOWS_ABSOLUTE_RE.test(path)
    || path.split("/").includes("..")) {
    return null;
  }
  return path;
}

function safeFilenamePart(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return normalized || "quotation";
}

function containedPath(root, target) {
  const relation = relative(root, target);
  return relation === ""
    || (relation !== ".."
      && !relation.startsWith("../")
      && !relation.startsWith("..\\")
      && !isAbsolute(relation));
}

function currentContainedDirectory(root, requested) {
  const actualRoot = realpathSync(root);
  const requestedPath = resolve(actualRoot, requested || ".");
  if (!containedPath(actualRoot, requestedPath)) {
    throw new Error("routine_output_path_outside_source");
  }
  let actual = actualRoot;
  for (const segment of relative(actualRoot, requestedPath).split(/[\\/]/).filter(Boolean)) {
    const next = resolve(actual, segment);
    if (existsSync(next)) {
      const stats = lstatSync(next);
      if (stats.isSymbolicLink()) throw new Error("routine_output_link_escapes_source");
      if (!stats.isDirectory()) throw new Error("routine_output_directory_invalid");
    } else {
      mkdirSync(next, { mode: 0o700 });
    }
    actual = realpathSync(next);
    if (!containedPath(actualRoot, actual)) {
      throw new Error("routine_output_link_escapes_source");
    }
  }
  return actual;
}

function writeExclusiveFile(target, content) {
  let handle = null;
  let created = false;
  try {
    handle = openSync(
      target,
      fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | fsConstants.O_WRONLY
        | (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    created = true;
    writeFileSync(handle, content, { encoding: "utf8" });
    fsyncSync(handle);
  } catch (error) {
    if (handle != null) {
      closeSync(handle);
      handle = null;
    }
    if (created) {
      try {
        unlinkSync(target);
      } catch {
        // Preserve the original write failure if cleanup also fails.
      }
    }
    throw error;
  } finally {
    if (handle != null) closeSync(handle);
  }
}

function markdownValue(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\r\n|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500)
    .replace(/([\\`*_[\]{}()#+.!-])/g, "\\$1");
}

function sourceRoots(projectPath, sourceRelativePath) {
  const projectRoot = realpathSync(projectPath);
  const sourceRequested = resolve(projectRoot, sourceRelativePath || ".");
  if (!containedPath(projectRoot, sourceRequested)) {
    throw new Error("routine_source_path_outside_project");
  }
  const sourceRoot = realpathSync(sourceRequested);
  if (!containedPath(projectRoot, sourceRoot)) {
    throw new Error("routine_source_link_escapes_project");
  }
  return { projectRoot, sourceRoot };
}

function containedSourceFile(sourceRoot, relativePathValue) {
  const normalized = relativePath(relativePathValue);
  if (!normalized) throw new Error("routine_template_path_invalid");
  const requested = resolve(sourceRoot, normalized);
  if (!containedPath(sourceRoot, requested)) {
    throw new Error("routine_template_path_outside_source");
  }
  const linkStats = lstatSync(requested);
  if (linkStats.isSymbolicLink()) throw new Error("routine_template_link_not_allowed");
  const actual = realpathSync(requested);
  if (!containedPath(sourceRoot, actual)) {
    throw new Error("routine_template_link_escapes_source");
  }
  const stats = statSync(actual);
  if (!stats.isFile()) throw new Error("routine_template_not_file");
  return { actual, normalized, stats };
}

function artifactFingerprint(relativePathValue, stats, content, readMode) {
  return createHash("sha256")
    .update(`${relativePathValue}\0${stats.size}\0${Math.trunc(stats.mtimeMs)}\0`)
    .update(readMode === "supported_text" ? content : "")
    .digest("hex");
}

export function inspectLocalQuotationTemplate({
  projectPath,
  sourceRelativePath = "",
  templateRelativePath,
  expectedFingerprint = null,
  sourceReadMode = "supported_text",
} = {}) {
  try {
    const { sourceRoot } = sourceRoots(projectPath, sourceRelativePath);
    const template = containedSourceFile(sourceRoot, templateRelativePath);
    const extension = extname(template.normalized).toLowerCase();
    if (![".md", ".docx", ".xlsx"].includes(extension)) {
      return { ok: false, error: "routine_template_format_not_supported" };
    }
    if (extension !== ".md") {
      return {
        ok: false,
        error: "routine_template_preservation_unavailable",
        format: extension.slice(1),
      };
    }
    if (sourceReadMode !== "supported_text") {
      return { ok: false, error: "routine_template_content_access_not_authorized" };
    }
    if (template.stats.size > MAX_TEMPLATE_BYTES) {
      return { ok: false, error: "routine_template_too_large" };
    }
    const content = readFileSync(template.actual, "utf8");
    const currentFingerprint = artifactFingerprint(
      template.normalized,
      template.stats,
      content,
      sourceReadMode,
    );
    if (expectedFingerprint && currentFingerprint !== expectedFingerprint) {
      return { ok: false, error: "routine_template_drifted" };
    }
    if (!content.trim()
      || content.includes("\0")
      || UNSAFE_MARKDOWN_TEMPLATE_RE.test(content)
      || PLACEHOLDER_IN_MARKDOWN_DESTINATION_RE.test(content)) {
      return { ok: false, error: "routine_template_content_unsafe" };
    }
    const placeholderKeys = [...new Set(
      [...content.matchAll(PLACEHOLDER_RE)].map((match) => match[1]),
    )];
    if (!placeholderKeys.length) {
      return { ok: false, error: "routine_template_placeholders_required" };
    }
    if (placeholderKeys.length > MAX_TEMPLATE_PLACEHOLDERS) {
      return { ok: false, error: "routine_template_placeholders_too_many" };
    }
    return {
      ok: true,
      format: "markdown",
      content,
      placeholderKeys,
      fingerprint: currentFingerprint,
      templateRelativePath: template.normalized,
    };
  } catch (error) {
    const code = String(error?.message ?? "");
    if (code.startsWith("routine_")) return { ok: false, error: code };
    return { ok: false, error: "routine_template_read_failed" };
  }
}

export function quotationDraftRelativePath({
  sourceRelativePath = "",
  outputDirectory = "outputs/quotations",
  businessKey,
  routineVersion,
  executionSuffix,
  draftRevision = null,
} = {}) {
  const normalizedOutputDirectory = relativePath(outputDirectory);
  const normalizedSource = sourceRelativePath && sourceRelativePath !== "."
    ? relativePath(sourceRelativePath)
    : "";
  if (!normalizedOutputDirectory || (sourceRelativePath && !normalizedSource)) return null;
  const slug = safeFilenamePart(businessKey);
  const suffix = /^[a-f0-9]{8}$/.test(String(executionSuffix ?? ""))
    ? executionSuffix
    : "execution";
  const version = Math.max(1, Number.parseInt(routineVersion, 10) || 1);
  const revision = draftRevision == null
    ? null
    : Math.max(1, Number.parseInt(draftRevision, 10) || 1);
  return [normalizedSource, normalizedOutputDirectory,
    `quotation-${slug}-r${version}${revision ? `-d${revision}` : ""}-${suffix}.md`]
    .filter(Boolean)
    .join("/");
}

export function writeLocalQuotationDraft({
  projectPath,
  sourceRelativePath = "",
  outputDirectory = "outputs/quotations",
  businessKey,
  routineVersion,
  executionSuffix,
  draftRevision = null,
  fields = {},
  evidencePaths = [],
  templateRelativePath = null,
  templateFingerprint = null,
  sourceReadMode = "supported_text",
} = {}) {
  const normalizedOutputDirectory = relativePath(outputDirectory);
  if (!normalizedOutputDirectory) {
    return { ok: false, error: "routine_output_directory_invalid" };
  }
  try {
    const { projectRoot, sourceRoot } = sourceRoots(projectPath, sourceRelativePath);
    const outputRoot = currentContainedDirectory(sourceRoot, normalizedOutputDirectory);
    const plannedRelativePath = quotationDraftRelativePath({
      sourceRelativePath,
      outputDirectory,
      businessKey,
      routineVersion,
      executionSuffix,
      draftRevision,
    });
    const filename = plannedRelativePath?.split("/").at(-1);
    if (!filename) return { ok: false, error: "routine_output_directory_invalid" };
    const target = resolve(outputRoot, filename);
    if (!containedPath(outputRoot, target)) {
      return { ok: false, error: "routine_output_path_outside_source" };
    }
    const fieldOrder = [
      "inquiry_number",
      "customer",
      "product",
      "quantity",
      "currency",
      "amount",
      "document_date",
    ];
    const rows = fieldOrder
      .filter((key) => fields[key] != null && markdownValue(fields[key]))
      .map((key) => `| ${key.replaceAll("_", " ")} | ${markdownValue(fields[key])} |`);
    const boundedEvidence = evidencePaths
      .map(markdownValue)
      .filter(Boolean)
      .slice(0, 20);
    let body;
    if (templateRelativePath) {
      const template = inspectLocalQuotationTemplate({
        projectPath,
        sourceRelativePath,
        templateRelativePath,
        expectedFingerprint: templateFingerprint,
        sourceReadMode,
      });
      if (!template.ok) return template;
      const missingPlaceholders = template.placeholderKeys.filter((key) =>
        fields[key] == null || !markdownValue(fields[key]));
      if (missingPlaceholders.length) {
        return {
          ok: false,
          error: "routine_template_values_missing",
          missingFields: missingPlaceholders.slice(0, 20),
        };
      }
      body = template.content.replace(PLACEHOLDER_RE, (_match, key) => markdownValue(fields[key]));
    } else {
      body = [
        "# Quotation Draft",
        "",
        "| Field | Value |",
        "| --- | --- |",
        ...rows,
      ].join("\n");
    }
    const content = [
      "> Draft only — review and approval are required before registration or delivery.",
      "",
      body.trim(),
      "",
      "## Source evidence",
      "",
      ...boundedEvidence.map((path) => `- ${path}`),
      "",
    ].join("\n");
    if (Buffer.byteLength(content, "utf8") > MAX_DRAFT_BYTES) {
      return { ok: false, error: "routine_output_too_large" };
    }
    if (existsSync(target)) {
      const linkStats = lstatSync(target);
      const stats = statSync(target);
      const actualTarget = realpathSync(target);
      if (linkStats.isSymbolicLink() || !stats.isFile() || !containedPath(outputRoot, actualTarget)) {
        return { ok: false, error: "routine_output_conflict" };
      }
      if (readFileSync(target, "utf8") !== content) {
        return { ok: false, error: "routine_output_conflict" };
      }
    } else {
      writeExclusiveFile(target, content);
    }
    return {
      ok: true,
      relativePath: relative(projectRoot, target).replaceAll("\\", "/"),
      preview: content.slice(0, 8_000),
    };
  } catch (error) {
    const code = String(error?.message ?? "");
    if (code.startsWith("routine_")) return { ok: false, error: code };
    if (error?.code === "EEXIST") return { ok: false, error: "routine_output_conflict" };
    return { ok: false, error: "routine_output_write_failed" };
  }
}
