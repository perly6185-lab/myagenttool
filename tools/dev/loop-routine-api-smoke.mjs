import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const tmpRoot = resolve(repoRoot, ".myagenttool/tmp/loop-routine-api-smoke");
const port = 5791;

rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(resolve(tmpRoot, ".gitignore"), ".myagenttool/state/\n.myagenttool/routine-runs/\n", "utf8");

const routine = aiJson(["loop-routine-run", "--file", resolve(repoRoot, "docs/examples/loop-routines/morning-triage.json"), "--json"], tmpRoot).routineRun;
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
  const state = await fetchJson("/api/state");
  if (!state.loopRoutines?.latestRunId) {
    throw new Error(`/api/state should expose compact routine summary: ${JSON.stringify(state.loopRoutines)}`);
  }
  if (Array.isArray(state.loopRoutines.runs)) {
    throw new Error("/api/state should not include full loopRoutines.runs.");
  }

  const list = await fetchJson("/api/loop-routines?limit=10");
  if (!list.runs?.some((run) => run.routineRunId === routine.routineRunId)) {
    throw new Error(`Dedicated list API should include routine run ${routine.routineRunId}: ${JSON.stringify(list)}`);
  }

  const shown = await fetchJson(`/api/loop-routines/${encodeURIComponent(routine.routineRunId)}`);
  if (shown.routineRunId !== routine.routineRunId || !Array.isArray(shown.findings)) {
    throw new Error(`Dedicated show API returned unexpected payload: ${JSON.stringify(shown)}`);
  }

  const findings = await fetchJson(`/api/loop-routines/${encodeURIComponent(routine.routineRunId)}/findings?withSuggestedRun=true`);
  if (!Array.isArray(findings.findings)) {
    throw new Error(`Dedicated findings API returned unexpected payload: ${JSON.stringify(findings)}`);
  }

  console.log(`[loop-routine-api-smoke] OK routineRun=${routine.routineRunId}`);
} finally {
  server.kill();
}

function aiJson(args, cwd) {
  const result = spawnSync(process.execPath, [resolve(repoRoot, "tools/ai/src/index.mjs"), ...args], {
    cwd,
    env: {
      ...process.env,
      MYAGENTTOOL_REPO_ROOT: cwd,
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`AI command failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
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
