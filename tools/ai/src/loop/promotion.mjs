import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { appendLoopEvent, loopRunPath } from "./registry.mjs";
import {
  childProcessErrorMessage,
  gitOutputForRoot,
  isLoopWorktreePath,
  loopWorktreeRoot,
  samePath,
  updateLoopWorkerResult,
} from "./worktree.mjs";
import {
  formatLoopWorktreePromotionApplyResult,
  formatLoopWorktreePromotionCommitResult,
  formatLoopWorktreePromotionPlan,
  formatLoopWorktreePromotionPrBody,
  formatLoopWorktreePromotionPrChecklist,
  formatLoopWorktreePromotionPrCreateExecute,
  formatLoopWorktreePromotionPrCreatePrep,
  formatLoopWorktreePromotionPrMergeExecute,
  formatLoopWorktreePromotionPrMergePrep,
  formatLoopWorktreePromotionPushChecklist,
  formatLoopWorktreePromotionPushExecuteResult,
  formatLoopWorktreePromotionPushPlan,
  formatLoopWorktreePromotionPushPreflightResult,
  formatLoopWorktreePromotionVerifyResult,
} from "./formatters.mjs";
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

export {
  assessLoopWorktreePromotionPrMergePrep,
  buildLoopPromotionPushPlanRisks,
  isPassingLoopWorktreePromotionPrCheck,
  normalizeLoopWorktreePromotionGhResult,
  normalizeLoopWorktreePromotionMergeMethod,
  parseLoopWorktreePromotionGhJsonArray,
  parseLoopWorktreePromotionGhJsonObject,
  parseLoopWorktreePromotionGhPrCreateOutput,
  readLoopWorktreePromotionRemoteHead,
};

const loopPromotionContext = {
  repoRoot: null,
  readOptionalJson: null,
  safeIsDirectory: null,
  safePathSegment: null,
};

export function configureLoopPromotionContext(context) {
  loopPromotionContext.repoRoot = context.repoRoot;
  loopPromotionContext.readOptionalJson = context.readOptionalJson;
  loopPromotionContext.safeIsDirectory = context.safeIsDirectory;
  loopPromotionContext.safePathSegment = context.safePathSegment;
}

function requireLoopPromotionRepoRoot() {
  if (!loopPromotionContext.repoRoot) {
    throw new Error("Loop promotion context has not been configured.");
  }
  return loopPromotionContext.repoRoot;
}

function loopPromotionRunDir(entry) {
  return resolve(requireLoopPromotionRepoRoot(), entry.runDir);
}

function readOptionalJson(path) {
  if (!loopPromotionContext.readOptionalJson) {
    throw new Error("Loop promotion readOptionalJson dependency has not been configured.");
  }
  return loopPromotionContext.readOptionalJson(path);
}

