import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  childProcessErrorMessage,
  gitOutputForRoot,
  isLoopWorktreePath,
  loopWorktreeRoot,
  samePath,
} from "./worktree.mjs";
import {
  assessLoopWorktreePromotionPrMergePrep,
  isPassingLoopWorktreePromotionPrCheck,
  normalizeLoopWorktreePromotionGhResult,
  normalizeLoopWorktreePromotionMergeMethod,
  parseLoopWorktreePromotionGhJsonArray,
  parseLoopWorktreePromotionGhJsonObject,
  parseLoopWorktreePromotionGhPrCreateOutput,
  runLoopWorktreePromotionGhCommand as runLoopWorktreePromotionGhCommandCore,
  runLoopWorktreePromotionPrCreateCommand as runLoopWorktreePromotionPrCreateCommandCore,
  runLoopWorktreePromotionPrMergeCommand as runLoopWorktreePromotionPrMergeCommandCore,
} from "./promotion-github.mjs";
import {
  buildLoopPromotionPushPlanRisks,
  readLoopWorktreePromotionRemoteHead,
  runLoopWorktreePromotionPushExecuteCommand as runLoopWorktreePromotionPushExecuteCommandCore,
  runLoopWorktreePromotionPushPreflightChecks as runLoopWorktreePromotionPushPreflightChecksCore,
} from "./promotion-push.mjs";
import {
  configureLoopPromotionEvidenceContext,
  writeLoopWorktreePromotionApplyEvidence,
  writeLoopWorktreePromotionCommitEvidence,
  writeLoopWorktreePromotionEvidence,
  writeLoopWorktreePromotionPrCreateExecuteEvidence,
  writeLoopWorktreePromotionPrCreatePrepEvidence,
  writeLoopWorktreePromotionPrMergeExecuteEvidence,
  writeLoopWorktreePromotionPrMergePrepEvidence,
  writeLoopWorktreePromotionPrPrepEvidence,
  writeLoopWorktreePromotionPushExecuteEvidence,
  writeLoopWorktreePromotionPushPlanEvidence,
  writeLoopWorktreePromotionPushPreflightEvidence,
  writeLoopWorktreePromotionVerifyEvidence,
} from "./promotion-evidence.mjs";
import {
  finishLoopWorktreePromotionApply,
  finishLoopWorktreePromotionCommit,
  finishLoopWorktreePromotionPrCreateExecute,
  finishLoopWorktreePromotionPrCreatePrep,
  finishLoopWorktreePromotionPrMergeExecute,
  finishLoopWorktreePromotionPrMergePrep,
  finishLoopWorktreePromotionPrPrep,
  finishLoopWorktreePromotionPushExecute,
  finishLoopWorktreePromotionPushPlan,
  finishLoopWorktreePromotionPushPreflight,
  finishLoopWorktreePromotionRefusal,
  finishLoopWorktreePromotionVerify,
  loopPromotionVerifyCommand,
} from "./promotion-finish.mjs";
import {
  configureLoopPromotionInputsContext,
  readLoopWorktreePromotionApplyInputs,
  readLoopWorktreePromotionCommitInputs,
  readLoopWorktreePromotionPrCreateExecuteInputs,
  readLoopWorktreePromotionPrCreatePrepInputs,
  readLoopWorktreePromotionPrMergeExecuteInputs,
  readLoopWorktreePromotionPrMergePrepInputs,
  readLoopWorktreePromotionPrPrepInputs,
  readLoopWorktreePromotionPushExecuteInputs,
  readLoopWorktreePromotionPushPlanInputs,
  readLoopWorktreePromotionPushPreflightInputs,
  readLoopWorktreePromotionVerifyInputs,
} from "./promotion-inputs.mjs";
import {
  buildLoopWorktreePromotionApplyResult,
  buildLoopWorktreePromotionCommitResult,
  buildLoopWorktreePromotionPlan,
  buildLoopWorktreePromotionPrCreateExecuteResult,
  buildLoopWorktreePromotionPrCreatePrepResult,
  buildLoopWorktreePromotionPrMergeExecuteResult,
  buildLoopWorktreePromotionPrMergePrepResult,
  buildLoopWorktreePromotionPrPrepResult,
  buildLoopWorktreePromotionPushExecuteResult,
  buildLoopWorktreePromotionPushPlanResult,
  buildLoopWorktreePromotionPushPreflightResult,
  buildLoopWorktreePromotionVerifyResult,
  defaultLoopPromotionCommitMessage,
  defaultLoopPromotionPrTitle,
} from "./promotion-results.mjs";

