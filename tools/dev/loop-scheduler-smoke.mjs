#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const runId = createRun();

const enqueued = aiJson(["loop-enqueue", "--run", runId, "--priority", "high", "--json"]).run;
assertState(enqueued, "queued", "enqueue");
if (enqueued.queuePriority !== "high") {
  throw new Error(`Expected high queue priority, got ${enqueued.queuePriority}`);
}

const firstClaim = aiJson(["loop-claim", "--run", runId, "--worker", "scheduler-smoke-a", "--lease-ms", "60000", "--json"]).run;
assertState(firstClaim, "claimed", "first claim");
if (firstClaim.workerId !== "scheduler-smoke-a" || !firstClaim.leaseExpiresAt) {
  throw new Error("First claim did not record worker and lease.");
}

const duplicateClaim = aiJson(["loop-claim", "--run", runId, "--worker", "scheduler-smoke-b", "--json"]).run;
if (duplicateClaim !== null) {
  throw new Error("Duplicate claim unexpectedly succeeded.");
}

const heartbeat = aiJson(["loop-heartbeat", "--run", runId, "--worker", "scheduler-smoke-a", "--lease-ms", "120000", "--json"]).run;
assertState(heartbeat, "claimed", "heartbeat");
if (heartbeat.workerId !== "scheduler-smoke-a") {
  throw new Error("Heartbeat changed worker ownership.");
}

const released = aiJson(["loop-release", "--run", runId, "--worker", "scheduler-smoke-a", "--to", "queued", "--reason", "scheduler smoke release", "--json"]).run;
assertState(released, "queued", "release");
if (released.workerId !== null || released.leaseExpiresAt !== null) {
  throw new Error("Release did not clear worker lease fields.");
}

const timeoutClaim = aiJson(["loop-claim", "--run", runId, "--worker", "scheduler-smoke-timeout", "--lease-ms", "1", "--json"]).run;
assertState(timeoutClaim, "claimed", "timeout claim");
sleep(20);

const timeoutResult = aiJson(["loop-timeout-check", "--json"]);
const timedOut = timeoutResult.timedOut.find((run) => run.runId === runId);
assertState(timedOut, "timed_out", "timeout check");

execFileSync("node", ["tools/ai/src/index.mjs", "loop-registry-check"], {
  cwd: repoRoot,
  stdio: "inherit",
});

const events = readFileSync(resolve(repoRoot, ".myagenttool/runs", runId, "events.jsonl"), "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const eventTypes = new Set(events.map((event) => event.type));
for (const type of ["loop_enqueued", "loop_claimed", "loop_heartbeat", "loop_released", "loop_timed_out"]) {
  if (!eventTypes.has(type)) {
    throw new Error(`Loop scheduler smoke missing event ${type}`);
  }
}

console.log(`[loop-scheduler-smoke] OK run=${runId} state=${timedOut.state} events=${events.length}`);

function createRun() {
  const output = execFileSync("node", ["tools/ai/src/index.mjs", "run-work", "--issue", "999993", "--provider", "mock", "--repo", "perly6185-lab/myagenttool"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const match = output.match(/\.myagenttool\/runs\/([^\s]+)/);
  if (!match) {
    throw new Error(`Unable to parse run id from work-runner output:\n${output}`);
  }
  return match[1];
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

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Keep the smoke test dependency-free and deterministic for a 1ms lease.
  }
}
