#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const issue = String(980000 + Math.floor(Date.now() % 9000));

const parentRunId = createIsolatedApplyRun(issue);
const shown = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(shown.parentRunId === parentRunId, "show should return the requested parent run");
assert(shown.childRunId && shown.childState === "completed", "show should include completed child run");
assert(shown.exists === true, "show should report existing worktree before cleanup");
assert(shown.pathInBoundary === true, "show should report a bounded worktree path");

const listed = aiJson(["loop-worktree-list", "--json"]).worktrees;
assert(listed.some((record) => record.parentRunId === parentRunId), "list should include the isolated parent run");

const noApproval = aiJsonAllowFailure(["loop-worktree-cleanup", "--run", parentRunId, "--json"]);
assert(noApproval.status !== 0, "cleanup without approval should fail");
assert(noApproval.json?.cleanup?.status === "refused", "cleanup without approval should record refusal");
assert(noApproval.json?.cleanup?.reason === "Worktree cleanup requires --approval.", "missing approval refusal reason should be explicit");

writeFileSync(resolve(shown.worktreePath, "loop-worktree-lifecycle-smoke.tmp"), "dirty cleanup refusal smoke\n", "utf8");
const dirty = aiJsonAllowFailure(["loop-worktree-cleanup", "--run", parentRunId, "--approval", "approved dirty refusal smoke", "--json"]);
assert(dirty.status !== 0, "cleanup on dirty worktree should fail");
assert(dirty.json?.cleanup?.status === "refused", "dirty cleanup should record refusal");
assert(dirty.json?.cleanup?.reason === "Worktree cleanup refused on dirty isolated worktree.", "dirty refusal reason should be explicit");

execFileSync("git", ["-C", shown.worktreePath, "clean", "-fd"], {
  cwd: repoRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

const cleaned = aiJson(["loop-worktree-cleanup", "--run", parentRunId, "--approval", "approved cleanup smoke", "--json"]);
assert(cleaned.worktree.cleanupStatus === "completed", "cleanup should complete after approval");
assert(cleaned.cleanup.status === "completed", "cleanup result should be completed");
assert(cleaned.worktree.exists === false, "cleaned worktree should no longer exist");
assert(!existsSync(shown.worktreePath), "worktree directory should be removed by cleanup");

const after = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(after.cleanupStatus === "completed", "show should preserve completed cleanup status");
assert(after.cleanupPolicy === "removed", "show should report removed cleanup policy");
assert(after.exists === false, "show should report removed worktree as missing");
assertEventTypes(parentRunId, [
  "loop_worktree_cleanup_requested",
  "loop_worktree_cleanup_refused",
  "loop_worktree_cleanup_completed",
]);

execFileSync("node", ["tools/ai/src/index.mjs", "loop-registry-check"], {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log(`[loop-worktree-lifecycle-smoke] OK parent=${parentRunId} child=${shown.childRunId}`);

function createIsolatedApplyRun(issueNumber) {
  const before = latestIsolatedParentRun();
  execFileSync(process.execPath, ["tools/dev/loop-worker-child-apply-isolated-smoke.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LOOP_ISOLATED_SMOKE_ISSUE: issueNumber,
    },
    stdio: "inherit",
  });
  const after = latestIsolatedParentRun();
  if (!after || after.parentRunId === before?.parentRunId) {
    throw new Error("Unable to locate isolated parent run created by lifecycle smoke.");
  }
  return after.parentRunId;
}

function latestIsolatedParentRun() {
  const result = aiJson(["loop-worktree-list", "--json"]);
  return result.worktrees[0] ?? null;
}

function aiJson(args) {
  const output = execFileSync("node", ["tools/ai/src/index.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function aiJsonAllowFailure(args) {
  try {
    return { status: 0, json: aiJson(args) };
  } catch (error) {
    const stdout = String(error.stdout ?? "").trim();
    return {
      status: error.status ?? 1,
      json: stdout ? JSON.parse(stdout) : null,
      stderr: String(error.stderr ?? ""),
    };
  }
}

function assertEventTypes(runId, requiredTypes) {
  const events = readFileSync(resolve(repoRoot, ".myagenttool/runs", runId, "events.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const eventTypes = new Set(events.map((event) => event.type));
  for (const type of requiredTypes) {
    if (!eventTypes.has(type)) {
      throw new Error(`Loop worktree lifecycle smoke missing event ${type} for ${runId}`);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
