import { execFileSync } from "node:child_process";

import {
  LOOP_DEFAULT_LEASE_MS,
  appendLoopEvent,
  claimLoopRun,
  findLoopRegistryEntry,
  loopRunPath,
  optionalPositiveInteger,
  updateLoopEvidence,
  updateLoopRun,
  writeLoopWorkerEvidence,
} from "../loop/registry.mjs";
import {
  createIsolatedLoopWorktree,
  worktreeDirtyReason,
} from "../loop/worktree.mjs";

let repoRoot = null;
let scriptPath = null;
const loopWorkerCommandsContext = {
  fail: null,
  option: null,
};

export function configureLoopWorkerCommandsContext(context) {
  repoRoot = context.repoRoot;
  scriptPath = context.scriptPath;
  loopWorkerCommandsContext.fail = context.fail;
  loopWorkerCommandsContext.option = context.option;
}

function requireLoopWorkerCommandsDependency(name) {
  const dependency = loopWorkerCommandsContext[name];
  if (!dependency) throw new Error("Loop worker command dependency has not been configured: " + name);
  return dependency;
}

function fail(...args) {
  return requireLoopWorkerCommandsDependency("fail")(...args);
}

function option(...args) {
  return requireLoopWorkerCommandsDependency("option")(...args);
}

export function loopWorkerOnce(args) {
  const workerId = option(args, "--worker");
  if (!workerId) fail("Missing --worker.");
  const runId = option(args, "--run") ?? option(args, "--run-id") ?? null;
  const leaseMs = optionalPositiveInteger(args, "--lease-ms") ?? LOOP_DEFAULT_LEASE_MS;
  const shouldFail = args.includes("--fail");
  const mode = option(args, "--mode") ?? "mock";
  if (!["mock", "child-run"].includes(mode)) {
    fail("Invalid --mode. Expected mock or child-run.");
  }
  if (mode === "child-run" && shouldFail) {
    fail("--fail is only supported with --mode mock. Use an invalid --child-provider to test child-run failure.");
  }

  const claimed = claimLoopRun({ workerId, runId, leaseMs });
  if (!claimed) {
    if (args.includes("--json")) {
      console.log(JSON.stringify({ run: null, result: null }, null, 2));
      return;
    }
    console.log(runId ? `Loop run is not claimable: ${runId}` : "No queued loop runs available.");
    return;
  }

  appendLoopEvent(claimed, "loop_claimed", "claimed", "Loop run claimed.", {
    workerId,
    leaseMs,
    heartbeatAt: claimed.heartbeatAt,
    leaseExpiresAt: claimed.leaseExpiresAt,
    from: "queued",
  });
  appendLoopEvent(claimed, "loop_state_changed", "claimed", "Loop run claimed.", { from: "queued", to: "claimed" });
  appendLoopEvent(claimed, "loop_worker_started", "claimed", "Loop worker started.", {
    workerId,
    mode,
    workerLog: loopRunPath(claimed.runId, "worker-log.md"),
    workerResult: loopRunPath(claimed.runId, "worker-result.json"),
  });

  const startedAt = new Date().toISOString();
  const executionResult = runLoopWorkerExecution({ entry: claimed, args, workerId, mode, shouldFail, startedAt });
  const result = {
    ...executionResult,
    workerId,
    parentRunId: claimed.runId,
    claimedRunId: claimed.runId,
  };
  const evidence = writeLoopWorkerEvidence(claimed, result);
  let updated = updateLoopEvidence(claimed, evidence);
  const finalState = result.status === "failed" ? "failed" : "completed";
  updated = updateLoopRun(updated, {
    state: finalState,
    workerId: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    timeoutAt: null,
    queuePriority: null,
    lastError: result.error,
  }, result.status === "failed" ? "Loop worker failed." : "Loop worker completed.");
  appendLoopEvent(updated, result.status === "failed" ? "loop_worker_failed" : "loop_worker_completed", finalState, result.error ?? result.summary, {
    workerId,
    mode,
    workerLog: evidence.workerLog,
    workerResult: evidence.workerResult,
    childRunId: result.childRunId,
    error: result.error,
  });
  appendLoopEvent(updated, result.status === "failed" ? "loop_failed" : "loop_completed", finalState, result.error ?? result.summary, {
    workerId,
    workerResult: evidence.workerResult,
    childRunId: result.childRunId,
    error: result.error,
  });

  if (args.includes("--json")) {
    console.log(JSON.stringify({ run: updated, result }, null, 2));
    return;
  }
  console.log(`Loop worker ${result.status}: ${updated.runId}`);
}

