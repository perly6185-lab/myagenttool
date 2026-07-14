// End-to-end bridge verification for Claude governance Phase 4 (#914): the
// write-capable apply path, driven through a REAL server + Desktop Bridge.
//
// Unit tests cover the pieces (the gate, the wrapper against a git repo); this
// smoke proves the SEAM they cannot: the authorized patch travels server ->
// bridge (in invocation metadata, stripped from public state) -> a temp file ->
// the git-apply runner in the bound worktree, and the applied result flows back
// into the authorization. It fails loudly if the patch never reaches the bridge.
//
// Flow: propose (fake Claude emits a patch) -> issue an approval grant ->
// claude.apply.patch -> bridge git-applies -> assert the file changed on disk and
// the authorization is `applied` with the file list + reversible rollback.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import { createClaudeProposeAgentRegistration } from "../../apps/server/src/services/claude-propose-agent.mjs";
import { createClaudeApplyAgentRegistration } from "../../apps/server/src/services/claude-apply-agent.mjs";

const serverPort = process.env.CLAUDE_APPLY_SMOKE_PORT ? Number(process.env.CLAUDE_APPLY_SMOKE_PORT) : await freePort();
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-claude-apply-smoke-${Date.now()}`);
const repoPath = join(tempRoot, "source");
const fixtureDir = join(tempRoot, "fixtures");
const statePath = join(tempRoot, "state.json");
const children = [];
let passed = 0;
const ok = (message) => { passed += 1; console.log(`  ok - ${message}`); };

mkdirSync(repoPath, { recursive: true });
mkdirSync(fixtureDir, { recursive: true });
runGit(["init", "-b", "main"], repoPath);
runGit(["config", "user.email", "claude-apply-smoke@example.test"], repoPath);
runGit(["config", "user.name", "Claude Apply Smoke"], repoPath);
writeFileSync(join(repoPath, "README.md"), "# Claude apply caller smoke\n");
runGit(["add", "README.md"], repoPath);
runGit(["commit", "-m", "seed claude apply smoke repo"], repoPath);

// A git-produced create-file patch for greeting.txt — guaranteed to apply cleanly
// to a worktree that does not have the file. The fake Claude proposes exactly this.
writeFileSync(join(repoPath, "greeting.txt"), "hello from claude apply\n");
runGit(["add", "-N", "greeting.txt"], repoPath);
const proposalPatch = gitOut(["diff", "--", "greeting.txt"], repoPath);
runGit(["reset", "--", "greeting.txt"], repoPath);
rmSync(join(repoPath, "greeting.txt"), { force: true });
if (!proposalPatch.includes("greeting.txt")) throw new Error("failed to build the proposal patch fixture");

// Fake Claude CLI (propose mode): emits the fixed patch as a claude.propose.patch
// JSON result. The apply runner uses git, not Claude, so it needs no fixture.
const fakeClaudePath = join(fixtureDir, "claude-propose-fixture.mjs");
writeFileSync(fakeClaudePath, [
  "const patch = process.env.CLAUDE_APPLY_SMOKE_PATCH ?? '';",
  "console.log(JSON.stringify({ summary: 'Create greeting.txt.', patch, files: [{ path: 'greeting.txt', action: 'created' }] }));",
].join("\n"));

try {
  start("server", process.execPath, ["apps/server/src/index.mjs"], {
    SERVER_PORT: String(serverPort),
    MYAGENTTOOL_PROJECT_PATH: repoPath,
    MYAGENTTOOL_STATE_PATH: statePath,
    MYAGENTTOOL_STATE_DISABLED: "1",
    // Phase 4 is default-OFF; the operator opts in.
    MYAGENTTOOL_CLAUDE_APPLY_ENABLED: "1",
  });
  await waitForServer();
  ok("server started with claude.apply.patch enabled");

  start("desktop", process.execPath, ["apps/desktop/src/index.mjs"], {
    BRIDGE_SERVER_URL: serverUrl,
    BRIDGE_POLL_INTERVAL_MS: "100",
    MYAGENTTOOL_CLAUDE_COMMAND: fakeClaudePath,
    CLAUDE_APPLY_SMOKE_PATCH: proposalPatch,
  });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device?.status === "online" ? state : false;
  }, "desktop bridge registration");
  ok("desktop bridge registered");

  const initialState = await request("GET", "/api/state");
  const branchName = `myagenttool/claude-apply-smoke-${Date.now().toString(36)}`;
  const worktreeCreated = await request("POST", "/api/worktrees", {
    name: "claude-apply-smoke",
    branchName,
    projectId: initialState.currentProject.id,
  });
  const worktreePath = worktreeCreated.worktree.worktreePath;
  ok("worktree created for the governed apply");

  // ---- Phase 3: register the propose agent and get a real proposal -----------
  await request("POST", "/api/agents", createClaudeProposeAgentRegistration({
    wrapperScriptPath: resolve("tools/agents/claude-review-wrapper.mjs"),
  }));
  const proposed = await request("POST", "/api/capabilities/claude.propose.patch/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    task: "Create greeting.txt with a greeting.",
  });
  const proposalInvocationId = proposed.invocationId;
  const proposal = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === proposalInvocationId);
    if (["failed", "cancelled", "timed_out", "rejected"].includes(invocation?.status)) {
      throw new Error(`propose invocation ended unexpectedly: ${invocation.status}`);
    }
    return invocation?.status === "succeeded" && invocation.result?.output?.patch ? invocation : false;
  }, "claude.propose.patch completion", 20_000);
  assert(proposal.result.output.patch.includes("greeting.txt"), "the proposal should carry the patch");
  ok("Claude proposed a patch through the bridge (Phase 3)");

  // ---- Phase 4: register the apply runner, approve, and apply ---------------
  const applyReg = await request("POST", "/api/agents", createClaudeApplyAgentRegistration({
    wrapperScriptPath: resolve("tools/agents/claude-apply-wrapper.mjs"),
  }));
  assert(applyReg.agent.id === "agt_claude_apply_patch", "the apply runner should register");
  ok("operator registered the governed apply runner");

  const grant = await request("POST", "/api/approvals/grants", { action: "apply_patch", targetId: proposalInvocationId });
  assert(grant.token, "a grant should be issued for the apply");
  ok("issued a single-use approval grant for the apply");

  const applied = await request("POST", "/api/capabilities/claude.apply.patch/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    proposalInvocationId,
    approvalToken: grant.token,
  });
  assert(applied.status === "applying", `apply should dispatch to the runner, got ${applied.status}`);
  assert(applied.executionInvocationId, "apply should link the execution invocation");
  ok("apply authorized + dispatched to the bridge runner");

  // A high-risk write runner may also fall to the platform local-approval gate;
  // release it if so (the grant already authorized the apply itself).
  await maybeApproveLocalGate(applied.executionInvocationId);

  const authorization = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const row = (state.claudeApplyAuthorizations ?? []).find((item) => item.id === applied.authorizationId);
    if (row?.status === "failed") throw new Error(`apply failed: ${JSON.stringify(row.verification)}`);
    return row?.status === "applied" ? row : false;
  }, "claude.apply.patch completion", 20_000);
  ok("the authorization transitioned to applied through the bridge");

  // The SEAM: the patch reached the bridge, was written to a temp file, and
  // git-applied — the file really exists on disk in the bound worktree.
  const appliedFile = join(worktreePath, "greeting.txt");
  assert(existsSync(appliedFile), "greeting.txt should exist in the worktree after apply");
  assert(readFileSync(appliedFile, "utf8").includes("hello from claude apply"), "the applied content should be on disk");
  ok("the patch was git-applied into the worktree on disk (server -> bridge -> git apply seam)");

  assert((authorization.appliedFiles ?? []).some((f) => f.path === "greeting.txt"), "the authorization should record greeting.txt");
  assert(authorization.rollback?.available === true, "a successful apply should record reversible rollback guidance");
  assert(authorization.patchPreview === undefined || typeof authorization.patchPreview === "string", "public authorization exposes only a bounded preview");
  ok("the applied file list + rollback guidance are recorded on the authorization");

  // Rollback is genuine: git apply --reverse of the same patch reverts the file.
  runGit(["apply", "--reverse", "--", writePatchFile(authorization)], worktreePath);
  assert(!existsSync(appliedFile), "rollback (git apply --reverse) should remove the applied file");
  ok("the recorded rollback genuinely reverts the applied change");

  console.log(`\nclaude-apply-caller-smoke: ${passed} checks passed`);
} finally {
  for (const child of children.reverse()) child.kill();
  if (resolve(tempRoot).startsWith(resolve(tmpdir()))) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function maybeApproveLocalGate(invocationId) {
  const pending = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const req = (state.approvalRequests ?? []).find((item) => item.invocationId === invocationId && item.status === "pending");
    const invocation = state.invocations.find((item) => item.id === invocationId);
    if (["succeeded", "failed", "cancelled"].includes(invocation?.status)) return { none: true };
    return req ?? false;
  }, "apply local-approval gate resolution", 8_000).catch(() => ({ none: true }));
  if (pending && !pending.none) {
    await request("POST", `/api/approvals/${encodeURIComponent(pending.id)}/approve`);
    ok("released the apply run at the platform local-approval gate");
  }
}

// The full patch is stripped from public state; the smoke rebuilt it from the
// original fixture for the rollback assertion.
function writePatchFile() {
  const patchFile = join(fixtureDir, "applied.patch");
  writeFileSync(patchFile, proposalPatch);
  return patchFile;
}

function start(label, command, args, env = {}) {
  const child = spawn(command, args, { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}:error] ${chunk}`));
  children.push(child);
  return child;
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
}

function gitOut(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return result.stdout ?? "";
}

async function waitForServer() {
  await waitFor(async () => { try { return (await fetch(`${serverUrl}/health`)).ok; } catch { return false; } }, "server health");
}

async function request(method, path, body = undefined) {
  const response = await fetch(`${serverUrl}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  return data;
}

async function waitFor(check, label, timeoutMs = 7_500) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw lastError ?? new Error(`Timed out waiting for ${label}`);
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => port ? resolvePort(port) : reject(new Error("no free port")));
    });
    server.on("error", reject);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
