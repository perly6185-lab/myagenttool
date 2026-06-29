#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const issue = String(986000 + Math.floor(Date.now() % 2000));
const smokeFile = `loop-promotion-pr-merge-execute-${issue}.txt`;
const commitMessage = `PR merge execute promotion smoke ${issue}`;
const prNumber = 1234;
const prUrl = `https://example.invalid/myagenttool/pull/${prNumber}`;

const parentRunId = createPromotedRun(issue);
const source = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(source.exists === true, "promotion PR merge execute smoke needs an existing source worktree");

writeFileSync(resolve(source.worktreePath, smokeFile), `promotion PR merge execute smoke ${issue}\n`, "utf8");
const promoted = aiJson(["loop-worktree-promote", "--run", parentRunId, "--approval", "approved promotion PR merge execute smoke", "--json"]);
assert(promoted.promotion.status === "planned", "promotion PR merge execute smoke needs planned promotion evidence");
assert(promoted.promotion.changedFiles.includes(smokeFile), "promotion evidence should include smoke file");

const cleanRoot = prepareCleanRepo(parentRunId, source.baseRef);
aiJson(["loop-worktree-promotion-apply", "--run", parentRunId, "--approval", "approved clean apply", "--json"], cleanRoot);
aiJson(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved verify", "--command", "git-status", "--json"], cleanRoot);
aiJson(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved pr prep", "--json"], cleanRoot);
const committed = aiJson(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved commit", "--message", commitMessage, "--json"], cleanRoot);
assert(committed.promotionCommit.status === "succeeded", "promotion commit should succeed before PR merge execute");

const noMergePrep = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-execute", "--run", parentRunId, "--approval", "approved no merge prep", "--confirm-pr", String(prNumber), "--confirm-commit", committed.promotionCommit.commitSha, "--merge-method", "squash", "--json"], cleanRoot);
assert(noMergePrep.status !== 0, "PR merge execute without merge prep should fail");
assert(noMergePrep.json?.promotionPrMergeExecute?.reason === "Missing worktree-promotion-pr-merge-prep-result.json. Run loop-worktree-promotion-pr-merge-prep first.", "missing merge prep refusal should be explicit");

const remoteUrl = createBareRemote(parentRunId);
execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: committed.promotionCommit.integrationWorktreePath });
aiJson(["loop-worktree-promotion-push-plan", "--run", parentRunId, "--approval", "approved push plan", "--json"], cleanRoot);
aiJson(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--approval", "approved dry run", "--dry-run", "--json"], cleanRoot);
aiJson(["loop-worktree-promotion-push-execute", "--run", parentRunId, "--approval", "approved push execute", "--confirm-commit", committed.promotionCommit.commitSha, "--json"], cleanRoot);

const prepared = aiJson(["loop-worktree-promotion-pr-create-prep", "--run", parentRunId, "--approval", "approved pr create prep", "--base", "main", "--json"], cleanRoot);
const setupGh = createFakeGh(cleanRoot, {
  mode: "checks-success",
  prNumber,
  prUrl,
  headBranch: prepared.promotionPrCreatePrep.headBranch,
  baseBranch: "main",
  commitSha: committed.promotionCommit.commitSha,
});
const created = aiJson(["loop-worktree-promotion-pr-create-execute", "--run", parentRunId, "--approval", "approved pr create execute", "--confirm-head", prepared.promotionPrCreatePrep.headBranch, "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: setupGh.commandJson,
});
assert(created.promotionPrCreateExecute.status === "succeeded", "PR create execute should succeed before merge execute");
const mergePrep = aiJson(["loop-worktree-promotion-pr-merge-prep", "--run", parentRunId, "--approval", "approved merge prep", "--confirm-pr", String(prNumber), "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: setupGh.commandJson,
});
assert(mergePrep.promotionPrMergePrep.status === "ready", "PR merge prep should be ready before merge execute");

const noApproval = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-execute", "--run", parentRunId, "--confirm-pr", String(prNumber), "--confirm-commit", committed.promotionCommit.commitSha, "--merge-method", "squash", "--json"], cleanRoot);
assert(noApproval.status !== 0, "PR merge execute without approval should fail");
assert(noApproval.json?.promotionPrMergeExecute?.reason === "Worktree promotion PR merge execute requires --approval.", "missing approval refusal should be explicit");

const noConfirmPr = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-execute", "--run", parentRunId, "--approval", "approved no pr", "--confirm-commit", committed.promotionCommit.commitSha, "--merge-method", "squash", "--json"], cleanRoot);
assert(noConfirmPr.status !== 0, "PR merge execute without confirm PR should fail");
assert(noConfirmPr.json?.promotionPrMergeExecute?.reason === "Worktree promotion PR merge execute requires --confirm-pr.", "missing confirm PR refusal should be explicit");

const noConfirmCommit = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-execute", "--run", parentRunId, "--approval", "approved no commit", "--confirm-pr", String(prNumber), "--merge-method", "squash", "--json"], cleanRoot);
assert(noConfirmCommit.status !== 0, "PR merge execute without confirm commit should fail");
assert(noConfirmCommit.json?.promotionPrMergeExecute?.reason === "Worktree promotion PR merge execute requires --confirm-commit.", "missing confirm commit refusal should be explicit");

const badMethod = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-execute", "--run", parentRunId, "--approval", "approved bad method", "--confirm-pr", String(prNumber), "--confirm-commit", committed.promotionCommit.commitSha, "--merge-method", "delete", "--json"], cleanRoot);
assert(badMethod.status !== 0, "PR merge execute with bad merge method should fail");
assert(badMethod.json?.promotionPrMergeExecute?.reason === "Worktree promotion PR merge execute requires --merge-method squash|merge|rebase.", "bad method refusal should be explicit");

const wrongPr = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-execute", "--run", parentRunId, "--approval", "approved wrong pr", "--confirm-pr", "9999", "--confirm-commit", committed.promotionCommit.commitSha, "--merge-method", "squash", "--json"], cleanRoot);
assert(wrongPr.status !== 0, "PR merge execute with wrong PR should fail");
assert(wrongPr.json?.promotionPrMergeExecute?.reason === "Promotion PR merge execute refused because --confirm-pr does not match merge prep PR number.", "wrong PR refusal should be explicit");

const wrongCommit = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-execute", "--run", parentRunId, "--approval", "approved wrong commit", "--confirm-pr", String(prNumber), "--confirm-commit", "0000000000000000000000000000000000000000", "--merge-method", "squash", "--json"], cleanRoot);
assert(wrongCommit.status !== 0, "PR merge execute with wrong commit should fail");
assert(wrongCommit.json?.promotionPrMergeExecute?.reason === "Promotion PR merge execute refused because --confirm-commit does not match merge prep commit.", "wrong commit refusal should be explicit");

const mergePrepPath = resolve(cleanRoot, ".myagenttool/runs", parentRunId, "worktree-promotion-pr-merge-prep-result.json");
const mergePrepResult = JSON.parse(readFileSync(mergePrepPath, "utf8"));
writeFileSync(mergePrepPath, `${JSON.stringify({ ...mergePrepResult, status: "blocked" }, null, 2)}\n`, "utf8");
const blockedPrep = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-execute", "--run", parentRunId, "--approval", "approved blocked prep", "--confirm-pr", String(prNumber), "--confirm-commit", committed.promotionCommit.commitSha, "--merge-method", "squash", "--json"], cleanRoot);
assert(blockedPrep.status !== 0, "PR merge execute should refuse blocked merge prep");
assert(blockedPrep.json?.promotionPrMergeExecute?.reason === "Promotion PR merge prep status must be ready, got blocked.", "blocked prep refusal should be explicit");
writeFileSync(mergePrepPath, `${JSON.stringify(mergePrepResult, null, 2)}\n`, "utf8");

writeFileSync(mergePrepPath, `${JSON.stringify({ ...mergePrepResult, commitSha: "0000000000000000000000000000000000000000" }, null, 2)}\n`, "utf8");
const remoteMismatch = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-execute", "--run", parentRunId, "--approval", "approved remote mismatch", "--confirm-pr", String(prNumber), "--confirm-commit", "0000000000000000000000000000000000000000", "--merge-method", "squash", "--json"], cleanRoot);
assert(remoteMismatch.status !== 0, "PR merge execute should refuse remote head mismatch");
assert(remoteMismatch.json?.promotionPrMergeExecute?.reason === "Promotion PR merge execute refused because remote head does not match merge prep commit.", "remote mismatch refusal should be explicit");
writeFileSync(mergePrepPath, `${JSON.stringify(mergePrepResult, null, 2)}\n`, "utf8");

const finalChecksGh = createFakeGh(cleanRoot, {
  mode: "checks-failing",
  prNumber,
  prUrl,
  headBranch: prepared.promotionPrCreatePrep.headBranch,
  baseBranch: "main",
  commitSha: committed.promotionCommit.commitSha,
});
const finalChecksBlocked = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-execute", "--run", parentRunId, "--approval", "approved final checks blocked", "--confirm-pr", String(prNumber), "--confirm-commit", committed.promotionCommit.commitSha, "--merge-method", "squash", "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: finalChecksGh.commandJson,
});
assert(finalChecksBlocked.status !== 0, "PR merge execute should refuse when final checks are blocked");
assert(finalChecksBlocked.json?.promotionPrMergeExecute?.reason.includes("pr-checks-not-passing"), "final checks blocker should be recorded");

