#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const issue = String(970000 + Math.floor(Date.now() % 9000));
const smokeFile = `loop-worktree-review-${issue}.txt`;

const beforeStatus = gitStatus(repoRoot);
const parentRunId = createIsolatedApplyRun(issue);
const shown = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(shown.exists === true, "review smoke needs an existing isolated worktree");
assert(shown.pathInBoundary === true, "review smoke worktree should be inside loop boundary");

const worktreeFile = resolve(shown.worktreePath, smokeFile);
writeFileSync(worktreeFile, `review promotion smoke ${issue}\n`, "utf8");

const diff = aiJson(["loop-worktree-diff", "--run", parentRunId, "--json"]).diff;
assert(diff.changedFiles.includes(smokeFile), "diff should include smoke file");
assert(diff.patch.includes(smokeFile), "diff patch should include smoke file path");
assert(diff.dirty === true, "diff should mark uncommitted worktree change as dirty");

const review = aiJson(["loop-worktree-review", "--run", parentRunId, "--json"]).review;
assert(review.changedFiles.includes(smokeFile), "review should include smoke file");
assert(review.evidence?.reviewJson, "review should write JSON evidence");
assert(review.evidence?.reviewMarkdown, "review should write markdown evidence");
assert(existsSync(resolve(repoRoot, review.evidence.reviewJson)), "review JSON evidence should exist");
assert(existsSync(resolve(repoRoot, review.evidence.reviewMarkdown)), "review markdown evidence should exist");

const noApproval = aiJsonAllowFailure(["loop-worktree-promote", "--run", parentRunId, "--json"]);
assert(noApproval.status !== 0, "promotion without approval should fail");
assert(noApproval.json?.promotion?.status === "refused", "promotion without approval should record refusal");
assert(noApproval.json?.promotion?.reason === "Worktree promotion requires --approval.", "missing approval refusal reason should be explicit");

const promoted = aiJson(["loop-worktree-promote", "--run", parentRunId, "--approval", "approved promotion smoke", "--json"]);
assert(promoted.promotion.status === "planned", "promotion should create a plan");
assert(promoted.promotion.changedFiles.includes(smokeFile), "promotion should include smoke file");
assert(promoted.promotion.forbiddenActions.includes("apply patch to current workspace"), "promotion should preserve forbidden actions");
assert(promoted.promotion.evidence?.patch, "promotion should write patch evidence");
const patchPath = resolve(repoRoot, promoted.promotion.evidence.patch);
assert(existsSync(patchPath), "promotion patch evidence should exist");
assert(readFileSync(patchPath, "utf8").includes(smokeFile), "promotion patch should include smoke file");

const afterStatus = gitStatus(repoRoot);
assert(afterStatus === beforeStatus, "promotion should not modify the parent workspace status");
assertEventTypes(parentRunId, [
  "loop_worktree_review_written",
  "loop_worktree_promotion_requested",
  "loop_worktree_promotion_refused",
  "loop_worktree_promotion_planned",
]);

execFileSync("node", ["tools/ai/src/index.mjs", "loop-registry-check"], {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log(`[loop-worktree-review-promotion-smoke] OK parent=${parentRunId} child=${shown.childRunId} file=${smokeFile}`);

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
    throw new Error("Unable to locate isolated parent run created by review/promotion smoke.");
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
      throw new Error(`Loop worktree review/promotion smoke missing event ${type} for ${runId}`);
    }
  }
}

function gitStatus(root) {
  return execFileSync("git", ["status", "--short"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
