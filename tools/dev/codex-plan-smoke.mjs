import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import { createCodexPlanAgentRegistration } from "../../apps/server/src/services/codex-agent.mjs";

const serverPort = process.env.CODEX_PLAN_SMOKE_PORT
  ? Number(process.env.CODEX_PLAN_SMOKE_PORT)
  : await freePort();
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-codex-plan-smoke-${Date.now()}`);
const repoPath = join(tempRoot, "source");
const fixtureDir = join(tempRoot, "fixtures");
const statePath = join(tempRoot, "state.json");
const codexCapturePath = join(tempRoot, "codex-plan-capture.json");
const children = [];
let passed = 0;

const ok = (message) => {
  passed += 1;
  console.log(`  ok - ${message}`);
};

mkdirSync(repoPath, { recursive: true });
mkdirSync(fixtureDir, { recursive: true });
runGit(["init", "-b", "main"], repoPath);
runGit(["config", "user.email", "codex-plan-smoke@example.test"], repoPath);
runGit(["config", "user.name", "Codex Plan Smoke"], repoPath);
writeFileSync(join(repoPath, "README.md"), "# Codex plan smoke\n");
runGit(["add", "README.md"], repoPath);
runGit(["commit", "-m", "seed codex plan smoke repo"], repoPath);

const fakeCodexPath = join(fixtureDir, "codex-plan-fixture.mjs");
writeFileSync(fakeCodexPath, [
  "import { writeFileSync } from 'node:fs';",
  "const args = process.argv.slice(2);",
  "const prompt = args.at(-1) ?? '';",
  "writeFileSync(process.env.CODEX_PLAN_SMOKE_CAPTURE, JSON.stringify({ cwd: process.cwd(), args, prompt }, null, 2));",
  "if (!args.includes('exec')) { console.error('missing exec'); process.exit(3); }",
  "if (!args.includes('--json')) { console.error('missing json'); process.exit(4); }",
  "if (args[args.indexOf('--sandbox') + 1] !== 'read-only') { console.error('missing read-only sandbox'); process.exit(5); }",
  "if (!prompt.includes('Plan the requested code change')) { console.error('missing fixed prompt'); process.exit(6); }",
  "if (!prompt.includes('Do not edit files')) { console.error('missing no-edit instruction'); process.exit(7); }",
  "if (!prompt.includes('Requested goal: Add immutable patch proposal artifacts.')) { console.error('missing goal'); process.exit(8); }",
  "if (!prompt.includes('Constraints: Keep the worktree untouched.')) { console.error('missing constraints'); process.exit(9); }",
  "if (!prompt.includes('Risk attention floor: high.')) { console.error('missing severity floor'); process.exit(10); }",
  "console.log(JSON.stringify({",
  "  summary: 'Plan generated for immutable patch proposals.',",
  "  steps: [{",
  "    title: 'Add patch proposal artifact model',",
  "    rationale: 'Store generated patches for review before application.',",
  "    files: ['apps/server/src/services/tools.mjs'],",
  "    risk: 'medium'",
  "  }],",
  "  openQuestions: ['Which review state marks a proposal applyable?'],",
  "  verification: ['node tools/dev/codex-plan-smoke.mjs']",
  "}));",
].join("\n"));

try {
  start("server", process.execPath, ["apps/server/src/index.mjs"], {
    SERVER_PORT: String(serverPort),
    MYAGENTTOOL_PROJECT_PATH: repoPath,
    MYAGENTTOOL_STATE_PATH: statePath,
    MYAGENTTOOL_STATE_DISABLED: "1",
  });
  await waitForServer();
  ok("server started with an isolated smoke project");

  start("desktop", process.execPath, ["apps/desktop/src/index.mjs"], {
    BRIDGE_SERVER_URL: serverUrl,
    BRIDGE_POLL_INTERVAL_MS: "100",
    MYAGENTTOOL_CODEX_COMMAND: fakeCodexPath,
    CODEX_PLAN_SMOKE_CAPTURE: codexCapturePath,
  });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device?.status === "online" ? state : false;
  }, "desktop bridge registration");
  ok("desktop bridge registered");

  const initialState = await request("GET", "/api/state");
  const branchName = `myagenttool/codex-plan-smoke-${Date.now().toString(36)}`;
  const worktreeCreated = await request("POST", "/api/worktrees", {
    name: "codex-plan-smoke",
    branchName,
    projectId: initialState.currentProject.id,
  });
  ok("worktree created for governed planning");

  const registration = createCodexPlanAgentRegistration({
    wrapperScriptPath: resolve("tools/agents/codex-plan-wrapper.mjs"),
    costOwner: "team_smoke_ops",
  });
  const registered = await request("POST", "/api/agents", registration);
  assert(registered.agent.id === "agt_codex_plan_change", "codex plan agent should register with deterministic id");
  assert(registered.agent.status === "available", "codex plan agent should be available while bridge is online");
  ok("governed codex.plan.change agent registered");

  const tools = await request("GET", "/api/tools");
  const codexPlanTool = tools.tools.find((item) => item.name === "codex.plan.change");
  assert(codexPlanTool, "codex.plan.change should be discoverable");
  assert(codexPlanTool.outputCollection === "codexChangePlans", "codex plan output collection should be advertised");
  assert(!JSON.stringify(codexPlanTool).includes("codex-plan-wrapper.mjs"), "tool discovery must not expose wrapper argv");
  ok("tool discovery exposes the governed plan channel without raw argv");

  const missingProjectAfterRegistration = await rawRequest("POST", "/api/tools/codex.plan.change/invocations", {
    worktreeId: worktreeCreated.worktree.id,
    goal: "This should not run.",
  });
  assert(missingProjectAfterRegistration.status === 400, "missing projectId should be rejected after registration");
  assert(missingProjectAfterRegistration.body.error === "project_required", "plan facade should require projectId");
  ok("tool facade rejects unscoped planning before invocation creation");

  const created = await request("POST", "/api/tools/codex.plan.change/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    goal: "Add immutable patch proposal artifacts.",
    constraints: "Keep the worktree untouched.",
    severityFloor: "high",
  });
  assert(created.tool === "codex.plan.change", "tool invocation should identify the tool");
  assert(created.outputCollection === "codexChangePlans", "tool invocation should advertise the import collection");
  ok("tool facade created a governed planning invocation");

  const finalState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === created.invocationId);
    if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation?.status)) {
      const events = state.events
        .filter((item) => item.invocationId === created.invocationId)
        .map((item) => ({ type: item.type, level: item.level, message: item.message, data: item.data ?? null }));
      throw new Error(`codex.plan.change invocation ended unexpectedly: ${JSON.stringify({ status: invocation.status, result: invocation.result, events }, null, 2)}`);
    }
    const plan = state.codexChangePlans.find((item) => item.invocationId === created.invocationId);
    return invocation?.status === "succeeded" && plan ? state : false;
  }, "codex plan completion and import", 15_000);
  ok("desktop bridge completed the wrapper run and imported the change plan");

  const finalInvocation = finalState.invocations.find((item) => item.id === created.invocationId);
  const finalPlan = finalState.codexChangePlans.find((item) => item.invocationId === created.invocationId);
  assert(finalInvocation.options.metadata.worktreePath === worktreeCreated.worktree.worktreePath, "invocation metadata should carry the governed worktree path");
  assert(finalPlan.summary === "Plan generated for immutable patch proposals.", "imported plan should preserve summary");
  assert(finalPlan.steps[0].title === "Add patch proposal artifact model", "imported plan should preserve steps");
  assert(finalPlan.raw === undefined, "public state should strip raw plan payloads");
  ok("public state exposes the plan without raw payloads");

  const capture = await waitFor(() => readJsonFile(codexCapturePath), "fake Codex capture");
  assert(resolve(capture.cwd) === resolve(worktreeCreated.worktree.worktreePath), "wrapper should run Codex in the selected worktree");
  assert(capture.args.includes("--sandbox") && capture.args[capture.args.indexOf("--sandbox") + 1] === "read-only", "wrapper should force read-only sandbox");
  assert(capture.prompt.includes("Add immutable patch proposal artifacts."), "wrapper should pass the approved goal");
  assert(capture.prompt.includes("Keep the worktree untouched."), "wrapper should pass the approved constraints");
  ok("wrapper received governed plan parameters and read-only sandbox");

  const recordedEvent = finalState.events.find((item) => item.invocationId === created.invocationId && item.type === "codex_change_plan_recorded");
  assert(recordedEvent, "completion should record a codex change plan import event");
  console.log(`\ncodex-plan-smoke: ${passed} checks passed`);
} finally {
  for (const child of children.reverse()) {
    child.kill();
  }
  if (resolve(tempRoot).startsWith(resolve(tmpdir()))) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
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
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
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
  const response = await rawRequest(method, path, body);
  if (response.ok) {
    return response.body;
  }
  throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(response.body)}`);
}

async function rawRequest(method, path, body = undefined) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { ok: response.ok, status: response.status, body: data };
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
