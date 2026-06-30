import { appendLoopEvent } from "./registry.mjs";
import {
  formatLoopWorktreePromotionPrBody,
  formatLoopWorktreePromotionPrChecklist,
} from "./formatters.mjs";
import { updateLoopWorkerResult } from "./worktree.mjs";
import {
  writeLoopWorktreePromotionApplyEvidence,
  writeLoopWorktreePromotionCommitEvidence,
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
  buildLoopWorktreePromotionApplyResult,
  buildLoopWorktreePromotionCommitResult,
  buildLoopWorktreePromotionPrCreateExecuteResult,
  buildLoopWorktreePromotionPrCreatePrepResult,
  buildLoopWorktreePromotionPrMergeExecuteResult,
  buildLoopWorktreePromotionPrMergePrepResult,
  buildLoopWorktreePromotionPrPrepResult,
  buildLoopWorktreePromotionPushExecuteResult,
  buildLoopWorktreePromotionPushPlanResult,
  buildLoopWorktreePromotionPushPreflightResult,
  buildLoopWorktreePromotionVerifyResult,
} from "./promotion-results.mjs";

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
