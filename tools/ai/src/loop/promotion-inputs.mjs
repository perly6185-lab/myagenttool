import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { loopRunPath } from "./registry.mjs";
import { isLoopWorktreePath } from "./worktree.mjs";

const loopPromotionInputsContext = {
  repoRoot: null,
  readOptionalJson: null,
  safeIsDirectory: null,
};

export function configureLoopPromotionInputsContext(context) {
  loopPromotionInputsContext.repoRoot = context.repoRoot;
  loopPromotionInputsContext.readOptionalJson = context.readOptionalJson;
  loopPromotionInputsContext.safeIsDirectory = context.safeIsDirectory;
}

function requireLoopPromotionRepoRoot() {
  if (!loopPromotionInputsContext.repoRoot) {
    throw new Error("Loop promotion inputs context has not been configured.");
  }
  return loopPromotionInputsContext.repoRoot;
}

function readOptionalJson(path) {
  if (!loopPromotionInputsContext.readOptionalJson) {
    throw new Error("Loop promotion inputs readOptionalJson dependency has not been configured.");
  }
  return loopPromotionInputsContext.readOptionalJson(path);
}

function safeIsDirectory(path) {
  if (!loopPromotionInputsContext.safeIsDirectory) {
    throw new Error("Loop promotion inputs safeIsDirectory dependency has not been configured.");
  }
  return loopPromotionInputsContext.safeIsDirectory(path);
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