function safeIsDirectory(path) {
  if (!loopPromotionContext.safeIsDirectory) {
    throw new Error("Loop promotion safeIsDirectory dependency has not been configured.");
  }
  return loopPromotionContext.safeIsDirectory(path);
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

export function loopPromotionVerifyCommand(commandId) {
  const commands = {
    "git-status": { id: "git-status", command: "git", args: ["status", "--short"], description: "Inspect integration worktree status." },
    "tools-ai-check": { id: "tools-ai-check", command: "pnpm", args: ["--filter", "@myagenttool/tools-ai", "test"], description: "Run tools-ai local check." },
    "protocol-check": { id: "protocol-check", command: "pnpm", args: ["--filter", "@myagenttool/protocol", "test"], description: "Run protocol vocabulary check." },
    "repo-typecheck": { id: "repo-typecheck", command: "pnpm", args: ["typecheck"], description: "Run repository typecheck." },
    "repo-test": { id: "repo-test", command: "pnpm", args: ["test"], description: "Run repository tests." },
  };
  return commands[commandId] ?? null;
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

export function buildLoopWorktreePromotionPlan({ record, review, approval }) {
  const createdAt = new Date().toISOString();
  return {
    createdAt,
    status: "planned",
    parentRunId: record.parentRunId,
    childRunId: record.childRunId,
    worktreePath: record.worktreePath,
    baseRef: record.baseRef,
    approval,
    changedFiles: review.changedFiles,
    changedFileCount: review.changedFileCount,
    patchPath: loopRunPath(record.parentRunId, "worktree.patch"),
    reviewPath: loopRunPath(record.parentRunId, "worktree-review.md"),
    forbiddenActions: ["apply patch to current workspace", "merge branch", "push branch", "open pull request"],
    nextSteps: [
      "Review worktree-review.md and worktree.patch.",
      "Apply the patch manually or through a future gated command.",
      "Run repository verification after applying any patch.",
      "Open a PR only after human review confirms the scope.",
    ],
    summary: "Promotion plan created. No workspace files were modified.",
  };
}

export function buildLoopWorktreePromotionApplyResult({ entry, record, approval, requestedAt, status, promotionPlan = null, integration = null, parentDirtyStatus = "", reason = null }) {
  const completedAt = new Date().toISOString();
  return {
    createdAt: completedAt,
    requestedAt,
    completedAt: status === "succeeded" || status === "failed" ? completedAt : null,
    refusedAt: status === "refused" ? completedAt : null,
    status,
    approval,
    reason,
    parentRunId: entry.runId,
    childRunId: record.childRunId,
    sourceWorktreePath: record.worktreePath,
    sourceBaseRef: record.baseRef,
    promotionPlanPath: loopRunPath(entry.runId, "worktree-promotion-plan.json"),
    patchPath: loopRunPath(entry.runId, "worktree.patch"),
    integrationWorktreePath: integration?.worktreePath ?? null,
    integrationBranch: integration?.branch ?? null,
    integrationBaseRef: integration?.baseRef ?? null,
    parentDirty: Boolean(parentDirtyStatus.trim()),
    parentDirtyStatus,
    changedFiles: promotionPlan?.changedFiles ?? [],
    changedFileCount: promotionPlan?.changedFileCount ?? 0,
    forbiddenActions: ["modify current workspace", "merge branch", "push branch", "open pull request"],
    nextSteps: status === "succeeded"
      ? [
          "Review the isolated integration worktree.",
          "Run repository verification inside the integration worktree.",
          "Open a PR only after human review confirms the applied patch.",
        ]
      : [
          "Fix the refusal or failure reason.",
          "Re-run loop-worktree-promote if the source patch changed.",
          "Re-run promotion apply with explicit approval.",
        ],
    summary: status === "succeeded"
      ? "Promotion patch applied to an isolated integration worktree. The current workspace was not modified."
      : "Promotion apply did not modify the current workspace.",
  };
}

export function buildLoopWorktreePromotionVerifyResult({ entry, record, applyResult, approval, commandId, command, requestedAt, startedAt, status, verification, reason = null }) {
  const completedAt = new Date().toISOString();
  return {
    createdAt: completedAt,
    requestedAt,
    startedAt,
    completedAt: status === "succeeded" || status === "failed" ? completedAt : null,
    refusedAt: status === "refused" ? completedAt : null,
    status,
    approval,
    reason: reason ?? verification.error ?? null,
    parentRunId: entry.runId,
    childRunId: record.childRunId,
    sourceWorktreePath: record.worktreePath,
    integrationWorktreePath: applyResult?.integrationWorktreePath ?? null,
    integrationBranch: applyResult?.integrationBranch ?? null,
    commandId,
    command: command ? [command.command, ...command.args].join(" ") : null,
    commandDescription: command?.description ?? null,
    exitCode: verification.exitCode,
    signal: verification.signal ?? null,
    stdoutBytes: Buffer.byteLength(verification.stdout ?? "", "utf8"),
    stderrBytes: Buffer.byteLength(verification.stderr ?? "", "utf8"),
    changedFiles: applyResult?.changedFiles ?? [],
    changedFileCount: applyResult?.changedFileCount ?? 0,
    summary: status === "succeeded"
      ? "Promotion verification succeeded inside the isolated integration worktree."
      : status === "failed"
        ? "Promotion verification failed inside the isolated integration worktree."
        : "Promotion verification did not run.",
  };
}

export function buildLoopWorktreePromotionPrPrepResult({ entry, record, approval, requestedAt, status = "written", reason = null, applyResult, verifyResult, changedFiles, diffStat, dirtyStatus }) {
  const createdAt = new Date().toISOString();
  return {
    createdAt,
    requestedAt,
    status,
    approval,
    reason,
    parentRunId: entry.runId,
    childRunId: record.childRunId,
    issue: record.issue,
    sourceWorktreePath: record.worktreePath,
    integrationWorktreePath: applyResult?.integrationWorktreePath ?? null,
    integrationBranch: applyResult?.integrationBranch ?? null,
    applyStatus: applyResult?.status ?? null,
    verifyStatus: verifyResult?.status ?? null,
    verifyCommandId: verifyResult?.commandId ?? null,
    verifyCommand: verifyResult?.command ?? null,
    verifyExitCode: verifyResult?.exitCode ?? null,
    changedFiles,
    changedFileCount: changedFiles.length,
    diffStat,
    dirty: Boolean(dirtyStatus.trim()),
    dirtyStatus,
    evidenceRefs: {
      promotionApply: loopRunPath(entry.runId, "worktree-promotion-apply-result.json"),
      promotionVerify: loopRunPath(entry.runId, "worktree-promotion-verify-result.json"),
      promotionPatch: loopRunPath(entry.runId, "worktree.patch"),
      promotionReview: loopRunPath(entry.runId, "worktree-review.md"),
    },
    summary: status === "written"
      ? "Promotion PR preparation package written. No push, merge, or PR was performed."
      : "Promotion PR preparation was refused.",
  };
}

export function defaultLoopPromotionCommitMessage({ entry, record, prPrep }) {
  const issue = record.issue || entry.issue || "unknown";
  const count = prPrep?.changedFileCount ?? 0;
  return `Apply loop promotion for issue #${issue}\n\nParent run: ${entry.runId}\nChanged files: ${count}`;
}

export function buildLoopWorktreePromotionCommitResult({ entry, record, approval, requestedAt, status, reason = null, applyResult, verifyResult, prPrep, message, commitSha, changedFiles, preCommitStatus, postCommitStatus }) {
  const completedAt = new Date().toISOString();
  return {
    createdAt: completedAt,
    requestedAt,
    completedAt: status === "succeeded" || status === "failed" ? completedAt : null,
    refusedAt: status === "refused" ? completedAt : null,
    status,
    approval,
    reason,
    parentRunId: entry.runId,
    childRunId: record.childRunId,
    issue: record.issue,
    integrationWorktreePath: applyResult?.integrationWorktreePath ?? null,
    integrationBranch: applyResult?.integrationBranch ?? null,
    applyStatus: applyResult?.status ?? null,
    verifyStatus: verifyResult?.status ?? null,
    prPrepStatus: prPrep?.status ?? null,
    commitSha,
    message,
    changedFiles,
    changedFileCount: changedFiles.length,
    preCommitStatus,
    postCommitStatus,
    summary: status === "succeeded"
      ? "Promotion changes committed locally in the isolated integration worktree."
      : "Promotion commit did not create a local commit.",
  };
}

export function buildLoopWorktreePromotionPushPlanResult({ entry, record, approval, requestedAt, status = "planned", reason = null, remote, remoteUrl, remoteNames, risks, commitResult, prPrep, head, dirtyStatus }) {
  const createdAt = new Date().toISOString();
  const branch = commitResult?.integrationBranch ?? null;
  return {
    createdAt,
    requestedAt,
    status,
    approval,
    reason,
    parentRunId: entry.runId,
    childRunId: record.childRunId,
    issue: record.issue,
    integrationWorktreePath: commitResult?.integrationWorktreePath ?? null,
    integrationBranch: branch,
    commitSha: commitResult?.commitSha ?? null,
    head,
    headMatchesCommit: Boolean(commitResult?.commitSha && head === commitResult.commitSha),
    remote,
    remoteUrl,
    remoteNames,
    refspec: branch ? `${branch}:${branch}` : null,
    pushCommand: branch ? `git push ${remote} ${branch}:${branch}` : null,
    dirty: Boolean(dirtyStatus.trim()),
    dirtyStatus,
    changedFiles: commitResult?.changedFiles ?? prPrep?.changedFiles ?? [],
    changedFileCount: commitResult?.changedFileCount ?? prPrep?.changedFileCount ?? 0,
    risks,
    nextSteps: [
      "Review worktree-promotion-push-plan.json and worktree-promotion-push-checklist.md.",
      "Confirm the remote and branch are correct.",
      "Run the push command only after human approval.",
      "Open a PR only after the branch is pushed and reviewed.",
    ],
    summary: status === "planned"
      ? "Promotion push plan written. No push, merge, or PR was performed."
      : "Promotion push plan was refused.",
  };
}

export function buildLoopWorktreePromotionPushPreflightResult({ entry, record, approval, requestedAt, status = "succeeded", reason = null, pushPlan, head, currentBranch, dirtyStatus, includeDryRun, checks }) {
  const completedAt = new Date().toISOString();
  const failedChecks = checks.filter((check) => check.exitCode !== 0).map((check) => check.id);
  return {
    createdAt: completedAt,
    requestedAt,
    completedAt: status === "succeeded" || status === "failed" ? completedAt : null,
    refusedAt: status === "refused" ? completedAt : null,
    status,
    approval,
    reason,
    parentRunId: entry.runId,
    childRunId: record.childRunId,
    issue: record.issue,
    integrationWorktreePath: pushPlan?.integrationWorktreePath ?? null,
    integrationBranch: pushPlan?.integrationBranch ?? null,
    commitSha: pushPlan?.commitSha ?? null,
    head,
    headMatchesPlan: Boolean(pushPlan?.commitSha && head === pushPlan.commitSha),
    currentBranch,
    branchMatchesPlan: Boolean(pushPlan?.integrationBranch && currentBranch === pushPlan.integrationBranch),
    remote: pushPlan?.remote ?? null,
    remoteUrl: pushPlan?.remoteUrl ?? null,
    refspec: pushPlan?.refspec ?? null,
    pushCommand: pushPlan?.pushCommand ?? null,
    dryRun: includeDryRun,
    dirty: Boolean(dirtyStatus.trim()),
    dirtyStatus,
    checks,
    failedChecks,
    changedFiles: pushPlan?.changedFiles ?? [],
    changedFileCount: pushPlan?.changedFileCount ?? 0,
    nextSteps: status === "succeeded"
      ? [
          "Review worktree-promotion-push-preflight-result.json.",
          "Confirm the dry-run setting matches the intended risk level.",
          "Run the real push only in the next human-gated execute step.",
        ]
      : [
          "Fix the refusal or failed check reason.",
          "Regenerate the push plan if branch, commit, or remote changed.",
          "Re-run push preflight before any push execute step.",
        ],
    summary: status === "succeeded"
      ? "Promotion push preflight succeeded. No push, merge, or PR was performed."
      : status === "failed"
        ? "Promotion push preflight failed. No push, merge, or PR was performed."
        : "Promotion push preflight was refused.",
  };
}

export function buildLoopWorktreePromotionPushExecuteResult({ entry, record, approval, confirmCommit, requestedAt, startedAt, status, reason, preflight, head, currentBranch, dirtyStatus, push, remoteHead }) {
  const completedAt = new Date().toISOString();
  return {
    createdAt: completedAt,
    requestedAt,
    startedAt,
    completedAt: status === "succeeded" || status === "failed" ? completedAt : null,
    refusedAt: status === "refused" ? completedAt : null,
    status,
    approval,
    confirmCommit,
    reason,
    parentRunId: entry.runId,
    childRunId: record.childRunId,
    issue: record.issue,
    integrationWorktreePath: preflight?.integrationWorktreePath ?? null,
    integrationBranch: preflight?.integrationBranch ?? null,
    commitSha: preflight?.commitSha ?? null,
    head,
    headMatchesPreflight: Boolean(preflight?.commitSha && head === preflight.commitSha),
    currentBranch,
    branchMatchesPreflight: Boolean(preflight?.integrationBranch && currentBranch === preflight.integrationBranch),
    remote: preflight?.remote ?? null,
    remoteUrl: preflight?.remoteUrl ?? null,
    refspec: preflight?.refspec ?? null,
    pushCommand: preflight?.refspec && preflight?.remote ? `git push ${preflight.remote} ${preflight.refspec}` : null,
    preflightDryRun: preflight?.dryRun === true,
    dirty: Boolean(dirtyStatus.trim()),
    dirtyStatus,
    push: push ?? {
      command: null,
      startedAt: null,
      completedAt: null,
      exitCode: null,
      signal: null,
      error: null,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdout: "",
      stderr: "",
    },
    remoteHead,
    remoteHeadMatchesCommit: Boolean(preflight?.commitSha && remoteHead === preflight.commitSha),
    changedFiles: preflight?.changedFiles ?? [],
    changedFileCount: preflight?.changedFileCount ?? 0,
    nextSteps: status === "succeeded"
      ? [
          "Review worktree-promotion-push-execute-result.json.",
          "Confirm the remote branch points at the expected commit.",
          "Prepare pull request creation only after human review.",
        ]
      : [
          "Fix the refusal or push failure reason.",
          "Re-run push preflight with --dry-run before retrying execute.",
          "Retry push execute only with the same confirmed commit.",
        ],
    summary: status === "succeeded"
      ? "Promotion branch was pushed to the preflighted remote/refspec."
      : status === "failed"
        ? "Promotion push execute failed after the push command started."
        : "Promotion push execute was refused before running git push.",
  };
}

export function buildLoopWorktreePromotionPrCreatePrepResult({ entry, record, approval, baseBranch, requestedAt, status = "written", reason = null, pushExecute, prPrep, prBody, prChecklist, remoteHead }) {
  const createdAt = new Date().toISOString();
  const title = defaultLoopPromotionPrTitle({ entry, record, pushExecute });
  const bodyFile = loopRunPath(entry.runId, "worktree-promotion-pr-body.md");
  const command = pushExecute?.integrationBranch
    ? `gh pr create --base ${baseBranch} --head ${pushExecute.integrationBranch} --title "${title}" --body-file ${bodyFile}`
    : null;
  return {
    createdAt,
    requestedAt,
    status,
    approval,
    reason,
    parentRunId: entry.runId,
    childRunId: record.childRunId,
    issue: record.issue,
    baseBranch,
    headBranch: pushExecute?.integrationBranch ?? null,
    integrationBranch: pushExecute?.integrationBranch ?? null,
    integrationWorktreePath: pushExecute?.integrationWorktreePath ?? null,
    commitSha: pushExecute?.commitSha ?? null,
    remote: pushExecute?.remote ?? null,
    remoteUrl: pushExecute?.remoteUrl ?? null,
    remoteHead,
    remoteHeadMatchesCommit: Boolean(pushExecute?.commitSha && remoteHead === pushExecute.commitSha),
    title,
    bodyFile,
    checklistFile: loopRunPath(entry.runId, "worktree-promotion-pr-checklist.md"),
    createCommand: command,
    bodyBytes: Buffer.byteLength(prBody ?? "", "utf8"),
    checklistBytes: Buffer.byteLength(prChecklist ?? "", "utf8"),
    changedFiles: pushExecute?.changedFiles ?? prPrep?.changedFiles ?? [],
    changedFileCount: pushExecute?.changedFileCount ?? prPrep?.changedFileCount ?? 0,
    evidenceRefs: {
      promotionPrSummary: loopRunPath(entry.runId, "worktree-promotion-pr-summary.json"),
      promotionPrBody: loopRunPath(entry.runId, "worktree-promotion-pr-body.md"),
      promotionPrChecklist: loopRunPath(entry.runId, "worktree-promotion-pr-checklist.md"),
      promotionPushExecute: loopRunPath(entry.runId, "worktree-promotion-push-execute-result.json"),
    },
    nextSteps: status === "written"
      ? [
          "Review worktree-promotion-pr-create-plan.json.",
          "Review worktree-promotion-pr-body.md and checklist.",
          "Create the PR only in the next human-gated execute step.",
        ]
      : [
          "Fix the refusal reason.",
          "Re-run push execute if the remote branch changed.",
          "Re-run PR create prep before creating a PR.",
        ],
    summary: status === "written"
      ? "Promotion PR create preparation package written. No GitHub PR was created."
      : "Promotion PR create preparation was refused.",
  };
}

export function defaultLoopPromotionPrTitle({ entry, record, pushExecute }) {
  const issue = record.issue || entry.issue || pushExecute?.issue || "unknown";
  return `Apply loop promotion for issue #${issue}`;
}

export function buildLoopWorktreePromotionPrCreateExecuteResult({ entry, record, approval, confirmHead, requestedAt, startedAt, status, reason, prCreatePrep, remoteHead, gh, pr }) {
  const completedAt = new Date().toISOString();
  const normalizedGh = gh ?? {
    command: null,
    executable: null,
    args: [],
    startedAt: null,
    completedAt: null,
    exitCode: null,
    signal: null,
    error: null,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdout: "",
    stderr: "",
  };
  return {
    createdAt: completedAt,
    requestedAt,
    startedAt,
    completedAt: status === "succeeded" || status === "failed" ? completedAt : null,
    refusedAt: status === "refused" ? completedAt : null,
    status,
    approval,
    confirmHead,
    reason,
    parentRunId: entry.runId,
    childRunId: record.childRunId,
    issue: record.issue,
    baseBranch: prCreatePrep?.baseBranch ?? null,
    headBranch: prCreatePrep?.headBranch ?? null,
    commitSha: prCreatePrep?.commitSha ?? null,
    remote: prCreatePrep?.remote ?? null,
    remoteUrl: prCreatePrep?.remoteUrl ?? null,
    remoteHead,
    remoteHeadMatchesCommit: Boolean(prCreatePrep?.commitSha && remoteHead === prCreatePrep.commitSha),
    title: prCreatePrep?.title ?? null,
    bodyFile: prCreatePrep?.bodyFile ?? null,
    checklistFile: prCreatePrep?.checklistFile ?? null,
    createCommand: prCreatePrep?.createCommand ?? null,
    integrationWorktreePath: prCreatePrep?.integrationWorktreePath ?? null,
    gh: normalizedGh,
    prNumber: pr?.number ?? null,
    prUrl: pr?.url ?? null,
    prState: pr?.state ?? null,
    prRaw: pr?.raw ?? "",
    changedFiles: prCreatePrep?.changedFiles ?? [],
    changedFileCount: prCreatePrep?.changedFileCount ?? 0,
    nextSteps: status === "succeeded"
      ? [
          "Review worktree-promotion-pr-create-result.json.",
          "Monitor PR checks before merge.",
          "Merge only in a later human-gated step.",
        ]
      : [
          "Fix the refusal or gh failure reason.",
          "Re-run PR create prep if branch or body changed.",
          "Retry PR create execute only after confirming the same head branch.",
        ],
    summary: status === "succeeded"
      ? "Promotion pull request was created."
      : status === "failed"
        ? "Promotion PR create command failed."
        : "Promotion PR create execute was refused before calling gh.",
  };
}

export function buildLoopWorktreePromotionPrMergePrepResult({ entry, record, approval, confirmPr, allowNoChecks, requestedAt, startedAt, status, reason, blockers, prCreateExecute, remoteHead, prView, prViewData, checks, checksData }) {
  const completedAt = new Date().toISOString();
  const normalizedPrView = normalizeLoopWorktreePromotionGhResult(prView);
  const normalizedChecks = normalizeLoopWorktreePromotionGhResult(checks);
  const normalizedChecksData = Array.isArray(checksData) ? checksData : [];
  const failedChecks = normalizedChecksData.filter((check) => !isPassingLoopWorktreePromotionPrCheck(check));
  return {
    createdAt: completedAt,
    requestedAt,
    startedAt,
    completedAt: status === "ready" || status === "blocked" ? completedAt : null,
    refusedAt: status === "refused" ? completedAt : null,
    status,
    approval,
    confirmPr,
    allowNoChecks,
    reason,
    blockers,
    parentRunId: entry.runId,
    childRunId: record.childRunId,
    issue: record.issue,
    baseBranch: prCreateExecute?.baseBranch ?? null,
    headBranch: prCreateExecute?.headBranch ?? null,
    commitSha: prCreateExecute?.commitSha ?? null,
    remote: prCreateExecute?.remote ?? null,
    remoteUrl: prCreateExecute?.remoteUrl ?? null,
    remoteHead,
    remoteHeadMatchesCommit: Boolean(prCreateExecute?.commitSha && remoteHead === prCreateExecute.commitSha),
    integrationWorktreePath: prCreateExecute?.integrationWorktreePath ?? null,
    prNumber: prCreateExecute?.prNumber ?? null,
    prUrl: prCreateExecute?.prUrl ?? null,
    prState: prViewData?.state ?? prCreateExecute?.prState ?? null,
    prIsDraft: prViewData?.isDraft ?? null,
    prMergeable: prViewData?.mergeable ?? null,
    prHeadRefName: prViewData?.headRefName ?? null,
    prHeadRefOid: prViewData?.headRefOid ?? null,
    prBaseRefName: prViewData?.baseRefName ?? null,
    prView: normalizedPrView,
    checks: normalizedChecks,
    checkRuns: normalizedChecksData,
    failedChecks,
    changedFiles: prCreateExecute?.changedFiles ?? [],
    changedFileCount: prCreateExecute?.changedFileCount ?? 0,
    nextSteps: status === "ready"
      ? [
          "Review worktree-promotion-pr-merge-prep-result.json.",
          "Confirm the merge method and branch policy with a human.",
          "Run merge execute only in a later human-gated step.",
        ]
      : [
          "Fix or inspect the merge prep blockers.",
          "Re-run PR create execute or merge prep if PR state changed.",
          "Do not run merge execute until merge prep is ready.",
        ],
    summary: status === "ready"
      ? "Promotion PR merge prep is ready. No merge was performed."
      : status === "blocked"
        ? "Promotion PR merge prep is blocked. No merge was performed."
        : "Promotion PR merge prep was refused before read-only PR checks.",
  };
}

export function buildLoopWorktreePromotionPrMergeExecuteResult({ entry, record, approval, confirmPr, confirmCommit, mergeMethod, requestedAt, startedAt, status, reason, blockers, prMergePrep, remoteHead, prView, prViewData, checks, checksData, merge }) {
  const completedAt = new Date().toISOString();
  const normalizedPrView = normalizeLoopWorktreePromotionGhResult(prView);
  const normalizedChecks = normalizeLoopWorktreePromotionGhResult(checks);
  const normalizedMerge = normalizeLoopWorktreePromotionGhResult(merge);
  const normalizedChecksData = Array.isArray(checksData) ? checksData : [];
  const failedChecks = normalizedChecksData.filter((check) => !isPassingLoopWorktreePromotionPrCheck(check));
  return {
    createdAt: completedAt,
    requestedAt,
    startedAt,
    completedAt: status === "succeeded" || status === "failed" ? completedAt : null,
    refusedAt: status === "refused" ? completedAt : null,
    status,
    approval,
    confirmPr,
    confirmCommit,
    mergeMethod,
    reason,
    blockers,
    parentRunId: entry.runId,
    childRunId: record.childRunId,
    issue: record.issue,
    baseBranch: prMergePrep?.baseBranch ?? null,
    headBranch: prMergePrep?.headBranch ?? null,
    commitSha: prMergePrep?.commitSha ?? null,
    remote: prMergePrep?.remote ?? null,
    remoteUrl: prMergePrep?.remoteUrl ?? null,
    remoteHead,
    remoteHeadMatchesCommit: Boolean(prMergePrep?.commitSha && remoteHead === prMergePrep.commitSha),
    integrationWorktreePath: prMergePrep?.integrationWorktreePath ?? null,
    prNumber: prMergePrep?.prNumber ?? null,
    prUrl: prMergePrep?.prUrl ?? null,
    prState: prViewData?.state ?? prMergePrep?.prState ?? null,
    prIsDraft: prViewData?.isDraft ?? null,
    prMergeable: prViewData?.mergeable ?? null,
    prHeadRefName: prViewData?.headRefName ?? null,
    prHeadRefOid: prViewData?.headRefOid ?? null,
    prBaseRefName: prViewData?.baseRefName ?? null,
    prView: normalizedPrView,
    checks: normalizedChecks,
    checkRuns: normalizedChecksData,
    failedChecks,
    merge: normalizedMerge,
    changedFiles: prMergePrep?.changedFiles ?? [],
    changedFileCount: prMergePrep?.changedFileCount ?? 0,
    nextSteps: status === "succeeded"
      ? [
          "Review worktree-promotion-pr-merge-execute-result.json.",
          "Confirm the PR is merged in GitHub.",
          "Plan branch cleanup only in a later human-gated step.",
        ]
      : [
          "Fix the refusal, final check blocker, or merge command failure.",
          "Re-run PR merge prep before retrying merge execute.",
          "Retry merge execute only with the same confirmed PR and commit.",
        ],
    summary: status === "succeeded"
      ? "Promotion PR was merged by the human-gated execute step."
      : status === "failed"
        ? "Promotion PR merge command failed after execution started."
        : "Promotion PR merge execute was refused before running gh pr merge.",
  };
}

export function writeLoopWorktreePromotionEvidence(entry, plan, patch) {
  const runDir = loopPromotionRunDir(entry);
  const jsonPath = resolve(runDir, "worktree-promotion-plan.json");
  const markdownPath = resolve(runDir, "worktree-promotion-plan.md");
  const patchPath = resolve(runDir, "worktree.patch");
  writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, formatLoopWorktreePromotionPlan(plan), "utf8");
  writeFileSync(patchPath, patch, "utf8");
  return {
    promotionJson: loopRunPath(entry.runId, "worktree-promotion-plan.json"),
    promotionMarkdown: loopRunPath(entry.runId, "worktree-promotion-plan.md"),
    patch: loopRunPath(entry.runId, "worktree.patch"),
  };
}

export function writeLoopWorktreePromotionApplyEvidence(entry, result) {
  const runDir = loopPromotionRunDir(entry);
  const planPath = resolve(runDir, "worktree-promotion-apply-plan.json");
  const resultPath = resolve(runDir, "worktree-promotion-apply-result.json");
  const markdownPath = resolve(runDir, "worktree-promotion-apply.md");
  const plan = {
    createdAt: result.createdAt,
    status: result.status,
    parentRunId: result.parentRunId,
    sourceWorktreePath: result.sourceWorktreePath,
    patchPath: result.patchPath,
    integrationWorktreePath: result.integrationWorktreePath,
    integrationBranch: result.integrationBranch,
    forbiddenActions: result.forbiddenActions,
    nextSteps: result.nextSteps,
  };
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, formatLoopWorktreePromotionApplyResult(result), "utf8");
  return {
    promotionApplyPlan: loopRunPath(entry.runId, "worktree-promotion-apply-plan.json"),
    promotionApplyResult: loopRunPath(entry.runId, "worktree-promotion-apply-result.json"),
    promotionApplyMarkdown: loopRunPath(entry.runId, "worktree-promotion-apply.md"),
  };
}