export {
  assessLoopWorktreePromotionPrMergePrep,
  buildLoopPromotionPushPlanRisks,
  buildLoopWorktreePromotionApplyResult,
  buildLoopWorktreePromotionCommitResult,
  buildLoopWorktreePromotionPlan,
  buildLoopWorktreePromotionPrCreateExecuteResult,
  buildLoopWorktreePromotionPrCreatePrepResult,
  buildLoopWorktreePromotionPrMergeExecuteResult,
  buildLoopWorktreePromotionPrMergePrepResult,
  buildLoopWorktreePromotionPrPrepResult,
  buildLoopWorktreePromotionPushExecuteResult,
  buildLoopWorktreePromotionPushPlanResult,
  buildLoopWorktreePromotionPushPreflightResult,
  buildLoopWorktreePromotionVerifyResult,
  defaultLoopPromotionCommitMessage,
  defaultLoopPromotionPrTitle,
  finishLoopWorktreePromotionApply,
  finishLoopWorktreePromotionCommit,
  finishLoopWorktreePromotionPrCreateExecute,
  finishLoopWorktreePromotionPrCreatePrep,
  finishLoopWorktreePromotionPrMergeExecute,
  finishLoopWorktreePromotionPrMergePrep,
  finishLoopWorktreePromotionPrPrep,
  finishLoopWorktreePromotionPushExecute,
  finishLoopWorktreePromotionPushPlan,
  finishLoopWorktreePromotionPushPreflight,
  finishLoopWorktreePromotionRefusal,
  finishLoopWorktreePromotionVerify,
  isPassingLoopWorktreePromotionPrCheck,
  loopPromotionVerifyCommand,
  normalizeLoopWorktreePromotionGhResult,
  normalizeLoopWorktreePromotionMergeMethod,
  parseLoopWorktreePromotionGhJsonArray,
  parseLoopWorktreePromotionGhJsonObject,
  parseLoopWorktreePromotionGhPrCreateOutput,
  readLoopWorktreePromotionRemoteHead,
  readLoopWorktreePromotionApplyInputs,
  readLoopWorktreePromotionCommitInputs,
  readLoopWorktreePromotionPrCreateExecuteInputs,
  readLoopWorktreePromotionPrCreatePrepInputs,
  readLoopWorktreePromotionPrMergeExecuteInputs,
  readLoopWorktreePromotionPrMergePrepInputs,
  readLoopWorktreePromotionPrPrepInputs,
  readLoopWorktreePromotionPushExecuteInputs,
  readLoopWorktreePromotionPushPlanInputs,
  readLoopWorktreePromotionPushPreflightInputs,
  readLoopWorktreePromotionVerifyInputs,
  writeLoopWorktreePromotionApplyEvidence,
  writeLoopWorktreePromotionCommitEvidence,
  writeLoopWorktreePromotionEvidence,
  writeLoopWorktreePromotionPrCreateExecuteEvidence,
  writeLoopWorktreePromotionPrCreatePrepEvidence,
  writeLoopWorktreePromotionPrMergeExecuteEvidence,
  writeLoopWorktreePromotionPrMergePrepEvidence,
  writeLoopWorktreePromotionPrPrepEvidence,
  writeLoopWorktreePromotionPushExecuteEvidence,
  writeLoopWorktreePromotionPushPlanEvidence,
  writeLoopWorktreePromotionPushPreflightEvidence,
  writeLoopWorktreePromotionVerifyEvidence,
};

const loopPromotionContext = {
  repoRoot: null,
  safePathSegment: null,
};

