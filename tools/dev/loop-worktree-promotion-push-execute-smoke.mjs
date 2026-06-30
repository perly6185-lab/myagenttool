#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const issue = String(994000 + Math.floor(Date.now() % 2000));
const smokeFile = `loop-promotion-push-execute-${issue}.txt`;
const commitMessage = `Push execute promotion smoke ${issue}`;

const parentRunId = createPromotedRun(issue);
const source = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(source.exists === true, "promotion push execute smoke needs an existing source worktree");

writeFileSync(resolve(source.worktreePath, smokeFile), `promotion push execute smoke ${issue}\n`, "utf8");
const promoted = aiJson(["loop-worktree-promote", "--run", parentRunId, "--approval", "approved promotion push execute smoke", "--json"]);
assert(promoted.promotion.status === "planned", "promotion push execute smoke needs planned promotion evidence");
assert(promoted.promotion.changedFiles.includes(smokeFile), "promotion evidence should include smoke file");

const cleanRoot = prepareCleanRepo(parentRunId, source.baseRef);
const applied = aiJson(["loop-worktree-promotion-apply", "--run", parentRunId, "--approval", "approved clean apply", "--json"], cleanRoot);
assert(applied.promotionApply.status === "succeeded", "promotion apply should succeed before push execute");
const verified = aiJson(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved verify", "--command", "git-status", "--json"], cleanRoot);
assert(verified.promotionVerify.status === "succeeded", "promotion verify should succeed before push execute");
const prepped = aiJson(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved pr prep", "--json"], cleanRoot);
assert(prepped.promotionPrPrep.status === "written", "promotion PR prep should succeed before push execute");
const committed = aiJson(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved commit", "--message", commitMessage, "--json"], cleanRoot);
assert(committed.promotionCommit.status === "succeeded", "promotion commit should succeed before push execute");

const noPreflight = aiJsonAllowFailure(["loop-worktree-promotion-push-execute", "--run", parentRunId, "--approval", "approved no preflight", "--confirm-commit", committed.promotionCommit.commitSha, "--json"], cleanRoot);
assert(noPreflight.status !== 0, "push execute without preflight should fail");
assert(noPreflight.json?.promotionPushExecute?.reason === "Missing worktree-promotion-push-preflight-result.json. Run loop-worktree-promotion-push-preflight --dry-run first.", "missing preflight refusal should be explicit");

const remoteUrl = createBareRemote(parentRunId);
execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: committed.promotionCommit.integrationWorktreePath });

const planned = aiJson(["loop-worktree-promotion-push-plan", "--run", parentRunId, "--approval", "approved push plan", "--json"], cleanRoot);
assert(planned.promotionPushPlan.status === "planned", "promotion push plan should succeed before execute");
const preflightNoDryRun = aiJson(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--approval", "approved preflight", "--json"], cleanRoot);
assert(preflightNoDryRun.promotionPushPreflight.status === "succeeded", "non-dry-run preflight should succeed");
const requiresDryRun = aiJsonAllowFailure(["loop-worktree-promotion-push-execute", "--run", parentRunId, "--approval", "approved no dry run", "--confirm-commit", committed.promotionCommit.commitSha, "--json"], cleanRoot);
assert(requiresDryRun.status !== 0, "push execute should require dry-run preflight");
assert(requiresDryRun.json?.promotionPushExecute?.reason === "Promotion push execute requires a successful push preflight with --dry-run.", "dry-run requirement refusal should be explicit");

const preflight = aiJson(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--approval", "approved dry run", "--dry-run", "--json"], cleanRoot);
assert(preflight.promotionPushPreflight.status === "succeeded", "dry-run preflight should succeed before execute");
assert(preflight.promotionPushPreflight.dryRun === true, "preflight must record dryRun");
assert(commandAllowFailure("git", ["--git-dir", remoteUrl, "show-ref", "--verify", `refs/heads/${committed.promotionCommit.integrationBranch}`]).status !== 0, "dry-run preflight must not create remote branch");

const noApproval = aiJsonAllowFailure(["loop-worktree-promotion-push-execute", "--run", parentRunId, "--confirm-commit", committed.promotionCommit.commitSha, "--json"], cleanRoot);
assert(noApproval.status !== 0, "push execute without approval should fail");
assert(noApproval.json?.promotionPushExecute?.status === "refused", "missing approval should record refused execute");
assert(noApproval.json?.promotionPushExecute?.reason === "Worktree promotion push execute requires --approval.", "missing approval refusal should be explicit");

const noConfirm = aiJsonAllowFailure(["loop-worktree-promotion-push-execute", "--run", parentRunId, "--approval", "approved no confirm", "--json"], cleanRoot);
assert(noConfirm.status !== 0, "push execute without confirm commit should fail");
assert(noConfirm.json?.promotionPushExecute?.reason === "Worktree promotion push execute requires --confirm-commit.", "missing confirm refusal should be explicit");

const wrongConfirm = aiJsonAllowFailure(["loop-worktree-promotion-push-execute", "--run", parentRunId, "--approval", "approved wrong confirm", "--confirm-commit", "0000000000000000000000000000000000000000", "--json"], cleanRoot);
assert(wrongConfirm.status !== 0, "push execute with wrong confirm commit should fail");
assert(wrongConfirm.json?.promotionPushExecute?.reason === "Promotion push execute refused because --confirm-commit does not match preflight commit.", "wrong confirm refusal should be explicit");

const pushed = aiJson(["loop-worktree-promotion-push-execute", "--run", parentRunId, "--approval", "approved push execute", "--confirm-commit", committed.promotionCommit.commitSha, "--json"], cleanRoot);
assert(pushed.promotionPushExecute.status === "succeeded", "push execute should succeed");
assert(pushed.promotionPushExecute.commitSha === committed.promotionCommit.commitSha, "push execute should record commit SHA");
assert(pushed.promotionPushExecute.confirmCommit === committed.promotionCommit.commitSha, "push execute should record confirmed commit");
assert(pushed.promotionPushExecute.preflightDryRun === true, "push execute should require dry-run preflight");
assert(pushed.promotionPushExecute.remoteHead === committed.promotionCommit.commitSha, "push execute should record remote head");
assert(pushed.promotionPushExecute.remoteHeadMatchesCommit === true, "remote head should match commit");
assert(pushed.promotionPushExecute.push.exitCode === 0, "git push should exit cleanly");
assert(existsSync(resolve(cleanRoot, pushed.promotionPushExecute.evidence.promotionPushExecutePlan)), "push execute plan evidence should exist");
assert(existsSync(resolve(cleanRoot, pushed.promotionPushExecute.evidence.promotionPushExecuteResult)), "push execute result evidence should exist");
assert(existsSync(resolve(cleanRoot, pushed.promotionPushExecute.evidence.promotionPushExecuteMarkdown)), "push execute markdown evidence should exist");
assert(readRemoteHead(remoteUrl, committed.promotionCommit.integrationBranch) === committed.promotionCommit.commitSha, "remote branch should point at pushed commit");
const markdown = readFileSync(resolve(cleanRoot, pushed.promotionPushExecute.evidence.promotionPushExecuteMarkdown), "utf8");
assert(markdown.includes(committed.promotionCommit.commitSha), "push execute markdown should include commit SHA");
assert(markdown.includes("Remote head matches commit: yes"), "push execute markdown should record remote head match");

const secondPush = aiJson(["loop-worktree-promotion-push-execute", "--run", parentRunId, "--approval", "approved second push", "--confirm-commit", committed.promotionCommit.commitSha, "--json"], cleanRoot);
assert(secondPush.promotionPushExecute.status === "succeeded", "idempotent push execute should still succeed");
assert(readRemoteHead(remoteUrl, committed.promotionCommit.integrationBranch) === committed.promotionCommit.commitSha, "remote branch should remain at pushed commit");

writeFileSync(resolve(committed.promotionCommit.integrationWorktreePath, `dirty-${smokeFile}`), "dirty push execute smoke\n", "utf8");
const dirty = aiJsonAllowFailure(["loop-worktree-promotion-push-execute", "--run", parentRunId, "--approval", "approved dirty", "--confirm-commit", committed.promotionCommit.commitSha, "--json"], cleanRoot);
assert(dirty.status !== 0, "push execute should refuse dirty integration worktree");
assert(dirty.json?.promotionPushExecute?.reason === "Promotion push execute refused on dirty integration worktree.", "dirty refusal should be explicit");

assertEventTypes(cleanRoot, parentRunId, [
  "loop_worktree_promotion_push_execute_requested",
  "loop_worktree_promotion_push_execute_refused",
  "loop_worktree_promotion_push_execute_started",
  "loop_worktree_promotion_push_execute_succeeded",
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

console.log(`[loop-worktree-promotion-push-execute-smoke] OK parent=${parentRunId} commit=${committed.promotionCommit.commitSha} file=${smokeFile}`);

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
    throw new Error("Unable to locate isolated parent run created by promotion push execute smoke.");
  }
  return after.parentRunId;
}

function prepareCleanRepo(runId, baseRef) {
  const root = resolve("D:/tmp/myagenttool-loop-smoke", `push-execute-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.email", "loop-smoke@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Loop Smoke"], { cwd: root });
  writeFileSync(resolve(root, ".gitignore"), ".myagenttool/\n", "utf8");
  writeFileSync(resolve(root, "README.md"), `promotion push execute clean repo for ${runId}\nbase ${baseRef ?? "HEAD"}\n`, "utf8");
  execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed promotion push execute smoke repo"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
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

function createBareRemote(runId) {
  const remoteUrl = normalizePath(resolve("D:/tmp/myagenttool-loop-smoke", `push-execute-remote-${runId}-${Date.now()}.git`));
  mkdirSync(dirname(remoteUrl), { recursive: true });
  execFileSync("git", ["init", "--bare", remoteUrl], { stdio: ["ignore", "pipe", "pipe"] });
  return remoteUrl;
}

function readRemoteHead(remoteUrl, branch) {
  const output = execFileSync("git", ["--git-dir", remoteUrl, "show-ref", "--verify", `refs/heads/${branch}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return output.split(/\s+/)[0];
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

function commandAllowFailure(command, args, cwd = repoRoot) {
  try {
    return {
      status: 0,
      stdout: execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
      stderr: "",
    };
  } catch (error) {
    return {
      status: error.status ?? 1,
      stdout: String(error.stdout ?? ""),
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
      throw new Error(`Loop worktree promotion push execute smoke missing event ${type} for ${runId}`);
    }
  }
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