export function writeLoopWorktreePromotionVerifyEvidence(entry, result, verification) {
  const runDir = loopPromotionRunDir(entry);
  const planPath = resolve(runDir, "worktree-promotion-verify-plan.json");
  const resultPath = resolve(runDir, "worktree-promotion-verify-result.json");
  const markdownPath = resolve(runDir, "worktree-promotion-verify.md");
  const stdoutPath = resolve(runDir, "worktree-promotion-verify-stdout.txt");
  const stderrPath = resolve(runDir, "worktree-promotion-verify-stderr.txt");
  const plan = {
    createdAt: result.createdAt,
    status: result.status,
    parentRunId: result.parentRunId,
    integrationWorktreePath: result.integrationWorktreePath,
    integrationBranch: result.integrationBranch,
    commandId: result.commandId,
    command: result.command,
  };
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, formatLoopWorktreePromotionVerifyResult(result), "utf8");
  writeFileSync(stdoutPath, verification.stdout ?? "", "utf8");
  writeFileSync(stderrPath, verification.stderr ?? "", "utf8");
  return {
    promotionVerifyPlan: loopRunPath(entry.runId, "worktree-promotion-verify-plan.json"),
    promotionVerifyResult: loopRunPath(entry.runId, "worktree-promotion-verify-result.json"),
    promotionVerifyMarkdown: loopRunPath(entry.runId, "worktree-promotion-verify.md"),
    promotionVerifyStdout: loopRunPath(entry.runId, "worktree-promotion-verify-stdout.txt"),
    promotionVerifyStderr: loopRunPath(entry.runId, "worktree-promotion-verify-stderr.txt"),
  };
}

