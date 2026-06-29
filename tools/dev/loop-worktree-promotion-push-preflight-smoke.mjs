#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const issue = String(996000 + Math.floor(Date.now() % 2000));
const smokeFile = `loop-promotion-push-preflight-${issue}.txt`;
const commitMessage = `Push preflight promotion smoke ${issue}`;

const parentRunId = createPromotedRun(issue);
const source = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(source.exists === true, "promotion push preflight smoke needs an existing source worktree");

writeFileSync(resolve(source.worktreePath, smokeFile), `promotion push preflight smoke ${issue}\n`, "utf8");
const promoted = aiJson(["loop-worktree-promote", "--run", parentRunId, "--approval", "approved promotion push preflight smoke", "--json"]);
assert(promoted.promotion.status === "planned", "promotion push preflight smoke needs planned promotion evidence");
assert(promoted.promotion.changedFiles.includes(smokeFile), "promotion evidence should include smoke file");

const cleanRoot = prepareCleanRepo(parentRunId, source.baseRef);
const applied = aiJson(["loop-worktree-promotion-apply", "--run", parentRunId, "--approval", "approved clean apply", "--json"], cleanRoot);
assert(applied.promotionApply.status === "succeeded", "promotion apply should succeed before push preflight");
const verified = aiJson(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved verify", "--command", "git-status", "--json"], cleanRoot);
assert(verified.promotionVerify.status === "succeeded", "promotion verify should succeed before push preflight");
const prepped = aiJson(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved pr prep", "--json"], cleanRoot);
assert(prepped.promotionPrPrep.status === "written", "promotion PR prep should succeed before push preflight");
const committed = aiJson(["loop-worktree-promotion-commit", "--run", parentRunId, "--approval", "approved commit", "--message", commitMessage, "--json"], cleanRoot);
assert(committed.promotionCommit.status === "succeeded", "promotion commit should succeed before push preflight");

const noPlan = aiJsonAllowFailure(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--approval", "approved no plan", "--json"], cleanRoot);
assert(noPlan.status !== 0, "push preflight without push plan evidence should fail");
assert(noPlan.json?.promotionPushPreflight?.reason === "Missing worktree-promotion-push-plan.json. Run loop-worktree-promotion-push-plan first.", "missing push plan refusal should be explicit");

const remoteUrl = createBareRemote(parentRunId);
execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: committed.promotionCommit.integrationWorktreePath });

const planned = aiJson(["loop-worktree-promotion-push-plan", "--run", parentRunId, "--approval", "approved push plan", "--json"], cleanRoot);
assert(planned.promotionPushPlan.status === "planned", "promotion push plan should succeed before preflight");
assert(planned.promotionPushPlan.remoteUrl === remoteUrl, "push plan should record local bare remote");

const noApproval = aiJsonAllowFailure(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--json"], cleanRoot);
assert(noApproval.status !== 0, "push preflight without approval should fail");
assert(noApproval.json?.promotionPushPreflight?.status === "refused", "missing approval should record refused preflight");
assert(noApproval.json?.promotionPushPreflight?.reason === "Worktree promotion push preflight requires --approval.", "missing approval refusal should be explicit");

const preflight = aiJson(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--approval", "approved preflight", "--json"], cleanRoot);
assert(preflight.promotionPushPreflight.status === "succeeded", "promotion push preflight should succeed");
assert(preflight.promotionPushPreflight.dryRun === false, "default preflight should not run push dry-run");
assert(preflight.promotionPushPreflight.headMatchesPlan === true, "preflight should confirm HEAD");
assert(preflight.promotionPushPreflight.branchMatchesPlan === true, "preflight should confirm branch");
assert(preflight.promotionPushPreflight.failedChecks.length === 0, "preflight should have no failed checks");
assert(preflight.promotionPushPreflight.checks.map((check) => check.id).join(",") === "remote-url,remote-head", "default checks should be remote-url and remote-head");
assert(existsSync(resolve(cleanRoot, preflight.promotionPushPreflight.evidence.promotionPushPreflightPlan)), "preflight plan evidence should exist");
assert(existsSync(resolve(cleanRoot, preflight.promotionPushPreflight.evidence.promotionPushPreflightResult)), "preflight result evidence should exist");
assert(existsSync(resolve(cleanRoot, preflight.promotionPushPreflight.evidence.promotionPushPreflightMarkdown)), "preflight markdown evidence should exist");

const dryRun = aiJson(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--approval", "approved dry run", "--dry-run", "--json"], cleanRoot);
assert(dryRun.promotionPushPreflight.status === "succeeded", "promotion push dry-run preflight should succeed");
assert(dryRun.promotionPushPreflight.dryRun === true, "dry-run preflight should record dryRun");
assert(dryRun.promotionPushPreflight.checks.some((check) => check.id === "push-dry-run"), "dry-run preflight should include push-dry-run check");
assert(dryRun.promotionPushPreflight.failedChecks.length === 0, "dry-run preflight should have no failed checks");
const markdown = readFileSync(resolve(cleanRoot, dryRun.promotionPushPreflight.evidence.promotionPushPreflightMarkdown), "utf8");
assert(markdown.includes(committed.promotionCommit.commitSha), "preflight markdown should include commit SHA");
assert(markdown.includes(committed.promotionCommit.integrationBranch), "preflight markdown should include branch");
assert(markdown.includes("Dry-run: yes"), "preflight markdown should record dry-run");
assert(commandAllowFailure("git", ["--git-dir", remoteUrl, "show-ref", "--verify", `refs/heads/${committed.promotionCommit.integrationBranch}`]).status !== 0, "dry-run preflight must not create the remote branch");

const pushPlanPath = resolve(cleanRoot, ".myagenttool/runs", parentRunId, "worktree-promotion-push-plan.json");
const pushPlan = JSON.parse(readFileSync(pushPlanPath, "utf8"));
writeFileSync(pushPlanPath, `${JSON.stringify({ ...pushPlan, remote: "missing" }, null, 2)}\n`, "utf8");
const failedRemote = aiJsonAllowFailure(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--approval", "approved missing remote", "--json"], cleanRoot);
assert(failedRemote.status !== 0, "missing remote should fail preflight checks");
assert(failedRemote.json?.promotionPushPreflight?.status === "failed", "missing remote should record failed preflight");
assert(failedRemote.json?.promotionPushPreflight?.failedChecks.includes("remote-url"), "missing remote should report remote-url failed check");
writeFileSync(pushPlanPath, `${JSON.stringify(pushPlan, null, 2)}\n`, "utf8");

writeFileSync(pushPlanPath, `${JSON.stringify({ ...pushPlan, commitSha: "0000000000000000000000000000000000000000" }, null, 2)}\n`, "utf8");
const headMismatch = aiJsonAllowFailure(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--approval", "approved head mismatch", "--json"], cleanRoot);
assert(headMismatch.status !== 0, "push preflight should refuse HEAD mismatch");
assert(headMismatch.json?.promotionPushPreflight?.reason === "Promotion push preflight refused because integration HEAD does not match push plan commit.", "HEAD mismatch refusal should be explicit");
writeFileSync(pushPlanPath, `${JSON.stringify(pushPlan, null, 2)}\n`, "utf8");

writeFileSync(pushPlanPath, `${JSON.stringify({ ...pushPlan, refspec: `bad/${pushPlan.integrationBranch}:${pushPlan.integrationBranch}` }, null, 2)}\n`, "utf8");
const badRefspec = aiJsonAllowFailure(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--approval", "approved bad refspec", "--json"], cleanRoot);
assert(badRefspec.status !== 0, "push preflight should refuse bad refspec evidence");
assert(badRefspec.json?.promotionPushPreflight?.reason === "Promotion push plan refspec does not match integration branch.", "bad refspec refusal should be explicit");
writeFileSync(pushPlanPath, `${JSON.stringify(pushPlan, null, 2)}\n`, "utf8");

writeFileSync(resolve(committed.promotionCommit.integrationWorktreePath, `dirty-${smokeFile}`), "dirty push preflight smoke\n", "utf8");
const dirty = aiJsonAllowFailure(["loop-worktree-promotion-push-preflight", "--run", parentRunId, "--approval", "approved dirty", "--json"], cleanRoot);
assert(dirty.status !== 0, "push preflight should refuse dirty integration worktree");
assert(dirty.json?.promotionPushPreflight?.reason === "Promotion push preflight refused on dirty integration worktree.", "dirty refusal should be explicit");

assertEventTypes(cleanRoot, parentRunId, [
  "loop_worktree_promotion_push_preflight_requested",
  "loop_worktree_promotion_push_preflight_refused",
  "loop_worktree_promotion_push_preflight_succeeded",
  "loop_worktree_promotion_push_preflight_failed",
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

console.log(`[loop-worktree-promotion-push-preflight-smoke] OK parent=${parentRunId} commit=${committed.promotionCommit.commitSha} file=${smokeFile}`);

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
    throw new Error("Unable to locate isolated parent run created by promotion push preflight smoke.");
  }
  return after.parentRunId;
}

function prepareCleanRepo(runId, baseRef) {
  const root = resolve("D:/tmp/myagenttool-loop-smoke", `push-preflight-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.email", "loop-smoke@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Loop Smoke"], { cwd: root });
  writeFileSync(resolve(root, ".gitignore"), ".myagenttool/\n", "utf8");
  writeFileSync(resolve(root, "README.md"), `promotion push preflight clean repo for ${runId}\nbase ${baseRef ?? "HEAD"}\n`, "utf8");
  execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed promotion push preflight smoke repo"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
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
  const remoteUrl = normalizePath(resolve("D:/tmp/myagenttool-loop-smoke", `push-preflight-remote-${runId}-${Date.now()}.git`));
  mkdirSync(dirname(remoteUrl), { recursive: true });
  execFileSync("git", ["init", "--bare", remoteUrl], { stdio: ["ignore", "pipe", "pipe"] });
  return remoteUrl;
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
      throw new Error(`Loop worktree promotion push preflight smoke missing event ${type} for ${runId}`);
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
