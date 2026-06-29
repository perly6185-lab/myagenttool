#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const issue = String(990000 + Math.floor(Date.now() % 2000));
const smokeFile = `loop-promotion-pr-create-execute-${issue}.txt`;
const commitMessage = `PR create execute promotion smoke ${issue}`;

const parentRunId = createPromotedRun(issue);
const source = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(source.exists === true, "promotion PR create execute smoke needs an existing source worktree");

writeFileSync(resolve(source.worktreePath, smokeFile), `promotion PR create execute smoke ${issue}\n`, "utf8");
const promoted = aiJson(["loop-worktree-promote", "--run", parentRunId, "--approval", "approved promotion PR create execute smoke", "--json"]);
assert(promoted.promotion.status === "planned", "promotion PR create execute smoke needs planned promotion evidence");
assert(promoted.promotion.changedFiles.includes(smokeFile), "promotion evidence should include smoke file");

const cleanRoot = prepareCleanRepo(parentRunId, source.baseRef);
const applied = aiJson(["loop-worktree-promotion-apply", "--run", parentRunId, "--approval", "approved clean apply", "--json"], cleanRoot);
assert(applied.promotionApply.status === "succeeded", "promotion apply should succeed before PR create execute");
const verified = aiJson(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved verify", "--command", "git-status", "--json"], cleanRoot);
assert(verified.promotionVerify.status === "succeeded", "promotion verify should succeed before PR create execute");
const prepped = aiJson(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved pr prep", "--json"], cleanRoot);
assert(prepped.promotionPrPrep.status === "written", "promotion PR prep should succeed before PR create execute");
const committed = aiJson(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved commit", "--message", commitMessage, "--json"], cleanRoot);
assert(committed.promotionCommit.status === "succeeded", "promotion commit should succeed before PR create execute");

const noPrep = aiJsonAllowFailure(["loop-worktree-promotion-pr-create-execute", "--run", parentRunId, "--approval", "approved no create prep", "--confirm-head", committed.promotionCommit.integrationBranch, "--json"], cleanRoot);
assert(noPrep.status !== 0, "PR create execute without create prep should fail");
assert(noPrep.json?.promotionPrCreateExecute?.reason === "Missing worktree-promotion-pr-create-summary.json. Run loop-worktree-promotion-pr-create-prep first.", "missing create prep refusal should be explicit");

const remoteUrl = createBareRemote(parentRunId);
execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: committed.promotionCommit.integrationWorktreePath });
aiJson(["loop-worktree-promotion-push-plan", "--run", parentRunId, "--approval", "approved push plan", "--json"], cleanRoot);
aiJson(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--approval", "approved dry run", "--dry-run", "--json"], cleanRoot);
const pushed = aiJson(["loop-worktree-promotion-push-execute", "--run", parentRunId, "--approval", "approved push execute", "--confirm-commit", committed.promotionCommit.commitSha, "--json"], cleanRoot);
assert(pushed.promotionPushExecute.status === "succeeded", "push execute should succeed before PR create execute");
assert(readRemoteHead(remoteUrl, committed.promotionCommit.integrationBranch) === committed.promotionCommit.commitSha, "remote branch should point at pushed commit");

const prepared = aiJson(["loop-worktree-promotion-pr-create-prep", "--run", parentRunId, "--approval", "approved pr create prep", "--base", "main", "--json"], cleanRoot);
assert(prepared.promotionPrCreatePrep.status === "written", "PR create prep should be written before execute");
assert(prepared.promotionPrCreatePrep.headBranch === committed.promotionCommit.integrationBranch, "PR create prep should record head branch");
assert(prepared.promotionPrCreatePrep.remoteHeadMatchesCommit === true, "PR create prep should confirm remote head");

const noApproval = aiJsonAllowFailure(["loop-worktree-promotion-pr-create-execute", "--run", parentRunId, "--confirm-head", prepared.promotionPrCreatePrep.headBranch, "--json"], cleanRoot);
assert(noApproval.status !== 0, "PR create execute without approval should fail");
assert(noApproval.json?.promotionPrCreateExecute?.status === "refused", "missing approval should record refused execute");
assert(noApproval.json?.promotionPrCreateExecute?.reason === "Worktree promotion PR create execute requires --approval.", "missing approval refusal should be explicit");

const noConfirm = aiJsonAllowFailure(["loop-worktree-promotion-pr-create-execute", "--run", parentRunId, "--approval", "approved no confirm", "--json"], cleanRoot);
assert(noConfirm.status !== 0, "PR create execute without confirm head should fail");
assert(noConfirm.json?.promotionPrCreateExecute?.reason === "Worktree promotion PR create execute requires --confirm-head.", "missing confirm refusal should be explicit");

const wrongConfirm = aiJsonAllowFailure(["loop-worktree-promotion-pr-create-execute", "--run", parentRunId, "--approval", "approved wrong confirm", "--confirm-head", "wrong-head-branch", "--json"], cleanRoot);
assert(wrongConfirm.status !== 0, "PR create execute with wrong confirm head should fail");
assert(wrongConfirm.json?.promotionPrCreateExecute?.reason === "Promotion PR create execute refused because --confirm-head does not match PR create prep head branch.", "wrong confirm refusal should be explicit");

const prCreateSummaryPath = resolve(cleanRoot, ".myagenttool/runs", parentRunId, "worktree-promotion-pr-create-summary.json");
const prCreateSummary = JSON.parse(readFileSync(prCreateSummaryPath, "utf8"));
writeFileSync(prCreateSummaryPath, `${JSON.stringify({ ...prCreateSummary, commitSha: "0000000000000000000000000000000000000000" }, null, 2)}\n`, "utf8");
const remoteMismatch = aiJsonAllowFailure(["loop-worktree-promotion-pr-create-execute", "--run", parentRunId, "--approval", "approved remote mismatch", "--confirm-head", prepared.promotionPrCreatePrep.headBranch, "--json"], cleanRoot);
assert(remoteMismatch.status !== 0, "PR create execute should refuse remote head mismatch");
assert(remoteMismatch.json?.promotionPrCreateExecute?.reason === "Promotion PR create execute refused because remote head does not match prepared commit.", "remote mismatch refusal should be explicit");
writeFileSync(prCreateSummaryPath, `${JSON.stringify(prCreateSummary, null, 2)}\n`, "utf8");

const failingGh = createFakeGh(cleanRoot, "fail", parentRunId);
const ghFailed = aiJsonAllowFailure(["loop-worktree-promotion-pr-create-execute", "--run", parentRunId, "--approval", "approved gh fail", "--confirm-head", prepared.promotionPrCreatePrep.headBranch, "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: failingGh.commandJson,
});
assert(ghFailed.status !== 0, "PR create execute should fail when gh fails");
assert(ghFailed.json?.promotionPrCreateExecute?.status === "failed", "gh failure should record failed execute");
assert(ghFailed.json?.promotionPrCreateExecute?.reason === "Promotion PR create execute failed during gh pr create.", "gh failure reason should be explicit");
assert(ghFailed.json?.promotionPrCreateExecute?.gh.exitCode === 2, "gh failure should record exit code");
assert(ghFailed.json?.promotionPrCreateExecute?.gh.stderr.includes("fake gh pr create failed"), "gh failure should record stderr");

const successGh = createFakeGh(cleanRoot, "success", parentRunId);
const executed = aiJson(["loop-worktree-promotion-pr-create-execute", "--run", parentRunId, "--approval", "approved pr create execute", "--confirm-head", prepared.promotionPrCreatePrep.headBranch, "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: successGh.commandJson,
});
assert(executed.promotionPrCreateExecute.status === "succeeded", "PR create execute should succeed with fake gh");
assert(executed.promotionPrCreateExecute.prNumber === 1234, "PR create execute should record PR number");
assert(executed.promotionPrCreateExecute.prUrl === "https://example.invalid/myagenttool/pull/1234", "PR create execute should record PR URL");
assert(executed.promotionPrCreateExecute.prState === "OPEN", "PR create execute should record PR state");
assert(executed.promotionPrCreateExecute.remoteHead === committed.promotionCommit.commitSha, "PR create execute should record remote head");
assert(executed.promotionPrCreateExecute.remoteHeadMatchesCommit === true, "PR create execute should confirm remote head");
assert(executed.promotionPrCreateExecute.gh.exitCode === 0, "fake gh should exit cleanly");
assert(executed.promotionPrCreateExecute.gh.args.includes("--base"), "gh args should include base option");
assert(executed.promotionPrCreateExecute.gh.args.includes("--head"), "gh args should include head option");
assert(executed.promotionPrCreateExecute.gh.args.includes("--body-file"), "gh args should include body file option");
assert(existsSync(resolve(cleanRoot, executed.promotionPrCreateExecute.evidence.promotionPrCreateExecutePlan)), "PR create execute plan evidence should exist");
assert(existsSync(resolve(cleanRoot, executed.promotionPrCreateExecute.evidence.promotionPrCreateResult)), "PR create execute result evidence should exist");
assert(existsSync(resolve(cleanRoot, executed.promotionPrCreateExecute.evidence.promotionPrCreateResultMarkdown)), "PR create execute markdown evidence should exist");

const successLog = JSON.parse(readFileSync(successGh.logPath, "utf8"));
assert(successLog.args[0] === "pr" && successLog.args[1] === "create", "fake gh should receive pr create args");
assert(successLog.args.includes("--base") && successLog.args.includes("main"), "fake gh should receive base branch");
assert(successLog.args.includes("--head") && successLog.args.includes(prepared.promotionPrCreatePrep.headBranch), "fake gh should receive head branch");
assert(successLog.env.GH_PROMPT_DISABLED === "1", "gh prompts should be disabled");
assert(normalizePath(successLog.cwd) === normalizePath(prepared.promotionPrCreatePrep.integrationWorktreePath), "fake gh should run in integration worktree");

const markdown = readFileSync(resolve(cleanRoot, executed.promotionPrCreateExecute.evidence.promotionPrCreateResultMarkdown), "utf8");
assert(markdown.includes("Promotion pull request was created."), "PR create execute markdown should include success summary");
assert(markdown.includes("This command may create a pull request. It did not merge."), "PR create execute markdown should state boundary");
assert(markdown.includes("https://example.invalid/myagenttool/pull/1234"), "PR create execute markdown should include PR URL");

assertEventTypes(cleanRoot, parentRunId, [
  "loop_worktree_promotion_pr_create_execute_requested",
  "loop_worktree_promotion_pr_create_execute_refused",
  "loop_worktree_promotion_pr_create_execute_started",
  "loop_worktree_promotion_pr_create_execute_failed",
  "loop_worktree_promotion_pr_create_execute_succeeded",
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

console.log(`[loop-worktree-promotion-pr-create-execute-smoke] OK parent=${parentRunId} pr=${executed.promotionPrCreateExecute.prUrl} file=${smokeFile}`);

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
    throw new Error("Unable to locate isolated parent run created by promotion PR create execute smoke.");
  }
  return after.parentRunId;
}

function prepareCleanRepo(runId, baseRef) {
  const root = resolve("D:/tmp/myagenttool-loop-smoke", `pr-create-execute-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.email", "loop-smoke@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Loop Smoke"], { cwd: root });
  writeFileSync(resolve(root, ".gitignore"), ".myagenttool/\n", "utf8");
  writeFileSync(resolve(root, "README.md"), `promotion PR create execute clean repo for ${runId}\nbase ${baseRef ?? "HEAD"}\n`, "utf8");
  execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed promotion PR create execute smoke repo"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
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
  const remoteUrl = normalizePath(resolve("D:/tmp/myagenttool-loop-smoke", `pr-create-execute-remote-${runId}-${Date.now()}.git`));
  mkdirSync(dirname(remoteUrl), { recursive: true });
  execFileSync("git", ["init", "--bare", remoteUrl], { stdio: ["ignore", "pipe", "pipe"] });
  return remoteUrl;
}

function createFakeGh(root, mode, runId) {
  const fakeDir = resolve(root, ".myagenttool/fake-gh");
  mkdirSync(fakeDir, { recursive: true });
  const scriptPath = resolve(fakeDir, `fake-gh-${mode}.mjs`);
  const logPath = resolve(fakeDir, `fake-gh-${mode}-args.json`);
  const prUrl = `https://example.invalid/myagenttool/pull/1234`;
  const source = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(normalizePath(logPath))}, JSON.stringify({
  args,
  cwd: process.cwd(),
  env: {
    GH_PROMPT_DISABLED: process.env.GH_PROMPT_DISABLED ?? null,
  },
}, null, 2) + "\\n", "utf8");

if (args[0] !== "pr" || args[1] !== "create") {
  console.error("fake gh expected pr create for ${runId}");
  process.exit(3);
}

if (${JSON.stringify(mode)} === "fail") {
  console.error("fake gh pr create failed");
  process.exit(2);
}

console.log(JSON.stringify({
  number: 1234,
  url: ${JSON.stringify(prUrl)},
  state: "OPEN",
}));
`;
  writeFileSync(scriptPath, source, "utf8");
  return {
    commandJson: JSON.stringify([process.execPath, scriptPath]),
    logPath,
  };
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
      throw new Error(`Loop worktree promotion PR create execute smoke missing event ${type} for ${runId}`);
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
