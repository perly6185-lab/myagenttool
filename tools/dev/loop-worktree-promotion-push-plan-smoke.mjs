#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const issue = String(998000 + Math.floor(Date.now() % 2000));
const smokeFile = `loop-promotion-push-plan-${issue}.txt`;
const commitMessage = `Push plan promotion smoke ${issue}`;
const remoteUrl = "https://example.invalid/perly6185-lab/myagenttool.git";

const parentRunId = createPromotedRun(issue);
const source = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(source.exists === true, "promotion push plan smoke needs an existing source worktree");

writeFileSync(resolve(source.worktreePath, smokeFile), `promotion push plan smoke ${issue}\n`, "utf8");
const promoted = aiJson(["loop-worktree-promote", "--run", parentRunId, "--approval", "approved promotion push plan smoke", "--json"]);
assert(promoted.promotion.status === "planned", "promotion push plan smoke needs planned promotion evidence");
assert(promoted.promotion.changedFiles.includes(smokeFile), "promotion evidence should include smoke file");

const cleanRoot = prepareCleanRepo(parentRunId, source.baseRef);
const noCommit = aiJsonAllowFailure(["loop-worktree-promotion-push-plan", "--run", parentRunId, "--approval", "approved no commit", "--json"], cleanRoot);
assert(noCommit.status !== 0, "push plan without commit evidence should fail");
assert(noCommit.json?.promotionPushPlan?.reason === "Missing worktree-promotion-commit-result.json. Run loop-worktree-promotion-commit first.", "missing commit refusal should be explicit");

