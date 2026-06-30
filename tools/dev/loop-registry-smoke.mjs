#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const runId = createRun();
const actions = [
  ["node", ["tools/ai/src/index.mjs", "loop-show", "--run", runId, "--json"]],
  ["node", ["tools/ai/src/index.mjs", "loop-list", "--json"]],
  ["node", ["tools/ai/src/index.mjs", "loop-gate-request", "--run", runId, "--reason", "loop registry smoke gate", "--scope", "smoke concurrent registry write", "--requested-action", "approve smoke continuation", "--risk", "medium", "--by", "loop-smoke"]],
  ["node", ["tools/ai/src/index.mjs", "loop-cancel", "--run", runId, "--reason", "loop registry smoke cancel", "--force"]],
];

await Promise.all(actions.map(([command, args]) => run(command, args)));

const registry = JSON.parse(readFileSync(resolve(repoRoot, ".myagenttool/runs/registry.json"), "utf8"));
const entry = registry.runs.find((run) => run.runId === runId);
if (!entry) {
  throw new Error(`Loop registry smoke did not find run ${runId}`);
}

const eventLog = resolve(repoRoot, ".myagenttool/runs", runId, "events.jsonl");
if (!existsSync(eventLog)) {
  throw new Error(`Loop registry smoke did not find events.jsonl for ${runId}`);
}
const events = readFileSync(eventLog, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const eventTypes = new Set(events.map((event) => event.type));
for (const type of ["loop_run_created", "loop_human_gate_required", "loop_cancel_requested"]) {
  if (!eventTypes.has(type)) {
    throw new Error(`Loop registry smoke missing event ${type}`);
  }
}

execFileSync("node", ["tools/ai/src/index.mjs", "loop-registry-check"], {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log(`[loop-registry-smoke] OK run=${runId} state=${entry.state} events=${events.length}`);

function createRun() {
  const output = execFileSync("node", ["tools/ai/src/index.mjs", "run-work", "--issue", "999995", "--provider", "mock", "--repo", "perly6185-lab/myagenttool"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const match = output.match(/\.myagenttool\/runs\/([^\s]+)/);
  if (!match) {
    throw new Error(`Unable to parse run id from work-runner output:\n${output}`);
  }
  return match[1];
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${stdout}\n${stderr}`));
      }
    });
  });
}
