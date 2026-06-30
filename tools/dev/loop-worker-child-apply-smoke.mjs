#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const missingApprovalRunId = createRun("999985");
enqueue(missingApprovalRunId);
const missingApproval = aiJson(["loop-worker-once", "--run", missingApprovalRunId, "--worker", "worker-child-apply-no-approval", "--mode", "child-run", "--child-apply", "--json"]);
assertState(missingApproval.run, "failed", "missing approval child apply");
const missingApprovalResult = readWorkerResult(missingApproval.run);
if (missingApprovalResult.childApply !== true || missingApprovalResult.childRunId !== null || missingApprovalResult.error !== "Child apply requires --approval.") {
  throw new Error(`Unexpected missing approval result: ${JSON.stringify(missingApprovalResult)}`);
}
assertEventTypes(missingApprovalRunId, ["loop_claimed", "loop_worker_started", "loop_worker_failed", "loop_failed"]);

const dirtyRunId = createRun("999984");
enqueue(dirtyRunId);
const dirty = aiJson(["loop-worker-once", "--run", dirtyRunId, "--worker", "worker-child-apply-dirty", "--mode", "child-run", "--child-apply", "--approval", "approved for dirty rejection smoke", "--json"]);
assertState(dirty.run, "failed", "dirty worktree child apply");
const dirtyResult = readWorkerResult(dirty.run);
if (dirtyResult.childApply !== true || dirtyResult.childRunId !== null || dirtyResult.error !== "Child apply refused on dirty worktree.") {
  throw new Error(`Unexpected dirty worktree result: ${JSON.stringify(dirtyResult)}`);
}
if (dirtyResult.approval !== "approved for dirty rejection smoke") {
  throw new Error("Child apply dirty smoke did not preserve approval evidence.");
}
assertEventTypes(dirtyRunId, ["loop_claimed", "loop_worker_started", "loop_worker_failed", "loop_failed"]);

execFileSync("node", ["tools/ai/src/index.mjs", "loop-registry-check"], {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log(`[loop-worker-child-apply-smoke] OK missingApproval=${missingApprovalRunId} dirty=${dirtyRunId}`);

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
      throw new Error(`Loop child apply smoke missing event ${type} for ${runId}`);
    }
  }
}
