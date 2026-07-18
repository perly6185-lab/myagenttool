import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const basePort = Number(process.env.PERSISTENCE_SMOKE_PORT ?? 3324);
const statePath = join(tmpdir(), `myagenttool-persist-${Date.now()}`, "state.json");
const sqlitePath = statePath.replace(/\.json$/, ".sqlite");
const projectPath = join(tmpdir(), `myagenttool-persist-project-${Date.now()}`);
mkdirSync(projectPath, { recursive: true });
rmSync(statePath, { force: true });

let server = null;

try {
  server = startServer(basePort);
  await waitForServer(basePort);
  const added = await request(basePort, "POST", "/api/projects", {
    name: "Persistent Project",
    path: projectPath
  });
  const invoked = await request(basePort, "POST", "/api/invocations", {
    task: "Persistence smoke task.",
    agentId: "agt_demo_cli"
  });
  await waitFor(
    () => existsSync(sqlitePath) && statSync(sqlitePath).size > 0,
    "SQLite durable backing write",
  );
  await stopServer(server);

  server = startServer(basePort + 1);
  await waitForServer(basePort + 1);
  const restored = await request(basePort + 1, "GET", "/api/state");
  assert(restored.projects.some((project) => project.id === added.project.id), "restored state should include project");
  assert(restored.invocations.some((invocation) => invocation.id === invoked.invocation.id), "restored state should include invocation");
  assert(restored.currentProjectId === added.project.id, "restored current project should match previous selection");

  console.log("[persistence-smoke] local state persistence and restore OK");
} finally {
  if (server) await stopServer(server);
}

function startServer(port) {
  const child = spawn(process.execPath, ["apps/server/src/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SERVER_PORT: String(port),
      MYAGENTTOOL_STATE_PATH: statePath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[server:error] ${chunk}`));
  return child;
}

async function stopServer(child) {
  if (!child || child.killed) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

async function waitForServer(port) {
  await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }, "server health");
}

async function request(port, method, path, body = undefined) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  }
  return data;
}

async function waitFor(check, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
