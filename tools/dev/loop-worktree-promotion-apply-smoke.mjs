#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const issue = String(980000 + Math.floor(Date.now() % 9000));
const smokeFile = `loop-promotion-apply-${issue}.txt`;

const parentRunId = createPromotedRun(issue);
const source = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(source.exists === true, "promotion apply smoke needs an existing source worktree");

const sourceFile = resolve(source.worktreePath, smokeFile);
writeFileSync(sourceFile, `promotion apply smoke ${issue}\n`, "utf8");

const promoted = aiJson(["loop-worktree-promote", "--run", parentRunId, "--approval", "approved promotion apply smoke", "--json"]);
assert(promoted.promotion.status === "planned", "promotion apply smoke needs planned promotion evidence");
assert(promoted.promotion.changedFiles.includes(smokeFile), "promotion evidence should include smoke file");

const noApproval = aiJsonAllowFailure(["loop-worktree-promotion-apply", "--run", parentRunId, "--json"]);
assert(noApproval.status !== 0, "promotion apply without approval should fail");
assert(noApproval.json?.promotionApply?.status === "refused", "missing approval should record refused apply");
assert(noApproval.json?.promotionApply?.reason === "Worktree promotion apply requires --approval.", "missing approval refusal should be explicit");

const dirtyParent = aiJsonAllowFailure(["loop-worktree-promotion-apply", "--run", parentRunId, "--approval", "approved dirty parent check", "--json"]);
assert(dirtyParent.status !== 0, "promotion apply should refuse dirty parent workspace");
assert(dirtyParent.json?.promotionApply?.status === "refused", "dirty parent refusal should be recorded");
assert(dirtyParent.json?.promotionApply?.reason === "Worktree promotion apply refused on dirty parent workspace.", "dirty parent refusal reason should be explicit");

const cleanRoot = prepareCleanRepo(parentRunId, source.baseRef);
const applied = aiJson(["loop-worktree-promotion-apply", "--run", parentRunId, "--approval", "approved clean apply", "--json"], cleanRoot);
assert(applied.promotionApply.status === "succeeded", "promotion apply should succeed in clean repo");
assert(applied.promotionApply.integrationWorktreePath, "promotion apply should create integration worktree");
assert(applied.promotionApply.integrationBranch, "promotion apply should create integration branch");
assert(applied.promotionApply.changedFiles.includes(smokeFile), "promotion apply result should include smoke file");
assert(applied.promotionApply.forbiddenActions.includes("modify current workspace"), "promotion apply should preserve current workspace boundary");
assert(existsSync(resolve(applied.promotionApply.integrationWorktreePath, smokeFile)), "integration worktree should contain applied smoke file");
assert(existsSync(resolve(cleanRoot, applied.promotionApply.evidence.promotionApplyPlan)), "apply plan evidence should exist");
assert(existsSync(resolve(cleanRoot, applied.promotionApply.evidence.promotionApplyResult)), "apply result evidence should exist");
assert(existsSync(resolve(cleanRoot, applied.promotionApply.evidence.promotionApplyMarkdown)), "apply markdown evidence should exist");
assert(gitStatus(cleanRoot) === "", "clean parent repo should remain unmodified by promotion apply");
assert(gitStatus(applied.promotionApply.integrationWorktreePath).includes(smokeFile), "integration worktree should contain applied patch changes");

assertEventTypes(cleanRoot, parentRunId, [
  "loop_worktree_promotion_apply_requested",
  "loop_worktree_promotion_apply_checked",
  "loop_worktree_promotion_apply_succeeded",
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

console.log(`[loop-worktree-promotion-apply-smoke] OK parent=${parentRunId} integration=${applied.promotionApply.integrationBranch} file=${smokeFile}`);

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
    throw new Error("Unable to locate isolated parent run created by promotion apply smoke.");
  }
  return after.parentRunId;
}

function prepareCleanRepo(runId, baseRef) {
  const root = resolve("D:/tmp/myagenttool-loop-smoke", `apply-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  execFileSync("git", ["config", "user.email", "loop-smoke@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Loop Smoke"], { cwd: root });
  writeFileSync(resolve(root, ".gitignore"), ".myagenttool/\n", "utf8");
  writeFileSync(resolve(root, "README.md"), `promotion apply clean repo for ${runId}\nbase ${baseRef ?? "HEAD"}\n`, "utf8");
  execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed promotion apply smoke repo"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
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
      throw new Error(`Loop worktree promotion apply smoke missing event ${type} for ${runId}`);
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
