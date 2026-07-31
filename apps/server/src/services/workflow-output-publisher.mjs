import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  createReadStream,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
  unlinkSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export const WORKFLOW_PUBLICATION_VERSION = 1;
const MAX_PUBLICATION_FILES = 100;

function publicationError(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, detail });
}

function confinedRelativePath(value) {
  const raw = String(value ?? "").replaceAll("\\", "/");
  const parts = raw.split("/");
  if (
    !raw
    || raw.includes("\0")
    || isAbsolute(raw)
    || raw.startsWith("/")
    || /^[a-zA-Z]:\//.test(raw)
    || parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw publicationError("workflow_publication_path_invalid", "Publication path is invalid.");
  }
  return parts.join("/");
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function ensureNoSymlinkComponents(root, relativePath, { allowMissing = false } = {}) {
  if (!relativePath || relativePath === ".") return;
  const parts = confinedRelativePath(relativePath).split("/").filter(Boolean);
  let cursor = root;
  for (const [index, part] of parts.entries()) {
    cursor = join(cursor, part);
    const stat = lstatOrNull(cursor);
    if (!stat) {
      if (allowMissing) return;
      throw publicationError(
        "workflow_publication_source_missing",
        "Publication source is missing.",
        { relativePath },
      );
    }
    if (stat.isSymbolicLink()) {
      throw publicationError(
        "workflow_publication_symlink_forbidden",
        "Publication paths cannot contain symbolic links.",
        { relativePath, component: parts.slice(0, index + 1).join("/") },
      );
    }
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw publicationError(
        "workflow_publication_path_invalid",
        "A publication path component is not a directory.",
        { relativePath, component: parts.slice(0, index + 1).join("/") },
      );
    }
  }
}

function confinedRoot(path) {
  return realpathSync(resolve(path));
}

function pathInside(root, relativePath) {
  const normalized = confinedRelativePath(relativePath);
  const target = resolve(root, normalized);
  const lexical = relative(root, target);
  if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
    throw publicationError("workflow_publication_path_invalid", "Publication path escapes its root.");
  }
  return { normalized, target };
}

