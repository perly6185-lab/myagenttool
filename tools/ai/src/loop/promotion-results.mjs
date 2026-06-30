import { loopRunPath } from "./registry.mjs";
import {
  isPassingLoopWorktreePromotionPrCheck,
  normalizeLoopWorktreePromotionGhResult,
} from "./promotion-github.mjs";

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
