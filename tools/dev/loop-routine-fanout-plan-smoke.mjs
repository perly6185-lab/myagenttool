#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const tmpRoot = resolve(repoRoot, ".myagenttool/tmp/loop-routine-fanout-plan-smoke");
const fakeGhPath = resolve(tmpRoot, "fake-gh-empty.mjs");

prepareTmpRepo();
const routineRun = runRoutine();
const fanout = aiJson(["loop-routine-fanout-plan", "--routine-run", routineRun.routineRunId, "--json"], tmpRoot);
if (fanout.plan?.candidateCount < 1) {
  throw new Error(`Fanout plan should include at least one candidate: ${JSON.stringify(fanout.plan)}`);
}
if (!existsSync(resolve(tmpRoot, fanout.planPath))) {
  throw new Error(`Fanout plan file missing: ${fanout.planPath}`);
}
const planFile = JSON.parse(readFileSync(resolve(tmpRoot, fanout.planPath), "utf8"));
if (!planFile.candidates.some((candidate) => candidate.findingId.includes("routine-smoke-issue-123"))) {
  throw new Error(`Fanout plan should include failed run finding: ${JSON.stringify(planFile.candidates)}`);
}

console.log(`[loop-routine-fanout-plan-smoke] OK routineRun=${routineRun.routineRunId} candidates=${fanout.plan.candidateCount}`);

function prepareTmpRepo() {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(resolve(tmpRoot, ".myagenttool/runs"), { recursive: true });
  mkdirSync(resolve(tmpRoot, "docs/engineering"), { recursive: true });
  execFileSync("git", ["init"], { cwd: tmpRoot, stdio: ["ignore", "ignore", "pipe"] });
  writeFileSync(resolve(tmpRoot, "docs/engineering/example.md"), "# Example\n", "utf8");
  execFileSync("git", ["add", "docs/engineering/example.md"], { cwd: tmpRoot, stdio: ["ignore", "ignore", "pipe"] });
  execFileSync("git", ["commit", "-m", "seed"], {
    cwd: tmpRoot,
    env: gitEnv(),
    stdio: ["ignore", "ignore", "pipe"],
  });
  seedFailedLoopRun();
  writeFileSync(fakeGhPath, "process.stdout.write('[]');\n", "utf8");
}

function runRoutine() {
  const result = aiJson(["loop-routine-run", "--file", resolve(repoRoot, "docs/examples/loop-routines/morning-triage.json"), "--json"], tmpRoot);
  if (result.routineRun?.status !== "completed") {
    throw new Error(`Routine run should complete: ${JSON.stringify(result.routineRun)}`);
  }
  return result.routineRun;
}

function seedFailedLoopRun() {
  const failedRunId = "routine-smoke-issue-123";
  const failedRunDir = resolve(tmpRoot, ".myagenttool/runs", failedRunId);
  mkdirSync(failedRunDir, { recursive: true });
  writeFileSync(resolve(failedRunDir, "events.jsonl"), [
    JSON.stringify({
      id: "routine-smoke-created",
      runId: failedRunId,
      type: "loop_run_created",
      state: "created",
      createdAt: "2026-06-29T00:00:00.000Z",
      message: "Loop run registered.",
      data: { adapter: "mock", apply: false, verify: false, openPr: false, repo: null, branch: "feat/routine-smoke" },
    }),
    JSON.stringify({
      id: "routine-smoke-failed",
      runId: failedRunId,
      type: "loop_failed",
      state: "failed",
      createdAt: "2026-06-29T00:00:01.000Z",
      message: "Routine smoke failure",
      data: { error: "Routine smoke failure" },
    }),
  ].join("\n") + "\n", "utf8");
  writeFileSync(resolve(tmpRoot, ".myagenttool/runs/registry.json"), `${JSON.stringify({
    version: 1,
    runs: [{
      runId: failedRunId,
      state: "failed",
      issue: "123",
      repo: null,
      branch: "feat/routine-smoke",
      adapter: "mock",
      runDir: `.myagenttool/runs/${failedRunId}`,
      eventLog: `.myagenttool/runs/${failedRunId}/events.jsonl`,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:01.000Z",
      attempts: 1,
      workerId: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      timeoutAt: null,
      queuePriority: null,
      prNumber: null,
      humanApproval: null,
      humanGate: null,
      evidence: {},
      lastError: "Routine smoke failure",
    }],
  }, null, 2)}\n`, "utf8");
}

function aiJson(args, cwd) {
  const output = execFileSync("node", [resolve(repoRoot, "tools/ai/src/index.mjs"), ...args], {
    cwd,
    env: { ...process.env, GH_PATH: fakeGhPath, MYAGENTTOOL_REPO_ROOT: cwd },
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function gitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "Loop Smoke",
    GIT_AUTHOR_EMAIL: "loop-smoke@example.test",
    GIT_COMMITTER_NAME: "Loop Smoke",
    GIT_COMMITTER_EMAIL: "loop-smoke@example.test",
  };
}