export async function sha256WorkflowFile(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

export async function buildWorkflowPublicationPreview({
  sourceRoot,
  targetRoot,
  outputs,
} = {}) {
  if (!Array.isArray(outputs) || !outputs.length || outputs.length > MAX_PUBLICATION_FILES) {
    throw publicationError(
      "workflow_publication_outputs_invalid",
      "Publication outputs must contain between 1 and 100 files.",
    );
  }
  const source = confinedRoot(sourceRoot);
  const target = confinedRoot(targetRoot);
  const seen = new Set();
  const files = [];
  for (const output of outputs) {
    const relativePath = confinedRelativePath(output?.relativePath);
    if (seen.has(relativePath)) {
      throw publicationError(
        "workflow_publication_outputs_invalid",
        "Publication contains duplicate target paths.",
        { relativePath },
      );
    }
    seen.add(relativePath);
    const sourcePath = pathInside(source, relativePath).target;
    ensureNoSymlinkComponents(source, relativePath);
    const sourceStat = statSync(sourcePath);
    if (!sourceStat.isFile()) {
      throw publicationError(
        "workflow_publication_source_invalid",
        "Publication source is not a regular file.",
        { relativePath },
      );
    }
    const targetPath = pathInside(target, relativePath).target;
    ensureNoSymlinkComponents(target, dirname(relativePath), { allowMissing: true });
    const targetStat = lstatOrNull(targetPath);
    files.push({
      relativePath,
      extension: String(output?.extension ?? "").replace(/^\./, "").toLowerCase(),
      bytes: sourceStat.size,
      sha256: await sha256WorkflowFile(sourcePath),
      sourceModifiedAt: sourceStat.mtime.toISOString(),
      targetState: targetStat ? "conflict" : "available",
      conflictType: targetStat
        ? targetStat.isSymbolicLink() ? "symlink" : targetStat.isDirectory() ? "directory" : "file"
        : null,
    });
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(files.map((file) => ({
      relativePath: file.relativePath,
      extension: file.extension,
      bytes: file.bytes,
      sha256: file.sha256,
      targetState: file.targetState,
      conflictType: file.conflictType,
    }))))
    .digest("hex");
  return {
    version: WORKFLOW_PUBLICATION_VERSION,
    digest,
    files,
    conflictCount: files.filter((file) => file.targetState === "conflict").length,
  };
}

function removeIfSameInode(path, expected) {
  try {
    const stat = lstatSync(path);
    if (stat.dev === expected.dev && stat.ino === expected.ino) unlinkSync(path);
  } catch {
    // Recovery is best effort and never removes an inode we did not create.
  }
}

function syncFile(path) {
  // Windows requires a writable handle for FlushFileBuffers; a read-only
  // descriptor can fail with EPERM even though the staged file is writable.
  const descriptor = openSync(path, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export async function publishWorkflowOutputFiles({
  sourceRoot,
  targetRoot,
  preview,
  previewId,
  resume = false,
} = {}) {
  if (
    !preview
    || preview.version !== WORKFLOW_PUBLICATION_VERSION
    || !Array.isArray(preview.files)
    || !preview.files.length
    || preview.files.length > MAX_PUBLICATION_FILES
  ) {
    throw publicationError("workflow_publication_preview_invalid", "Publication preview is invalid.");
  }
  const source = confinedRoot(sourceRoot);
  const target = confinedRoot(targetRoot);
  const staged = [];
  const linked = [];
  try {
    for (const [index, file] of preview.files.entries()) {
      const relativePath = confinedRelativePath(file.relativePath);
      const sourcePath = pathInside(source, relativePath).target;
      ensureNoSymlinkComponents(source, relativePath);
      const sourceStat = statSync(sourcePath);
      if (!sourceStat.isFile()) {
        throw publicationError(
          "workflow_publication_source_invalid",
          "Publication source is not a regular file.",
          { relativePath },
        );
      }
      const sourceHash = await sha256WorkflowFile(sourcePath);
      if (sourceStat.size !== file.bytes || sourceHash !== file.sha256) {
        throw publicationError(
          "workflow_publication_source_changed",
          "A source output changed after publication preview.",
          { relativePath },
        );
      }
      const targetPath = pathInside(target, relativePath).target;
      const parent = dirname(targetPath);
      ensureNoSymlinkComponents(target, dirname(relativePath), { allowMissing: true });
      mkdirSync(parent, { recursive: true });
      ensureNoSymlinkComponents(target, dirname(relativePath));
      const existingTarget = lstatOrNull(targetPath);
      if (existingTarget && resume && existingTarget.isFile() && !existingTarget.isSymbolicLink()) {
        const existingHash = await sha256WorkflowFile(targetPath);
        if (existingTarget.size === file.bytes && existingHash === file.sha256) continue;
      }
      if (existingTarget) {
        throw publicationError(
          "workflow_publication_target_conflict",
          "A target path became occupied after publication preview.",
          { relativePath },
        );
      }
      const safePreview = String(previewId ?? "preview").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
      const stagingPath = join(
        parent,
        `.${basename(targetPath)}.myagenttool-${safePreview}-${index}.tmp`,
      );
      const existingStaging = lstatOrNull(stagingPath);
      if (existingStaging) {
        if (!resume || !existingStaging.isFile() || existingStaging.isSymbolicLink()) {
          throw publicationError(
            "workflow_publication_staging_conflict",
            "A publication staging path is unexpectedly occupied.",
            { relativePath },
          );
        }
      } else {
        copyFileSync(sourcePath, stagingPath, constants.COPYFILE_EXCL);
        syncFile(stagingPath);
      }
      const stagingHash = await sha256WorkflowFile(stagingPath);
      const stagingStat = lstatSync(stagingPath);
      if (stagingStat.size !== file.bytes || stagingHash !== file.sha256) {
        throw publicationError(
          "workflow_publication_staging_mismatch",
          "A staged output did not match its preview.",
          { relativePath },
        );
      }
      staged.push({
        relativePath,
        targetPath,
        stagingPath,
        inode: stagingStat,
      });
    }
    for (const file of staged) {
      linkSync(file.stagingPath, file.targetPath);
      linked.push(file);
    }
    for (const file of staged) unlinkSync(file.stagingPath);
    return {
      version: WORKFLOW_PUBLICATION_VERSION,
      files: preview.files.map((file) => ({
        relativePath: file.relativePath,
        bytes: file.bytes,
        sha256: file.sha256,
      })),
    };
  } catch (error) {
    for (const file of [...linked].reverse()) removeIfSameInode(file.targetPath, file.inode);
    for (const file of staged) removeIfSameInode(file.stagingPath, file.inode);
    throw error;
  }
}
