import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { loopRunPath } from "./registry.mjs";
import { formatLoopWorktreeReview } from "./formatters.mjs";

let context = null;

export function configureLoopWorktreeContext(nextContext) {
  context = nextContext;
}

function ctx() {
  if (!context) throw new Error("Loop worktree context is not configured.");
  return context;
}

function repoRoot() {
  return ctx().repoRoot;
}

function readLoopRegistry() {
  return ctx().readLoopRegistry();
}

function readOptionalJson(path) {
  return ctx().readOptionalJson(path);
}

function updateLoopRun(entry, updates, message) {
  return ctx().updateLoopRun(entry, updates, message);
}

function safeIsDirectory(path) {
  return ctx().safeIsDirectory(path);
}

function isSubpath(root, target) {
  return ctx().isSubpath(root, target);
}

function safePathSegment(text) {
  return ctx().safePathSegment(text);
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

function commandOutput(command, args) {
  return ctx().commandOutput(command, args);
}

export function worktreeDirtyReason() {
  const status = commandOutput("git", ["status", "--short"]).trim();
  return status ? "Child apply refused on dirty worktree." : "";
}

export function createIsolatedLoopWorktree({ parentRunId, baseRef }) {
  const root = loopWorktreeRoot();
  mkdirSync(root, { recursive: true });
  const name = `${safePathSegment(parentRunId).slice(0, 48)}-${shortStableId(parentRunId)}-${Date.now()}`;
  const worktreePath = resolve(root, name);
  if (!isSubpath(root, worktreePath)) {
    throw new Error(`Refusing to create isolated worktree outside ${root}`);
  }
  execFileSync("git", ["worktree", "add", "--detach", worktreePath, baseRef], {
    cwd: repoRoot(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { path: worktreePath, baseRef };
}

export function loopWorktreeReviewValidationError(record) {
  if (!record.worktreePath || !isAbsolute(record.worktreePath)) return "Isolated worktree path is missing or not absolute.";
  if (!record.pathInBoundary || !isLoopWorktreePath(record.worktreePath)) return "Isolated worktree path is outside .myagenttool/worktrees.";
  if (record.cleanupStatus === "completed") return "Isolated worktree has already been cleaned up.";
  if (!record.exists) return "Isolated worktree path does not exist.";
  if (!safeIsDirectory(record.worktreePath)) return "Isolated worktree path is not a directory.";
  return null;
}

export function collectLoopWorktreeRecords() {
  return readLoopRegistry().runs
    .map(loopWorktreeRecordFromEntry)
    .filter(Boolean)
    .sort((a, b) => String(b.parentUpdatedAt).localeCompare(String(a.parentUpdatedAt)));
}

export function findLoopWorktreeRecord(parentRunId) {
  return collectLoopWorktreeRecords().find((record) => record.parentRunId === parentRunId) ?? null;
}

export function loopWorktreeRecordFromEntry(entry) {
  const workerResultPath = entry.evidence?.workerResult ? resolve(repoRoot(), entry.evidence.workerResult) : null;
  const workerResult = workerResultPath ? readOptionalJson(workerResultPath) : null;
  if (!workerResult?.isolatedWorktree || !workerResult.worktreePath) return null;
  const worktreePath = workerResult.worktreePath;
  const pathInBoundary = isLoopWorktreePath(worktreePath);
  const exists = safeIsDirectory(worktreePath);
  const statusResult = exists ? safeGitStatusForRoot(worktreePath) : { status: "", error: null };
  const cleanup = workerResult.cleanup ?? null;
  const cleanupStatus = cleanup?.status ?? (exists ? "kept" : "missing");
  return {
    parentRunId: entry.runId,
    parentState: entry.state,
    parentUpdatedAt: entry.updatedAt,
    issue: entry.issue,
    repo: entry.repo,
    workerResult: entry.evidence?.workerResult ?? null,
    childRunId: workerResult.childRunId ?? null,
    childState: workerResult.childState ?? null,
    childEvidence: workerResult.childEvidence ?? null,
    childProvider: workerResult.childProvider ?? null,
    childApply: Boolean(workerResult.childApply),
    worktreePath,
    baseRef: workerResult.baseRef ?? null,
    cleanupPolicy: workerResult.cleanupPolicy ?? (cleanupStatus === "completed" ? "removed" : "keep"),
    cleanupStatus,
    cleanup,
    exists,
    dirty: Boolean(statusResult.status.trim()),
    dirtyStatus: statusResult.status,
    statusError: statusResult.error,
    pathInBoundary,
  };
}

export function loopWorktreeCleanupValidationError(record) {
  if (!record.worktreePath || !isAbsolute(record.worktreePath)) return "Isolated worktree path is missing or not absolute.";
  if (!isLoopWorktreePath(record.worktreePath)) return "Isolated worktree path is outside .myagenttool/worktrees.";
  if (samePath(record.worktreePath, loopWorktreeRoot())) return "Refusing to cleanup the worktree root directory.";
  if (record.cleanupStatus === "completed") return "Worktree cleanup already completed.";
  if (!record.exists) return "Isolated worktree path does not exist.";
  if (!safeIsDirectory(record.worktreePath)) return "Isolated worktree path is not a directory.";
  return null;
}

export function updateLoopWorkerResult(entry, updates) {
  const resultPath = entry.evidence?.workerResult ? resolve(repoRoot(), entry.evidence.workerResult) : null;
  if (!resultPath || !existsSync(resultPath)) {
    throw new Error(`Missing worker result evidence for ${entry.runId}`);
  }
  const current = readOptionalJson(resultPath) ?? {};
  const next = { ...current, ...updates };
  writeFileSync(resultPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  updateLoopRun(entry, {}, "Loop worker result updated.");
  return next;
}

export function loopWorktreeRoot() {
  return resolve(repoRoot(), ".myagenttool/worktrees");
}

export function isLoopWorktreePath(path) {
  return isAbsolute(path) && isSubpath(loopWorktreeRoot(), path);
}

export function samePath(left, right) {
  return normalizePath(resolve(left)).toLowerCase().replace(/\/+$/, "") === normalizePath(resolve(right)).toLowerCase().replace(/\/+$/, "");
}

export function gitStatusForRoot(root) {
  return gitOutputForRoot(root, ["status", "--short"]);
}

export function gitOutputForRoot(root, args) {
  return gitRawOutputForRoot(root, args).trim();
}

export function gitRawOutputForRoot(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function gitOutputAllowExitForRoot(root, args, allowedStatuses) {
  try {
    return gitOutputForRoot(root, args);
  } catch (error) {
    if (allowedStatuses.includes(error?.status)) {
      return String(error.stdout ?? "").trim();
    }
    throw error;
  }
}

export function gitRawOutputAllowExitForRoot(root, args, allowedStatuses) {
  try {
    return gitRawOutputForRoot(root, args);
  } catch (error) {
    if (allowedStatuses.includes(error?.status)) {
      return String(error.stdout ?? "");
    }
    throw error;
  }
}

export function safeGitStatusForRoot(root) {
  try {
    return { status: gitStatusForRoot(root), error: null };
  } catch (error) {
    return { status: "", error: childProcessErrorMessage(error) };
  }
}

export function buildLoopWorktreeDiff(record) {
  const validationError = loopWorktreeReviewValidationError(record);
  if (validationError) throw new Error(validationError);
  const dirtyStatus = gitStatusForRoot(record.worktreePath);
  const trackedStat = gitOutputForRoot(record.worktreePath, ["diff", "--stat", "HEAD", "--"]);
  const trackedNameOnly = gitOutputForRoot(record.worktreePath, ["diff", "--name-only", "HEAD", "--"]);
  const trackedPatch = gitRawOutputForRoot(record.worktreePath, ["diff", "HEAD", "--"]);
  const untrackedFiles = lines(gitOutputForRoot(record.worktreePath, ["ls-files", "--others", "--exclude-standard"]));
  const untrackedStat = untrackedFiles.map((file) => gitOutputAllowExitForRoot(record.worktreePath, ["diff", "--no-index", "--stat", "--", "/dev/null", file], [0, 1])).filter(Boolean).join("\n");
  const untrackedPatch = untrackedFiles.map((file) => gitRawOutputAllowExitForRoot(record.worktreePath, ["diff", "--no-index", "--", "/dev/null", file], [0, 1])).filter(Boolean).join("");
  const stat = [trackedStat, untrackedStat].filter(Boolean).join("\n");
  const patch = [trackedPatch, untrackedPatch].filter(Boolean).join("");
  return {
    parentRunId: record.parentRunId,
    childRunId: record.childRunId,
    worktreePath: record.worktreePath,
    baseRef: record.baseRef,
    dirty: Boolean(dirtyStatus.trim()),
    dirtyStatus,
    changedFiles: uniqueStrings([...lines(trackedNameOnly), ...untrackedFiles]),
    stat,
    patch,
    patchBytes: Buffer.byteLength(patch, "utf8"),
  };
}

export function buildLoopWorktreeReview({ record, diff }) {
  const createdAt = new Date().toISOString();
  return {
    createdAt,
    parentRunId: record.parentRunId,
    parentState: record.parentState,
    issue: record.issue,
    childRunId: record.childRunId,
    childState: record.childState,
    worktreePath: record.worktreePath,
    baseRef: record.baseRef,
    cleanupStatus: record.cleanupStatus,
    pathInBoundary: record.pathInBoundary,
    exists: record.exists,
    dirty: diff.dirty,
    dirtyStatus: diff.dirtyStatus,
    changedFiles: diff.changedFiles,
    changedFileCount: diff.changedFiles.length,
    stat: diff.stat,
    patchBytes: diff.patchBytes,
    summary: diff.changedFiles.length > 0 ? `${diff.changedFiles.length} changed file(s) in isolated worktree.` : "No file changes detected in isolated worktree.",
  };
}

export function writeLoopWorktreeReviewEvidence(entry, review) {
  const runDir = resolve(repoRoot(), entry.runDir);
  const jsonPath = resolve(runDir, "worktree-review.json");
  const markdownPath = resolve(runDir, "worktree-review.md");
  writeFileSync(jsonPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, formatLoopWorktreeReview(review), "utf8");
  return {
    reviewJson: loopRunPath(entry.runId, "worktree-review.json"),
    reviewMarkdown: loopRunPath(entry.runId, "worktree-review.md"),
  };
}

export function childProcessErrorMessage(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
  return [error?.message ?? String(error), stdout, stderr].filter(Boolean).join("\n");
}

function uniqueStrings(items) {
  return [...new Set((items ?? []).filter(Boolean))];
}

function shortStableId(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function lines(output) {
  return String(output ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}


