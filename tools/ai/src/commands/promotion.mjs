import { execFileSync } from "node:child_process";

import { appendLoopEvent, loopRunPath } from "../loop/registry.mjs";
import {
  buildLoopWorktreeDiff,
  buildLoopWorktreeReview,
  childProcessErrorMessage,
  gitOutputAllowExitForRoot,
  gitOutputForRoot,
  gitStatusForRoot,
  loopWorktreeRecordFromEntry,
  loopWorktreeReviewValidationError,
  partitionWorktreesForReclaim,
  updateLoopWorkerResult,
  writeLoopWorktreeReviewEvidence,
} from "../loop/worktree.mjs";
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
  formatLoopWorktreePromotionPushExecuteResult,
  formatLoopWorktreePromotionPushPlan,
  formatLoopWorktreePromotionPushPreflightResult,
  formatLoopWorktreePromotionVerifyResult,
} from "../loop/formatters.mjs";
import {
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
  checkPatchApplies,
  createLoopPromotionIntegrationWorktree,
  defaultLoopPromotionCommitMessage,
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
  normalizeLoopWorktreePromotionMergeMethod,
  parseLoopWorktreePromotionGhJsonArray,
  parseLoopWorktreePromotionGhJsonObject,
  parseLoopWorktreePromotionGhPrCreateOutput,
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
  readLoopWorktreePromotionRemoteHead,
  readLoopWorktreePromotionVerifyInputs,
  runLoopPromotionVerifyCommand,
  runLoopWorktreePromotionGhCommand,
  runLoopWorktreePromotionPrCreateCommand,
  runLoopWorktreePromotionPrMergeCommand,
  runLoopWorktreePromotionPushExecuteCommand,
  runLoopWorktreePromotionPushPreflightChecks,
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
} from "../loop/promotion.mjs";

let repoRoot = null;
const loopPromotionCommandsContext = {
  fail: null,
  lines: null,
  option: null,
  requireLoopWorktreeEntry: null,
  uniqueStrings: null,
};

export function configureLoopPromotionCommandsContext(context) {
  repoRoot = context.repoRoot;
  loopPromotionCommandsContext.fail = context.fail;
  loopPromotionCommandsContext.lines = context.lines;
  loopPromotionCommandsContext.option = context.option;
  loopPromotionCommandsContext.requireLoopWorktreeEntry = context.requireLoopWorktreeEntry;
  loopPromotionCommandsContext.uniqueStrings = context.uniqueStrings;
}

function requireLoopPromotionCommandsDependency(name) {
  const dependency = loopPromotionCommandsContext[name];
  if (!dependency) throw new Error("Loop promotion command dependency has not been configured: " + name);
  return dependency;
}

function fail(...args) {
  return requireLoopPromotionCommandsDependency("fail")(...args);
}

function lines(...args) {
  return requireLoopPromotionCommandsDependency("lines")(...args);
}

function option(...args) {
  return requireLoopPromotionCommandsDependency("option")(...args);
}

function requireLoopWorktreeEntry(...args) {
  return requireLoopPromotionCommandsDependency("requireLoopWorktreeEntry")(...args);
}

function uniqueStrings(...args) {
  return requireLoopPromotionCommandsDependency("uniqueStrings")(...args);
}