const mergeFailGh = createFakeGh(cleanRoot, {
  mode: "merge-fail",
  prNumber,
  prUrl,
  headBranch: prepared.promotionPrCreatePrep.headBranch,
  baseBranch: "main",
  commitSha: committed.promotionCommit.commitSha,
});
const mergeFailed = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-execute", "--run", parentRunId, "--approval", "approved merge fail", "--confirm-pr", String(prNumber), "--confirm-commit", committed.promotionCommit.commitSha, "--merge-method", "squash", "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: mergeFailGh.commandJson,
});
assert(mergeFailed.status !== 0, "PR merge execute should fail when gh merge fails");
assert(mergeFailed.json?.promotionPrMergeExecute?.status === "failed", "merge command failure should record failed status");
assert(mergeFailed.json?.promotionPrMergeExecute?.merge.exitCode === 2, "merge command failure should record exit code");
assert(mergeFailed.json?.promotionPrMergeExecute?.merge.stderr.includes("fake gh pr merge failed"), "merge failure stderr should be recorded");

const successGh = createFakeGh(cleanRoot, {
  mode: "merge-success",
  prNumber,
  prUrl,
  headBranch: prepared.promotionPrCreatePrep.headBranch,
  baseBranch: "main",
  commitSha: committed.promotionCommit.commitSha,
});
const merged = aiJson(["loop-worktree-promotion-pr-merge-execute", "--run", parentRunId, "--approval", "approved merge execute", "--confirm-pr", String(prNumber), "--confirm-commit", committed.promotionCommit.commitSha, "--merge-method", "squash", "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: successGh.commandJson,
});
assert(merged.promotionPrMergeExecute.status === "succeeded", "PR merge execute should succeed with fake gh");
assert(merged.promotionPrMergeExecute.mergeMethod === "squash", "merge method should be recorded");
assert(merged.promotionPrMergeExecute.confirmCommit === committed.promotionCommit.commitSha, "confirmed commit should be recorded");
assert(merged.promotionPrMergeExecute.merge.exitCode === 0, "merge command should exit cleanly");
assert(merged.promotionPrMergeExecute.merge.args.includes("--squash"), "merge command should include squash flag");
assert(!merged.promotionPrMergeExecute.merge.args.includes("--delete-branch"), "merge execute should not delete branches");
assert(existsSync(resolve(cleanRoot, merged.promotionPrMergeExecute.evidence.promotionPrMergeExecutePlan)), "merge execute plan evidence should exist");
assert(existsSync(resolve(cleanRoot, merged.promotionPrMergeExecute.evidence.promotionPrMergeExecuteResult)), "merge execute result evidence should exist");
assert(existsSync(resolve(cleanRoot, merged.promotionPrMergeExecute.evidence.promotionPrMergeExecuteMarkdown)), "merge execute markdown evidence should exist");

