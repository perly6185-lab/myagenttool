#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const successRunId = createRun("999990");
enqueue(successRunId);
const success = aiJson(["loop-worker-once", "--run", successRunId, "--worker", "worker-smoke-success", "--json"]);
assertState(success.run, "completed", "successful worker");
assertWorkerEvidence(success.run, "completed");
assertEventTypes(successRunId, ["loop_claimed", "loop_worker_started", "loop_worker_completed", "loop_completed"]);

const failedRunId = createRun("999989");
enqueue(failedRunId);
const failed = aiJson(["loop-worker-once", "--run", failedRunId, "--worker", "worker-smoke-fail", "--fail", "--json"]);
assertState(failed.run, "failed", "failed worker");
assertWorkerEvidence(failed.run, "failed");
if (failed.run.lastError !== "Intentional mock worker failure.") {
  throw new Error(`Expected worker failure lastError, got ${failed.run.lastError}`);
}
assertEventTypes(failedRunId, ["loop_claimed", "loop_worker_started", "loop_worker_failed", "loop_failed"]);

execFileSync("node", ["tools/ai/src/index.mjs", "loop-registry-check"], {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log(`[loop-worker-smoke] OK success=${successRunId} failed=${failedRunId}`);

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

function assertState(run, expected, label) {
  if (!run || run.state !== expected) {
    throw new Error(`${label} expected state ${expected}, got ${run?.state ?? "missing run"}`);
  }
}

function assertWorkerEvidence(run, expectedStatus) {
  const workerLog = run.evidence?.workerLog;
  const workerResult = run.evidence?.workerResult;
  if (!workerLog || !workerResult) {
    throw new Error(`Missing worker evidence for ${run.runId}`);
  }
  const logPath = resolve(repoRoot, workerLog);
  const resultPath = resolve(repoRoot, workerResult);
  if (!existsSync(logPath) || !existsSync(resultPath)) {
    throw new Error(`Worker evidence files missing for ${run.runId}`);
  }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  if (result.status !== expectedStatus || result.claimedRunId !== run.runId) {
    throw new Error(`Unexpected worker result for ${run.runId}: ${JSON.stringify(result)}`);
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
      throw new Error(`Loop worker smoke missing event ${type} for ${runId}`);
    }
  }
}