export function loopWorktreePromote(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  appendLoopEvent(entry, "loop_worktree_promotion_requested", entry.state, "Isolated worktree promotion requested.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
  });
  if (!approval.trim()) {
    const refusal = finishLoopWorktreePromotionRefusal({ args, entry, record, approval, reason: "Worktree promotion requires --approval." });
    if (args.includes("--json")) console.log(`${JSON.stringify(refusal, null, 2)}\n`.trimEnd());
    process.exit(1);
  }
  const validationError = loopWorktreeReviewValidationError(record);
  if (validationError) {
    const refusal = finishLoopWorktreePromotionRefusal({ args, entry, record, approval, reason: validationError });
    if (args.includes("--json")) console.log(`${JSON.stringify(refusal, null, 2)}\n`.trimEnd());
    process.exit(1);
  }
  const diff = buildLoopWorktreeDiff(record);
  const review = buildLoopWorktreeReview({ record, diff });
  const reviewPaths = writeLoopWorktreeReviewEvidence(entry, review);
  const plan = buildLoopWorktreePromotionPlan({ record, review, approval });
  const promotionPaths = writeLoopWorktreePromotionEvidence(entry, plan, diff.patch);
  updateLoopWorkerResult(entry, {
    worktreeReview: { ...review, evidence: reviewPaths },
    promotion: { ...plan, evidence: promotionPaths },
  });
  appendLoopEvent(entry, "loop_worktree_review_written", entry.state, "Isolated worktree review evidence written.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    changedFiles: review.changedFiles,
    evidence: reviewPaths,
  });
  appendLoopEvent(entry, "loop_worktree_promotion_planned", entry.state, "Isolated worktree promotion plan written.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    changedFiles: review.changedFiles,
    evidence: promotionPaths,
  });
  const result = { review: { ...review, evidence: reviewPaths }, promotion: { ...plan, evidence: promotionPaths } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(result, null, 2)}\n`.trimEnd());
    return;
  }
  console.log(formatLoopWorktreePromotionPlan({ ...plan, evidence: promotionPaths }));
}

export function loopWorktreePromotionApply(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const requestedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_apply_requested", entry.state, "Isolated worktree promotion apply requested.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
  });

  if (!approval.trim()) {
    finishLoopWorktreePromotionApply({ args, entry, record, approval, requestedAt, status: "refused", reason: "Worktree promotion apply requires --approval.", exitCode: 1 });
    return;
  }

  const validationError = loopWorktreeReviewValidationError(record);
  if (validationError) {
    finishLoopWorktreePromotionApply({ args, entry, record, approval, requestedAt, status: "refused", reason: validationError, exitCode: 1 });
    return;
  }

  const promotionInputs = readLoopWorktreePromotionApplyInputs(entry);
  if (!promotionInputs.ok) {
    finishLoopWorktreePromotionApply({ args, entry, record, approval, requestedAt, status: "refused", reason: promotionInputs.reason, exitCode: 1 });
    return;
  }

  const parentDirtyStatus = gitStatusForRoot(repoRoot);
  if (parentDirtyStatus.trim()) {
    finishLoopWorktreePromotionApply({
      args,
      entry,
      record,
      approval,
      requestedAt,
      status: "refused",
      reason: "Worktree promotion apply refused on dirty parent workspace.",
      parentDirtyStatus,
      exitCode: 1,
    });
    return;
  }

  const patchCheck = checkPatchApplies(repoRoot, promotionInputs.patchPath);
  appendLoopEvent(entry, "loop_worktree_promotion_apply_checked", entry.state, patchCheck.ok ? "Promotion patch apply check passed." : "Promotion patch apply check failed.", {
    patch: loopRunPath(entry.runId, "worktree.patch"),
    ok: patchCheck.ok,
    error: patchCheck.error,
  });
  if (!patchCheck.ok) {
    finishLoopWorktreePromotionApply({
      args,
      entry,
      record,
      approval,
      requestedAt,
      status: "refused",
      reason: `git apply --check failed: ${patchCheck.error}`,
      exitCode: 1,
    });
    return;
  }

  let integration = null;
  try {
    integration = createLoopPromotionIntegrationWorktree({ entry, record });
    gitOutputForRoot(integration.worktreePath, ["apply", promotionInputs.patchPath]);
    const result = buildLoopWorktreePromotionApplyResult({
      entry,
      record,
      approval,
      requestedAt,
      status: "succeeded",
      promotionPlan: promotionInputs.plan,
      integration,
      parentDirtyStatus,
    });
    const evidence = writeLoopWorktreePromotionApplyEvidence(entry, result);
    updateLoopWorkerResult(entry, { promotionApply: { ...result, evidence } });
    appendLoopEvent(entry, "loop_worktree_promotion_apply_succeeded", entry.state, "Promotion patch applied to isolated integration worktree.", {
      worktreePath: record.worktreePath,
      childRunId: record.childRunId,
      integrationWorktreePath: integration.worktreePath,
      integrationBranch: integration.branch,
      changedFiles: result.changedFiles,
      evidence,
    });
    const payload = { promotionApply: { ...result, evidence } };
    if (args.includes("--json")) {
      console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
      return;
    }
    console.log(formatLoopWorktreePromotionApplyResult(payload.promotionApply));
  } catch (error) {
    finishLoopWorktreePromotionApply({
      args,
      entry,
      record,
      approval,
      requestedAt,
      status: "failed",
      reason: childProcessErrorMessage(error),
      integration,
      exitCode: 1,
    });
  }
}

export function loopWorktreePromotionVerify(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const commandId = option(args, "--command") ?? "git-status";
  const requestedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_verify_requested", entry.state, "Isolated promotion verification requested.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    commandId,
    approval,
  });

  const command = loopPromotionVerifyCommand(commandId);
  if (!approval.trim()) {
    finishLoopWorktreePromotionVerify({ args, entry, record, approval, commandId, requestedAt, status: "refused", reason: "Worktree promotion verification requires --approval.", exitCode: 1 });
    return;
  }
  if (!command) {
    finishLoopWorktreePromotionVerify({ args, entry, record, approval, commandId, requestedAt, status: "refused", reason: `Verification command is not allowed: ${commandId}`, exitCode: 1 });
    return;
  }

  const applyInputs = readLoopWorktreePromotionVerifyInputs(entry);
  if (!applyInputs.ok) {
    finishLoopWorktreePromotionVerify({ args, entry, record, approval, commandId, requestedAt, status: "refused", reason: applyInputs.reason, exitCode: 1 });
    return;
  }

  appendLoopEvent(entry, "loop_worktree_promotion_verify_started", entry.state, "Promotion verification started.", {
    commandId,
    command: [command.command, ...command.args].join(" "),
    integrationWorktreePath: applyInputs.applyResult.integrationWorktreePath,
    integrationBranch: applyInputs.applyResult.integrationBranch,
  });

  const startedAt = new Date().toISOString();
  const verification = runLoopPromotionVerifyCommand(command, applyInputs.applyResult.integrationWorktreePath);
  const status = verification.exitCode === 0 ? "succeeded" : "failed";
  const result = buildLoopWorktreePromotionVerifyResult({
    entry,
    record,
    applyResult: applyInputs.applyResult,
    approval,
    commandId,
    command,
    requestedAt,
    startedAt,
    status,
    verification,
  });
  const evidence = writeLoopWorktreePromotionVerifyEvidence(entry, result, verification);
  updateLoopWorkerResult(entry, { promotionVerify: { ...result, evidence } });
  appendLoopEvent(entry, status === "succeeded" ? "loop_worktree_promotion_verify_succeeded" : "loop_worktree_promotion_verify_failed", entry.state, status === "succeeded" ? "Promotion verification succeeded." : "Promotion verification failed.", {
    commandId,
    exitCode: verification.exitCode,
    integrationWorktreePath: applyInputs.applyResult.integrationWorktreePath,
    integrationBranch: applyInputs.applyResult.integrationBranch,
    evidence,
  });
  const payload = { promotionVerify: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
    if (status !== "succeeded") process.exit(1);
    return;
  }
  console.log(formatLoopWorktreePromotionVerifyResult(payload.promotionVerify));
  if (status !== "succeeded") process.exit(1);
}

export function loopWorktreePromotionPrPrep(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const requestedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_pr_prep_requested", entry.state, "Promotion PR preparation requested.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
  });

  if (!approval.trim()) {
    finishLoopWorktreePromotionPrPrep({ args, entry, record, approval, requestedAt, status: "refused", reason: "Worktree promotion PR prep requires --approval.", exitCode: 1 });
    return;
  }

  const inputs = readLoopWorktreePromotionPrPrepInputs(entry);
  if (!inputs.ok) {
    finishLoopWorktreePromotionPrPrep({ args, entry, record, approval, requestedAt, status: "refused", reason: inputs.reason, exitCode: 1 });
    return;
  }

  const diffStat = gitOutputForRoot(inputs.applyResult.integrationWorktreePath, ["diff", "--stat", "HEAD", "--"]);
  const changedFiles = uniqueStrings([
    ...lines(gitOutputForRoot(inputs.applyResult.integrationWorktreePath, ["diff", "--name-only", "HEAD", "--"])),
    ...(inputs.applyResult.changedFiles ?? []),
  ]);
  const dirtyStatus = gitStatusForRoot(inputs.applyResult.integrationWorktreePath);
  const result = buildLoopWorktreePromotionPrPrepResult({
    entry,
    record,
    approval,
    requestedAt,
    applyResult: inputs.applyResult,
    verifyResult: inputs.verifyResult,
    changedFiles,
    diffStat,
    dirtyStatus,
  });
  const body = formatLoopWorktreePromotionPrBody(result);
  const checklist = formatLoopWorktreePromotionPrChecklist(result);
  const evidence = writeLoopWorktreePromotionPrPrepEvidence(entry, result, body, checklist);
  updateLoopWorkerResult(entry, { promotionPrPrep: { ...result, evidence } });
  appendLoopEvent(entry, "loop_worktree_promotion_pr_prep_written", entry.state, "Promotion PR preparation evidence written.", {
    integrationWorktreePath: result.integrationWorktreePath,
    integrationBranch: result.integrationBranch,
    changedFiles: result.changedFiles,
    evidence,
  });
  const payload = { promotionPrPrep: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
    return;
  }
  console.log(body);
}

export function loopWorktreePromotionCommit(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const requestedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_commit_requested", entry.state, "Promotion commit requested.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
  });

  if (!approval.trim()) {
    finishLoopWorktreePromotionCommit({ args, entry, record, approval, requestedAt, status: "refused", reason: "Worktree promotion commit requires --approval.", exitCode: 1 });
    return;
  }

  const inputs = readLoopWorktreePromotionCommitInputs(entry);
  if (!inputs.ok) {
    finishLoopWorktreePromotionCommit({ args, entry, record, approval, requestedAt, status: "refused", reason: inputs.reason, exitCode: 1 });
    return;
  }

  const dirtyStatus = gitStatusForRoot(inputs.applyResult.integrationWorktreePath);
  const changedFiles = uniqueStrings([
    ...lines(gitOutputForRoot(inputs.applyResult.integrationWorktreePath, ["diff", "--name-only", "HEAD", "--"])),
    ...lines(gitOutputForRoot(inputs.applyResult.integrationWorktreePath, ["ls-files", "--others", "--exclude-standard"])),
    ...(inputs.prPrep.changedFiles ?? []),
  ]);
  if (!dirtyStatus.trim() || changedFiles.length === 0) {
    finishLoopWorktreePromotionCommit({
      args,
      entry,
      record,
      approval,
      requestedAt,
      status: "refused",
      reason: "Promotion commit refused because integration worktree has no pending changes.",
      exitCode: 1,
    });
    return;
  }

  const message = (option(args, "--message") ?? defaultLoopPromotionCommitMessage({ entry, record, prPrep: inputs.prPrep })).trim();
  if (!message) {
    finishLoopWorktreePromotionCommit({ args, entry, record, approval, requestedAt, status: "refused", reason: "Promotion commit message is empty.", exitCode: 1 });
    return;
  }

  try {
    gitOutputForRoot(inputs.applyResult.integrationWorktreePath, ["add", "--", ...changedFiles]);
    gitOutputForRoot(inputs.applyResult.integrationWorktreePath, ["commit", "-m", message]);
    const commitSha = gitOutputForRoot(inputs.applyResult.integrationWorktreePath, ["rev-parse", "HEAD"]);
    const postCommitStatus = gitStatusForRoot(inputs.applyResult.integrationWorktreePath);
    const result = buildLoopWorktreePromotionCommitResult({
      entry,
      record,
      approval,
      requestedAt,
      status: "succeeded",
      applyResult: inputs.applyResult,
      verifyResult: inputs.verifyResult,
      prPrep: inputs.prPrep,
      message,
      commitSha,
      changedFiles,
      preCommitStatus: dirtyStatus,
      postCommitStatus,
    });
    const evidence = writeLoopWorktreePromotionCommitEvidence(entry, result);
    updateLoopWorkerResult(entry, { promotionCommit: { ...result, evidence } });
    appendLoopEvent(entry, "loop_worktree_promotion_commit_succeeded", entry.state, "Promotion commit created in isolated integration worktree.", {
      integrationWorktreePath: result.integrationWorktreePath,
      integrationBranch: result.integrationBranch,
      commitSha,
      changedFiles,
      evidence,
    });
    const payload = { promotionCommit: { ...result, evidence } };
    if (args.includes("--json")) {
      console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
      return;
    }
    console.log(formatLoopWorktreePromotionCommitResult(payload.promotionCommit));
  } catch (error) {
    finishLoopWorktreePromotionCommit({
      args,
      entry,
      record,
      approval,
      requestedAt,
      status: "failed",
      reason: childProcessErrorMessage(error),
      exitCode: 1,
    });
  }
}

export function loopWorktreePromotionPushPlan(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const remote = option(args, "--remote") ?? "origin";
  const requestedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_push_plan_requested", entry.state, "Promotion push plan requested.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    remote,
    approval,
  });

  if (!approval.trim()) {
    finishLoopWorktreePromotionPushPlan({ args, entry, record, approval, remote, requestedAt, status: "refused", reason: "Worktree promotion push plan requires --approval.", exitCode: 1 });
    return;
  }

  const inputs = readLoopWorktreePromotionPushPlanInputs(entry);
  if (!inputs.ok) {
    finishLoopWorktreePromotionPushPlan({ args, entry, record, approval, remote, requestedAt, status: "refused", reason: inputs.reason, exitCode: 1 });
    return;
  }

  const worktreePath = inputs.commitResult.integrationWorktreePath;
  const head = gitOutputForRoot(worktreePath, ["rev-parse", "HEAD"]);
  if (head !== inputs.commitResult.commitSha) {
    finishLoopWorktreePromotionPushPlan({
      args,
      entry,
      record,
      approval,
      remote,
      requestedAt,
      status: "refused",
      reason: "Promotion push plan refused because integration HEAD does not match commit evidence.",
      commitResult: inputs.commitResult,
      prPrep: inputs.prPrep,
      head,
      exitCode: 1,
    });
    return;
  }
  const dirtyStatus = gitStatusForRoot(worktreePath);
  if (dirtyStatus.trim()) {
    finishLoopWorktreePromotionPushPlan({
      args,
      entry,
      record,
      approval,
      remote,
      requestedAt,
      status: "refused",
      reason: "Promotion push plan refused on dirty integration worktree.",
      commitResult: inputs.commitResult,
      prPrep: inputs.prPrep,
      head,
      dirtyStatus,
      exitCode: 1,
    });
    return;
  }

  const remoteUrl = gitOutputAllowExitForRoot(worktreePath, ["remote", "get-url", remote], [2, 128]);
  const remoteNames = lines(gitOutputForRoot(worktreePath, ["remote"]));
  const risks = buildLoopPromotionPushPlanRisks({ remote, remoteUrl, remoteNames, branch: inputs.commitResult.integrationBranch });
  const result = buildLoopWorktreePromotionPushPlanResult({
    entry,
    record,
    approval,
    requestedAt,
    remote,
    remoteUrl,
    remoteNames,
    risks,
    commitResult: inputs.commitResult,
    prPrep: inputs.prPrep,
    head,
    dirtyStatus,
  });
  const evidence = writeLoopWorktreePromotionPushPlanEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPushPlan: { ...result, evidence } });
  appendLoopEvent(entry, "loop_worktree_promotion_push_plan_written", entry.state, "Promotion push plan evidence written.", {
    integrationWorktreePath: result.integrationWorktreePath,
    integrationBranch: result.integrationBranch,
    remote,
    refspec: result.refspec,
    risks,
    evidence,
  });
  const payload = { promotionPushPlan: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
    return;
  }
  console.log(formatLoopWorktreePromotionPushPlan(result));
}

export function loopWorktreePromotionPushPreflight(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const includeDryRun = args.includes("--dry-run");
  const requestedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_push_preflight_requested", entry.state, "Promotion push preflight requested.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    dryRun: includeDryRun,
  });

  if (!approval.trim()) {
    finishLoopWorktreePromotionPushPreflight({ args, entry, record, approval, requestedAt, status: "refused", reason: "Worktree promotion push preflight requires --approval.", exitCode: 1 });
    return;
  }

  const inputs = readLoopWorktreePromotionPushPreflightInputs(entry);
  if (!inputs.ok) {
    finishLoopWorktreePromotionPushPreflight({ args, entry, record, approval, requestedAt, status: "refused", reason: inputs.reason, pushPlan: inputs.pushPlan ?? null, exitCode: 1 });
    return;
  }

  const worktreePath = inputs.pushPlan.integrationWorktreePath;
  const head = gitOutputForRoot(worktreePath, ["rev-parse", "HEAD"]);
  if (head !== inputs.pushPlan.commitSha) {
    finishLoopWorktreePromotionPushPreflight({
      args,
      entry,
      record,
      approval,
      requestedAt,
      status: "refused",
      reason: "Promotion push preflight refused because integration HEAD does not match push plan commit.",
      pushPlan: inputs.pushPlan,
      head,
      exitCode: 1,
    });
    return;
  }
  const currentBranch = gitOutputForRoot(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (currentBranch !== inputs.pushPlan.integrationBranch) {
    finishLoopWorktreePromotionPushPreflight({
      args,
      entry,
      record,
      approval,
      requestedAt,
      status: "refused",
      reason: "Promotion push preflight refused because integration branch does not match push plan.",
      pushPlan: inputs.pushPlan,
      head,
      currentBranch,
      exitCode: 1,
    });
    return;
  }
  const dirtyStatus = gitStatusForRoot(worktreePath);
  if (dirtyStatus.trim()) {
    finishLoopWorktreePromotionPushPreflight({
      args,
      entry,
      record,
      approval,
      requestedAt,
      status: "refused",
      reason: "Promotion push preflight refused on dirty integration worktree.",
      pushPlan: inputs.pushPlan,
      head,
      currentBranch,
      dirtyStatus,
      exitCode: 1,
    });
    return;
  }

  const checks = runLoopWorktreePromotionPushPreflightChecks(inputs.pushPlan, {
    includeDryRun,
    worktreePath,
  });
  const failedChecks = checks.filter((check) => check.exitCode !== 0);
  const status = failedChecks.length > 0 ? "failed" : "succeeded";
  const reason = failedChecks.length > 0 ? `Promotion push preflight failed ${failedChecks.length} check(s).` : null;
  const result = buildLoopWorktreePromotionPushPreflightResult({
    entry,
    record,
    approval,
    requestedAt,
    status,
    reason,
    pushPlan: inputs.pushPlan,
    head,
    currentBranch,
    dirtyStatus,
    includeDryRun,
    checks,
  });
  const evidence = writeLoopWorktreePromotionPushPreflightEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPushPreflight: { ...result, evidence } });
  appendLoopEvent(entry, status === "succeeded" ? "loop_worktree_promotion_push_preflight_succeeded" : "loop_worktree_promotion_push_preflight_failed", entry.state, status === "succeeded" ? "Promotion push preflight succeeded." : reason, {
    integrationWorktreePath: result.integrationWorktreePath,
    integrationBranch: result.integrationBranch,
    remote: result.remote,
    refspec: result.refspec,
    dryRun: includeDryRun,
    failedChecks: failedChecks.map((check) => check.id),
    evidence,
  });
  const payload = { promotionPushPreflight: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(formatLoopWorktreePromotionPushPreflightResult(result));
  }
  if (status !== "succeeded") process.exit(1);
}

export function loopWorktreePromotionPushExecute(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const confirmCommit = option(args, "--confirm-commit") ?? "";
  const requestedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_push_execute_requested", entry.state, "Promotion push execute requested.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    confirmCommit,
  });

  if (!approval.trim()) {
    finishLoopWorktreePromotionPushExecute({ args, entry, record, approval, confirmCommit, requestedAt, status: "refused", reason: "Worktree promotion push execute requires --approval.", exitCode: 1 });
    return;
  }
  if (!confirmCommit.trim()) {
    finishLoopWorktreePromotionPushExecute({ args, entry, record, approval, confirmCommit, requestedAt, status: "refused", reason: "Worktree promotion push execute requires --confirm-commit.", exitCode: 1 });
    return;
  }

  const inputs = readLoopWorktreePromotionPushExecuteInputs(entry);
  if (!inputs.ok) {
    finishLoopWorktreePromotionPushExecute({ args, entry, record, approval, confirmCommit, requestedAt, status: "refused", reason: inputs.reason, preflight: inputs.preflight ?? null, exitCode: 1 });
    return;
  }
  if (confirmCommit !== inputs.preflight.commitSha) {
    finishLoopWorktreePromotionPushExecute({
      args,
      entry,
      record,
      approval,
      confirmCommit,
      requestedAt,
      status: "refused",
      reason: "Promotion push execute refused because --confirm-commit does not match preflight commit.",
      preflight: inputs.preflight,
      exitCode: 1,
    });
    return;
  }

  const worktreePath = inputs.preflight.integrationWorktreePath;
  const head = gitOutputForRoot(worktreePath, ["rev-parse", "HEAD"]);
  if (head !== inputs.preflight.commitSha) {
    finishLoopWorktreePromotionPushExecute({
      args,
      entry,
      record,
      approval,
      confirmCommit,
      requestedAt,
      status: "refused",
      reason: "Promotion push execute refused because integration HEAD does not match preflight commit.",
      preflight: inputs.preflight,
      head,
      exitCode: 1,
    });
    return;
  }
  const currentBranch = gitOutputForRoot(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (currentBranch !== inputs.preflight.integrationBranch) {
    finishLoopWorktreePromotionPushExecute({
      args,
      entry,
      record,
      approval,
      confirmCommit,
      requestedAt,
      status: "refused",
      reason: "Promotion push execute refused because integration branch does not match preflight.",
      preflight: inputs.preflight,
      head,
      currentBranch,
      exitCode: 1,
    });
    return;
  }
  const dirtyStatus = gitStatusForRoot(worktreePath);
  if (dirtyStatus.trim()) {
    finishLoopWorktreePromotionPushExecute({
      args,
      entry,
      record,
      approval,
      confirmCommit,
      requestedAt,
      status: "refused",
      reason: "Promotion push execute refused on dirty integration worktree.",
      preflight: inputs.preflight,
      head,
      currentBranch,
      dirtyStatus,
      exitCode: 1,
    });
    return;
  }

  const startedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_push_execute_started", entry.state, "Promotion push execute started.", {
    integrationWorktreePath: worktreePath,
    integrationBranch: inputs.preflight.integrationBranch,
    commitSha: inputs.preflight.commitSha,
    remote: inputs.preflight.remote,
    refspec: inputs.preflight.refspec,
  });
  const push = runLoopWorktreePromotionPushExecuteCommand(worktreePath, inputs.preflight);
  const remoteHead = readLoopWorktreePromotionRemoteHead(worktreePath, inputs.preflight);
  const status = push.exitCode === 0 && remoteHead === inputs.preflight.commitSha ? "succeeded" : "failed";
  const reason = status === "succeeded"
    ? null
    : push.exitCode !== 0
      ? "Promotion push execute failed during git push."
      : "Promotion push execute failed because remote head does not match the pushed commit.";
  const result = buildLoopWorktreePromotionPushExecuteResult({
    entry,
    record,
    approval,
    confirmCommit,
    requestedAt,
    startedAt,
    status,
    reason,
    preflight: inputs.preflight,
    head,
    currentBranch,
    dirtyStatus,
    push,
    remoteHead,
  });
  const evidence = writeLoopWorktreePromotionPushExecuteEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPushExecute: { ...result, evidence } });
  appendLoopEvent(entry, status === "succeeded" ? "loop_worktree_promotion_push_execute_succeeded" : "loop_worktree_promotion_push_execute_failed", entry.state, status === "succeeded" ? "Promotion push execute succeeded." : reason, {
    integrationWorktreePath: result.integrationWorktreePath,
    integrationBranch: result.integrationBranch,
    commitSha: result.commitSha,
    remote: result.remote,
    refspec: result.refspec,
    remoteHead,
    exitCode: push.exitCode,
    evidence,
  });
  const payload = { promotionPushExecute: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(formatLoopWorktreePromotionPushExecuteResult(result));
  }
  if (status !== "succeeded") process.exit(1);
}

export function loopWorktreePromotionPrCreatePrep(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const baseBranch = option(args, "--base") ?? "main";
  const requestedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_pr_create_prep_requested", entry.state, "Promotion PR create preparation requested.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    baseBranch,
  });

  if (!approval.trim()) {
    finishLoopWorktreePromotionPrCreatePrep({ args, entry, record, approval, baseBranch, requestedAt, status: "refused", reason: "Worktree promotion PR create prep requires --approval.", exitCode: 1 });
    return;
  }

  const inputs = readLoopWorktreePromotionPrCreatePrepInputs(entry);
  if (!inputs.ok) {
    finishLoopWorktreePromotionPrCreatePrep({ args, entry, record, approval, baseBranch, requestedAt, status: "refused", reason: inputs.reason, pushExecute: inputs.pushExecute ?? null, exitCode: 1 });
    return;
  }

  const remoteHead = readLoopWorktreePromotionRemoteHead(inputs.pushExecute.integrationWorktreePath, inputs.pushExecute);
  if (remoteHead !== inputs.pushExecute.commitSha) {
    finishLoopWorktreePromotionPrCreatePrep({
      args,
      entry,
      record,
      approval,
      baseBranch,
      requestedAt,
      status: "refused",
      reason: "Promotion PR create prep refused because remote head does not match pushed commit.",
      pushExecute: inputs.pushExecute,
      remoteHead,
      exitCode: 1,
    });
    return;
  }

  const result = buildLoopWorktreePromotionPrCreatePrepResult({
    entry,
    record,
    approval,
    baseBranch,
    requestedAt,
    pushExecute: inputs.pushExecute,
    prPrep: inputs.prPrep,
    prBody: inputs.prBody,
    prChecklist: inputs.prChecklist,
    remoteHead,
  });
  const evidence = writeLoopWorktreePromotionPrCreatePrepEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPrCreatePrep: { ...result, evidence } });
  appendLoopEvent(entry, "loop_worktree_promotion_pr_create_prep_written", entry.state, "Promotion PR create preparation evidence written.", {
    integrationBranch: result.integrationBranch,
    baseBranch,
    remote: result.remote,
    remoteHead,
    evidence,
  });
  const payload = { promotionPrCreatePrep: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
    return;
  }
  console.log(formatLoopWorktreePromotionPrCreatePrep(result));
}

export function loopWorktreePromotionPrCreateExecute(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const confirmHead = option(args, "--confirm-head") ?? "";
  const requestedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_pr_create_execute_requested", entry.state, "Promotion PR create execute requested.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    confirmHead,
  });

  if (!approval.trim()) {
    finishLoopWorktreePromotionPrCreateExecute({ args, entry, record, approval, confirmHead, requestedAt, status: "refused", reason: "Worktree promotion PR create execute requires --approval.", exitCode: 1 });
    return;
  }
  if (!confirmHead.trim()) {
    finishLoopWorktreePromotionPrCreateExecute({ args, entry, record, approval, confirmHead, requestedAt, status: "refused", reason: "Worktree promotion PR create execute requires --confirm-head.", exitCode: 1 });
    return;
  }

  const inputs = readLoopWorktreePromotionPrCreateExecuteInputs(entry);
  if (!inputs.ok) {
    finishLoopWorktreePromotionPrCreateExecute({ args, entry, record, approval, confirmHead, requestedAt, status: "refused", reason: inputs.reason, prCreatePrep: inputs.prCreatePrep ?? null, exitCode: 1 });
    return;
  }
  if (confirmHead !== inputs.prCreatePrep.headBranch) {
    finishLoopWorktreePromotionPrCreateExecute({
      args,
      entry,
      record,
      approval,
      confirmHead,
      requestedAt,
      status: "refused",
      reason: "Promotion PR create execute refused because --confirm-head does not match PR create prep head branch.",
      prCreatePrep: inputs.prCreatePrep,
      exitCode: 1,
    });
    return;
  }

  const remoteHead = readLoopWorktreePromotionRemoteHead(inputs.prCreatePrep.integrationWorktreePath, inputs.prCreatePrep);
  if (remoteHead !== inputs.prCreatePrep.commitSha) {
    finishLoopWorktreePromotionPrCreateExecute({
      args,
      entry,
      record,
      approval,
      confirmHead,
      requestedAt,
      status: "refused",
      reason: "Promotion PR create execute refused because remote head does not match prepared commit.",
      prCreatePrep: inputs.prCreatePrep,
      remoteHead,
      exitCode: 1,
    });
    return;
  }

  const startedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_pr_create_execute_started", entry.state, "Promotion PR create execute started.", {
    baseBranch: inputs.prCreatePrep.baseBranch,
    headBranch: inputs.prCreatePrep.headBranch,
    commitSha: inputs.prCreatePrep.commitSha,
  });
  const gh = runLoopWorktreePromotionPrCreateCommand(inputs.prCreatePrep);
  const pr = parseLoopWorktreePromotionGhPrCreateOutput(gh.stdout);
  const status = gh.exitCode === 0 && Boolean(pr.url || pr.number) ? "succeeded" : "failed";
  const reason = status === "succeeded" ? null : "Promotion PR create execute failed during gh pr create.";
  const result = buildLoopWorktreePromotionPrCreateExecuteResult({
    entry,
    record,
    approval,
    confirmHead,
    requestedAt,
    startedAt,
    status,
    reason,
    prCreatePrep: inputs.prCreatePrep,
    remoteHead,
    gh,
    pr,
  });
  const evidence = writeLoopWorktreePromotionPrCreateExecuteEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPrCreateExecute: { ...result, evidence } });
  appendLoopEvent(entry, status === "succeeded" ? "loop_worktree_promotion_pr_create_execute_succeeded" : "loop_worktree_promotion_pr_create_execute_failed", entry.state, status === "succeeded" ? "Promotion PR create execute succeeded." : reason, {
    baseBranch: result.baseBranch,
    headBranch: result.headBranch,
    commitSha: result.commitSha,
    prNumber: result.prNumber,
    prUrl: result.prUrl,
    exitCode: gh.exitCode,
    evidence,
  });
  const payload = { promotionPrCreateExecute: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(formatLoopWorktreePromotionPrCreateExecute(result));
  }
  if (status !== "succeeded") process.exit(1);
}

export function loopWorktreePromotionPrMergePrep(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const confirmPr = option(args, "--confirm-pr") ?? "";
  const allowNoChecks = args.includes("--allow-no-checks");
  const requestedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_pr_merge_prep_requested", entry.state, "Promotion PR merge prep requested.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    confirmPr,
    allowNoChecks,
  });

  if (!approval.trim()) {
    finishLoopWorktreePromotionPrMergePrep({ args, entry, record, approval, confirmPr, allowNoChecks, requestedAt, status: "refused", reason: "Worktree promotion PR merge prep requires --approval.", exitCode: 1 });
    return;
  }
  if (!confirmPr.trim()) {
    finishLoopWorktreePromotionPrMergePrep({ args, entry, record, approval, confirmPr, allowNoChecks, requestedAt, status: "refused", reason: "Worktree promotion PR merge prep requires --confirm-pr.", exitCode: 1 });
    return;
  }

  const inputs = readLoopWorktreePromotionPrMergePrepInputs(entry);
  if (!inputs.ok) {
    finishLoopWorktreePromotionPrMergePrep({ args, entry, record, approval, confirmPr, allowNoChecks, requestedAt, status: "refused", reason: inputs.reason, prCreateExecute: inputs.prCreateExecute ?? null, exitCode: 1 });
    return;
  }
  if (String(confirmPr) !== String(inputs.prCreateExecute.prNumber)) {
    finishLoopWorktreePromotionPrMergePrep({
      args,
      entry,
      record,
      approval,
      confirmPr,
      allowNoChecks,
      requestedAt,
      status: "refused",
      reason: "Promotion PR merge prep refused because --confirm-pr does not match created PR number.",
      prCreateExecute: inputs.prCreateExecute,
      exitCode: 1,
    });
    return;
  }

  const remoteHead = readLoopWorktreePromotionRemoteHead(inputs.prCreateExecute.integrationWorktreePath, inputs.prCreateExecute);
  if (remoteHead !== inputs.prCreateExecute.commitSha) {
    finishLoopWorktreePromotionPrMergePrep({
      args,
      entry,
      record,
      approval,
      confirmPr,
      allowNoChecks,
      requestedAt,
      status: "refused",
      reason: "Promotion PR merge prep refused because remote head does not match created PR commit.",
      prCreateExecute: inputs.prCreateExecute,
      remoteHead,
      exitCode: 1,
    });
    return;
  }

  const startedAt = new Date().toISOString();
  const prView = runLoopWorktreePromotionGhCommand(inputs.prCreateExecute, [
    "pr",
    "view",
    String(inputs.prCreateExecute.prNumber),
    "--json",
    "number,url,state,isDraft,mergeable,headRefName,headRefOid,baseRefName",
  ]);
  const checks = runLoopWorktreePromotionGhCommand(inputs.prCreateExecute, [
    "pr",
    "checks",
    String(inputs.prCreateExecute.prNumber),
    "--json",
    "name,state,link,bucket",
  ]);
  const prViewData = parseLoopWorktreePromotionGhJsonObject(prView.stdout);
  const checksData = parseLoopWorktreePromotionGhJsonArray(checks.stdout);
  const assessment = assessLoopWorktreePromotionPrMergePrep({
    prCreateExecute: inputs.prCreateExecute,
    remoteHead,
    prView,
    prViewData,
    checks,
    checksData,
    allowNoChecks,
  });
  const result = buildLoopWorktreePromotionPrMergePrepResult({
    entry,
    record,
    approval,
    confirmPr,
    allowNoChecks,
    requestedAt,
    startedAt,
    status: assessment.status,
    reason: assessment.reason,
    blockers: assessment.blockers,
    prCreateExecute: inputs.prCreateExecute,
    remoteHead,
    prView,
    prViewData,
    checks,
    checksData,
  });
  const evidence = writeLoopWorktreePromotionPrMergePrepEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPrMergePrep: { ...result, evidence } });
  appendLoopEvent(entry, result.status === "ready" ? "loop_worktree_promotion_pr_merge_prep_ready" : "loop_worktree_promotion_pr_merge_prep_blocked", entry.state, result.status === "ready" ? "Promotion PR merge prep is ready." : result.reason, {
    prNumber: result.prNumber,
    prUrl: result.prUrl,
    commitSha: result.commitSha,
    remoteHead,
    blockers: result.blockers,
    evidence,
  });
  const payload = { promotionPrMergePrep: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(formatLoopWorktreePromotionPrMergePrep(result));
  }
  if (result.status !== "ready") process.exit(1);
}

export function loopWorktreePromotionPrMergeExecute(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const confirmPr = option(args, "--confirm-pr") ?? "";
  const confirmCommit = option(args, "--confirm-commit") ?? "";
  const mergeMethod = option(args, "--merge-method") ?? "";
  const requestedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_pr_merge_execute_requested", entry.state, "Promotion PR merge execute requested.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    confirmPr,
    confirmCommit,
    mergeMethod,
  });

  if (!approval.trim()) {
    finishLoopWorktreePromotionPrMergeExecute({ args, entry, record, approval, confirmPr, confirmCommit, mergeMethod, requestedAt, status: "refused", reason: "Worktree promotion PR merge execute requires --approval.", exitCode: 1 });
    return;
  }
  if (!confirmPr.trim()) {
    finishLoopWorktreePromotionPrMergeExecute({ args, entry, record, approval, confirmPr, confirmCommit, mergeMethod, requestedAt, status: "refused", reason: "Worktree promotion PR merge execute requires --confirm-pr.", exitCode: 1 });
    return;
  }
  if (!confirmCommit.trim()) {
    finishLoopWorktreePromotionPrMergeExecute({ args, entry, record, approval, confirmPr, confirmCommit, mergeMethod, requestedAt, status: "refused", reason: "Worktree promotion PR merge execute requires --confirm-commit.", exitCode: 1 });
    return;
  }
  const method = normalizeLoopWorktreePromotionMergeMethod(mergeMethod);
  if (!method) {
    finishLoopWorktreePromotionPrMergeExecute({ args, entry, record, approval, confirmPr, confirmCommit, mergeMethod, requestedAt, status: "refused", reason: "Worktree promotion PR merge execute requires --merge-method squash|merge|rebase.", exitCode: 1 });
    return;
  }

  const inputs = readLoopWorktreePromotionPrMergeExecuteInputs(entry);
  if (!inputs.ok) {
    finishLoopWorktreePromotionPrMergeExecute({ args, entry, record, approval, confirmPr, confirmCommit, mergeMethod: method, requestedAt, status: "refused", reason: inputs.reason, prMergePrep: inputs.prMergePrep ?? null, exitCode: 1 });
    return;
  }
  if (String(confirmPr) !== String(inputs.prMergePrep.prNumber)) {
    finishLoopWorktreePromotionPrMergeExecute({
      args,
      entry,
      record,
      approval,
      confirmPr,
      confirmCommit,
      mergeMethod: method,
      requestedAt,
      status: "refused",
      reason: "Promotion PR merge execute refused because --confirm-pr does not match merge prep PR number.",
      prMergePrep: inputs.prMergePrep,
      exitCode: 1,
    });
    return;
  }
  if (confirmCommit !== inputs.prMergePrep.commitSha) {
    finishLoopWorktreePromotionPrMergeExecute({
      args,
      entry,
      record,
      approval,
      confirmPr,
      confirmCommit,
      mergeMethod: method,
      requestedAt,
      status: "refused",
      reason: "Promotion PR merge execute refused because --confirm-commit does not match merge prep commit.",
      prMergePrep: inputs.prMergePrep,
      exitCode: 1,
    });
    return;
  }

  const remoteHead = readLoopWorktreePromotionRemoteHead(inputs.prMergePrep.integrationWorktreePath, inputs.prMergePrep);
  if (remoteHead !== inputs.prMergePrep.commitSha) {
    finishLoopWorktreePromotionPrMergeExecute({
      args,
      entry,
      record,
      approval,
      confirmPr,
      confirmCommit,
      mergeMethod: method,
      requestedAt,
      status: "refused",
      reason: "Promotion PR merge execute refused because remote head does not match merge prep commit.",
      prMergePrep: inputs.prMergePrep,
      remoteHead,
      exitCode: 1,
    });
    return;
  }

  const prView = runLoopWorktreePromotionGhCommand(inputs.prMergePrep, [
    "pr",
    "view",
    String(inputs.prMergePrep.prNumber),
    "--json",
    "number,url,state,isDraft,mergeable,headRefName,headRefOid,baseRefName",
  ]);
  const checks = runLoopWorktreePromotionGhCommand(inputs.prMergePrep, [
    "pr",
    "checks",
    String(inputs.prMergePrep.prNumber),
    "--json",
    "name,state,link,bucket",
  ]);
  const prViewData = parseLoopWorktreePromotionGhJsonObject(prView.stdout);
  const checksData = parseLoopWorktreePromotionGhJsonArray(checks.stdout);
  const assessment = assessLoopWorktreePromotionPrMergePrep({
    prCreateExecute: inputs.prMergePrep,
    remoteHead,
    prView,
    prViewData,
    checks,
    checksData,
    allowNoChecks: inputs.prMergePrep.allowNoChecks === true,
  });
  if (assessment.status !== "ready") {
    finishLoopWorktreePromotionPrMergeExecute({
      args,
      entry,
      record,
      approval,
      confirmPr,
      confirmCommit,
      mergeMethod: method,
      requestedAt,
      status: "refused",
      reason: `Promotion PR merge execute refused because final merge prep checks are blocked: ${assessment.blockers.join(", ")}.`,
      prMergePrep: inputs.prMergePrep,
      remoteHead,
      prView,
      prViewData,
      checks,
      checksData,
      blockers: assessment.blockers,
      exitCode: 1,
    });
    return;
  }

  const startedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_promotion_pr_merge_execute_started", entry.state, "Promotion PR merge execute started.", {
    prNumber: inputs.prMergePrep.prNumber,
    prUrl: inputs.prMergePrep.prUrl,
    commitSha: inputs.prMergePrep.commitSha,
    mergeMethod: method,
  });
  const merge = runLoopWorktreePromotionPrMergeCommand(inputs.prMergePrep, method);
  const status = merge.exitCode === 0 ? "succeeded" : "failed";
  const reason = status === "succeeded" ? null : "Promotion PR merge execute failed during gh pr merge.";
  const result = buildLoopWorktreePromotionPrMergeExecuteResult({
    entry,
    record,
    approval,
    confirmPr,
    confirmCommit,
    mergeMethod: method,
    requestedAt,
    startedAt,
    status,
    reason,
    blockers: [],
    prMergePrep: inputs.prMergePrep,
    remoteHead,
    prView,
    prViewData,
    checks,
    checksData,
    merge,
  });
  const evidence = writeLoopWorktreePromotionPrMergeExecuteEvidence(entry, result);
  updateLoopWorkerResult(entry, { promotionPrMergeExecute: { ...result, evidence } });
  appendLoopEvent(entry, status === "succeeded" ? "loop_worktree_promotion_pr_merge_execute_succeeded" : "loop_worktree_promotion_pr_merge_execute_failed", entry.state, status === "succeeded" ? "Promotion PR merge execute succeeded." : reason, {
    prNumber: result.prNumber,
    prUrl: result.prUrl,
    commitSha: result.commitSha,
    mergeMethod: result.mergeMethod,
    exitCode: merge.exitCode,
    evidence,
  });
  // Fully unattended cleanup: a successful promotion merge reclaims the parent's
  // isolated worktree, riding this step's existing --approval. Best-effort — the
  // merge already succeeded, so a cleanup problem never fails it — and dirty
  // worktrees are always preserved. Opt out with --keep-worktree.
  if (status === "succeeded" && !args.includes("--keep-worktree")) {
    autoReclaimWorktreeAfterMerge(entry, approval);
  }
  const payload = { promotionPrMergeExecute: { ...result, evidence } };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(payload, null, 2)}\n`.trimEnd());
  } else {
    console.log(formatLoopWorktreePromotionPrMergeExecute(result));
  }
  if (status !== "succeeded") process.exit(1);
}