const successLog = JSON.parse(readFileSync(successGh.logPath, "utf8"));
const mergeCall = successLog.calls.find((call) => call.args[0] === "pr" && call.args[1] === "merge");
assert(mergeCall, "fake gh should receive pr merge");
assert(mergeCall.args.includes(String(prNumber)), "fake gh merge should receive PR number");
assert(mergeCall.args.includes("--squash"), "fake gh merge should receive squash method");
assert(!mergeCall.args.includes("--delete-branch"), "fake gh merge should not receive delete branch");
assert(successLog.calls.every((call) => call.env.GH_PROMPT_DISABLED === "1"), "gh prompts should be disabled");

const markdown = readFileSync(resolve(cleanRoot, merged.promotionPrMergeExecute.evidence.promotionPrMergeExecuteMarkdown), "utf8");
assert(markdown.includes("Promotion PR was merged by the human-gated execute step."), "merge execute markdown should include success summary");
assert(markdown.includes("This command may merge the confirmed pull request. It did not delete branches."), "merge execute markdown should state boundary");

assertEventTypes(cleanRoot, parentRunId, [
  "loop_worktree_promotion_pr_merge_execute_requested",
  "loop_worktree_promotion_pr_merge_execute_refused",
  "loop_worktree_promotion_pr_merge_execute_started",
  "loop_worktree_promotion_pr_merge_execute_failed",
  "loop_worktree_promotion_pr_merge_execute_succeeded",
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

console.log(`[loop-worktree-promotion-pr-merge-execute-smoke] OK parent=${parentRunId} pr=${merged.promotionPrMergeExecute.prUrl} file=${smokeFile}`);

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
    throw new Error("Unable to locate isolated parent run created by promotion PR merge execute smoke.");
  }
  return after.parentRunId;
}