export function writeLoopWorktreePromotionPrPrepEvidence(entry, result, body, checklist) {
  const runDir = loopPromotionRunDir(entry);
  const planPath = resolve(runDir, "worktree-promotion-pr-plan.json");
  const bodyPath = resolve(runDir, "worktree-promotion-pr-body.md");
  const checklistPath = resolve(runDir, "worktree-promotion-pr-checklist.md");
  const summaryPath = resolve(runDir, "worktree-promotion-pr-summary.json");
  const plan = {
    createdAt: result.createdAt,
    status: result.status,
    parentRunId: result.parentRunId,
    integrationWorktreePath: result.integrationWorktreePath,
    integrationBranch: result.integrationBranch,
    verifyCommandId: result.verifyCommandId,
    verifyExitCode: result.verifyExitCode,
    nextSteps: [
      "Review worktree-promotion-pr-body.md and worktree-promotion-pr-checklist.md.",
      "Inspect the integration worktree before pushing or opening a PR.",
      "Push and open a PR only after human approval.",
    ],
  };
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(bodyPath, body, "utf8");
  writeFileSync(checklistPath, checklist, "utf8");
  writeFileSync(summaryPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return {
    promotionPrPlan: loopRunPath(entry.runId, "worktree-promotion-pr-plan.json"),
    promotionPrBody: loopRunPath(entry.runId, "worktree-promotion-pr-body.md"),
    promotionPrChecklist: loopRunPath(entry.runId, "worktree-promotion-pr-checklist.md"),
    promotionPrSummary: loopRunPath(entry.runId, "worktree-promotion-pr-summary.json"),
  };
}

export function writeLoopWorktreePromotionCommitEvidence(entry, result) {
  const runDir = loopPromotionRunDir(entry);
  const planPath = resolve(runDir, "worktree-promotion-commit-plan.json");
  const resultPath = resolve(runDir, "worktree-promotion-commit-result.json");
  const markdownPath = resolve(runDir, "worktree-promotion-commit.md");
  const plan = {
    createdAt: result.createdAt,
    status: result.status,
    parentRunId: result.parentRunId,
    integrationWorktreePath: result.integrationWorktreePath,
    integrationBranch: result.integrationBranch,
    message: result.message,
    nextSteps: [
      "Inspect the local commit in the isolated integration worktree.",
      "Push the integration branch only after human approval.",
      "Open a PR only after human approval.",
    ],
  };
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, formatLoopWorktreePromotionCommitResult(result), "utf8");
  return {
    promotionCommitPlan: loopRunPath(entry.runId, "worktree-promotion-commit-plan.json"),
    promotionCommitResult: loopRunPath(entry.runId, "worktree-promotion-commit-result.json"),
    promotionCommitMarkdown: loopRunPath(entry.runId, "worktree-promotion-commit.md"),
  };
}

export function writeLoopWorktreePromotionPushPlanEvidence(entry, result) {
  const runDir = loopPromotionRunDir(entry);
  const planPath = resolve(runDir, "worktree-promotion-push-plan.json");
  const checklistPath = resolve(runDir, "worktree-promotion-push-checklist.md");
  const markdownPath = resolve(runDir, "worktree-promotion-push.md");
  writeFileSync(planPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(checklistPath, formatLoopWorktreePromotionPushChecklist(result), "utf8");
  writeFileSync(markdownPath, formatLoopWorktreePromotionPushPlan(result), "utf8");
  return {
    promotionPushPlan: loopRunPath(entry.runId, "worktree-promotion-push-plan.json"),
    promotionPushChecklist: loopRunPath(entry.runId, "worktree-promotion-push-checklist.md"),
    promotionPushMarkdown: loopRunPath(entry.runId, "worktree-promotion-push.md"),
  };
}

export function writeLoopWorktreePromotionPushPreflightEvidence(entry, result) {
  const runDir = loopPromotionRunDir(entry);
  const planPath = resolve(runDir, "worktree-promotion-push-preflight-plan.json");
  const resultPath = resolve(runDir, "worktree-promotion-push-preflight-result.json");
  const markdownPath = resolve(runDir, "worktree-promotion-push-preflight.md");
  const plan = {
    createdAt: result.createdAt,
    status: result.status,
    parentRunId: result.parentRunId,
    integrationWorktreePath: result.integrationWorktreePath,
    integrationBranch: result.integrationBranch,
    commitSha: result.commitSha,
    remote: result.remote,
    remoteUrl: result.remoteUrl,
    refspec: result.refspec,
    dryRun: result.dryRun,
    checks: result.checks.map((check) => ({ id: check.id, command: check.command, description: check.description })),
    boundary: "No real git push, merge, or pull request creation is performed by this command.",
  };
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, formatLoopWorktreePromotionPushPreflightResult(result), "utf8");
  return {
    promotionPushPreflightPlan: loopRunPath(entry.runId, "worktree-promotion-push-preflight-plan.json"),
    promotionPushPreflightResult: loopRunPath(entry.runId, "worktree-promotion-push-preflight-result.json"),
    promotionPushPreflightMarkdown: loopRunPath(entry.runId, "worktree-promotion-push-preflight.md"),
  };
}

