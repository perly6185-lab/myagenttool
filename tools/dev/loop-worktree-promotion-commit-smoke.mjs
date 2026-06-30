#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const issue = String(997000 + Math.floor(Date.now() % 2000));
const smokeFile = `loop-promotion-commit-${issue}.txt`;
const commitMessage = `Commit promotion smoke ${issue}`;

const parentRunId = createPromotedRun(issue);
const source = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(source.exists === true, "promotion commit smoke needs an existing source worktree");

writeFileSync(resolve(source.worktreePath, smokeFile), `promotion commit smoke ${issue}\n`, "utf8");
const promoted = aiJson(["loop-worktree-promote", "--run", parentRunId, "--approval", "approved promotion commit smoke", "--json"]);
assert(promoted.promotion.status === "planned", "promotion commit smoke needs planned promotion evidence");
assert(promoted.promotion.changedFiles.includes(smokeFile), "promotion evidence should include smoke file");

const cleanRoot = prepareCleanRepo(parentRunId, source.baseRef);
const noApply = aiJsonAllowFailure(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved no apply", "--json"], cleanRoot);
assert(noApply.status !== 0, "commit without apply evidence should fail");
assert(noApply.json?.promotionCommit?.reason === "Missing worktree-promotion-apply-result.json. Run loop-worktree-promotion-apply first.", "missing apply refusal should be explicit");

const applied = aiJson(["loop-worktree-promotion-apply", "--run", parentRunId, "--approval", "approved clean apply", "--json"], cleanRoot);
assert(applied.promotionApply.status === "succeeded", "promotion apply should succeed before commit");

const noVerify = aiJsonAllowFailure(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved no verify", "--json"], cleanRoot);
assert(noVerify.status !== 0, "commit without verify evidence should fail");
assert(noVerify.json?.promotionCommit?.reason === "Missing worktree-promotion-verify-result.json. Run loop-worktree-promotion-verify first.", "missing verify refusal should be explicit");

const verified = aiJson(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved verify", "--command", "git-status", "--json"], cleanRoot);
assert(verified.promotionVerify.status === "succeeded", "promotion verify should succeed before commit");

const noPrep = aiJsonAllowFailure(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved no prep", "--json"], cleanRoot);
assert(noPrep.status !== 0, "commit without PR prep evidence should fail");
assert(noPrep.json?.promotionCommit?.reason === "Missing worktree-promotion-pr-summary.json. Run loop-worktree-promotion-pr-prep first.", "missing PR prep refusal should be explicit");

const prepped = aiJson(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved pr prep", "--json"], cleanRoot);
assert(prepped.promotionPrPrep.status === "written", "promotion PR prep should succeed before commit");

const noApproval = aiJsonAllowFailure(["loop-worktree-promotion-commit", "--run", parentRunId, "--json"], cleanRoot);
assert(noApproval.status !== 0, "commit without approval should fail");
assert(noApproval.json?.promotionCommit?.status === "refused", "missing approval should record refused commit");
assert(noApproval.json?.promotionCommit?.reason === "Worktree promotion commit requires --approval.", "missing approval refusal should be explicit");

const applyResultPath = resolve(cleanRoot, ".myagenttool/runs", parentRunId, "worktree-promotion-apply-result.json");
const applyResult = JSON.parse(readFileSync(applyResultPath, "utf8"));
writeFileSync(applyResultPath, `${JSON.stringify({ ...applyResult, integrationWorktreePath: resolve(cleanRoot, ".myagenttool/worktrees/missing") }, null, 2)}\n`, "utf8");
const missingIntegration = aiJsonAllowFailure(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved missing integration", "--json"], cleanRoot);
assert(missingIntegration.status !== 0, "commit should refuse missing integration worktree");
assert(missingIntegration.json?.promotionCommit?.reason === "Integration worktree path does not exist.", "missing integration refusal should be explicit");
writeFileSync(applyResultPath, `${JSON.stringify(applyResult, null, 2)}\n`, "utf8");

const cleanClone = prepareCleanRepo(parentRunId, source.baseRef);
const cleanApply = aiJson(["loop-worktree-promotion-apply", "--run", parentRunId, "--approval", "approved clean apply", "--json"], cleanClone);
aiJson(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved verify", "--command", "git-status", "--json"], cleanClone);
aiJson(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved pr prep", "--json"], cleanClone);
execFileSync("git", ["add", "--", smokeFile], { cwd: cleanApply.promotionApply.integrationWorktreePath });
execFileSync("git", ["commit", "-m", "precommit smoke"], { cwd: cleanApply.promotionApply.integrationWorktreePath, stdio: ["ignore", "pipe", "pipe"] });
const noChanges = aiJsonAllowFailure(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved no changes", "--json"], cleanClone);
assert(noChanges.status !== 0, "commit should refuse when no pending changes exist");
assert(noChanges.json?.promotionCommit?.reason === "Promotion commit refused because integration worktree has no pending changes.", "no changes refusal should be explicit");

const committed = aiJson(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved commit", "--message", commitMessage, "--json"], cleanRoot);
assert(committed.promotionCommit.status === "succeeded", "promotion commit should succeed");
assert(committed.promotionCommit.commitSha, "promotion commit should record commit SHA");
assert(committed.promotionCommit.message === commitMessage, "promotion commit should record custom message");
assert(committed.promotionCommit.integrationBranch === applied.promotionApply.integrationBranch, "promotion commit should record branch");
assert(committed.promotionCommit.changedFiles.includes(smokeFile), "promotion commit should include smoke file");
assert(committed.promotionCommit.postCommitStatus === "", "promotion commit should leave integration worktree clean");
assert(existsSync(resolve(cleanRoot, committed.promotionCommit.evidence.promotionCommitPlan)), "commit plan evidence should exist");
assert(existsSync(resolve(cleanRoot, committed.promotionCommit.evidence.promotionCommitResult)), "commit result evidence should exist");
assert(existsSync(resolve(cleanRoot, committed.promotionCommit.evidence.promotionCommitMarkdown)), "commit markdown evidence should exist");
assert(execFileSync("git", ["rev-parse", "HEAD"], { cwd: applied.promotionApply.integrationWorktreePath, encoding: "utf8" }).trim() === committed.promotionCommit.commitSha, "integration HEAD should match recorded commit");
assert(execFileSync("git", ["log", "-1", "--pretty=%B"], { cwd: applied.promotionApply.integrationWorktreePath, encoding: "utf8" }).includes(commitMessage), "commit log should include custom message");

const secondCommit = aiJsonAllowFailure(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved second commit", "--json"], cleanRoot);
assert(secondCommit.status !== 0, "second commit should refuse clean integration worktree");
assert(secondCommit.json?.promotionCommit?.reason === "Promotion commit refused because integration worktree has no pending changes.", "second commit refusal should be explicit");

assertEventTypes(cleanRoot, parentRunId, [
  "loop_worktree_promotion_commit_requested",
  "loop_worktree_promotion_commit_refused",
  "loop_worktree_promotion_commit_succeeded",
]);

execFileSync("node", [resolve(repoRoot, "tools/ai/src/index.mjs"), "loop-registry-check"], {
  cwd: cleanRoot,
  env: { ...process.env, MYAGENTTOOL_REPO_ROOT: cleanRoot },
  stdio: "inherit",
});

execFileSync("node", ["tools/ai/src/index.mjs", "loop-registry-check"], {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log(`[loop-worktree-promotion-commit-smoke] OK parent=${parentRunId} commit=${committed.promotionCommit.commitSha} file=${smokeFile}`);

function createPromotedRun(issueNumber) {
  const before = latestIsolatedParentRun(repoRoot);
  execFileSync(process.execPath, ["tools/dev/loop-worker-child-apply-isolated-smoke.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LOOP_ISOLATED_SMOKE_ISSUE: issueNumber,
    },
    stdio: "inherit",
  });
  const after = latestIsolatedParentRun(repoRoot);
  if (!after || after.parentRunId === before?.parentRunId) {
    throw new Error("Unable to locate isolated parent run created by promotion commit smoke.");
  }
  return after.parentRunId;
}

function prepareCleanRepo(runId, baseRef) {
  const root = resolve("D:/tmp/myagenttool-loop-smoke", `commit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.email", "loop-smoke@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Loop Smoke"], { cwd: root });
  writeFileSync(resolve(root, ".gitignore"), ".myagenttool/\n", "utf8");
  writeFileSync(resolve(root, "README.md"), `promotion commit clean repo for ${runId}\nbase ${baseRef ?? "HEAD"}\n`, "utf8");
  execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed promotion commit smoke repo"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const runSource = resolve(repoRoot, ".myagenttool/runs", runId);
  const runTarget = resolve(root, ".myagenttool/runs", runId);
  mkdirSync(dirname(runTarget), { recursive: true });
  cpSync(runSource, runTarget, { recursive: true });
  const sourceMirror = resolve(root, ".myagenttool/worktrees/source");
  mkdirSync(sourceMirror, { recursive: true });
  const workerResultPath = resolve(runTarget, "worker-result.json");
  const workerResult = JSON.parse(readFileSync(workerResultPath, "utf8"));
  writeFileSync(workerResultPath, `${JSON.stringify({ ...workerResult, worktreePath: sourceMirror }, null, 2)}\n`, "utf8");
  execFileSync("node", [resolve(repoRoot, "tools/ai/src/index.mjs"), "loop-registry-rebuild", "--json"], {
    cwd: root,
    env: { ...process.env, MYAGENTTOOL_REPO_ROOT: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return root;
}

function latestIsolatedParentRun(root) {
  const result = aiJson(["loop-worktree-list", "--json"], root);
  return result.worktrees[0] ?? null;
}

function aiJson(args, root = repoRoot) {
  const output = execFileSync("node", [resolve(repoRoot, "tools/ai/src/index.mjs"), ...args], {
    cwd: root,
    env: { ...process.env, MYAGENTTOOL_REPO_ROOT: root },
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function aiJsonAllowFailure(args, root = repoRoot) {
  try {
    return { status: 0, json: aiJson(args, root) };
  } catch (error) {
    const stdout = String(error.stdout ?? "").trim();
    return {
      status: error.status ?? 1,
      json: stdout ? JSON.parse(stdout) : null,
      stderr: String(error.stderr ?? ""),
    };
  }
}

function assertEventTypes(root, runId, requiredTypes) {
  const events = readFileSync(resolve(root, ".myagenttool/runs", runId, "events.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const eventTypes = new Set(events.map((event) => event.type));
  for (const type of requiredTypes) {
    if (!eventTypes.has(type)) {
      throw new Error(`Loop worktree promotion commit smoke missing event ${type} for ${runId}`);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
