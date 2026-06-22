import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const serverPort = Number(process.env.SESSION_HISTORY_SMOKE_PORT ?? 3323);
const serverUrl = `http://127.0.0.1:${serverPort}`;
const firstProjectPath = join(tmpdir(), `myagenttool-history-a-${Date.now()}`);
const secondProjectPath = join(tmpdir(), `myagenttool-history-b-${Date.now()}`);
const statePath = join(tmpdir(), `myagenttool-history-state-${Date.now()}.json`);
mkdirSync(firstProjectPath, { recursive: true });
mkdirSync(secondProjectPath, { recursive: true });

const server = spawn(process.execPath, ["apps/server/src/index.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SERVER_PORT: String(serverPort),
    MYAGENTTOOL_PROJECT_PATH: firstProjectPath,
    MYAGENTTOOL_STATE_PATH: statePath
  },
  stdio: ["ignore", "pipe", "pipe"]
});

server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[server:error] ${chunk}`));

try {
  await waitForServer();
  const initial = await request("GET", "/api/state");
  const firstProject = initial.currentProject;

  const firstRun = await request("POST", "/api/invocations", {
    task: "History task in first project.",
    agentId: "agt_demo_cli"
  });
  assert(firstRun.invocation.options.metadata.projectId === firstProject.id, "first invocation should bind default project");

  const added = await request("POST", "/api/projects", {
    name: "Second History Project",
    path: secondProjectPath
  });
  const secondRun = await request("POST", "/api/invocations", {
    task: "History task in second project.",
    agentId: "agt_demo_cli"
  });
  assert(secondRun.invocation.options.metadata.projectId === added.project.id, "second invocation should bind selected project");

  const state = await request("GET", "/api/state");
  const grouped = new Map();
  for (const invocation of state.invocations) {
    const projectId = invocation.options?.metadata?.projectId;
    grouped.set(projectId, (grouped.get(projectId) ?? 0) + 1);
  }
  assert(grouped.get(firstProject.id) === 1, "first project should have one conversation");
  assert(grouped.get(added.project.id) === 1, "second project should have one conversation");

  console.log("[session-history-smoke] project-scoped invocation history OK");
} finally {
  server.kill();
}

async function waitForServer() {
  await waitFor(async () => {
    try {
      const response = await fetch(`${serverUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }, "server health");
}

async function request(method, path, body = undefined) {
  const response = await fetch(`${serverUrl}${path}`, {
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
