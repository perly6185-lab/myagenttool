// #1210: end-to-end proof that a project with no internet account can still
// publish — a platform-managed bare repo as origin, then the ordinary
// publishWorktreeBranch path, unmodified.
//
// The claim being tested is not "the endpoint returns 200". It is: a user who
// has never signed up for anything can run the platform's loop and have the work
// land somewhere durable and readable. So this asserts against the bare repo's
// actual git objects, not against the API's own report of success.
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const serverPort = Number(process.env.LOCAL_ORIGIN_SMOKE_PORT ?? 3345);
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-local-origin-smoke-${Date.now()}`);
const repoPath = join(tempRoot, "source");

mkdirSync(repoPath, { recursive: true });
git(["init", "-b", "main"], repoPath);
git(["config", "user.email", "smoke@example.test"], repoPath);
git(["config", "user.name", "Smoke Test"], repoPath);
writeFileSync(join(repoPath, "README.md"), "# Local origin smoke\n");
git(["add", "README.md"], repoPath);
git(["commit", "-m", "initial"], repoPath);

// The project has NO remote — the state a user without an account is in.
const noRemote = spawnSync("git", ["-C", repoPath, "remote"], { encoding: "utf8" });
assert(!noRemote.stdout.trim(), "the smoke repo starts with no remote (the point of the test)");

const server = spawn(process.execPath, ["apps/server/src/index.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SERVER_PORT: String(serverPort),
    MYAGENTTOOL_PROJECT_PATH: repoPath,
    MYAGENTTOOL_STATE_PATH: join(tempRoot, "state.json"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[server:error] ${chunk}`));

try {
  await waitForServer();
  const state = await request("GET", "/api/state");
  const projectId = state.currentProject.id;

  // Publishing must fail BEFORE a local origin exists — otherwise a later pass
  // proves nothing about this feature.
  const worktreeA = await request("POST", "/api/worktrees", {
    name: "before",
    branchName: `myagenttool/before-${Date.now().toString(36)}`,
    projectId,
  });
  const before = await requestRaw("POST", `/api/worktrees/${worktreeA.worktree.id}/push`, {});
  assert(before.status >= 400, `publish refuses with no origin (got ${before.status})`);
  assert(/No 'origin' remote/i.test(JSON.stringify(before.body)), `refusal names the missing origin: ${JSON.stringify(before.body).slice(0, 160)}`);

  // Create the local origin.
  const created = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/local-origin`);
  assert(created.originUrl?.startsWith("file:///"), `origin is a file:// url (got ${created.originUrl})`);
  assert(existsSync(created.barePath), `bare repo exists on disk at ${created.barePath}`);
  assert(!created.barePath.startsWith(resolve(repoPath)), "the bare repo lives OUTSIDE the project's own checkout");

  // Use --git-dir (not -C) so the check still works when the developer's global
  // git config sets `safe.bareRepository = explicit`, which otherwise makes git
  // refuse to operate on a bare repo reached via -C. CI runners lack that setting
  // and behave identically either way.
  const bareType = spawnSync("git", ["--git-dir", created.barePath, "rev-parse", "--is-bare-repository"], { encoding: "utf8" });
  assert(bareType.stdout.trim() === "true", "the created repo is bare");

  // No listener was opened for any of this.
  assert(!created.port && !created.pid, "local origin starts no process and opens no port");

  // Now the ordinary publish path — unmodified — must work.
  const worktreeB = await request("POST", "/api/worktrees", {
    name: "after",
    branchName: `myagenttool/after-${Date.now().toString(36)}`,
    projectId,
  });
  const branch = worktreeB.worktree.branchName;
  const wtPath = worktreeB.worktree.worktreePath;
  writeFileSync(join(wtPath, "work.txt"), "agent output\n");
  git(["add", "work.txt"], wtPath);
  git(["commit", "-m", "smoke: agent work"], wtPath);
  const localHead = spawnSync("git", ["-C", wtPath, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();

  const published = await request("POST", `/api/worktrees/${worktreeB.worktree.id}/push`, {});
  assert(published.published === true, `publish succeeds against the local origin: ${JSON.stringify(published).slice(0, 200)}`);

  // The assertion that matters: the commit is IN the bare repo, reachable by the
  // branch name — not merely that the API said "ok".
  const remoteRef = spawnSync("git", ["--git-dir", created.barePath, "rev-parse", branch], { encoding: "utf8" });
  assert(remoteRef.status === 0, `the branch exists in the bare repo: ${remoteRef.stderr?.slice(0, 120)}`);
  assert(remoteRef.stdout.trim() === localHead, `the bare repo carries the same commit (${remoteRef.stdout.trim().slice(0, 8)} vs ${localHead.slice(0, 8)})`);

  // ...and it is a real repo someone else can clone from.
  const clonePath = join(tempRoot, "clone");
  const cloned = spawnSync("git", ["clone", "--branch", branch, created.barePath, clonePath], { encoding: "utf8" });
  assert(cloned.status === 0, `the bare repo is clonable: ${cloned.stderr?.slice(0, 160)}`);
  assert(existsSync(join(clonePath, "work.txt")), "the cloned checkout contains the agent's file");

  // Idempotent: a second call must not re-init over the pushed history.
  const again = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/local-origin`);
  assert(again.originUrl === created.originUrl, "a second call reports the same origin");
  assert(again.created === false, "a second call reports created:false — it reused, it did not re-init");
  const afterRef = spawnSync("git", ["--git-dir", created.barePath, "rev-parse", branch], { encoding: "utf8" });
  assert(afterRef.stdout.trim() === localHead, "the pushed history survives a second call (no re-init)");

  // A remote the USER chose must never be re-pointed into a local directory —
  // their pushes would silently stop reaching the place they watch. Swap origin
  // for a foreign URL and assert the refusal names it.
  git(["remote", "set-url", "origin", "https://github.com/someone/real.git"], repoPath);
  const foreign = await requestRaw("POST", `/api/projects/${encodeURIComponent(projectId)}/local-origin`, {});
  assert(foreign.status >= 400, `refuses to re-point a foreign origin (got ${foreign.status})`);
  assert(/already has an 'origin'/i.test(JSON.stringify(foreign.body)), `refusal explains why: ${JSON.stringify(foreign.body).slice(0, 160)}`);
  assert(/github\.com\/someone\/real/.test(JSON.stringify(foreign.body)), "refusal names the remote it declined to replace");
  const untouched = spawnSync("git", ["-C", repoPath, "remote", "get-url", "origin"], { encoding: "utf8" });
  assert(untouched.stdout.trim() === "https://github.com/someone/real.git", "the user's remote is left exactly as it was");

  console.log(`[local-origin-smoke] no account, no service, no port -> pushed ${branch} @ ${localHead.slice(0, 8)} into ${created.barePath}`);
  console.log("[local-origin-smoke] local origin OK");
} finally {
  server.kill();
  await new Promise((resolveExit) => {
    if (server.exitCode !== null) return resolveExit();
    server.once("exit", resolveExit);
  });
  rmSync(tempRoot, { recursive: true, force: true });
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result;
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await request("GET", "/api/state");
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
  }
  throw new Error("Timed out waiting for the smoke server.");
}

async function requestRaw(method, path, body) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function request(method, path, body) {
  const { status, body: data } = await requestRaw(method, path, body);
  if (status >= 400) throw new Error(`${method} ${path} failed (${status}): ${JSON.stringify(data)}`);
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(`[local-origin-smoke] ${message}`);
}
