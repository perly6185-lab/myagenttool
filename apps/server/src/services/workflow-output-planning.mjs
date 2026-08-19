import { existsSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

function outputPlanningError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function pathSegments(value) {
  return String(value ?? "").replaceAll("\\", "/").split("/").filter(Boolean);
}

export function commonPathPrefix(values) {
  if (!values.length) return "";
  const segments = values.map(pathSegments);
  const prefix = [];
  for (let index = 0; index < Math.min(...segments.map((items) => items.length)); index += 1) {
    const value = segments[0][index];
    if (!segments.every((items) => items[index] === value)) break;
    prefix.push(value);
  }
  return prefix.join("/");
}

export function joinRelative(...parts) {
  return parts
    .map((part) => String(part ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

export function safeOutputPath(value) {
  const normalized = String(value ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (
    !normalized
    || normalized.length > 1_000
    || isAbsolute(normalized)
    || normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw outputPlanningError("invalid_workflow_output_path", "A planned output path escapes the selected project.");
  }
  return normalized;
}

function safeStem(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-\s]+|[.\-\s]+$/g, "")
    .slice(0, 120) || "delivery";
}

export function plannedOutputsFor({ source, artifact, profile }) {
  const requirementStem = safeStem(basename(artifact.relativePath, extname(artifact.relativePath)));
  const requirementDirectory = dirname(artifact.relativePath) === "." ? "" : dirname(artifact.relativePath);
  const template = String(profile.outcomeSpec?.pathTemplate ?? "{requirement-directory}/delivery/{requirement-stem}")
    .replaceAll("{requirement-stem}", requirementStem)
    .replaceAll("{requirement-directory}", requirementDirectory);
  if (template.includes("{") || template.includes("}")) {
    throw outputPlanningError("invalid_workflow_output_path", "The output path template contains an unresolved token.");
  }
  const directory = safeOutputPath(joinRelative(source.relativePath, template));
  const outputs = [];
  for (const [index, spec] of (profile.outcomeSpec?.outputs ?? []).entries()) {
    const extension = String(spec.extension ?? "").toLowerCase().replace(/^\./, "");
    if (!/^[a-z0-9]{1,12}$/.test(extension)) {
      throw outputPlanningError("invalid_workflow_output_extension", "A workflow output extension is invalid.");
    }
    const suffix = spec.family && spec.family !== "document"
      ? `-${safeStem(spec.family)}`
      : index ? `-${index + 1}` : "";
    outputs.push({
      role: spec.role ?? "delivery",
      family: spec.family ?? "unknown",
      extension,
      relativePath: safeOutputPath(`${directory}/${requirementStem}${suffix}.${extension}`),
      minimumCount: Math.max(1, Math.min(20, Number(spec.minimumCount) || 1)),
    });
  }
  return outputs;
}

export function reserveOutputPaths(projectPath, outputs) {
  const root = realpathSync(resolve(projectPath));
  const conflicts = [];
  const planned = [];
  for (const output of outputs) {
    const target = resolve(root, output.relativePath);
    const lexical = relative(root, target);
    if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
      throw outputPlanningError(
        "invalid_workflow_output_path",
        "A planned output path escapes the selected project.",
      );
    }
    if (existsSync(target)) {
      conflicts.push(output.relativePath);
      continue;
    }
    let existingParent = dirname(target);
    while (!existsSync(existingParent) && existingParent !== root) {
      existingParent = dirname(existingParent);
    }
    const realParent = realpathSync(existingParent);
    const parentRelative = relative(root, realParent);
    if (
      parentRelative === ".."
      || parentRelative.startsWith(`..${sep}`)
      || isAbsolute(parentRelative)
    ) {
      throw outputPlanningError(
        "invalid_workflow_output_path",
        "A planned output parent resolves outside the selected project.",
      );
    }
    planned.push({ ...output, existedAtPlanning: false });
  }
  if (conflicts.length) {
    const error = outputPlanningError(
      "workflow_output_path_conflict",
      "One or more planned output files already exist.",
      409,
    );
    error.conflicts = conflicts;
    throw error;
  }
  return planned;
}
