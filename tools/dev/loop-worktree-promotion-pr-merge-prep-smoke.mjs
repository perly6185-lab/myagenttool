#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const issue = String(988000 + Math.floor(Date.now() % 2000));
const smokeFile = `loop-promotion-pr-merge-prep-${issue}.txt`;
const commitMessage = `PR merge prep promotion smoke ${issue}`;
const prNumber = 1234;
const prUrl = `https://example.invalid/myagenttool/pull/${prNumber}`;

const parentRunId = createPromotedRun(issue);
const source = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(source.exists === true, "promotion PR merge prep smoke needs an existing source worktree");

writeFileSync(resolve(source.worktreePath, smokeFile), `promotion PR merge prep smoke ${issue}\n`, "utf8");
const promoted = aiJson(["loop-worktree-promote", "--run", parentRunId, "--approval", "approved promotion PR merge prep smoke", "--json"]);
assert(promoted.promotion.status === "planned", "promotion PR merge prep smoke needs planned promotion evidence");
assert(promoted.promotion.changedFiles.includes(smokeFile), "promotion evidence should include smoke file");

const cleanRoot = prepareCleanRepo(parentRunId, source.baseRef);
const applied = aiJson(["loop-worktree-promotion-apply", "--run", parentRunId, "--approval", "approved clean apply", "--json"], cleanRoot);
aiJson(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved verify", "--command", "git-status", "--json"], cleanRoot);
aiJson(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved pr prep", "--json"], cleanRoot);
const committed = aiJson(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved commit", "--message", commitMessage, "--json"], cleanRoot);
assert(committed.promotionCommit.status === "succeeded", "promotion commit should succeed before PR merge prep");

const noCreate = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-prep", "--run", parentRunId, "--approval", "approved no create", "--confirm-pr", String(prNumber), "--json"], cleanRoot);
assert(noCreate.status !== 0, "PR merge prep without PR create execute should fail");
assert(noCreate.json?.promotionPrMergePrep?.reason === "Missing worktree-promotion-pr-create-result.json. Run loop-worktree-promotion-pr-create-execute first.", "missing PR create execute refusal should be explicit");

const remoteUrl = createBareRemote(parentRunId);
execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: committed.promotionCommit.integrationWorktreePath });
aiJson(["loop-worktree-promotion-push-plan", "--run", parentRunId, "--approval", "approved push plan", "--json"], cleanRoot);
aiJson(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--approval", "approved dry run", "--dry-run", "--json"], cleanRoot);
const pushed = aiJson(["loop-worktree-promotion-push-execute", "--run", parentRunId, "--approval", "approved push execute", "--confirm-commit", committed.promotionCommit.commitSha, "--json"], cleanRoot);
assert(pushed.promotionPushExecute.status === "succeeded", "push execute should succeed before PR merge prep");

const prepared = aiJson(["loop-worktree-promotion-pr-create-prep", "--run", parentRunId, "--approval", "approved pr create prep", "--base", "main", "--json"], cleanRoot);
const createGh = createFakeGh(cleanRoot, {
  mode: "create-success",
  prNumber,
  prUrl,
  headBranch: prepared.promotionPrCreatePrep.headBranch,
  baseBranch: "main",
  commitSha: committed.promotionCommit.commitSha,
});
const created = aiJson(["loop-worktree-promotion-pr-create-execute", "--run", parentRunId, "--approval", "approved pr create execute", "--confirm-head", prepared.promotionPrCreatePrep.headBranch, "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: createGh.commandJson,
});
assert(created.promotionPrCreateExecute.status === "succeeded", "PR create execute should succeed before PR merge prep");

const noApproval = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-prep", "--run", parentRunId, "--confirm-pr", String(prNumber), "--json"], cleanRoot);
assert(noApproval.status !== 0, "PR merge prep without approval should fail");
assert(noApproval.json?.promotionPrMergePrep?.reason === "Worktree promotion PR merge prep requires --approval.", "missing approval refusal should be explicit");

const noConfirm = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-prep", "--run", parentRunId, "--approval", "approved no confirm", "--json"], cleanRoot);
assert(noConfirm.status !== 0, "PR merge prep without confirm PR should fail");
assert(noConfirm.json?.promotionPrMergePrep?.reason === "Worktree promotion PR merge prep requires --confirm-pr.", "missing confirm refusal should be explicit");

const wrongConfirm = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-prep", "--run", parentRunId, "--approval", "approved wrong pr", "--confirm-pr", "9999", "--json"], cleanRoot);
assert(wrongConfirm.status !== 0, "PR merge prep with wrong confirm PR should fail");
assert(wrongConfirm.json?.promotionPrMergePrep?.reason === "Promotion PR merge prep refused because --confirm-pr does not match created PR number.", "wrong confirm refusal should be explicit");

const createResultPath = resolve(cleanRoot, ".myagenttool/runs", parentRunId, "worktree-promotion-pr-create-result.json");
const createResult = JSON.parse(readFileSync(createResultPath, "utf8"));
writeFileSync(createResultPath, `${JSON.stringify({ ...createResult, commitSha: "0000000000000000000000000000000000000000" }, null, 2)}\n`, "utf8");
const remoteMismatch = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-prep", "--run", parentRunId, "--approval", "approved remote mismatch", "--confirm-pr", String(prNumber), "--json"], cleanRoot);
assert(remoteMismatch.status !== 0, "PR merge prep should refuse remote head mismatch");
assert(remoteMismatch.json?.promotionPrMergePrep?.reason === "Promotion PR merge prep refused because remote head does not match created PR commit.", "remote mismatch refusal should be explicit");
writeFileSync(createResultPath, `${JSON.stringify(createResult, null, 2)}\n`, "utf8");

const failingChecksGh = createFakeGh(cleanRoot, {
  mode: "checks-failing",
  prNumber,
  prUrl,
  headBranch: prepared.promotionPrCreatePrep.headBranch,
  baseBranch: "main",
  commitSha: committed.promotionCommit.commitSha,
});
const checksBlocked = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-prep", "--run", parentRunId, "--approval", "approved failing checks", "--confirm-pr", String(prNumber), "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: failingChecksGh.commandJson,
});
assert(checksBlocked.status !== 0, "PR merge prep should block on failing checks");
assert(checksBlocked.json?.promotionPrMergePrep?.status === "blocked", "failing checks should record blocked prep");
assert(checksBlocked.json?.promotionPrMergePrep?.blockers.includes("pr-checks-not-passing"), "failing checks blocker should be recorded");