function prepareCleanRepo(runId, baseRef) {
  const root = resolve("D:/tmp/myagenttool-loop-smoke", `pr-merge-execute-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.email", "loop-smoke@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Loop Smoke"], { cwd: root });
  writeFileSync(resolve(root, ".gitignore"), ".myagenttool/\n", "utf8");
  writeFileSync(resolve(root, "README.md"), `promotion PR merge execute clean repo for ${runId}\nbase ${baseRef ?? "HEAD"}\n`, "utf8");
  execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed promotion PR merge execute smoke repo"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
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
  const remoteUrl = normalizePath(resolve("D:/tmp/myagenttool-loop-smoke", `pr-merge-execute-remote-${runId}-${Date.now()}.git`));
  mkdirSync(dirname(remoteUrl), { recursive: true });
  execFileSync("git", ["init", "--bare", remoteUrl], { stdio: ["ignore", "pipe", "pipe"] });
  return remoteUrl;
}

function createFakeGh(root, config) {
  const fakeDir = resolve(root, ".myagenttool/fake-gh");
  mkdirSync(fakeDir, { recursive: true });
  const scriptPath = resolve(fakeDir, `fake-gh-${config.mode}.mjs`);
  const logPath = resolve(fakeDir, `fake-gh-${config.mode}-calls.json`);
  const source = `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const logPath = ${JSON.stringify(normalizePath(logPath))};
const calls = existsSync(logPath) ? JSON.parse(readFileSync(logPath, "utf8")).calls : [];
calls.push({
  args,
  cwd: process.cwd(),
  env: {
    GH_PROMPT_DISABLED: process.env.GH_PROMPT_DISABLED ?? null,
  },
});
writeFileSync(logPath, JSON.stringify({ calls }, null, 2) + "\\n", "utf8");

if (args[0] !== "pr") {
  console.error("fake gh expected pr command");
  process.exit(3);
}

if (args[1] === "create") {
  console.log(JSON.stringify({
    number: ${JSON.stringify(config.prNumber)},
    url: ${JSON.stringify(config.prUrl)},
    state: "OPEN",
  }));
  process.exit(0);
}

if (args[1] === "view") {
  console.log(JSON.stringify({
    number: ${JSON.stringify(config.prNumber)},
    url: ${JSON.stringify(config.prUrl)},
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    headRefName: ${JSON.stringify(config.headBranch)},
    headRefOid: ${JSON.stringify(config.commitSha)},
    baseRefName: ${JSON.stringify(config.baseBranch)},
  }));
  process.exit(0);
}

if (args[1] === "checks") {
  if (${JSON.stringify(config.mode)} === "checks-failing") {
    console.log(JSON.stringify([
      { name: "unit", state: "SUCCESS", bucket: "pass" },
      { name: "lint", state: "FAILURE", bucket: "fail" },
    ]));
    process.exit(0);
  }
  console.log(JSON.stringify([
    { name: "unit", state: "SUCCESS", bucket: "pass" },
    { name: "lint", state: "SUCCESS", bucket: "pass" },
  ]));
  process.exit(0);
}

if (args[1] === "merge") {
  if (${JSON.stringify(config.mode)} === "merge-fail") {
    console.error("fake gh pr merge failed");
    process.exit(2);
  }
  console.log("Merged pull request #${config.prNumber}");
  process.exit(0);
}

console.error("fake gh unsupported pr command");
process.exit(4);
`;
  writeFileSync(scriptPath, source, "utf8");
  return {
    commandJson: JSON.stringify([process.execPath, scriptPath]),
    logPath,
  };
}

function latestIsolatedParentRun(root) {
  const result = aiJson(["loop-worktree-list", "--json"], root);
  return result.worktrees[0] ?? null;
}

function aiJson(args, root = repoRoot, extraEnv = {}) {
  const output = execFileSync("node", [resolve(repoRoot, "tools/ai/src/index.mjs"), ...args], {
    cwd: root,
    env: { ...process.env, ...extraEnv, MYAGENTTOOL_REPO_ROOT: root },
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function aiJsonAllowFailure(args, root = repoRoot, extraEnv = {}) {
  try {
    return { status: 0, json: aiJson(args, root, extraEnv) };
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
      throw new Error(`Loop worktree promotion PR merge execute smoke missing event ${type} for ${runId}`);
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