export function writeLoopWorktreePromotionPushExecuteEvidence(entry, result) {
  const runDir = loopPromotionRunDir(entry);
  const planPath = resolve(runDir, "worktree-promotion-push-execute-plan.json");
  const resultPath = resolve(runDir, "worktree-promotion-push-execute-result.json");
  const markdownPath = resolve(runDir, "worktree-promotion-push-execute.md");
  const plan = {
    createdAt: result.createdAt,
    status: result.status,
    parentRunId: result.parentRunId,
    integrationWorktreePath: result.integrationWorktreePath,
    integrationBranch: result.integrationBranch,
    commitSha: result.commitSha,
    confirmCommit: result.confirmCommit,
    remote: result.remote,
    remoteUrl: result.remoteUrl,
    refspec: result.refspec,
    pushCommand: result.pushCommand,
    preflightDryRun: result.preflightDryRun,
    boundary: "Only the preflighted git push command is allowed. No merge or pull request creation is performed.",
  };
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, formatLoopWorktreePromotionPushExecuteResult(result), "utf8");
  return {
    promotionPushExecutePlan: loopRunPath(entry.runId, "worktree-promotion-push-execute-plan.json"),
    promotionPushExecuteResult: loopRunPath(entry.runId, "worktree-promotion-push-execute-result.json"),
    promotionPushExecuteMarkdown: loopRunPath(entry.runId, "worktree-promotion-push-execute.md"),
  };
}

export function writeLoopWorktreePromotionPrCreatePrepEvidence(entry, result) {
  const runDir = loopPromotionRunDir(entry);
  const planPath = resolve(runDir, "worktree-promotion-pr-create-plan.json");
  const summaryPath = resolve(runDir, "worktree-promotion-pr-create-summary.json");
  const markdownPath = resolve(runDir, "worktree-promotion-pr-create.md");
  const plan = {
    createdAt: result.createdAt,
    status: result.status,
    parentRunId: result.parentRunId,
    baseBranch: result.baseBranch,
    headBranch: result.headBranch,
    commitSha: result.commitSha,
    remote: result.remote,
    remoteUrl: result.remoteUrl,
    remoteHead: result.remoteHead,
    title: result.title,
    bodyFile: result.bodyFile,
    checklistFile: result.checklistFile,
    createCommand: result.createCommand,
    boundary: "This command prepares PR creation only. It does not call gh pr create.",
  };
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(summaryPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, formatLoopWorktreePromotionPrCreatePrep(result), "utf8");
  return {
    promotionPrCreatePlan: loopRunPath(entry.runId, "worktree-promotion-pr-create-plan.json"),
    promotionPrCreateSummary: loopRunPath(entry.runId, "worktree-promotion-pr-create-summary.json"),
    promotionPrCreateMarkdown: loopRunPath(entry.runId, "worktree-promotion-pr-create.md"),
  };
}

export function writeLoopWorktreePromotionPrCreateExecuteEvidence(entry, result) {
  const runDir = loopPromotionRunDir(entry);
  const planPath = resolve(runDir, "worktree-promotion-pr-create-execute-plan.json");
  const resultPath = resolve(runDir, "worktree-promotion-pr-create-result.json");
  const markdownPath = resolve(runDir, "worktree-promotion-pr-create-result.md");
  const plan = {
    createdAt: result.createdAt,
    status: result.status,
    parentRunId: result.parentRunId,
    baseBranch: result.baseBranch,
    headBranch: result.headBranch,
    commitSha: result.commitSha,
    confirmHead: result.confirmHead,
    title: result.title,
    bodyFile: result.bodyFile,
    command: result.gh.command,
    boundary: "This command may create a pull request. It does not merge.",
  };
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, formatLoopWorktreePromotionPrCreateExecute(result), "utf8");
  return {
    promotionPrCreateExecutePlan: loopRunPath(entry.runId, "worktree-promotion-pr-create-execute-plan.json"),
    promotionPrCreateResult: loopRunPath(entry.runId, "worktree-promotion-pr-create-result.json"),
    promotionPrCreateResultMarkdown: loopRunPath(entry.runId, "worktree-promotion-pr-create-result.md"),
  };
}

export function writeLoopWorktreePromotionPrMergePrepEvidence(entry, result) {
  const runDir = loopPromotionRunDir(entry);
  const planPath = resolve(runDir, "worktree-promotion-pr-merge-prep-plan.json");
  const resultPath = resolve(runDir, "worktree-promotion-pr-merge-prep-result.json");
  const markdownPath = resolve(runDir, "worktree-promotion-pr-merge-prep.md");
  const plan = {
    createdAt: result.createdAt,
    status: result.status,
    parentRunId: result.parentRunId,
    prNumber: result.prNumber,
    prUrl: result.prUrl,
    baseBranch: result.baseBranch,
    headBranch: result.headBranch,
    commitSha: result.commitSha,
    confirmPr: result.confirmPr,
    allowNoChecks: result.allowNoChecks,
    prViewCommand: result.prView.command,
    checksCommand: result.checks.command,
    boundary: "This command performs read-only PR merge preparation checks. It does not merge.",
  };
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, formatLoopWorktreePromotionPrMergePrep(result), "utf8");
  return {
    promotionPrMergePrepPlan: loopRunPath(entry.runId, "worktree-promotion-pr-merge-prep-plan.json"),
    promotionPrMergePrepResult: loopRunPath(entry.runId, "worktree-promotion-pr-merge-prep-result.json"),
    promotionPrMergePrepMarkdown: loopRunPath(entry.runId, "worktree-promotion-pr-merge-prep.md"),
  };
}

export function writeLoopWorktreePromotionPrMergeExecuteEvidence(entry, result) {
  const runDir = loopPromotionRunDir(entry);
  const planPath = resolve(runDir, "worktree-promotion-pr-merge-execute-plan.json");
  const resultPath = resolve(runDir, "worktree-promotion-pr-merge-execute-result.json");
  const markdownPath = resolve(runDir, "worktree-promotion-pr-merge-execute.md");
  const plan = {
    createdAt: result.createdAt,
    status: result.status,
    parentRunId: result.parentRunId,
    prNumber: result.prNumber,
    prUrl: result.prUrl,
    baseBranch: result.baseBranch,
    headBranch: result.headBranch,
    commitSha: result.commitSha,
    confirmPr: result.confirmPr,
    confirmCommit: result.confirmCommit,
    mergeMethod: result.mergeMethod,
    mergeCommand: result.merge.command,
    boundary: "This command may merge the confirmed pull request. It does not delete branches.",
  };
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, formatLoopWorktreePromotionPrMergeExecute(result), "utf8");
  return {
    promotionPrMergeExecutePlan: loopRunPath(entry.runId, "worktree-promotion-pr-merge-execute-plan.json"),
    promotionPrMergeExecuteResult: loopRunPath(entry.runId, "worktree-promotion-pr-merge-execute-result.json"),
    promotionPrMergeExecuteMarkdown: loopRunPath(entry.runId, "worktree-promotion-pr-merge-execute.md"),
  };
}