function markWorktreeReclaimed(entry, record, approval, note) {
  updateLoopWorkerResult(entry, {
    cleanup: {
      status: "completed",
      requestedAt: null,
      completedAt: new Date().toISOString(),
      approval,
      worktreePath: record.worktreePath,
      childRunId: record.childRunId,
      dirty: false,
      dirtyStatus: "",
      reason: null,
    },
    cleanupPolicy: "removed",
  });
  appendLoopEvent(entry, "loop_worktree_cleanup_completed", entry.state, note, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    dirty: false,
    autoAfterMerge: true,
    reason: null,
  });
}

// Reclaim the parent run's isolated worktree after its promotion merged. Reuses
// the tested partition decision (reclaim clean / reconcile gone / preserve dirty)
// and never throws — cleanup must not undo a completed merge.
function autoReclaimWorktreeAfterMerge(entry, approval) {
  try {
    const record = loopWorktreeRecordFromEntry(entry);
    if (!record) return;
    const { reclaim, reconcile, skip } = partitionWorktreesForReclaim([record], (path) =>
      Boolean(gitStatusForRoot(path).trim()),
    );
    for (const target of reclaim) {
      try {
        execFileSync("git", ["worktree", "remove", target.worktreePath], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        appendLoopEvent(entry, "loop_worktree_cleanup_refused", entry.state, `Auto-reclaim after merge failed: ${childProcessErrorMessage(error)}`, {
          worktreePath: target.worktreePath,
          autoAfterMerge: true,
        });
        continue;
      }
      markWorktreeReclaimed(entry, target, approval, "Isolated worktree auto-reclaimed after promotion merge.");
      console.log(`Auto-reclaimed worktree after merge: ${target.worktreePath}`);
    }
    for (const target of reconcile) {
      markWorktreeReclaimed(entry, target, approval, "Isolated worktree record reconciled after promotion merge.");
    }
    for (const entryRecord of skip) {
      appendLoopEvent(entry, "loop_worktree_cleanup_refused", entry.state, entryRecord.reason, {
        worktreePath: entryRecord.record.worktreePath,
        autoAfterMerge: true,
      });
      console.log(`Worktree preserved after merge (${entryRecord.reason}): ${entryRecord.record.worktreePath}`);
    }
  } catch (error) {
    appendLoopEvent(entry, "loop_worktree_cleanup_refused", entry.state, `Auto-reclaim after merge errored: ${childProcessErrorMessage(error)}`, {
      autoAfterMerge: true,
    });
  }
}