function runLoopWorkerExecution({ entry, args, workerId, mode, shouldFail, startedAt }) {
  if (mode === "mock") {
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      status: shouldFail ? "failed" : "completed",
      mode,
      childRunId: null,
      childState: null,
      childEvidence: null,
      childApply: false,
      approval: null,
      dirtyWorktreePolicy: null,
      isolatedWorktree: false,
      worktreePath: null,
      baseRef: null,
      cleanupPolicy: null,
      summary: shouldFail ? "Mock worker intentionally failed." : "Mock worker completed the queued loop run.",
      error: shouldFail ? "Intentional mock worker failure." : null,
    };
  }
  return runChildLoopRun({ entry, args, workerId, startedAt });
}

function runChildLoopRun({ entry, args, workerId, startedAt }) {
  const provider = option(args, "--child-provider") ?? option(args, "--provider") ?? "mock";
  const childApply = args.includes("--child-apply");
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const isolatedWorktree = args.includes("--isolate-worktree");
  const baseRef = option(args, "--base-ref") ?? "HEAD";
  const childSkipVerify = args.includes("--child-skip-verify");
  const dirtyWorktreePolicy = isolatedWorktree ? "allow child apply only in isolated worktree" : "refuse child apply on dirty worktree";
  let worktree = null;
  const commonResult = {
    startedAt,
    mode: "child-run",
    childApply,
    approval,
    dirtyWorktreePolicy,
    childProvider: provider,
    workerId,
    isolatedWorktree,
    worktreePath: null,
    baseRef: isolatedWorktree ? baseRef : null,
    cleanupPolicy: isolatedWorktree ? "keep" : null,
    childSkipVerify,
  };
  if (childApply && !approval.trim()) {
    return {
      ...commonResult,
      completedAt: new Date().toISOString(),
      status: "failed",
      childRunId: null,
      childState: null,
      childEvidence: null,
      summary: "Child apply refused.",
      error: "Child apply requires --approval.",
    };
  }
  const dirtyReason = childApply && !isolatedWorktree ? worktreeDirtyReason() : "";
  if (dirtyReason) {
    return {
      ...commonResult,
      completedAt: new Date().toISOString(),
      status: "failed",
      childRunId: null,
      childState: null,
      childEvidence: null,
      summary: "Child apply refused.",
      error: dirtyReason,
    };
  }
  try {
    if (childApply && isolatedWorktree) {
      worktree = createIsolatedLoopWorktree({ parentRunId: entry.runId, baseRef });
      commonResult.worktreePath = worktree.path;
      commonResult.baseRef = worktree.baseRef;
    }
    const childRepoRoot = worktree?.path ?? repoRoot;
    const childArgs = [scriptPath, "run-work", "--issue", entry.issue, "--provider", provider, "--coding-adapter", entry.adapter];
    if (entry.repo) childArgs.push("--repo", entry.repo);
    if (childApply) childArgs.push("--apply", "--human-approved", approval);
    if (childApply && childSkipVerify) childArgs.push("--skip-verify");
    const output = execFileSync("node", childArgs, {
      cwd: childRepoRoot,
      env: {
        ...process.env,
        MYAGENTTOOL_REPO_ROOT: childRepoRoot,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const childRunId = parseLoopRunId(output);
    if (!childRunId) {
      throw new Error(`Unable to parse child run id from run-work output:\n${output}`);
    }
    const childEntry = findLoopRegistryEntry(childRunId, childRepoRoot);
    return {
      ...commonResult,
      completedAt: new Date().toISOString(),
      status: "completed",
      childRunId,
      childState: childEntry?.state ?? null,
      childEvidence: childEntry?.evidence ?? null,
      summary: `Child loop run created: ${childRunId}`,
      error: null,
    };
  } catch (error) {
    return {
      ...commonResult,
      completedAt: new Date().toISOString(),
      status: "failed",
      childRunId: null,
      childState: null,
      childEvidence: null,
      summary: "Child loop run failed.",
      error: error?.message ?? String(error),
    };
  }
}

function parseLoopRunId(output) {
  return output.match(/\.myagenttool[\\/]runs[\\/]([^\\/\s]+)/)?.[1] ?? null;
}

