#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const issue = String(992000 + Math.floor(Date.now() % 2000));
const smokeFile = `loop-promotion-pr-create-prep-${issue}.txt`;
const commitMessage = `PR create prep promotion smoke ${issue}`;

const parentRunId = createPromotedRun(issue);
const source = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(source.exists === true, "promotion PR create prep smoke needs an existing source worktree");

writeFileSync(resolve(source.worktreePath, smokeFile), `promotion PR create prep smoke ${issue}\n`, "utf8");
const promoted = aiJson(["loop-worktree-promote", "--run", parentRunId, "--approval", "approved promotion PR create prep smoke", "--json"]);
assert(promoted.promotion.status === "planned", "promotion PR create prep smoke needs planned promotion evidence");
assert(promoted.promotion.changedFiles.includes(smokeFile), "promotion evidence should include smoke file");

const cleanRoot = prepareCleanRepo(parentRunId, source.baseRef);
const applied = aiJson(["loop-worktree-promotion-apply", "--run", parentRunId, "--approval", "approved clean apply", "--json"], cleanRoot);
assert(applied.promotionApply.status === "succeeded", "promotion apply should succeed before PR create prep");
aiJson(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved verify", "--command", "git-status", "--json"], cleanRoot);
const prepped = aiJson(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved pr prep", "--json"], cleanRoot);
assert(prepped.promotionPrPrep.status === "written", "promotion PR prep should succeed before PR create prep");
const committed = aiJson(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved commit", "--message", commitMessage, "--json"], cleanRoot);
assert(committed.promotionCommit.status === "succeeded", "promotion commit should succeed before PR create prep");

const noPush = aiJsonAllowFailure(["loop-worktree-promotion-pr-create-prep", "--run", parentRunId, "--approval", "approved no push", "--json"], cleanRoot);
assert(noPush.status !== 0, "PR create prep without push execute should fail");
assert(noPush.json?.promotionPrCreatePrep?.reason === "Missing worktree-promotion-push-execute-result.json. Run loop-worktree-promotion-push-execute first.", "missing push execute refusal should be explicit");

const remoteUrl = createBareRemote(parentRunId);
execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: committed.promotionCommit.integrationWorktreePath });
aiJson(["loop-worktree-promotion-push-plan", "--run", parentRunId, "--approval", "approved push plan", "--json"], cleanRoot);
aiJson(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--approval", "approved dry run", "--dry-run", "--json"], cleanRoot);
const pushed = aiJson(["loop-worktree-promotion-push-execute", "--run", parentRunId, "--approval", "approved push execute", "--confirm-commit", committed.promotionCommit.commitSha, "--json"], cleanRoot);
assert(pushed.promotionPushExecute.status === "succeeded", "push execute should succeed before PR create prep");
assert(readRemoteHead(remoteUrl, committed.promotionCommit.integrationBranch) === committed.promotionCommit.commitSha, "remote branch should point at pushed commit");

const noApproval = aiJsonAllowFailure(["loop-worktree-promotion-pr-create-prep", "--run", parentRunId, "--json"], cleanRoot);
assert(noApproval.status !== 0, "PR create prep without approval should fail");
assert(noApproval.json?.promotionPrCreatePrep?.status === "refused", "missing approval should record refused PR create prep");
assert(noApproval.json?.promotionPrCreatePrep?.reason === "Worktree promotion PR create prep requires --approval.", "missing approval refusal should be explicit");

const prepared = aiJson(["loop-worktree-promotion-pr-create-prep", "--run", parentRunId, "--approval", "approved pr create prep", "--base", "main", "--json"], cleanRoot);
assert(prepared.promotionPrCreatePrep.status === "written", "PR create prep should be written");
assert(prepared.promotionPrCreatePrep.baseBranch === "main", "PR create prep should record base branch");
assert(prepared.promotionPrCreatePrep.headBranch === committed.promotionCommit.integrationBranch, "PR create prep should record head branch");
assert(prepared.promotionPrCreatePrep.commitSha === committed.promotionCommit.commitSha, "PR create prep should record commit");
assert(prepared.promotionPrCreatePrep.remoteHead === committed.promotionCommit.commitSha, "PR create prep should record remote head");
assert(prepared.promotionPrCreatePrep.remoteHeadMatchesCommit === true, "PR create prep should confirm remote head");
assert(prepared.promotionPrCreatePrep.createCommand.includes("gh pr create"), "PR create prep should include gh command");
assert(prepared.promotionPrCreatePrep.createCommand.includes(`--head ${committed.promotionCommit.integrationBranch}`), "PR create prep should include head branch");
assert(prepared.promotionPrCreatePrep.createCommand.includes("--body-file .myagenttool/runs/"), "PR create prep should include body file");
assert(existsSync(resolve(cleanRoot, prepared.promotionPrCreatePrep.evidence.promotionPrCreatePlan)), "PR create plan evidence should exist");
assert(existsSync(resolve(cleanRoot, prepared.promotionPrCreatePrep.evidence.promotionPrCreateSummary)), "PR create summary evidence should exist");
assert(existsSync(resolve(cleanRoot, prepared.promotionPrCreatePrep.evidence.promotionPrCreateMarkdown)), "PR create markdown evidence should exist");
const markdown = readFileSync(resolve(cleanRoot, prepared.promotionPrCreatePrep.evidence.promotionPrCreateMarkdown), "utf8");
assert(markdown.includes("gh pr create"), "PR create markdown should include gh command");
assert(markdown.includes("This command did not call GitHub"), "PR create markdown should state boundary");

const pushExecutePath = resolve(cleanRoot, ".myagenttool/runs", parentRunId, "worktree-promotion-push-execute-result.json");
const pushExecute = JSON.parse(readFileSync(pushExecutePath, "utf8"));
writeFileSync(pushExecutePath, `${JSON.stringify({ ...pushExecute, remoteHeadMatchesCommit: false }, null, 2)}\n`, "utf8");
const badPushEvidence = aiJsonAllowFailure(["loop-worktree-promotion-pr-create-prep", "--run", parentRunId, "--approval", "approved bad push evidence", "--json"], cleanRoot);
assert(badPushEvidence.status !== 0, "PR create prep should refuse push execute evidence without remote head match");
assert(badPushEvidence.json?.promotionPrCreatePrep?.reason === "Promotion push execute result must confirm remote head matches commit.", "bad push evidence refusal should be explicit");
writeFileSync(pushExecutePath, `${JSON.stringify(pushExecute, null, 2)}\n`, "utf8");

writeFileSync(pushExecutePath, `${JSON.stringify({ ...pushExecute, commitSha: "0000000000000000000000000000000000000000" }, null, 2)}\n`, "utf8");
const remoteMismatch = aiJsonAllowFailure(["loop-worktree-promotion-pr-create-prep", "--run", parentRunId, "--approval", "approved remote mismatch", "--json"], cleanRoot);
assert(remoteMismatch.status !== 0, "PR create prep should refuse remote head mismatch");
assert(remoteMismatch.json?.promotionPrCreatePrep?.reason === "Promotion PR create prep refused because remote head does not match pushed commit.", "remote head mismatch refusal should be explicit");
writeFileSync(pushExecutePath, `${JSON.stringify(pushExecute, null, 2)}\n`, "utf8");

assertEventTypes(cleanRoot, parentRunId, [
  "loop_worktree_promotion_pr_create_prep_requested",
  "loop_worktree_promotion_pr_create_prep_refused",
  "loop_worktree_promotion_pr_create_prep_written",
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

console.log(`[loop-worktree-promotion-pr-create-prep-smoke] OK parent=${parentRunId} commit=${committed.promotionCommit.commitSha} file=${smokeFile}`);

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
    throw new Error("Unable to locate isolated parent run created by promotion PR create prep smoke.");
  }
  return after.parentRunId;
}

function prepareCleanRepo(runId, baseRef) {
  const root = resolve("D:/tmp/myagenttool-loop-smoke", `pr-create-prep-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.email", "loop-smoke@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Loop Smoke"], { cwd: root });
  writeFileSync(resolve(root, ".gitignore"), ".myagenttool/\n", "utf8");
  writeFileSync(resolve(root, "README.md"), `promotion PR create prep clean repo for ${runId}\nbase ${baseRef ?? "HEAD"}\n`, "utf8");
  execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed promotion PR create prep smoke repo"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
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
  const remoteUrl = normalizePath(resolve("D:/tmp/myagenttool-loop-smoke", `pr-create-prep-remote-${runId}-${Date.now()}.git`));
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

function assertEventTypes(root, runId, requiredTypes) {
  const events = readFileSync(resolve(root, ".myagenttool/runs", runId, "events.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const eventTypes = new Set(events.map((event) => event.type));
  for (const type of requiredTypes) {
    if (!eventTypes.has(type)) {
      throw new Error(`Loop worktree promotion PR create prep smoke missing event ${type} for ${runId}`);
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
