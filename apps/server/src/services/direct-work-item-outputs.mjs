import { existsSync, readdirSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { describeProjectAsset } from "./asset-capabilities.mjs";

const MAX_DIRECT_OUTPUT_FILES = 100;
const MAX_DIRECT_OUTPUT_DEPTH = 6;

function safeSegment(value, fallback) {
  return String(value ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || fallback;
}

function cleanRelativePath(value) {
  const path = String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.split("/").includes("..") || path.length > 1_000) return null;
  return path;
}

export function directWorkItemOutputDirectory(item) {
  return `outputs/tasks/${safeSegment(item?.id, "task")}/revision-${Math.max(1, Number(item?.revision) || 1)}`;
}

export function discoverDirectWorkItemOutputs({ state, item, outputDirectory = null } = {}) {
  const project = (state?.projects ?? []).find((candidate) => candidate.id === item?.projectId) ?? null;
  const relativeRoot = cleanRelativePath(outputDirectory ?? directWorkItemOutputDirectory(item));
  if (!project?.path || !item?.terminalId || !relativeRoot) return [];
  let projectRoot;
  let candidateRoot;
  let actualRoot;
  try {
    projectRoot = realpathSync(resolve(project.path));
    candidateRoot = resolve(projectRoot, relativeRoot);
    if (!existsSync(candidateRoot)) return [];
    actualRoot = realpathSync(candidateRoot);
  } catch {
    return [];
  }
  if (!(actualRoot === projectRoot || actualRoot.startsWith(`${projectRoot}${sep}`))) return [];

  const paths = [];
  const visit = (directory, depth) => {
    if (depth > MAX_DIRECT_OUTPUT_DEPTH || paths.length >= MAX_DIRECT_OUTPUT_FILES) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (paths.length >= MAX_DIRECT_OUTPUT_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const target = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(target, depth + 1);
      else if (entry.isFile()) {
        const path = relative(projectRoot, target).split(sep).join("/");
        if (cleanRelativePath(path)) paths.push(path);
      }
    }
  };
  visit(actualRoot, 0);

  return paths.sort().flatMap((path) => {
    try {
      const asset = describeProjectAsset({
        projectId: item.projectId,
        projectRoot,
        relativePath: path,
        terminalId: item.terminalId,
      });
      return [{ ...asset, originalName: asset.name }];
    } catch {
      return [];
    }
  });
}