export function configureLoopPromotionContext(context) {
  loopPromotionContext.repoRoot = context.repoRoot;
  loopPromotionContext.safePathSegment = context.safePathSegment;
  configureLoopPromotionEvidenceContext({ repoRoot: context.repoRoot });
  configureLoopPromotionInputsContext({
    repoRoot: context.repoRoot,
    readOptionalJson: context.readOptionalJson,
    safeIsDirectory: context.safeIsDirectory,
  });
}

function requireLoopPromotionRepoRoot() {
  if (!loopPromotionContext.repoRoot) {
    throw new Error("Loop promotion context has not been configured.");
  }
  return loopPromotionContext.repoRoot;
}

function safePathSegment(text) {
  if (!loopPromotionContext.safePathSegment) {
    throw new Error("Loop promotion safePathSegment dependency has not been configured.");
  }
  return loopPromotionContext.safePathSegment(text);
}

export function runLoopWorktreePromotionPrCreateCommand(prCreatePrep) {
  return runLoopWorktreePromotionPrCreateCommandCore(prCreatePrep, {
    repoRoot: requireLoopPromotionRepoRoot(),
    truncate,
  });
}

export function runLoopWorktreePromotionGhCommand(context, commandArgs) {
  return runLoopWorktreePromotionGhCommandCore(context, commandArgs, { truncate });
}

export function runLoopWorktreePromotionPrMergeCommand(context, mergeMethod) {
  return runLoopWorktreePromotionPrMergeCommandCore(context, mergeMethod, { truncate });
}

export function runLoopPromotionVerifyCommand(command, cwd) {
  const result = spawnSync(command.command, command.args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      MYAGENTTOOL_REPO_ROOT: cwd,
    },
  });
  return {
    exitCode: result.status ?? (result.error ? 1 : 0),
    signal: result.signal ?? null,
    error: result.error ? childProcessErrorMessage(result.error) : null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function runLoopWorktreePromotionPushPreflightChecks(pushPlan, { includeDryRun, worktreePath }) {
  return runLoopWorktreePromotionPushPreflightChecksCore(pushPlan, { includeDryRun, worktreePath, truncate });
}

export function runLoopWorktreePromotionPushExecuteCommand(worktreePath, preflight) {
  return runLoopWorktreePromotionPushExecuteCommandCore(worktreePath, preflight, { truncate });
}

export function checkPatchApplies(root, patchPath) {
  try {
    gitOutputForRoot(root, ["apply", "--check", patchPath]);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: childProcessErrorMessage(error) };
  }
}

export function createLoopPromotionIntegrationWorktree({ entry, record }) {
  const root = loopWorktreeRoot();
  mkdirSync(root, { recursive: true });
  const createdAt = new Date().toISOString();
  const issueSegment = safePathSegment(record.issue || entry.issue || "issue");
  const segment = safePathSegment(`promotion-${issueSegment}-${Date.now()}`);
  const worktreePath = resolve(root, segment);
  if (!isLoopWorktreePath(worktreePath) || samePath(worktreePath, root)) {
    throw new Error(`Refusing to create promotion worktree outside ${root}`);
  }
  const branch = uniquePromotionBranchName({ entry, record });
  gitOutputForRoot(requireLoopPromotionRepoRoot(), ["worktree", "add", "-b", branch, worktreePath, record.baseRef ?? "HEAD"]);
  return {
    createdAt,
    branch,
    worktreePath,
    baseRef: record.baseRef ?? "HEAD",
  };
}

function uniquePromotionBranchName({ entry, record }) {
  const issueSegment = safePathSegment(record.issue || entry.issue || "issue");
  const runSegment = safePathSegment(entry.runId).slice(-18).replace(/^-+/, "") || "run";
  const base = `loop/promotion/${issueSegment}/${runSegment}`;
  if (!gitRefExists(base)) return base;
  return `${base}-${Date.now()}`;
}

function gitRefExists(ref) {
  try {
    gitOutputForRoot(requireLoopPromotionRepoRoot(), ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}