const applied = aiJson(["loop-worktree-promotion-apply", "--run", parentRunId, "--approval", "approved clean apply", "--json"], cleanRoot);
assert(applied.promotionApply.status === "succeeded", "promotion apply should succeed before push plan");
const verified = aiJson(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved verify", "--command", "git-status", "--json"], cleanRoot);
assert(verified.promotionVerify.status === "succeeded", "promotion verify should succeed before push plan");
const prepped = aiJson(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved pr prep", "--json"], cleanRoot);
assert(prepped.promotionPrPrep.status === "written", "promotion PR prep should succeed before push plan");
const committed = aiJson(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved commit", "--message", commitMessage, "--json"], cleanRoot);
assert(committed.promotionCommit.status === "succeeded", "promotion commit should succeed before push plan");

execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: committed.promotionCommit.integrationWorktreePath });

const noApproval = aiJsonAllowFailure(["loop-worktree-promotion-push-plan", "--run", parentRunId, "--json"], cleanRoot);
assert(noApproval.status !== 0, "push plan without approval should fail");
assert(noApproval.json?.promotionPushPlan?.status === "refused", "missing approval should record refused push plan");
assert(noApproval.json?.promotionPushPlan?.reason === "Worktree promotion push plan requires --approval.", "missing approval refusal should be explicit");

const planned = aiJson(["loop-worktree-promotion-push-plan", "--run", parentRunId, "--approval", "approved push plan", "--json"], cleanRoot);
assert(planned.promotionPushPlan.status === "planned", "promotion push plan should be planned");
assert(planned.promotionPushPlan.commitSha === committed.promotionCommit.commitSha, "push plan should record commit SHA");
assert(planned.promotionPushPlan.headMatchesCommit === true, "push plan should confirm integration HEAD");
assert(planned.promotionPushPlan.remote === "origin", "push plan should default to origin");
assert(planned.promotionPushPlan.remoteUrl === remoteUrl, "push plan should record remote URL");
assert(planned.promotionPushPlan.refspec === `${committed.promotionCommit.integrationBranch}:${committed.promotionCommit.integrationBranch}`, "push plan should record refspec");
assert(planned.promotionPushPlan.pushCommand === `git push origin ${committed.promotionCommit.integrationBranch}:${committed.promotionCommit.integrationBranch}`, "push plan should record push command");
assert(planned.promotionPushPlan.risks.length === 0, "configured origin should not produce push plan risks");
assert(planned.promotionPushPlan.changedFiles.includes(smokeFile), "push plan should include changed file");
assert(existsSync(resolve(cleanRoot, planned.promotionPushPlan.evidence.promotionPushPlan)), "push plan JSON evidence should exist");
assert(existsSync(resolve(cleanRoot, planned.promotionPushPlan.evidence.promotionPushChecklist)), "push checklist evidence should exist");
assert(existsSync(resolve(cleanRoot, planned.promotionPushPlan.evidence.promotionPushMarkdown)), "push markdown evidence should exist");
const markdown = readFileSync(resolve(cleanRoot, planned.promotionPushPlan.evidence.promotionPushMarkdown), "utf8");
assert(markdown.includes(committed.promotionCommit.commitSha), "push markdown should include commit SHA");
assert(markdown.includes(committed.promotionCommit.integrationBranch), "push markdown should include branch");
assert(markdown.includes(planned.promotionPushPlan.pushCommand), "push markdown should include push command");

const missingRemote = aiJson(["loop-worktree-promotion-push-plan", "--run", parentRunId, "--approval", "approved missing remote risk", "--remote", "upstream", "--json"], cleanRoot);
assert(missingRemote.promotionPushPlan.status === "planned", "missing remote should be a risk, not a refusal");
assert(missingRemote.promotionPushPlan.risks.includes("Remote not configured: upstream"), "missing remote risk should be explicit");

const commitResultPath = resolve(cleanRoot, ".myagenttool/runs", parentRunId, "worktree-promotion-commit-result.json");
const commitResult = JSON.parse(readFileSync(commitResultPath, "utf8"));
writeFileSync(commitResultPath, `${JSON.stringify({ ...commitResult, commitSha: "0000000000000000000000000000000000000000" }, null, 2)}\n`, "utf8");
const headMismatch = aiJsonAllowFailure(["loop-worktree-promotion-push-plan", "--run", parentRunId, "--approval", "approved head mismatch", "--json"], cleanRoot);
assert(headMismatch.status !== 0, "push plan should refuse HEAD mismatch");
assert(headMismatch.json?.promotionPushPlan?.reason === "Promotion push plan refused because integration HEAD does not match commit evidence.", "HEAD mismatch refusal should be explicit");
writeFileSync(commitResultPath, `${JSON.stringify(commitResult, null, 2)}\n`, "utf8");

writeFileSync(commitResultPath, `${JSON.stringify({ ...commitResult, integrationWorktreePath: resolve(cleanRoot, ".myagenttool/worktrees/missing") }, null, 2)}\n`, "utf8");
const missingIntegration = aiJsonAllowFailure(["loop-worktree-promotion-push-plan", "--run", parentRunId, "--approval", "approved missing integration", "--json"], cleanRoot);
assert(missingIntegration.status !== 0, "push plan should refuse missing integration worktree");
assert(missingIntegration.json?.promotionPushPlan?.reason === "Integration worktree path does not exist.", "missing integration refusal should be explicit");
writeFileSync(commitResultPath, `${JSON.stringify(commitResult, null, 2)}\n`, "utf8");

writeFileSync(resolve(committed.promotionCommit.integrationWorktreePath, `dirty-${smokeFile}`), "dirty push plan smoke\n", "utf8");
const dirty = aiJsonAllowFailure(["loop-worktree-promotion-push-plan", "--run", parentRunId, "--approval", "approved dirty", "--json"], cleanRoot);
assert(dirty.status !== 0, "push plan should refuse dirty integration worktree");
assert(dirty.json?.promotionPushPlan?.reason === "Promotion push plan refused on dirty integration worktree.", "dirty refusal should be explicit");

assertEventTypes(cleanRoot, parentRunId, [
  "loop_worktree_promotion_push_plan_requested",
  "loop_worktree_promotion_push_plan_refused",
  "loop_worktree_promotion_push_plan_written",
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

console.log(`[loop-worktree-promotion-push-plan-smoke] OK parent=${parentRunId} commit=${committed.promotionCommit.commitSha} file=${smokeFile}`);

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
    throw new Error("Unable to locate isolated parent run created by promotion push plan smoke.");
  }
  return after.parentRunId;
}

function prepareCleanRepo(runId, baseRef) {
  const root = resolve("D:/tmp/myagenttool-loop-smoke", `push-plan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.email", "loop-smoke@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Loop Smoke"], { cwd: root });
  writeFileSync(resolve(root, ".gitignore"), ".myagenttool/\n", "utf8");
  writeFileSync(resolve(root, "README.md"), `promotion push plan clean repo for ${runId}\nbase ${baseRef ?? "HEAD"}\n`, "utf8");
  execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed promotion push plan smoke repo"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
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
      throw new Error(`Loop worktree promotion push plan smoke missing event ${type} for ${runId}`);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
