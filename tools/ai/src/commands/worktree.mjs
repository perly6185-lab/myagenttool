import { execFileSync } from "node:child_process";

import { appendLoopEvent, findLoopRegistryEntry } from "../loop/registry.mjs";
import {
  buildLoopWorktreeDiff,
  buildLoopWorktreeReview,
  childProcessErrorMessage,
  collectLoopWorktreeRecords,
  findLoopWorktreeRecord,
  gitStatusForRoot,
  loopWorktreeCleanupValidationError,
  loopWorktreeRecordFromEntry,
  partitionWorktreesForReclaim,
  updateLoopWorkerResult,
  writeLoopWorktreeReviewEvidence,
} from "../loop/worktree.mjs";
import {
  formatLoopWorktreeDiff,
  formatLoopWorktreeRecord,
  formatLoopWorktreeReview,
} from "../loop/formatters.mjs";

let repoRoot = null;
const loopWorktreeCommandsContext = {
  fail: null,
  option: null,
};

export function configureLoopWorktreeCommandsContext(context) {
  repoRoot = context.repoRoot;
  loopWorktreeCommandsContext.fail = context.fail;
  loopWorktreeCommandsContext.option = context.option;
}

function requireLoopWorktreeCommandsDependency(name) {
  const dependency = loopWorktreeCommandsContext[name];
  if (!dependency) throw new Error("Loop worktree command dependency has not been configured: " + name);
  return dependency;
}

function fail(...args) {
  return requireLoopWorktreeCommandsDependency("fail")(...args);
}

function option(...args) {
  return requireLoopWorktreeCommandsDependency("option")(...args);
}

export function loopWorktreeList(args) {
  const records = collectLoopWorktreeRecords();
  if (args.includes("--json")) {
    console.log(`${JSON.stringify({ worktrees: records }, null, 2)}\n`.trimEnd());
    return;
  }
  if (records.length === 0) {
    console.log("No isolated loop worktrees recorded.");
    return;
  }
  console.log("Parent Run | Child Run | Cleanup | Exists | Dirty | Path");
  console.log("--- | --- | --- | --- | --- | ---");
  for (const record of records) {
    console.log(`${record.parentRunId} | ${record.childRunId ?? "none"} | ${record.cleanupStatus} | ${record.exists ? "yes" : "no"} | ${record.dirty ? "yes" : "no"} | ${record.worktreePath ?? "not recorded"}`);
  }
}

export function loopWorktreeShow(args) {
  const runId = option(args, "--run") ?? option(args, "--run-id");
  if (!runId) fail("Missing --run.");
  const record = findLoopWorktreeRecord(runId);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${runId}`);
  if (args.includes("--json")) {
    console.log(`${JSON.stringify({ worktree: record }, null, 2)}\n`.trimEnd());
    return;
  }
  console.log(formatLoopWorktreeRecord(record));
}

export function loopWorktreeCleanup(args) {
  const runId = option(args, "--run") ?? option(args, "--run-id");
  if (!runId) fail("Missing --run.");
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const entry = findLoopRegistryEntry(runId);
  if (!entry) fail(`Loop run not found: ${runId}`);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${runId}`);

  const requestedAt = new Date().toISOString();
  appendLoopEvent(entry, "loop_worktree_cleanup_requested", entry.state, "Isolated worktree cleanup requested.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
  });

  if (!approval.trim()) {
    finishLoopWorktreeCleanup({
      args,
      entry,
      record,
      status: "refused",
      requestedAt,
      refusedAt: new Date().toISOString(),
      approval,
      reason: "Worktree cleanup requires --approval.",
      exitCode: 1,
    });
    return;
  }

  const validationError = loopWorktreeCleanupValidationError(record);
  if (validationError) {
    finishLoopWorktreeCleanup({
      args,
      entry,
      record,
      status: "refused",
      requestedAt,
      refusedAt: new Date().toISOString(),
      approval,
      reason: validationError,
      exitCode: 1,
    });
    return;
  }

  let dirtyStatus = "";
  try {
    dirtyStatus = gitStatusForRoot(record.worktreePath);
  } catch (error) {
    finishLoopWorktreeCleanup({
      args,
      entry,
      record,
      status: "refused",
      requestedAt,
      refusedAt: new Date().toISOString(),
      approval,
      reason: `Unable to inspect isolated worktree status: ${childProcessErrorMessage(error)}`,
      exitCode: 1,
    });
    return;
  }
  if (dirtyStatus.trim()) {
    finishLoopWorktreeCleanup({
      args,
      entry,
      record: { ...record, dirty: true, dirtyStatus },
      status: "refused",
      requestedAt,
      refusedAt: new Date().toISOString(),
      approval,
      reason: "Worktree cleanup refused on dirty isolated worktree.",
      dirtyStatus,
      exitCode: 1,
    });
    return;
  }

  try {
    execFileSync("git", ["worktree", "remove", record.worktreePath], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    finishLoopWorktreeCleanup({
      args,
      entry,
      record,
      status: "refused",
      requestedAt,
      refusedAt: new Date().toISOString(),
      approval,
      reason: `git worktree remove failed: ${childProcessErrorMessage(error)}`,
      exitCode: 1,
    });
    return;
  }

  finishLoopWorktreeCleanup({
    args,
    entry,
    record: { ...record, exists: false, dirty: false, dirtyStatus: "" },
    status: "completed",
    requestedAt,
    completedAt: new Date().toISOString(),
    approval,
    reason: null,
    exitCode: 0,
  });
}

