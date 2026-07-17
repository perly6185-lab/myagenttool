import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const serverPort = Number(process.env.WORKTREE_SMOKE_PORT ?? 3325);
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-worktree-smoke-${Date.now()}`);
const repoPath = join(tempRoot, "source");
const statePath = join(tempRoot, "state.json");

mkdirSync(repoPath, { recursive: true });
runGit(["init", "-b", "main"], repoPath);
runGit(["config", "user.email", "smoke@example.test"], repoPath);
runGit(["config", "user.name", "Smoke Test"], repoPath);
writeFileSync(join(repoPath, "README.md"), "# Smoke repo\n");
// A nested directory, so the file tree has something to descend into (#1200).
mkdirSync(join(repoPath, "apps", "web"), { recursive: true });
writeFileSync(join(repoPath, "apps", "web", "main.ts"), "export const ok = true;\n");
runGit(["add", "README.md", "apps"], repoPath);
runGit(["commit", "-m", "initial"], repoPath);

const server = spawn(process.execPath, ["apps/server/src/index.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SERVER_PORT: String(serverPort),
    MYAGENTTOOL_PROJECT_PATH: repoPath,
    MYAGENTTOOL_STATE_PATH: statePath
  },
  stdio: ["ignore", "pipe", "pipe"]
});

server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[server:error] ${chunk}`));

try {
  await waitForServer();
  const initial = await request("GET", "/api/state");
  assert(initial.currentProject.path === resolve(repoPath), "default project should be the smoke repository");

  const branchName = `myagenttool/smoke-${Date.now().toString(36)}`;
  const created = await request("POST", "/api/worktrees", {
    name: "smoke-worktree",
    branchName,
    projectId: initial.currentProject.id
  });
  assert(created.worktree.branchName === branchName, "worktree should preserve requested branch");
  assert(created.currentProjectId === created.project.id, "created worktree project should become current");
  assert(created.project.worktree.id === created.worktree.id, "worktree project should carry worktree metadata");
  assert(basename(created.worktree.worktreePath).includes("smoke-worktree"), "worktree path should use requested name");

  const state = await request("GET", "/api/state");
  assert(state.worktrees.some((item) => item.id === created.worktree.id), "state should expose worktree registry");
  assert(state.currentProject.path === created.worktree.worktreePath, "current project should point at worktree path");

  const tree = await request("GET", `/api/projects/${encodeURIComponent(created.project.id)}/tree`);
  assert(tree.entries.some((entry) => entry.name === "README.md"), "worktree project tree should be readable");

  // #1200: the file tree loads one level at a time. The root listing must not
  // claim to know what is inside a directory — it only ran one readdir. Saying
  // `children: []` there asserted "empty", and the browser rendered an unread
  // directory and an empty one identically: as nothing. Clicking did nothing.
  const rootFiles = await request("GET", `/api/worktrees/${encodeURIComponent(created.worktree.id)}/files`);
  const appsNode = (rootFiles.tree ?? []).find((node) => node.name === "apps");
  assert(appsNode, "root listing should include the apps directory");
  assert(appsNode.dir === true, "apps should be reported as a directory");
  assert(!("children" in appsNode), "an unread directory must NOT claim children — absent means 'not read yet'");
  const readmeNode = (rootFiles.tree ?? []).find((node) => node.name === "README.md");
  assert(readmeNode && readmeNode.dir === false, "root listing should include README.md as a file");

  // ...and the level below is fetchable by path, which is what expanding does.
  const appsFiles = await request(
    "GET",
    `/api/worktrees/${encodeURIComponent(created.worktree.id)}/files?path=${encodeURIComponent("apps")}`,
  );
  const webNode = (appsFiles.tree ?? []).find((node) => node.name === "web");
  assert(webNode && webNode.dir === true, "?path=apps should list the nested web directory");
  assert(webNode.path === "apps/web", `nested node should carry its full path (got ${webNode.path})`);

  const webFiles = await request(
    "GET",
    `/api/worktrees/${encodeURIComponent(created.worktree.id)}/files?path=${encodeURIComponent("apps/web")}`,
  );
  assert((webFiles.tree ?? []).some((node) => node.name === "main.ts" && !node.dir), "?path=apps/web should list main.ts");

  // Path confinement still holds on the listing route.
  let escaped = null;
  try {
    escaped = await request("GET", `/api/worktrees/${encodeURIComponent(created.worktree.id)}/files?path=${encodeURIComponent("../..")}`);
  } catch (error) {
    escaped = { refused: true, message: String(error?.message ?? error) };
  }
  assert(escaped?.refused === true, "listing must refuse a path escaping the worktree root");

  const invoked = await request("POST", "/api/invocations", {
    task: "Worktree smoke task.",
    agentId: "agt_demo_cli"
  });
  assert(invoked.invocation.options.metadata.projectId === created.project.id, "invocation should bind to worktree project");
  assert(invoked.invocation.options.metadata.worktreeId === created.worktree.id, "invocation should record worktree id");
  assert(invoked.invocation.options.metadata.projectPath === created.worktree.worktreePath, "invocation should run in worktree path");

  console.log("[worktree-smoke] worktree creation and project binding OK");
} finally {
  // #1042 aftermath: the server owns an open SQLite/WAL in tempRoot until it
  // actually exits — an rm racing the shutdown checkpoint dies ENOTEMPTY (and,
  // thrown from a finally, MASKS the smoke's real verdict). Wait for exit, then
  // remove with retries.
  server.kill();
  await new Promise((resolveExit) => {
    if (server.exitCode !== null) return resolveExit();
    server.once("exit", resolveExit);
    setTimeout(resolveExit, 5000).unref?.();
  });
  if (resolve(tempRoot).startsWith(resolve(tmpdir()))) {
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
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