const noChecksGh = createFakeGh(cleanRoot, {
  mode: "checks-empty",
  prNumber,
  prUrl,
  headBranch: prepared.promotionPrCreatePrep.headBranch,
  baseBranch: "main",
  commitSha: committed.promotionCommit.commitSha,
});
const noChecksBlocked = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-prep", "--run", parentRunId, "--approval", "approved no checks", "--confirm-pr", String(prNumber), "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: noChecksGh.commandJson,
});
assert(noChecksBlocked.status !== 0, "PR merge prep should block on missing checks by default");
assert(noChecksBlocked.json?.promotionPrMergePrep?.blockers.includes("pr-checks-missing"), "missing checks blocker should be recorded");

const invalidChecksGh = createFakeGh(cleanRoot, {
  mode: "checks-invalid-json",
  prNumber,
  prUrl,
  headBranch: prepared.promotionPrCreatePrep.headBranch,
  baseBranch: "main",
  commitSha: committed.promotionCommit.commitSha,
});
const invalidChecksBlocked = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-prep", "--run", parentRunId, "--approval", "approved invalid checks", "--confirm-pr", String(prNumber), "--allow-no-checks", "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: invalidChecksGh.commandJson,
});
assert(invalidChecksBlocked.status !== 0, "PR merge prep should block invalid checks JSON even with allow-no-checks");
assert(invalidChecksBlocked.json?.promotionPrMergePrep?.blockers.includes("gh-pr-checks-invalid-json"), "invalid checks JSON blocker should be recorded");

const missingPrViewGh = createFakeGh(cleanRoot, {
  mode: "view-missing-fields",
  prNumber,
  prUrl,
  headBranch: prepared.promotionPrCreatePrep.headBranch,
  baseBranch: "main",
  commitSha: committed.promotionCommit.commitSha,
});
const missingPrViewBlocked = aiJsonAllowFailure(["loop-worktree-promotion-pr-merge-prep", "--run", parentRunId, "--approval", "approved missing view fields", "--confirm-pr", String(prNumber), "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: missingPrViewGh.commandJson,
});
assert(missingPrViewBlocked.status !== 0, "PR merge prep should block missing PR view confirmation fields");
assert(missingPrViewBlocked.json?.promotionPrMergePrep?.blockers.includes("pr-head-commit-missing"), "missing head commit blocker should be recorded");
assert(missingPrViewBlocked.json?.promotionPrMergePrep?.blockers.includes("pr-mergeable-missing"), "missing mergeable blocker should be recorded");

const noChecksAllowed = aiJson(["loop-worktree-promotion-pr-merge-prep", "--run", parentRunId, "--approval", "approved no checks allowed", "--confirm-pr", String(prNumber), "--allow-no-checks", "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: noChecksGh.commandJson,
});
assert(noChecksAllowed.promotionPrMergePrep.status === "ready", "allow-no-checks should permit empty checks");
assert(noChecksAllowed.promotionPrMergePrep.allowNoChecks === true, "allow-no-checks should be recorded");

