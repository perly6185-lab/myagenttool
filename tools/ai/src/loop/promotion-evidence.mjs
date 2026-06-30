import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loopRunPath } from "./registry.mjs";
import {
  formatLoopWorktreePromotionApplyResult,
  formatLoopWorktreePromotionCommitResult,
  formatLoopWorktreePromotionPlan,
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

const loopPromotionEvidenceContext = {
  repoRoot: null,
};

export function configureLoopPromotionEvidenceContext(context) {
  loopPromotionEvidenceContext.repoRoot = context.repoRoot;
}

function requireLoopPromotionRepoRoot() {
  if (!loopPromotionEvidenceContext.repoRoot) {
    throw new Error("Loop promotion evidence context has not been configured.");
  }
  return loopPromotionEvidenceContext.repoRoot;
}

function loopPromotionRunDir(entry) {
  return resolve(requireLoopPromotionRepoRoot(), entry.runDir);
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
