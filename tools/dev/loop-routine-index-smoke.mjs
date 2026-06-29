import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const tmpRoot = resolve(repoRoot, ".myagenttool/tmp/loop-routine-index-smoke");
const indexPath = resolve(tmpRoot, ".myagenttool/state/routine-runs-index.json");
const routineFile = resolve(repoRoot, "docs/examples/loop-routines/morning-triage.json");
const fakeGhPath = resolve(tmpRoot, "fake-gh-empty.mjs");
const port = 5792;

prepareTmpRepo();

const routineRun = aiJson(["loop-routine-run", "--file", routineFile, "--json"], tmpRoot).routineRun;
assert(existsSync(indexPath), "routine run should create compact index");
let index = readIndex();
assert(index.latestRunId === routineRun.routineRunId, "index should point at latest routine run");
assert(index.runs.some((run) => run.routineRunId === routineRun.routineRunId), "index should include routine run");

aiJson(["loop-routine-fanout-plan", "--routine-run", routineRun.routineRunId, "--json"], tmpRoot);
index = readIndex();
const planned = index.runs.find((run) => run.routineRunId === routineRun.routineRunId);
assert(planned?.summary?.fanoutCandidateCount === 1, "fanout plan should update index candidate count");

aiJson(["loop-routine-fanout-execute", "--routine-run", routineRun.routineRunId, "--approval", "smoke routine index approval", "--json"], tmpRoot);
index = readIndex();
const executed = index.runs.find((run) => run.routineRunId === routineRun.routineRunId);
assert(executed?.summary?.fanoutCreatedCount === 1, "fanout execute should update index created count");

writeFileSync(indexPath, "{ bad json", "utf8");
const server = spawn(process.execPath, [resolve(repoRoot, "apps/server/src/index.mjs")], {
  cwd: repoRoot,
  env: {
    ...process.env,
    SERVER_PORT: String(port),
    MYAGENTTOOL_PROJECT_PATH: tmpRoot,
    MYAGENTTOOL_STATE_DISABLED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer();
  const list = await fetchJson("/api/loop-routines?limit=10");
  assert(list.index?.source === "scan", "API should fallback to scan when index is invalid");
  assert(list.index?.status === "invalid_json", "API should report invalid JSON index status");
  assert(list.runs.some((run) => run.routineRunId === routineRun.routineRunId), "fallback scan should include routine run");
} finally {
  server.kill();
}

const rebuilt = aiJson(["loop-routine-index-rebuild", "--json"], tmpRoot);
assert(rebuilt.index?.latestRunId === routineRun.routineRunId, "rebuild should repair latest routine run");
assert(readIndex().runs.some((run) => run.routineRunId === routineRun.routineRunId), "rebuilt index should include routine run");

console.log(`[loop-routine-index-smoke] OK routineRun=${routineRun.routineRunId}`);

function readIndex() {
  return JSON.parse(readFileSync(indexPath, "utf8"));
}

function aiJson(args, cwd) {
  const result = spawnSync(process.execPath, [resolve(repoRoot, "tools/ai/src/index.mjs"), ...args], {
    cwd,
    env: {
      ...process.env,
      GH_PATH: fakeGhPath,
      MYAGENTTOOL_REPO_ROOT: cwd,
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`AI command failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

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
  writeFileSync(resolve(tmpRoot, ".gitignore"), ".myagenttool/state/\n.myagenttool/routine-runs/\n.myagenttool/runs/\n", "utf8");
}

function seedFailedLoopRun() {
  const failedRunId = "routine-index-smoke-issue-123";
  const failedRunDir = resolve(tmpRoot, ".myagenttool/runs", failedRunId);
  mkdirSync(failedRunDir, { recursive: true });
  writeFileSync(resolve(failedRunDir, "events.jsonl"), [
    JSON.stringify({
      id: "routine-index-smoke-created",
      runId: failedRunId,
      type: "loop_run_created",
      state: "created",
      createdAt: "2026-06-29T00:00:00.000Z",
      message: "Loop run registered.",
      data: { adapter: "mock", apply: false, verify: false, openPr: false, repo: null, branch: "feat/routine-index-smoke" },
    }),
    JSON.stringify({
      id: "routine-index-smoke-failed",
      runId: failedRunId,
      type: "loop_failed",
      state: "failed",
      createdAt: "2026-06-29T00:00:01.000Z",
      message: "Routine index smoke failure",
      data: { error: "Routine index smoke failure" },
    }),
  ].join("\n") + "\n", "utf8");
  writeFileSync(resolve(tmpRoot, ".myagenttool/runs/registry.json"), `${JSON.stringify({
    version: 1,
    runs: [{
      runId: failedRunId,
      state: "failed",
      issue: "123",
      repo: null,
      branch: "feat/routine-index-smoke",
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
      lastError: "Routine index smoke failure",
    }],
  }, null, 2)}\n`, "utf8");
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

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fetchJson("/health");
      return;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
  throw new Error("Server did not become healthy.");
}

async function fetchJson(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}: ${await response.text()}`);
  }
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
