import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const serverPort = Number(process.env.PROJECT_REGISTRY_SMOKE_PORT ?? 3321);
const serverUrl = `http://127.0.0.1:${serverPort}`;
const defaultProjectPath = join(tmpdir(), `myagenttool-project-default-${Date.now()}`);
const projectPath = join(tmpdir(), `myagenttool-project-smoke-${Date.now()}`);
const statePath = join(tmpdir(), `myagenttool-project-smoke-state-${Date.now()}.json`);
mkdirSync(defaultProjectPath, { recursive: true });
mkdirSync(projectPath, { recursive: true });

const server = spawn(process.execPath, ["apps/server/src/index.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SERVER_PORT: String(serverPort),
    MYAGENTTOOL_PROJECT_PATH: defaultProjectPath,
    MYAGENTTOOL_STATE_PATH: statePath
  },
  stdio: ["ignore", "pipe", "pipe"]
});

server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[server:error] ${chunk}`));

try {
  await waitForServer();
  const initial = await request("GET", "/api/state");
  assert(initial.projects?.length >= 1, "default project should be registered");
  assert(initial.currentProject?.path, "current project should expose path");

  const added = await request("POST", "/api/projects", {
    name: "Smoke Project",
    path: projectPath
  });
  assert(added.project.name === "Smoke Project", "added project should preserve name");
  assert(added.currentProjectId === added.project.id, "added project should become current");

  const invoked = await request("POST", "/api/invocations", {
    task: "Project registry smoke task.",
    agentId: "agt_demo_cli"
  });
  assert(invoked.invocation.options.metadata.projectId === added.project.id, "invocation should record selected project id");
  assert(invoked.invocation.options.metadata.projectPath === projectPath, "invocation should record selected project path");

  const selected = await request("POST", `/api/projects/${encodeURIComponent(initial.currentProject.id)}`);
  assert(selected.currentProjectId === initial.currentProject.id, "project switch should update current project id");

  const removed = await request("DELETE", `/api/projects/${encodeURIComponent(added.project.id)}`);
  assert(removed.removed.id === added.project.id, "project remove should return removed project");
  assert(!removed.projects.some((project) => project.id === added.project.id), "removed project should leave registry");

  console.log("[project-registry-smoke] project registry API OK");
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
