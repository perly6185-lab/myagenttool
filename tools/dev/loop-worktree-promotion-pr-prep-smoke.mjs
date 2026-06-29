#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const issue = String(995000 + Math.floor(Date.now() % 4000));
const smokeFile = `loop-promotion-pr-prep-${issue}.txt`;

const parentRunId = createPromotedRun(issue);
const source = aiJson(["loop-worktree-show", "--run", parentRunId, "--json"]).worktree;
assert(source.exists === true, "promotion PR prep smoke needs an existing source worktree");

writeFileSync(resolve(source.worktreePath, smokeFile), `promotion pr prep smoke ${issue}\n`, "utf8");
const promoted = aiJson(["loop-worktree-promote", "--run", parentRunId, "--approval", "approved promotion pr prep smoke", "--json"]);
assert(promoted.promotion.status === "planned", "promotion PR prep smoke needs planned promotion evidence");
assert(promoted.promotion.changedFiles.includes(smokeFile), "promotion evidence should include smoke file");

const cleanRoot = prepareCleanRepo(parentRunId, source.baseRef);
const noApply = aiJsonAllowFailure(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved no apply", "--json"], cleanRoot);
assert(noApply.status !== 0, "PR prep without apply evidence should fail");
assert(noApply.json?.promotionPrPrep?.reason === "Missing worktree-promotion-apply-result.json. Run loop-worktree-promotion-apply first.", "missing apply refusal should be explicit");

const applied = aiJson(["loop-worktree-promotion-apply", "--run", parentRunId, "--approval", "approved clean apply", "--json"], cleanRoot);
assert(applied.promotionApply.status === "succeeded", "promotion apply should succeed before PR prep");

const noVerify = aiJsonAllowFailure(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved no verify", "--json"], cleanRoot);
assert(noVerify.status !== 0, "PR prep without verify evidence should fail");
assert(noVerify.json?.promotionPrPrep?.reason === "Missing worktree-promotion-verify-result.json. Run loop-worktree-promotion-verify first.", "missing verify refusal should be explicit");

const verifyFailedPath = resolve(cleanRoot, ".myagenttool/runs", parentRunId, "worktree-promotion-verify-result.json");
writeFileSync(verifyFailedPath, `${JSON.stringify({ status: "failed", parentRunId }, null, 2)}\n`, "utf8");
const failedVerify = aiJsonAllowFailure(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved failed verify", "--json"], cleanRoot);
assert(failedVerify.status !== 0, "PR prep should refuse failed verification");
assert(failedVerify.json?.promotionPrPrep?.reason === "Promotion verification status must be succeeded, got failed.", "failed verify refusal should be explicit");

const verified = aiJson(["loop-worktree-promotion-verify", "--run", parentRunId, "--approval", "approved verify", "--command", "git-status", "--json"], cleanRoot);
assert(verified.promotionVerify.status === "succeeded", "promotion verify should succeed before PR prep");

const noApproval = aiJsonAllowFailure(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--json"], cleanRoot);
assert(noApproval.status !== 0, "PR prep without approval should fail");
assert(noApproval.json?.promotionPrPrep?.status === "refused", "missing approval should record refused PR prep");
assert(noApproval.json?.promotionPrPrep?.reason === "Worktree promotion PR prep requires --approval.", "missing approval refusal should be explicit");

const applyResultPath = resolve(cleanRoot, ".myagenttool/runs", parentRunId, "worktree-promotion-apply-result.json");
const applyResult = JSON.parse(readFileSync(applyResultPath, "utf8"));
writeFileSync(applyResultPath, `${JSON.stringify({ ...applyResult, integrationWorktreePath: resolve(cleanRoot, ".myagenttool/worktrees/missing") }, null, 2)}\n`, "utf8");
const missingIntegration = aiJsonAllowFailure(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved missing integration", "--json"], cleanRoot);
assert(missingIntegration.status !== 0, "PR prep should refuse missing integration worktree");
assert(missingIntegration.json?.promotionPrPrep?.reason === "Integration worktree path does not exist.", "missing integration refusal should be explicit");
writeFileSync(applyResultPath, `${JSON.stringify(applyResult, null, 2)}\n`, "utf8");

const prepped = aiJson(["loop-worktree-promotion-pr-prep", "--run", parentRunId, "--approval", "approved pr prep", "--json"], cleanRoot);
assert(prepped.promotionPrPrep.status === "written", "PR prep should write preparation package");
assert(prepped.promotionPrPrep.integrationBranch === applied.promotionApply.integrationBranch, "PR prep should record integration branch");
assert(prepped.promotionPrPrep.changedFiles.includes(smokeFile), "PR prep should include smoke file");
assert(prepped.promotionPrPrep.verifyCommandId === "git-status", "PR prep should record verification command id");
assert(prepped.promotionPrPrep.verifyExitCode === 0, "PR prep should record verification exit code");
assert(prepped.promotionPrPrep.evidence?.promotionPrPlan, "PR prep should write plan evidence");
assert(prepped.promotionPrPrep.evidence?.promotionPrBody, "PR prep should write body evidence");
assert(prepped.promotionPrPrep.evidence?.promotionPrChecklist, "PR prep should write checklist evidence");
assert(prepped.promotionPrPrep.evidence?.promotionPrSummary, "PR prep should write summary evidence");

const bodyPath = resolve(cleanRoot, prepped.promotionPrPrep.evidence.promotionPrBody);
const checklistPath = resolve(cleanRoot, prepped.promotionPrPrep.evidence.promotionPrChecklist);
assert(existsSync(bodyPath), "PR body evidence should exist");
assert(existsSync(checklistPath), "PR checklist evidence should exist");
const body = readFileSync(bodyPath, "utf8");
assert(body.includes(parentRunId), "PR body should include parent run id");
assert(body.includes(applied.promotionApply.integrationBranch), "PR body should include integration branch");
assert(body.includes(smokeFile), "PR body should include changed file");
assert(body.includes("git status --short"), "PR body should include verification command");
assert(body.includes("Exit code: 0"), "PR body should include verification exit code");
assert(body.includes("worktree-promotion-verify-result.json"), "PR body should include evidence refs");

assertEventTypes(cleanRoot, parentRunId, [
  "loop_worktree_promotion_pr_prep_requested",
  "loop_worktree_promotion_pr_prep_refused",
  "loop_worktree_promotion_pr_prep_written",
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

console.log(`[loop-worktree-promotion-pr-prep-smoke] OK parent=${parentRunId} branch=${prepped.promotionPrPrep.integrationBranch} file=${smokeFile}`);

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
    throw new Error("Unable to locate isolated parent run created by promotion PR prep smoke.");
  }
  return after.parentRunId;
}

function prepareCleanRepo(runId, baseRef) {
  const root = resolve("D:/tmp/myagenttool-loop-smoke", `pr-prep-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.email", "loop-smoke@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Loop Smoke"], { cwd: root });
  writeFileSync(resolve(root, ".gitignore"), ".myagenttool/\n", "utf8");
  writeFileSync(resolve(root, "README.md"), `promotion pr prep clean repo for ${runId}\nbase ${baseRef ?? "HEAD"}\n`, "utf8");
  execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed promotion pr prep smoke repo"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
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
      throw new Error(`Loop worktree promotion PR prep smoke missing event ${type} for ${runId}`);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
