#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const issue = String(990000 + Math.floor(Date.now() % 9000));
const smokeFile = `loop-promotion-verify-${issue}.txt`;

const parentRunId = createPromotedRun(issue);
const source = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(source.exists === true, "promotion verify smoke needs an existing source worktree");

writeFileSync(resolve(source.worktreePath, smokeFile), `promotion verify smoke ${issue}\n`, "utf8");
const promoted = aiJson(["loop-worktree-promote", "--run", parentRunId, "--approval", "approved promotion verify smoke", "--json"]);
assert(promoted.promotion.status === "planned", "promotion verify smoke needs planned promotion evidence");
assert(promoted.promotion.changedFiles.includes(smokeFile), "promotion evidence should include smoke file");

const cleanRoot = prepareCleanRepo(parentRunId, source.baseRef);
const noApply = aiJsonAllowFailure(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved no apply", "--json"], cleanRoot);
assert(noApply.status !== 0, "verification without apply evidence should fail");
assert(noApply.json?.promotionVerify?.status === "refused", "verification without apply should be refused");
assert(noApply.json?.promotionVerify?.reason === "Missing worktree-promotion-apply-result.json. Run loop-worktree-promotion-apply first.", "missing apply refusal should be explicit");

const applied = aiJson(["loop-worktree-promotion-apply", "--run", parentRunId, "--approval", "approved clean apply", "--json"], cleanRoot);
assert(applied.promotionApply.status === "succeeded", "promotion apply should succeed before verification");
assert(existsSync(resolve(applied.promotionApply.integrationWorktreePath, smokeFile)), "integration worktree should contain applied smoke file");

const noApproval = aiJsonAllowFailure(["loop-worktree-promotion-verify", "--run", parentRunId, "--json"], cleanRoot);
assert(noApproval.status !== 0, "verification without approval should fail");
assert(noApproval.json?.promotionVerify?.status === "refused", "missing approval should record refused verification");
assert(noApproval.json?.promotionVerify?.reason === "Worktree promotion verification requires --approval.", "missing approval refusal should be explicit");

const badCommand = aiJsonAllowFailure(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved bad command", "--command", "shell-anything", "--json"], cleanRoot);
assert(badCommand.status !== 0, "verification with non-allowlisted command should fail");
assert(badCommand.json?.promotionVerify?.status === "refused", "bad command should be refused");
assert(badCommand.json?.promotionVerify?.reason === "Verification command is not allowed: shell-anything", "bad command refusal should be explicit");

const succeeded = aiJson(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved verify", "--command", "git-status", "--json"], cleanRoot);
assert(succeeded.promotionVerify.status === "succeeded", "git-status verification should succeed");
assert(succeeded.promotionVerify.commandId === "git-status", "verification should record command id");
assert(succeeded.promotionVerify.exitCode === 0, "verification should record zero exit code");
assert(succeeded.promotionVerify.integrationWorktreePath === applied.promotionApply.integrationWorktreePath, "verification should target integration worktree");
assert(succeeded.promotionVerify.evidence?.promotionVerifyPlan, "verification should write plan evidence");
assert(succeeded.promotionVerify.evidence?.promotionVerifyResult, "verification should write result evidence");
assert(succeeded.promotionVerify.evidence?.promotionVerifyMarkdown, "verification should write markdown evidence");
assert(succeeded.promotionVerify.evidence?.promotionVerifyStdout, "verification should write stdout evidence");
assert(succeeded.promotionVerify.evidence?.promotionVerifyStderr, "verification should write stderr evidence");
assert(existsSync(resolve(cleanRoot, succeeded.promotionVerify.evidence.promotionVerifyPlan)), "verify plan evidence should exist");
assert(existsSync(resolve(cleanRoot, succeeded.promotionVerify.evidence.promotionVerifyResult)), "verify result evidence should exist");
assert(existsSync(resolve(cleanRoot, succeeded.promotionVerify.evidence.promotionVerifyMarkdown)), "verify markdown evidence should exist");
assert(readFileSync(resolve(cleanRoot, succeeded.promotionVerify.evidence.promotionVerifyStdout), "utf8").includes(smokeFile), "git-status stdout should mention smoke file");

writeFileSync(resolve(cleanRoot, ".myagenttool/runs", parentRunId, "worktree-promotion-apply-result.json"), `${JSON.stringify({ ...applied.promotionApply, integrationWorktreePath: resolve(cleanRoot, ".myagenttool/worktrees/missing") }, null, 2)}\n`, "utf8");
const missingIntegration = aiJsonAllowFailure(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved missing integration", "--json"], cleanRoot);
assert(missingIntegration.status !== 0, "verification should refuse missing integration worktree");
assert(missingIntegration.json?.promotionVerify?.reason === "Integration worktree path does not exist.", "missing integration refusal should be explicit");

assertEventTypes(cleanRoot, parentRunId, [
  "loop_worktree_promotion_verify_requested",
  "loop_worktree_promotion_verify_started",
  "loop_worktree_promotion_verify_refused",
  "loop_worktree_promotion_verify_succeeded",
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

console.log(`[loop-worktree-promotion-verify-smoke] OK parent=${parentRunId} command=${succeeded.promotionVerify.commandId} file=${smokeFile}`);

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
    throw new Error("Unable to locate isolated parent run created by promotion verify smoke.");
  }
  return after.parentRunId;
}

function prepareCleanRepo(runId, baseRef) {
  const root = resolve("D:/tmp/myagenttool-loop-smoke", `verify-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.email", "loop-smoke@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Loop Smoke"], { cwd: root });
  writeFileSync(resolve(root, ".gitignore"), ".myagenttool/\n", "utf8");
  writeFileSync(resolve(root, "README.md"), `promotion verify clean repo for ${runId}\nbase ${baseRef ?? "HEAD"}\n`, "utf8");
  execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed promotion verify smoke repo"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
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
      throw new Error(`Loop worktree promotion verify smoke missing event ${type} for ${runId}`);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