export function readLoopWorktreePromotionApplyInputs(entry) {
  const repoRoot = requireLoopPromotionRepoRoot();
  const planPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-plan.json"));
  const patchPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree.patch"));
  const plan = readOptionalJson(planPath);
  if (!plan) {
    return { ok: false, reason: "Missing worktree-promotion-plan.json. Run loop-worktree-promote first." };
  }
  if (plan.status !== "planned") {
    return { ok: false, reason: `Promotion plan status must be planned, got ${plan.status ?? "unknown"}.` };
  }
  if (plan.parentRunId !== entry.runId) {
    return { ok: false, reason: "Promotion plan parent run does not match requested run." };
  }
  if (!existsSync(patchPath)) {
    return { ok: false, reason: "Missing worktree.patch. Run loop-worktree-promote first." };
  }
  const patch = readFileSync(patchPath, "utf8");
  if (!patch.trim()) {
    return { ok: false, reason: "Promotion patch is empty." };
  }
  return { ok: true, plan, patch, planPath, patchPath };
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

export function readLoopWorktreePromotionVerifyInputs(entry) {
  const repoRoot = requireLoopPromotionRepoRoot();
  const applyResultPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-apply-result.json"));
  const applyResult = readOptionalJson(applyResultPath);
  if (!applyResult) {
    return { ok: false, reason: "Missing worktree-promotion-apply-result.json. Run loop-worktree-promotion-apply first." };
  }
  if (applyResult.status !== "succeeded") {
    return { ok: false, reason: `Promotion apply status must be succeeded, got ${applyResult.status ?? "unknown"}.` };
  }
  if (!applyResult.integrationWorktreePath || !isAbsolute(applyResult.integrationWorktreePath)) {
    return { ok: false, reason: "Promotion apply result is missing an absolute integration worktree path." };
  }
  if (!isLoopWorktreePath(applyResult.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path is outside .myagenttool/worktrees." };
  }
  if (!safeIsDirectory(applyResult.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path does not exist." };
  }
  return { ok: true, applyResult };
}

export function readLoopWorktreePromotionPrPrepInputs(entry) {
  const repoRoot = requireLoopPromotionRepoRoot();
  const applyResultPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-apply-result.json"));
  const verifyResultPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-verify-result.json"));
  const applyResult = readOptionalJson(applyResultPath);
  const verifyResult = readOptionalJson(verifyResultPath);
  if (!applyResult) {
    return { ok: false, reason: "Missing worktree-promotion-apply-result.json. Run loop-worktree-promotion-apply first." };
  }
  if (applyResult.status !== "succeeded") {
    return { ok: false, reason: `Promotion apply status must be succeeded, got ${applyResult.status ?? "unknown"}.` };
  }
  if (!verifyResult) {
    return { ok: false, reason: "Missing worktree-promotion-verify-result.json. Run loop-worktree-promotion-verify first." };
  }
  if (verifyResult.status !== "succeeded") {
    return { ok: false, reason: `Promotion verification status must be succeeded, got ${verifyResult.status ?? "unknown"}.` };
  }
  if (!applyResult.integrationWorktreePath || !isAbsolute(applyResult.integrationWorktreePath)) {
    return { ok: false, reason: "Promotion apply result is missing an absolute integration worktree path." };
  }
  if (!isLoopWorktreePath(applyResult.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path is outside .myagenttool/worktrees." };
  }
  if (!safeIsDirectory(applyResult.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path does not exist." };
  }
  return { ok: true, applyResult, verifyResult };
}

export function readLoopWorktreePromotionCommitInputs(entry) {
  const repoRoot = requireLoopPromotionRepoRoot();
  const applyResultPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-apply-result.json"));
  const verifyResultPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-verify-result.json"));
  const prPrepPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-pr-summary.json"));
  const applyResult = readOptionalJson(applyResultPath);
  const verifyResult = readOptionalJson(verifyResultPath);
  const prPrep = readOptionalJson(prPrepPath);
  if (!applyResult) {
    return { ok: false, reason: "Missing worktree-promotion-apply-result.json. Run loop-worktree-promotion-apply first." };
  }
  if (applyResult.status !== "succeeded") {
    return { ok: false, reason: `Promotion apply status must be succeeded, got ${applyResult.status ?? "unknown"}.` };
  }
  if (!verifyResult) {
    return { ok: false, reason: "Missing worktree-promotion-verify-result.json. Run loop-worktree-promotion-verify first." };
  }
  if (verifyResult.status !== "succeeded") {
    return { ok: false, reason: `Promotion verification status must be succeeded, got ${verifyResult.status ?? "unknown"}.` };
  }
  if (!prPrep) {
    return { ok: false, reason: "Missing worktree-promotion-pr-summary.json. Run loop-worktree-promotion-pr-prep first." };
  }
  if (prPrep.status !== "written") {
    return { ok: false, reason: `Promotion PR prep status must be written, got ${prPrep.status ?? "unknown"}.` };
  }
  if (!applyResult.integrationWorktreePath || !isAbsolute(applyResult.integrationWorktreePath)) {
    return { ok: false, reason: "Promotion apply result is missing an absolute integration worktree path." };
  }
  if (!isLoopWorktreePath(applyResult.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path is outside .myagenttool/worktrees." };
  }
  if (!safeIsDirectory(applyResult.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path does not exist." };
  }
  return { ok: true, applyResult, verifyResult, prPrep };
}

export function readLoopWorktreePromotionPushPlanInputs(entry) {
  const repoRoot = requireLoopPromotionRepoRoot();
  const commitResultPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-commit-result.json"));
  const prPrepPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-pr-summary.json"));
  const commitResult = readOptionalJson(commitResultPath);
  const prPrep = readOptionalJson(prPrepPath);
  if (!commitResult) {
    return { ok: false, reason: "Missing worktree-promotion-commit-result.json. Run loop-worktree-promotion-commit first." };
  }
  if (commitResult.status !== "succeeded") {
    return { ok: false, reason: `Promotion commit status must be succeeded, got ${commitResult.status ?? "unknown"}.` };
  }
  if (!commitResult.commitSha) {
    return { ok: false, reason: "Promotion commit result is missing commit SHA." };
  }
  if (!commitResult.integrationBranch) {
    return { ok: false, reason: "Promotion commit result is missing integration branch." };
  }
  if (!commitResult.integrationWorktreePath || !isAbsolute(commitResult.integrationWorktreePath)) {
    return { ok: false, reason: "Promotion commit result is missing an absolute integration worktree path." };
  }
  if (!isLoopWorktreePath(commitResult.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path is outside .myagenttool/worktrees." };
  }
  if (!safeIsDirectory(commitResult.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path does not exist." };
  }
  if (!prPrep) {
    return { ok: false, reason: "Missing worktree-promotion-pr-summary.json. Run loop-worktree-promotion-pr-prep first." };
  }
  if (prPrep.status !== "written") {
    return { ok: false, reason: `Promotion PR prep status must be written, got ${prPrep.status ?? "unknown"}.` };
  }
  return { ok: true, commitResult, prPrep };
}

export function readLoopWorktreePromotionPushPreflightInputs(entry) {
  const repoRoot = requireLoopPromotionRepoRoot();
  const pushPlanPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-push-plan.json"));
  const pushPlan = readOptionalJson(pushPlanPath);
  if (!pushPlan) {
    return { ok: false, reason: "Missing worktree-promotion-push-plan.json. Run loop-worktree-promotion-push-plan first.", pushPlan: null };
  }
  if (pushPlan.status !== "planned") {
    return { ok: false, reason: `Promotion push plan status must be planned, got ${pushPlan.status ?? "unknown"}.`, pushPlan };
  }
  if (!pushPlan.commitSha) {
    return { ok: false, reason: "Promotion push plan is missing commit SHA.", pushPlan };
  }
  if (!pushPlan.integrationBranch) {
    return { ok: false, reason: "Promotion push plan is missing integration branch.", pushPlan };
  }
  if (!pushPlan.remote) {
    return { ok: false, reason: "Promotion push plan is missing remote.", pushPlan };
  }
  if (!pushPlan.refspec) {
    return { ok: false, reason: "Promotion push plan is missing refspec.", pushPlan };
  }
  if (pushPlan.refspec !== `${pushPlan.integrationBranch}:${pushPlan.integrationBranch}`) {
    return { ok: false, reason: "Promotion push plan refspec does not match integration branch.", pushPlan };
  }
  if (!pushPlan.integrationWorktreePath || !isAbsolute(pushPlan.integrationWorktreePath)) {
    return { ok: false, reason: "Promotion push plan is missing an absolute integration worktree path.", pushPlan };
  }
  if (!isLoopWorktreePath(pushPlan.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path is outside .myagenttool/worktrees.", pushPlan };
  }
  if (!safeIsDirectory(pushPlan.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path does not exist.", pushPlan };
  }
  return { ok: true, pushPlan };
}

export function readLoopWorktreePromotionPushExecuteInputs(entry) {
  const repoRoot = requireLoopPromotionRepoRoot();
  const preflightPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-push-preflight-result.json"));
  const preflight = readOptionalJson(preflightPath);
  if (!preflight) {
    return { ok: false, reason: "Missing worktree-promotion-push-preflight-result.json. Run loop-worktree-promotion-push-preflight --dry-run first.", preflight: null };
  }
  if (preflight.status !== "succeeded") {
    return { ok: false, reason: `Promotion push preflight status must be succeeded, got ${preflight.status ?? "unknown"}.`, preflight };
  }
  if (preflight.dryRun !== true) {
    return { ok: false, reason: "Promotion push execute requires a successful push preflight with --dry-run.", preflight };
  }
  if (!preflight.commitSha) {
    return { ok: false, reason: "Promotion push preflight result is missing commit SHA.", preflight };
  }
  if (!preflight.integrationBranch) {
    return { ok: false, reason: "Promotion push preflight result is missing integration branch.", preflight };
  }
  if (!preflight.remote) {
    return { ok: false, reason: "Promotion push preflight result is missing remote.", preflight };
  }
  if (!preflight.refspec) {
    return { ok: false, reason: "Promotion push preflight result is missing refspec.", preflight };
  }
  if (preflight.refspec !== `${preflight.integrationBranch}:${preflight.integrationBranch}`) {
    return { ok: false, reason: "Promotion push preflight refspec does not match integration branch.", preflight };
  }
  if (!preflight.integrationWorktreePath || !isAbsolute(preflight.integrationWorktreePath)) {
    return { ok: false, reason: "Promotion push preflight result is missing an absolute integration worktree path.", preflight };
  }
  if (!isLoopWorktreePath(preflight.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path is outside .myagenttool/worktrees.", preflight };
  }
  if (!safeIsDirectory(preflight.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path does not exist.", preflight };
  }
  return { ok: true, preflight };
}

export function readLoopWorktreePromotionPrCreatePrepInputs(entry) {
  const repoRoot = requireLoopPromotionRepoRoot();
  const pushExecutePath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-push-execute-result.json"));
  const prSummaryPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-pr-summary.json"));
  const prBodyPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-pr-body.md"));
  const prChecklistPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-pr-checklist.md"));
  const pushExecute = readOptionalJson(pushExecutePath);
  const prPrep = readOptionalJson(prSummaryPath);
  if (!pushExecute) {
    return { ok: false, reason: "Missing worktree-promotion-push-execute-result.json. Run loop-worktree-promotion-push-execute first.", pushExecute: null };
  }
  if (pushExecute.status !== "succeeded") {
    return { ok: false, reason: `Promotion push execute status must be succeeded, got ${pushExecute.status ?? "unknown"}.`, pushExecute };
  }
  if (!pushExecute.remoteHeadMatchesCommit) {
    return { ok: false, reason: "Promotion push execute result must confirm remote head matches commit.", pushExecute };
  }
  if (!pushExecute.commitSha) {
    return { ok: false, reason: "Promotion push execute result is missing commit SHA.", pushExecute };
  }
  if (!pushExecute.integrationBranch) {
    return { ok: false, reason: "Promotion push execute result is missing integration branch.", pushExecute };
  }
  if (!pushExecute.remote) {
    return { ok: false, reason: "Promotion push execute result is missing remote.", pushExecute };
  }
  if (!pushExecute.integrationWorktreePath || !isAbsolute(pushExecute.integrationWorktreePath)) {
    return { ok: false, reason: "Promotion push execute result is missing an absolute integration worktree path.", pushExecute };
  }
  if (!isLoopWorktreePath(pushExecute.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path is outside .myagenttool/worktrees.", pushExecute };
  }
  if (!safeIsDirectory(pushExecute.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path does not exist.", pushExecute };
  }
  if (!prPrep) {
    return { ok: false, reason: "Missing worktree-promotion-pr-summary.json. Run loop-worktree-promotion-pr-prep first.", pushExecute };
  }
  if (prPrep.status !== "written") {
    return { ok: false, reason: `Promotion PR prep status must be written, got ${prPrep.status ?? "unknown"}.`, pushExecute };
  }
  if (!existsSync(prBodyPath)) {
    return { ok: false, reason: "Missing worktree-promotion-pr-body.md. Run loop-worktree-promotion-pr-prep first.", pushExecute };
  }
  if (!existsSync(prChecklistPath)) {
    return { ok: false, reason: "Missing worktree-promotion-pr-checklist.md. Run loop-worktree-promotion-pr-prep first.", pushExecute };
  }
  return {
    ok: true,
    pushExecute,
    prPrep,
    prBody: readFileSync(prBodyPath, "utf8"),
    prChecklist: readFileSync(prChecklistPath, "utf8"),
  };
}

export function readLoopWorktreePromotionPrCreateExecuteInputs(entry) {
  const repoRoot = requireLoopPromotionRepoRoot();
  const prCreatePrepPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-pr-create-summary.json"));
  const prCreatePrep = readOptionalJson(prCreatePrepPath);
  if (!prCreatePrep) {
    return { ok: false, reason: "Missing worktree-promotion-pr-create-summary.json. Run loop-worktree-promotion-pr-create-prep first.", prCreatePrep: null };
  }
  if (prCreatePrep.status !== "written") {
    return { ok: false, reason: `Promotion PR create prep status must be written, got ${prCreatePrep.status ?? "unknown"}.`, prCreatePrep };
  }
  if (!prCreatePrep.headBranch) {
    return { ok: false, reason: "Promotion PR create prep is missing head branch.", prCreatePrep };
  }
  if (!prCreatePrep.baseBranch) {
    return { ok: false, reason: "Promotion PR create prep is missing base branch.", prCreatePrep };
  }
  if (!prCreatePrep.title) {
    return { ok: false, reason: "Promotion PR create prep is missing title.", prCreatePrep };
  }
  if (!prCreatePrep.bodyFile) {
    return { ok: false, reason: "Promotion PR create prep is missing body file.", prCreatePrep };
  }
  if (!prCreatePrep.commitSha) {
    return { ok: false, reason: "Promotion PR create prep is missing commit SHA.", prCreatePrep };
  }
  if (!prCreatePrep.remote) {
    return { ok: false, reason: "Promotion PR create prep is missing remote.", prCreatePrep };
  }
  if (!prCreatePrep.integrationWorktreePath || !isAbsolute(prCreatePrep.integrationWorktreePath)) {
    return { ok: false, reason: "Promotion PR create prep is missing an absolute integration worktree path.", prCreatePrep };
  }
  if (!isLoopWorktreePath(prCreatePrep.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path is outside .myagenttool/worktrees.", prCreatePrep };
  }
  if (!safeIsDirectory(prCreatePrep.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path does not exist.", prCreatePrep };
  }
  if (!existsSync(resolve(repoRoot, prCreatePrep.bodyFile))) {
    return { ok: false, reason: "Promotion PR create prep body file does not exist.", prCreatePrep };
  }
  return { ok: true, prCreatePrep };
}

export function readLoopWorktreePromotionPrMergePrepInputs(entry) {
  const repoRoot = requireLoopPromotionRepoRoot();
  const prCreateExecutePath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-pr-create-result.json"));
  const prCreateExecute = readOptionalJson(prCreateExecutePath);
  if (!prCreateExecute) {
    return { ok: false, reason: "Missing worktree-promotion-pr-create-result.json. Run loop-worktree-promotion-pr-create-execute first.", prCreateExecute: null };
  }
  if (prCreateExecute.status !== "succeeded") {
    return { ok: false, reason: `Promotion PR create execute status must be succeeded, got ${prCreateExecute.status ?? "unknown"}.`, prCreateExecute };
  }
  if (!prCreateExecute.prNumber) {
    return { ok: false, reason: "Promotion PR create execute result is missing PR number.", prCreateExecute };
  }
  if (!prCreateExecute.prUrl) {
    return { ok: false, reason: "Promotion PR create execute result is missing PR URL.", prCreateExecute };
  }
  if (!prCreateExecute.headBranch) {
    return { ok: false, reason: "Promotion PR create execute result is missing head branch.", prCreateExecute };
  }
  if (!prCreateExecute.baseBranch) {
    return { ok: false, reason: "Promotion PR create execute result is missing base branch.", prCreateExecute };
  }
  if (!prCreateExecute.commitSha) {
    return { ok: false, reason: "Promotion PR create execute result is missing commit SHA.", prCreateExecute };
  }
  if (!prCreateExecute.remote) {
    return { ok: false, reason: "Promotion PR create execute result is missing remote.", prCreateExecute };
  }
  if (!prCreateExecute.remoteHeadMatchesCommit) {
    return { ok: false, reason: "Promotion PR create execute result must confirm remote head matches commit.", prCreateExecute };
  }
  if (!prCreateExecute.integrationWorktreePath || !isAbsolute(prCreateExecute.integrationWorktreePath)) {
    return { ok: false, reason: "Promotion PR create execute result is missing an absolute integration worktree path.", prCreateExecute };
  }
  if (!isLoopWorktreePath(prCreateExecute.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path is outside .myagenttool/worktrees.", prCreateExecute };
  }
  if (!safeIsDirectory(prCreateExecute.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path does not exist.", prCreateExecute };
  }
  return { ok: true, prCreateExecute };
}

export function readLoopWorktreePromotionPrMergeExecuteInputs(entry) {
  const repoRoot = requireLoopPromotionRepoRoot();
  const prMergePrepPath = resolve(repoRoot, loopRunPath(entry.runId, "worktree-promotion-pr-merge-prep-result.json"));
  const prMergePrep = readOptionalJson(prMergePrepPath);
  if (!prMergePrep) {
    return { ok: false, reason: "Missing worktree-promotion-pr-merge-prep-result.json. Run loop-worktree-promotion-pr-merge-prep first.", prMergePrep: null };
  }
  if (prMergePrep.status !== "ready") {
    return { ok: false, reason: `Promotion PR merge prep status must be ready, got ${prMergePrep.status ?? "unknown"}.`, prMergePrep };
  }
  if (!prMergePrep.prNumber) {
    return { ok: false, reason: "Promotion PR merge prep result is missing PR number.", prMergePrep };
  }
  if (!prMergePrep.prUrl) {
    return { ok: false, reason: "Promotion PR merge prep result is missing PR URL.", prMergePrep };
  }
  if (!prMergePrep.headBranch) {
    return { ok: false, reason: "Promotion PR merge prep result is missing head branch.", prMergePrep };
  }
  if (!prMergePrep.baseBranch) {
    return { ok: false, reason: "Promotion PR merge prep result is missing base branch.", prMergePrep };
  }
  if (!prMergePrep.commitSha) {
    return { ok: false, reason: "Promotion PR merge prep result is missing commit SHA.", prMergePrep };
  }
  if (!prMergePrep.remote) {
    return { ok: false, reason: "Promotion PR merge prep result is missing remote.", prMergePrep };
  }
  if (!prMergePrep.remoteHeadMatchesCommit) {
    return { ok: false, reason: "Promotion PR merge prep result must confirm remote head matches commit.", prMergePrep };
  }
  if (!prMergePrep.integrationWorktreePath || !isAbsolute(prMergePrep.integrationWorktreePath)) {
    return { ok: false, reason: "Promotion PR merge prep result is missing an absolute integration worktree path.", prMergePrep };
  }
  if (!isLoopWorktreePath(prMergePrep.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path is outside .myagenttool/worktrees.", prMergePrep };
  }
  if (!safeIsDirectory(prMergePrep.integrationWorktreePath)) {
    return { ok: false, reason: "Integration worktree path does not exist.", prMergePrep };
  }
  return { ok: true, prMergePrep };
}

export function finishLoopWorktreePromotionRefusal({ args, entry, record, approval, reason }) {
  const promotion = {
    status: "refused",
    requestedAt: new Date().toISOString(),
    approval,
    reason,
    parentRunId: entry.runId,
    childRunId: record.childRunId,
    worktreePath: record.worktreePath,
  };
  updateLoopWorkerResult(entry, { promotion });
  appendLoopEvent(entry, "loop_worktree_promotion_refused", entry.state, reason, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    reason,
  });
  const result = { promotion };
  if (!args.includes("--json")) {
    console.log(`Isolated worktree promotion refused: ${reason}`);
  }
  return result;
}

export function finishLoopWorktreePromotionApply({ args, entry, record, approval, requestedAt, status, reason, parentDirtyStatus = "", integration = null, exitCode }) {
  const result = buildLoopWorktreePromotionApplyResult({
    entry,
    record,
    approval,
    requestedAt,
    status,
    reason,
    parentDirtyStatus,
    integration,
  });
  const evidence = writeLoopWorktreePromotionApplyEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionApply: { ...result, evidence } });
  const eventType = status === "failed" ? "loop_worktree_promotion_apply_failed" : "loop_worktree_promotion_apply_refused";
  appendLoopEvent(entry, eventType, entry.state, reason, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    reason,
    integrationWorktreePath: integration?.worktreePath ?? null,
    integrationBranch: integration?.branch ?? null,
    evidence,
  });
  const payload = { promotionApply: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(`Isolated worktree promotion apply ${status}: ${reason}`);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

export function finishLoopWorktreePromotionVerify({ args, entry, record, approval, commandId, requestedAt, status, reason, exitCode }) {
  const result = buildLoopWorktreePromotionVerifyResult({
    entry,
    record,
    applyResult: null,
    approval,
    commandId,
    command: loopPromotionVerifyCommand(commandId),
    requestedAt,
    startedAt: null,
    status,
    reason,
    verification: { exitCode: null, stdout: "", stderr: "" },
  });
  const evidence = writeLoopWorktreePromotionVerifyEvidence(entry, result, { stdout: "", stderr: "" });
  updateLoopWorkerResult(entry, { promotionVerify: { ...result, evidence } });
  appendLoopEvent(entry, "loop_worktree_promotion_verify_refused", entry.state, reason, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    commandId,
    reason,
    evidence,
  });
  const payload = { promotionVerify: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(`Isolated worktree promotion verification refused: ${reason}`);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

export function finishLoopWorktreePromotionPrPrep({ args, entry, record, approval, requestedAt, status, reason, exitCode }) {
  const result = buildLoopWorktreePromotionPrPrepResult({
    entry,
    record,
    approval,
    requestedAt,
    status,
    reason,
    applyResult: null,
    verifyResult: null,
    changedFiles: [],
    diffStat: "",
    dirtyStatus: "",
  });
  const body = formatLoopWorktreePromotionPrBody(result);
  const checklist = formatLoopWorktreePromotionPrChecklist(result);
  const evidence = writeLoopWorktreePromotionPrPrepEvidence(entry, result, body, checklist);
  updateLoopWorkerResult(entry, { promotionPrPrep: { ...result, evidence } });
  appendLoopEvent(entry, "loop_worktree_promotion_pr_prep_refused", entry.state, reason, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    reason,
    evidence,
  });
  const payload = { promotionPrPrep: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(`Isolated worktree promotion PR prep refused: ${reason}`);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

export function finishLoopWorktreePromotionCommit({ args, entry, record, approval, requestedAt, status, reason, exitCode }) {
  const result = buildLoopWorktreePromotionCommitResult({
    entry,
    record,
    approval,
    requestedAt,
    status,
    reason,
    applyResult: null,
    verifyResult: null,
    prPrep: null,
    message: null,
    commitSha: null,
    changedFiles: [],
    preCommitStatus: "",
    postCommitStatus: "",
  });
  const evidence = writeLoopWorktreePromotionCommitEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionCommit: { ...result, evidence } });
  appendLoopEvent(entry, status === "failed" ? "loop_worktree_promotion_commit_failed" : "loop_worktree_promotion_commit_refused", entry.state, reason, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    reason,
    evidence,
  });
  const payload = { promotionCommit: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(`Isolated worktree promotion commit ${status}: ${reason}`);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

export function finishLoopWorktreePromotionPushPlan({ args, entry, record, approval, remote, requestedAt, status, reason, commitResult = null, prPrep = null, head = null, dirtyStatus = "", remoteUrl = "", remoteNames = [], risks = [], exitCode }) {
  const result = buildLoopWorktreePromotionPushPlanResult({
    entry,
    record,
    approval,
    requestedAt,
    status,
    reason,
    remote,
    remoteUrl,
    remoteNames,
    risks,
    commitResult,
    prPrep,
    head,
    dirtyStatus,
  });
  const evidence = writeLoopWorktreePromotionPushPlanEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPushPlan: { ...result, evidence } });
  appendLoopEvent(entry, "loop_worktree_promotion_push_plan_refused", entry.state, reason, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    remote,
    reason,
    evidence,
  });
  const payload = { promotionPushPlan: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(`Isolated worktree promotion push plan refused: ${reason}`);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

export function finishLoopWorktreePromotionPushPreflight({ args, entry, record, approval, requestedAt, status, reason, pushPlan = null, head = null, currentBranch = null, dirtyStatus = "", includeDryRun = false, checks = [], exitCode }) {
  const result = buildLoopWorktreePromotionPushPreflightResult({
    entry,
    record,
    approval,
    requestedAt,
    status,
    reason,
    pushPlan,
    head,
    currentBranch,
    dirtyStatus,
    includeDryRun,
    checks,
  });
  const evidence = writeLoopWorktreePromotionPushPreflightEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPushPreflight: { ...result, evidence } });
  appendLoopEvent(entry, "loop_worktree_promotion_push_preflight_refused", entry.state, reason, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    dryRun: includeDryRun,
    reason,
    evidence,
  });
  const payload = { promotionPushPreflight: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(`Isolated worktree promotion push preflight refused: ${reason}`);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

export function finishLoopWorktreePromotionPushExecute({ args, entry, record, approval, confirmCommit, requestedAt, status, reason, preflight = null, head = null, currentBranch = null, dirtyStatus = "", push = null, remoteHead = null, exitCode }) {
  const result = buildLoopWorktreePromotionPushExecuteResult({
    entry,
    record,
    approval,
    confirmCommit,
    requestedAt,
    startedAt: null,
    status,
    reason,
    preflight,
    head,
    currentBranch,
    dirtyStatus,
    push,
    remoteHead,
  });
  const evidence = writeLoopWorktreePromotionPushExecuteEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPushExecute: { ...result, evidence } });
  appendLoopEvent(entry, "loop_worktree_promotion_push_execute_refused", entry.state, reason, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    confirmCommit,
    reason,
    evidence,
  });
  const payload = { promotionPushExecute: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(`Isolated worktree promotion push execute refused: ${reason}`);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

export function finishLoopWorktreePromotionPrCreatePrep({ args, entry, record, approval, baseBranch, requestedAt, status, reason, pushExecute = null, remoteHead = null, exitCode }) {
  const result = buildLoopWorktreePromotionPrCreatePrepResult({
    entry,
    record,
    approval,
    baseBranch,
    requestedAt,
    status,
    reason,
    pushExecute,
    prPrep: null,
    prBody: "",
    prChecklist: "",
    remoteHead,
  });
  const evidence = writeLoopWorktreePromotionPrCreatePrepEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPrCreatePrep: { ...result, evidence } });
  appendLoopEvent(entry, "loop_worktree_promotion_pr_create_prep_refused", entry.state, reason, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    baseBranch,
    reason,
    evidence,
  });
  const payload = { promotionPrCreatePrep: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(`Isolated worktree promotion PR create prep refused: ${reason}`);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

export function finishLoopWorktreePromotionPrCreateExecute({ args, entry, record, approval, confirmHead, requestedAt, status, reason, prCreatePrep = null, remoteHead = null, gh = null, pr = null, exitCode }) {
  const result = buildLoopWorktreePromotionPrCreateExecuteResult({
    entry,
    record,
    approval,
    confirmHead,
    requestedAt,
    startedAt: null,
    status,
    reason,
    prCreatePrep,
    remoteHead,
    gh,
    pr,
  });
  const evidence = writeLoopWorktreePromotionPrCreateExecuteEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPrCreateExecute: { ...result, evidence } });
  appendLoopEvent(entry, "loop_worktree_promotion_pr_create_execute_refused", entry.state, reason, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    confirmHead,
    reason,
    evidence,
  });
  const payload = { promotionPrCreateExecute: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(`Isolated worktree promotion PR create execute refused: ${reason}`);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

export function finishLoopWorktreePromotionPrMergePrep({ args, entry, record, approval, confirmPr, allowNoChecks, requestedAt, status, reason, prCreateExecute = null, remoteHead = null, prView = null, prViewData = null, checks = null, checksData = null, blockers = [], exitCode }) {
  const result = buildLoopWorktreePromotionPrMergePrepResult({
    entry,
    record,
    approval,
    confirmPr,
    allowNoChecks,
    requestedAt,
    startedAt: null,
    status,
    reason,
    blockers,
    prCreateExecute,
    remoteHead,
    prView,
    prViewData,
    checks,
    checksData,
  });
  const evidence = writeLoopWorktreePromotionPrMergePrepEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPrMergePrep: { ...result, evidence } });
  appendLoopEvent(entry, "loop_worktree_promotion_pr_merge_prep_refused", entry.state, reason, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    confirmPr,
    allowNoChecks,
    reason,
    evidence,
  });
  const payload = { promotionPrMergePrep: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(`Isolated worktree promotion PR merge prep refused: ${reason}`);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

export function finishLoopWorktreePromotionPrMergeExecute({ args, entry, record, approval, confirmPr, confirmCommit, mergeMethod, requestedAt, status, reason, prMergePrep = null, remoteHead = null, prView = null, prViewData = null, checks = null, checksData = null, blockers = [], merge = null, exitCode }) {
  const result = buildLoopWorktreePromotionPrMergeExecuteResult({
    entry,
    record,
    approval,
    confirmPr,
    confirmCommit,
    mergeMethod,
    requestedAt,
    startedAt: null,
    status,
    reason,
    blockers,
    prMergePrep,
    remoteHead,
    prView,
    prViewData,
    checks,
    checksData,
    merge,
  });
  const evidence = writeLoopWorktreePromotionPrMergeExecuteEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPrMergeExecute: { ...result, evidence } });
  appendLoopEvent(entry, "loop_worktree_promotion_pr_merge_execute_refused", entry.state, reason, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    confirmPr,
    confirmCommit,
    mergeMethod,
    reason,
    blockers,
    evidence,
  });
  const payload = { promotionPrMergeExecute: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(`Isolated worktree promotion PR merge execute refused: ${reason}`);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}
