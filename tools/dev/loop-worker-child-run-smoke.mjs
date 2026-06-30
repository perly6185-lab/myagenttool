#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const successParentId = createRun("999988");
enqueue(successParentId);
const success = aiJson(["loop-worker-once", "--run", successParentId, "--worker", "worker-child-smoke-success", "--mode", "child-run", "--json"]);
assertState(success.run, "completed", "child-run parent success");
const successResult = readWorkerResult(success.run);
if (successResult.mode !== "child-run" || !successResult.childRunId || successResult.childState !== "planned") {
  throw new Error(`Unexpected child-run success result: ${JSON.stringify(successResult)}`);
}
const child = aiJson(["loop-show", "--run", successResult.childRunId, "--json"]).run;
assertState(child, "planned", "child run");
assertEventTypes(successParentId, ["loop_claimed", "loop_worker_started", "loop_worker_completed", "loop_completed"]);

const failedParentId = createRun("999987");
enqueue(failedParentId);
const failed = aiJson(["loop-worker-once", "--run", failedParentId, "--worker", "worker-child-smoke-fail", "--mode", "child-run", "--child-provider", "unknown", "--json"]);
assertState(failed.run, "failed", "child-run parent failure");
const failedResult = readWorkerResult(failed.run);
if (failedResult.mode !== "child-run" || failedResult.childRunId !== null || !failedResult.error) {
  throw new Error(`Unexpected child-run failure result: ${JSON.stringify(failedResult)}`);
}
assertEventTypes(failedParentId, ["loop_claimed", "loop_worker_started", "loop_worker_failed", "loop_failed"]);

execFileSync("node", ["tools/ai/src/index.mjs", "loop-registry-check"], {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log(`[loop-worker-child-run-smoke] OK parent=${successParentId} child=${successResult.childRunId} failed=${failedParentId}`);

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
  const resultPath = resolve(repoRoot, workerResult);
  if (!existsSync(resultPath)) {
    throw new Error(`Worker result file missing for ${run.runId}`);
  }
  return JSON.parse(readFileSync(resultPath, "utf8"));
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
      throw new Error(`Loop child-run smoke missing event ${type} for ${runId}`);
    }
  }
}
