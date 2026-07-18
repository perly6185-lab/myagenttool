import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const serverPort = Number(process.env.PROJECT_TREE_SMOKE_PORT ?? 3322);
const serverUrl = `http://127.0.0.1:${serverPort}`;
const projectPath = join(tmpdir(), `myagenttool-tree-smoke-${Date.now()}`);
const statePath = join(tmpdir(), `myagenttool-tree-smoke-state-${Date.now()}.json`);
mkdirSync(join(projectPath, "src"), { recursive: true });
writeFileSync(join(projectPath, "README.md"), "# Smoke\n");
writeFileSync(join(projectPath, "src", "app.js"), "console.log('smoke');\n");
runGit("init");
runGit("config", "user.email", "smoke@example.test");
runGit("config", "user.name", "Smoke Test");
runGit("add", "README.md");
runGit("commit", "-m", "init");
writeFileSync(join(projectPath, "README.md"), "# Smoke changed\n");

const server = spawn(process.execPath, ["apps/server/src/index.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SERVER_PORT: String(serverPort),
    MYAGENTTOOL_PROJECT_PATH: projectPath,
    MYAGENTTOOL_STATE_PATH: statePath
  },
  stdio: ["ignore", "pipe", "pipe"]
});

server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[server:error] ${chunk}`));

try {
  await waitForServer();
  const state = await request("GET", "/api/state");
  const projectId = state.currentProject.id;
  const root = await request("GET", `/api/projects/${encodeURIComponent(projectId)}/tree`);
  assert(root.entries.some((entry) => entry.name === "src" && entry.kind === "directory"), "root tree should include src directory");
  assert(root.entries.some((entry) => entry.name === "README.md" && entry.gitStatus === "modified"), "root tree should include modified README");

  const search = await request("GET", `/api/projects/${encodeURIComponent(projectId)}/tree?search=readme`);
  assert(search.entries.length === 1 && search.entries[0].name === "README.md", "search should filter file tree");

  const src = await request("GET", `/api/projects/${encodeURIComponent(projectId)}/tree?path=src`);
  assert(src.entries.some((entry) => entry.name === "app.js"), "directory tree should load lazily");

  await expectFailure("GET", `/api/projects/${encodeURIComponent(projectId)}/tree?path=..`, "escaping project root should fail");

  console.log("[project-tree-smoke] registered-root file tree OK");
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

async function request(method, path) {
  const response = await fetch(`${serverUrl}${path}`, { method });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  }
  return data;
}

async function expectFailure(method, path, message) {
  const response = await fetch(`${serverUrl}${path}`, { method });
  if (response.ok) {
    throw new Error(message);
  }
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

function runGit(...args) {
  const result = spawnSync("git", args, { cwd: projectPath, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}