// Batch reclaim: remove every finished (clean) isolated worktree in one command,
// preserving dirty (in-progress) ones. Dry-run by default; --apply --approval to
// remove. `git worktree remove` keeps the branch, so committed work is never lost.
export function loopWorktreeCleanupMerged(args) {
  const apply = args.includes("--apply");
  const approval = option(args, "--approval") ?? option(args, "--human-approved") ?? "";
  const records = collectLoopWorktreeRecords();
  const { reclaim, skip } = partitionWorktreesForReclaim(records, (path) =>
    Boolean(gitStatusForRoot(path).trim()),
  );

  if (args.includes("--json")) {
    console.log(
      `${JSON.stringify(
        {
          apply,
          reclaim: reclaim.map((r) => r.worktreePath),
          skip: skip.map((s) => ({ path: s.record.worktreePath, reason: s.reason })),
        },
        null,
        2,
      )}`.trimEnd(),
    );
    if (!apply) return;
  }

  if (!apply) {
    console.log(`Reclaimable (clean, finished) isolated worktrees: ${reclaim.length}`);
    for (const record of reclaim) console.log(`  RECLAIM  ${record.parentRunId} | ${record.worktreePath}`);
    for (const entry of skip) console.log(`  skip     ${entry.record.parentRunId ?? "?"} | ${entry.reason}`);
    console.log(
      `\nDry run: re-run with --apply --approval "reason" to reclaim ${reclaim.length}. Dirty worktrees are always preserved.`,
    );
    return;
  }

  if (!approval.trim()) fail('Batch worktree cleanup requires --approval "reason".');

  let removed = 0;
  let failed = 0;
  for (const record of reclaim) {
    const entry = findLoopRegistryEntry(record.parentRunId);
    try {
      execFileSync("git", ["worktree", "remove", record.worktreePath], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      failed += 1;
      console.log(`failed:    ${record.worktreePath} — ${childProcessErrorMessage(error)}`);
      continue;
    }
    if (entry) {
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
      appendLoopEvent(
        entry,
        "loop_worktree_cleanup_completed",
        entry.state,
        "Isolated worktree cleanup completed (batch --merged).",
        { worktreePath: record.worktreePath, childRunId: record.childRunId, approval, dirty: false, reason: null },
      );
    }
    removed += 1;
    console.log(`reclaimed: ${record.worktreePath}`);
  }
  console.log(`\nReclaimed ${removed}, failed ${failed}, preserved/skipped ${skip.length}.`);
  if (failed > 0) process.exit(1);
}

export function loopWorktreeDiff(args) {
  const record = requireLoopWorktreeRecord(args);
  const diff = buildLoopWorktreeDiff(record);
  if (args.includes("--json")) {
    console.log(`${JSON.stringify({ worktree: record, diff }, null, 2)}\n`.trimEnd());
    return;
  }
  console.log(formatLoopWorktreeDiff(diff, args.includes("--patch")));
}

export function loopWorktreeReview(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  const diff = buildLoopWorktreeDiff(record);
  const review = buildLoopWorktreeReview({ record, diff });
  const paths = writeLoopWorktreeReviewEvidence(entry, review);
  updateLoopWorkerResult(entry, { worktreeReview: { ...review, evidence: paths } });
  appendLoopEvent(entry, "loop_worktree_review_written", entry.state, "Isolated worktree review evidence written.", {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    changedFiles: review.changedFiles,
    evidence: paths,
  });
  if (args.includes("--json")) {
    console.log(`${JSON.stringify({ review: { ...review, evidence: paths } }, null, 2)}\n`.trimEnd());
    return;
  }
  console.log(formatLoopWorktreeReview({ ...review, evidence: paths }));
}

function finishLoopWorktreeCleanup({ args, entry, record, status, requestedAt, completedAt = null, refusedAt = null, approval, reason, dirtyStatus = "", exitCode }) {
  const cleanup = {
    status,
    requestedAt,
    completedAt,
    refusedAt,
    approval,
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    dirty: Boolean(dirtyStatus.trim()),
    dirtyStatus,
    reason,
  };
  updateLoopWorkerResult(entry, {
    cleanup,
    cleanupPolicy: status === "completed" ? "removed" : record.cleanupPolicy,
  });
  appendLoopEvent(entry, status === "completed" ? "loop_worktree_cleanup_completed" : "loop_worktree_cleanup_refused", entry.state, status === "completed" ? "Isolated worktree cleanup completed." : reason, {
    worktreePath: record.worktreePath,
    childRunId: record.childRunId,
    approval,
    dirty: cleanup.dirty,
    reason,
  });
  const refreshed = findLoopWorktreeRecord(entry.runId) ?? {
    ...record,
    cleanup,
    cleanupStatus: status,
    cleanupPolicy: status === "completed" ? "removed" : record.cleanupPolicy,
  };
  if (args.includes("--json")) {
    console.log(`${JSON.stringify({ worktree: refreshed, cleanup }, null, 2)}\n`.trimEnd());
  } else if (status === "completed") {
    console.log(`Isolated worktree cleanup completed: ${record.worktreePath}`);
  } else {
    console.log(`Isolated worktree cleanup refused: ${reason}`);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

export function requireLoopWorktreeEntry(args) {
  const runId = option(args, "--run") ?? option(args, "--run-id");
  if (!runId) fail("Missing --run.");
  const entry = findLoopRegistryEntry(runId);
  if (!entry) fail(`Loop run not found: ${runId}`);
  return entry;
}

export function requireLoopWorktreeRecord(args) {
  const entry = requireLoopWorktreeEntry(args);
  const record = loopWorktreeRecordFromEntry(entry);
  if (!record) fail(`No isolated loop worktree recorded for parent run: ${entry.runId}`);
  return record;
}