const successGh = createFakeGh(cleanRoot, {
  mode: "checks-success",
  prNumber,
  prUrl,
  headBranch: prepared.promotionPrCreatePrep.headBranch,
  baseBranch: "main",
  commitSha: committed.promotionCommit.commitSha,
});
const ready = aiJson(["loop-worktree-promotion-pr-merge-prep", "--run", parentRunId, "--approval", "approved merge prep", "--confirm-pr", String(prNumber), "--json"], cleanRoot, {
  MYAGENTTOOL_GH_COMMAND_JSON: successGh.commandJson,
});
assert(ready.promotionPrMergePrep.status === "ready", "PR merge prep should be ready with open PR and passing checks");
assert(ready.promotionPrMergePrep.prNumber === prNumber, "PR merge prep should record PR number");
assert(ready.promotionPrMergePrep.prUrl === prUrl, "PR merge prep should record PR URL");
assert(ready.promotionPrMergePrep.remoteHead === committed.promotionCommit.commitSha, "PR merge prep should record remote head");
assert(ready.promotionPrMergePrep.remoteHeadMatchesCommit === true, "PR merge prep should confirm remote head");
assert(ready.promotionPrMergePrep.checkRuns.length === 2, "PR merge prep should record check runs");
assert(ready.promotionPrMergePrep.failedChecks.length === 0, "PR merge prep should have no failed checks");
assert(existsSync(resolve(cleanRoot, ready.promotionPrMergePrep.evidence.promotionPrMergePrepPlan)), "PR merge prep plan evidence should exist");
assert(existsSync(resolve(cleanRoot, ready.promotionPrMergePrep.evidence.promotionPrMergePrepResult)), "PR merge prep result evidence should exist");
assert(existsSync(resolve(cleanRoot, ready.promotionPrMergePrep.evidence.promotionPrMergePrepMarkdown)), "PR merge prep markdown evidence should exist");

const successLog = JSON.parse(readFileSync(successGh.logPath, "utf8"));
assert(successLog.calls.some((call) => call.args[0] === "pr" && call.args[1] === "view"), "fake gh should receive pr view");
assert(successLog.calls.some((call) => call.args[0] === "pr" && call.args[1] === "checks"), "fake gh should receive pr checks");
assert(successLog.calls.every((call) => call.env.GH_PROMPT_DISABLED === "1"), "gh prompts should be disabled");
assert(successLog.calls.every((call) => normalizePath(call.cwd) === normalizePath(prepared.promotionPrCreatePrep.integrationWorktreePath)), "fake gh should run in integration worktree");

const markdown = readFileSync(resolve(cleanRoot, ready.promotionPrMergePrep.evidence.promotionPrMergePrepMarkdown), "utf8");
assert(markdown.includes("Promotion PR merge prep is ready."), "PR merge prep markdown should include ready summary");
assert(markdown.includes("This command performed read-only PR merge preparation checks. It did not merge."), "PR merge prep markdown should state boundary");
assert(markdown.includes(prUrl), "PR merge prep markdown should include PR URL");

assertEventTypes(cleanRoot, parentRunId, [
  "loop_worktree_promotion_pr_merge_prep_requested",
  "loop_worktree_promotion_pr_merge_prep_refused",
  "loop_worktree_promotion_pr_merge_prep_blocked",
  "loop_worktree_promotion_pr_merge_prep_ready",
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

console.log(`[loop-worktree-promotion-pr-merge-prep-smoke] OK parent=${parentRunId} pr=${ready.promotionPrMergePrep.prUrl} file=${smokeFile}`);

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
    throw new Error("Unable to locate isolated parent run created by promotion PR merge prep smoke.");
  }
  return after.parentRunId;
}

function prepareCleanRepo(runId, baseRef) {
  const root = resolve("D:/tmp/myagenttool-loop-smoke", `pr-merge-prep-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.email", "loop-smoke@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Loop Smoke"], { cwd: root });
  writeFileSync(resolve(root, ".gitignore"), ".myagenttool/\n", "utf8");
  writeFileSync(resolve(root, "README.md"), `promotion PR merge prep clean repo for ${runId}\nbase ${baseRef ?? "HEAD"}\n`, "utf8");
  execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed promotion PR merge prep smoke repo"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
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
  const remoteUrl = normalizePath(resolve("D:/tmp/myagenttool-loop-smoke", `pr-merge-prep-remote-${runId}-${Date.now()}.git`));
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
  if (${JSON.stringify(config.mode)} === "view-missing-fields") {
    console.log(JSON.stringify({
      number: ${JSON.stringify(config.prNumber)},
      url: ${JSON.stringify(config.prUrl)},
      state: "OPEN",
      isDraft: false,
      headRefName: ${JSON.stringify(config.headBranch)},
      baseRefName: ${JSON.stringify(config.baseBranch)},
    }));
    process.exit(0);
  }
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
  if (${JSON.stringify(config.mode)} === "checks-empty") {
    console.log(JSON.stringify([]));
    process.exit(0);
  }
  if (${JSON.stringify(config.mode)} === "checks-invalid-json") {
    console.log("not json");
    process.exit(0);
  }
  console.log(JSON.stringify([
    { name: "unit", state: "SUCCESS", bucket: "pass" },
    { name: "lint", state: "SUCCESS", bucket: "pass" },
  ]));
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
      throw new Error(`Loop worktree promotion PR merge prep smoke missing event ${type} for ${runId}`);
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
