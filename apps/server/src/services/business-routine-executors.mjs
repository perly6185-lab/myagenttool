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
import { isAbsolute, relative, resolve } from "node:path";

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

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
    .replace(/[\r\n|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function writeLocalQuotationDraft({
  projectPath,
  sourceRelativePath = "",
  outputDirectory = "outputs/quotations",
  businessKey,
  routineVersion,
  executionSuffix,
  fields = {},
  evidencePaths = [],
} = {}) {
  const normalizedOutputDirectory = relativePath(outputDirectory);
  if (!normalizedOutputDirectory) {
    return { ok: false, error: "routine_output_directory_invalid" };
  }
  try {
    const projectRoot = realpathSync(projectPath);
    const sourceRequested = resolve(projectRoot, sourceRelativePath || ".");
    if (!containedPath(projectRoot, sourceRequested)) {
      return { ok: false, error: "routine_source_path_outside_project" };
    }
    const sourceRoot = realpathSync(sourceRequested);
    if (!containedPath(projectRoot, sourceRoot)) {
      return { ok: false, error: "routine_source_link_escapes_project" };
    }
    const outputRoot = currentContainedDirectory(sourceRoot, normalizedOutputDirectory);
    const slug = safeFilenamePart(businessKey);
    const suffix = /^[a-f0-9]{8}$/.test(String(executionSuffix ?? ""))
      ? executionSuffix
      : "execution";
    const version = Math.max(1, Number.parseInt(routineVersion, 10) || 1);
    const filename = `quotation-${slug}-r${version}-${suffix}.md`;
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
    const content = [
      "# Quotation Draft",
      "",
      "> Draft only — review and approval are required before registration or delivery.",
      "",
      "| Field | Value |",
      "| --- | --- |",
      ...rows,
      "",
      "## Source evidence",
      "",
      ...boundedEvidence.map((path) => `- ${path}`),
      "",
    ].join("\n").slice(0, 32_000);
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
    };
  } catch (error) {
    const code = String(error?.message ?? "");
    if (code.startsWith("routine_")) return { ok: false, error: code };
    if (error?.code === "EEXIST") return { ok: false, error: "routine_output_conflict" };
    return { ok: false, error: "routine_output_write_failed" };
  }
}
