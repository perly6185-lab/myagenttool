#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const beforeStatus = gitStatus();
if (!beforeStatus.trim()) {
  throw new Error("Isolated child apply smoke expects the parent workspace to be dirty so the isolation boundary is exercised.");
}

const issue = process.env.LOOP_ISOLATED_SMOKE_ISSUE ?? String(990000 + Math.floor(Date.now() % 9000));
const runId = createRun(issue);
enqueue(runId);
const result = aiJson([
  "loop-worker-once",
  "--run",
  runId,
  "--worker",
  "worker-child-apply-isolated",
  "--mode",
  "child-run",
  "--child-apply",
  "--approval",
  "approved for isolated child apply smoke",
  "--isolate-worktree",
  "--base-ref",
  "HEAD",
  "--child-skip-verify",
  "--json",
]);

assertState(result.run, "completed", "isolated child apply");
const workerResult = readWorkerResult(result.run);
if (workerResult.status !== "completed" || workerResult.childApply !== true || workerResult.isolatedWorktree !== true) {
  throw new Error(`Unexpected isolated child apply result: ${JSON.stringify(workerResult)}`);
}
if (!workerResult.childRunId || workerResult.childState !== "completed") {
  throw new Error(`Isolated child apply did not record a completed child run: ${JSON.stringify(workerResult)}`);
}
if (workerResult.approval !== "approved for isolated child apply smoke") {
  throw new Error("Isolated child apply smoke did not preserve approval evidence.");
}
if (workerResult.baseRef !== "HEAD" || workerResult.cleanupPolicy !== "keep" || workerResult.childSkipVerify !== true) {
  throw new Error(`Isolated child apply metadata is incomplete: ${JSON.stringify(workerResult)}`);
}
if (!workerResult.worktreePath || !isAbsolute(workerResult.worktreePath)) {
  throw new Error(`Isolated child apply did not record an absolute worktree path: ${JSON.stringify(workerResult)}`);
}
const expectedRoot = normalize(resolve(repoRoot, ".myagenttool/worktrees"));
if (!normalize(workerResult.worktreePath).startsWith(`${expectedRoot}/`)) {
  throw new Error(`Isolated worktree path escaped expected root: ${workerResult.worktreePath}`);
}
if (!existsSync(resolve(workerResult.worktreePath, ".myagenttool/runs", workerResult.childRunId, "events.jsonl"))) {
  throw new Error("Isolated child run evidence was not written inside the isolated worktree.");
}
if (existsSync(resolve(repoRoot, ".myagenttool/runs", workerResult.childRunId, "events.jsonl"))) {
  throw new Error("Isolated child run evidence leaked into the parent runs directory.");
}
if (!workerResult.childEvidence?.manifest || !workerResult.childEvidence?.scopeCheckJson) {
  throw new Error(`Isolated child evidence is incomplete: ${JSON.stringify(workerResult.childEvidence)}`);
}
const afterStatus = gitStatus();
if (afterStatus !== beforeStatus) {
  throw new Error(`Parent workspace status changed during isolated child apply.\nBefore:\n${beforeStatus}\nAfter:\n${afterStatus}`);
}
assertEventTypes(runId, ["loop_claimed", "loop_worker_started", "loop_worker_completed", "loop_completed"]);

execFileSync("node", ["tools/ai/src/index.mjs", "loop-registry-check"], {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log(`[loop-worker-child-apply-isolated-smoke] OK parent=${runId} child=${workerResult.childRunId}`);

function createRun(issue) {
  const output = execFileSync("node", ["tools/ai/src/index.mjs", "run-work", "--issue", issue, "--provider", "mock", "--repo", "perly6185-lab/myagenttool"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const match = output.match(/\.myagenttool\/runs\/([^\s]+)/);
  if (!match) {
    throw new Error(`Unable to parse run id from work-runner output:\n${output}`);
  }
  return match[1];
}

function enqueue(runId) {
  const result = aiJson(["loop-enqueue", "--run", runId, "--priority", "normal", "--json"]);
  assertState(result.run, "queued", "enqueue");
}

function aiJson(args) {
  const output = execFileSync("node", ["tools/ai/src/index.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function readWorkerResult(run) {
  const workerResult = run.evidence?.workerResult;
  if (!workerResult) {
    throw new Error(`Missing worker result for ${run.runId}`);
  }
  return JSON.parse(readFileSync(resolve(repoRoot, workerResult), "utf8"));
}

function assertState(run, expected, label) {
  if (!run || run.state !== expected) {
    throw new Error(`${label} expected state ${expected}, got ${run?.state ?? "missing run"}`);
  }
}

function assertEventTypes(runId, requiredTypes) {
  const events = readFileSync(resolve(repoRoot, ".myagenttool/runs", runId, "events.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const eventTypes = new Set(events.map((event) => event.type));
  for (const type of requiredTypes) {
    if (!eventTypes.has(type)) {
      throw new Error(`Loop isolated child apply smoke missing event ${type} for ${runId}`);
    }
  }
}

function gitStatus() {
  return execFileSync("git", ["status", "--short"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function normalize(path) {
  return path.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
}
