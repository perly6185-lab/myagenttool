// Demo + regression: an internal caller drives the write-capable codex.exec
// capability end to end (Phase 1, default-OFF behind MYAGENTTOOL_CODEX_EXEC_ENABLED).
//
// Proves the full governed write chain:
//   1. Flag on → codex.exec is discoverable in the capability catalog.
//   2. Caller invokes via POST /api/capabilities/codex.exec/invocations.
//   3. High-risk write => the platform local-approval gate holds the run
//      (status waiting_for_local_approval) until an authorized human approves.
//   4. After approval the Bridge runs the governed exec wrapper in the worktree;
//      the wrapper derives the AUTHORITATIVE changeset from git (not the model).
//   5. Caller reads the changeset back from public state (raw stripped).
//
// See docs/engineering/CODEX_EXEC_CONTRACT_DESIGN.md.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import { createCodexExecAgentRegistration } from "../../apps/server/src/services/codex-agent.mjs";

const CAPABILITY_NAME = "codex.exec";

const serverPort = process.env.CODEX_EXEC_SMOKE_PORT ? Number(process.env.CODEX_EXEC_SMOKE_PORT) : await freePort();
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-codex-exec-smoke-${Date.now()}`);
const repoPath = join(tempRoot, "source");
const fixtureDir = join(tempRoot, "fixtures");
const statePath = join(tempRoot, "state.json");
const codexCapturePath = join(tempRoot, "codex-capture.json");
const children = [];
let passed = 0;

const ok = (message) => { passed += 1; console.log(`  ok - ${message}`); };

mkdirSync(repoPath, { recursive: true });
mkdirSync(fixtureDir, { recursive: true });
runGit(["init", "-b", "main"], repoPath);
runGit(["config", "user.email", "codex-exec-smoke@example.test"], repoPath);
runGit(["config", "user.name", "Codex Exec Smoke"], repoPath);
writeFileSync(join(repoPath, "README.md"), "# Codex exec caller smoke\n");
runGit(["add", "README.md"], repoPath);
runGit(["commit", "-m", "seed codex exec smoke repo"], repoPath);

// Fake Codex CLI in EDIT mode: it actually writes a file into its cwd (the
// worktree), then prints a summary line. The wrapper then reads the real diff.
const fakeCodexPath = join(fixtureDir, "codex-edit-fixture.mjs");
writeFileSync(fakeCodexPath, [
  "import { writeFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "const args = process.argv.slice(2);",
  "const prompt = args.at(-1) ?? '';",
  "writeFileSync(process.env.CODEX_EXEC_SMOKE_CAPTURE, JSON.stringify({ cwd: process.cwd(), args, prompt }, null, 2));",
  "if (!args.includes('exec')) { console.error('missing exec'); process.exit(3); }",
  "if (!prompt.includes('Add a greeting file.')) { console.error('missing task'); process.exit(4); }",
  "writeFileSync(join(process.cwd(), 'greeting.txt'), 'hello from codex exec\\n');",
  "console.log(JSON.stringify({ summary: 'Created greeting.txt as requested.' }));",
].join("\n"));

try {
  // ---- Platform setup (operator) -----------------------------------------
  start("server", process.execPath, ["apps/server/src/index.mjs"], {
    SERVER_PORT: String(serverPort),
    MYAGENTTOOL_PROJECT_PATH: repoPath,
    MYAGENTTOOL_STATE_PATH: statePath,
    MYAGENTTOOL_STATE_DISABLED: "1",
    // Phase 1 is default-OFF; the operator opts in.
    MYAGENTTOOL_CODEX_EXEC_ENABLED: "1",
  });
  await waitForServer();
  ok("server started with codex.exec enabled");

  start("desktop", process.execPath, ["apps/desktop/src/index.mjs"], {
    BRIDGE_SERVER_URL: serverUrl,
    BRIDGE_POLL_INTERVAL_MS: "100",
    MYAGENTTOOL_CODEX_COMMAND: fakeCodexPath,
    CODEX_EXEC_SMOKE_CAPTURE: codexCapturePath,
  });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device?.status === "online" ? state : false;
  }, "desktop bridge registration");
  ok("desktop bridge registered");

  const initialState = await request("GET", "/api/state");
  const branchName = `myagenttool/codex-exec-smoke-${Date.now().toString(36)}`;
  const worktreeCreated = await request("POST", "/api/worktrees", {
    name: "codex-exec-smoke",
    branchName,
    projectId: initialState.currentProject.id,
  });
  ok("worktree created for governed edit");

  const registration = createCodexExecAgentRegistration({
    wrapperScriptPath: resolve("tools/agents/codex-exec-wrapper.mjs"),
    costOwner: "team_smoke_ops",
  });
  const registered = await request("POST", "/api/agents", registration);
  assert(registered.agent.id === "agt_codex_exec", "codex exec agent should register with deterministic id");
  ok("operator registered the governed codex.exec agent");

  // ---- Internal caller ----------------------------------------------------
  const result = await internalCallerAgent({
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
  });

  assert(result.changes.length >= 1, "caller should read at least one imported change");
  const greeting = result.changes.find((change) => change.file === "greeting.txt");
  assert(greeting, "the git-derived changeset should include greeting.txt");
  assert(greeting.action === "created", "greeting.txt should be recorded as created");
  assert(greeting.source === "codex", "change should be attributed to Codex");
  assert(typeof greeting.diffPreview === "string" && greeting.diffPreview.includes("hello from codex exec"), "diff preview should carry the added content");
  assert(greeting.raw === undefined, "caller must never see raw change payloads");
  ok("caller read the git-derived changeset back through public state");

  assert(!JSON.stringify(result.catalogEntry).includes("codex-exec-wrapper.mjs"), "catalog must not leak wrapper argv");
  ok("capability catalog exposes the contract without raw argv");

  // Phase 2: the exec changeset surfaces in the Evidence Center trust ledger — an
  // AI that wrote code is visible to a supervisor, scoped to the run.
  const evidenceState = await request("GET", "/api/state");
  const execEvidence = (evidenceState.evidenceCenterRecords ?? []).filter(
    (record) => record.source === "governed_codex_exec" && record.invocationId === result.invocationId,
  );
  assert(execEvidence.length >= 1, "exec changeset should appear in the Evidence Center");
  assert(execEvidence.some((record) => record.summary.includes("greeting.txt")), "evidence record should name the changed file");
  assert(execEvidence.every((record) => record.redactionState === "summary_only"), "exec evidence must stay summary-only");
  ok("exec changeset surfaces in the Evidence Center trust ledger");

  const capture = await waitFor(() => readJsonFile(codexCapturePath), "fake Codex capture");
  assert(resolve(capture.cwd) === resolve(worktreeCreated.worktree.worktreePath), "Codex ran in the selected worktree");
  assert(capture.prompt.includes("Add a greeting file."), "caller task reached the wrapper");
  ok("capability invocation drove the governed exec wrapper in the right worktree");

  console.log(`\ncodex-exec-caller-smoke: ${passed} checks passed`);
} finally {
  for (const child of children.reverse()) {
    child.kill();
  }
  if (resolve(tempRoot).startsWith(resolve(tmpdir()))) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function internalCallerAgent({ projectId, worktreeId }) {
  const catalog = await request("GET", "/api/capabilities?providerType=tool");
  const catalogEntry = catalog.capabilities.find((capability) => capability.name === CAPABILITY_NAME);
  assert(catalogEntry, `caller should discover ${CAPABILITY_NAME} when the flag is on`);
  assert(catalogEntry.riskLevel === "high", "exec capability should advertise high risk");
  ok("caller discovered codex.exec via GET /api/capabilities");

  const invoked = await request("POST", `/api/capabilities/${encodeURIComponent(CAPABILITY_NAME)}/invocations`, {
    projectId,
    worktreeId,
    task: "Add a greeting file.",
    approvalMode: "auto",
  });
  assert(invoked.invocationId, "invocation response should carry an invocationId");
  assert(invoked.outputCollection === "codexExecChanges", "response should advertise the changeset collection");
  // High-risk write => the platform local-approval gate holds it before it runs.
  assert(invoked.status === "waiting_for_local_approval", `high-risk exec should await local approval, got ${invoked.status}`);
  ok("high-risk exec invocation is held at the local-approval gate");

  const approval = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.approvalRequests.find((item) => item.invocationId === invoked.invocationId && item.status === "pending") ?? false;
  }, "pending local approval request");
  await request("POST", `/api/approvals/${encodeURIComponent(approval.id)}/approve`);
  ok("authorized approver released the exec run");

  const changes = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === invoked.invocationId);
    if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation?.status)) {
      throw new Error(`codex.exec invocation ended unexpectedly: ${invocation.status}`);
    }
    if (invocation?.status !== "succeeded") return false;
    const rows = state.codexExecChanges.filter((item) => item.invocationId === invoked.invocationId);
    return rows.length ? rows : false;
  }, "codex.exec completion and changeset import", 20_000);
  ok("caller polled the exec run to completion");

  return { catalogEntry, invocationId: invoked.invocationId, changes };
}

function start(label, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}:error] ${chunk}`));
  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`[${label}:exit] code=${code}\n`);
    } else if (signal && signal !== "SIGTERM") {
      process.stderr.write(`[${label}:exit] signal=${signal}\n`);
    }
  });
  children.push(child);
  return child;
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  }
  return data;
}

async function waitFor(check, label, timeoutMs = 7_500) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw lastError ?? new Error(`Timed out waiting for ${label}`);
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => port ? resolvePort(port) : reject(new Error("Unable to allocate a free port.")));
    });
    server.on("error", reject);
  });
}

function readJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
