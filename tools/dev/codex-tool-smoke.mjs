import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import { createCodexReviewAgentRegistration } from "../../apps/server/src/services/codex-agent.mjs";

const serverPort = process.env.CODEX_TOOL_SMOKE_PORT
  ? Number(process.env.CODEX_TOOL_SMOKE_PORT)
  : await freePort();
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-codex-tool-smoke-${Date.now()}`);
const repoPath = join(tempRoot, "source");
const fixtureDir = join(tempRoot, "fixtures");
const statePath = join(tempRoot, "state.json");
const codexCapturePath = join(tempRoot, "codex-capture.json");
const children = [];
let passed = 0;

const ok = (message) => {
  passed += 1;
  console.log(`  ok - ${message}`);
};

mkdirSync(repoPath, { recursive: true });
mkdirSync(fixtureDir, { recursive: true });
runGit(["init", "-b", "main"], repoPath);
runGit(["config", "user.email", "codex-tool-smoke@example.test"], repoPath);
runGit(["config", "user.name", "Codex Tool Smoke"], repoPath);
writeFileSync(join(repoPath, "README.md"), "# Codex tool smoke\n");
runGit(["add", "README.md"], repoPath);
runGit(["commit", "-m", "seed codex tool smoke repo"], repoPath);

const fakeCodexPath = join(fixtureDir, "codex-review-fixture.mjs");
writeFileSync(fakeCodexPath, [
  "import { writeFileSync } from 'node:fs';",
  "const args = process.argv.slice(2);",
  "const prompt = args.at(-1) ?? '';",
  "writeFileSync(process.env.CODEX_TOOL_SMOKE_CAPTURE, JSON.stringify({ cwd: process.cwd(), args, prompt }, null, 2));",
  "if (!args.includes('exec')) { console.error('missing exec'); process.exit(3); }",
  "if (!args.includes('--json')) { console.error('missing json'); process.exit(4); }",
  "if (!prompt.includes('Review the current worktree diff')) { console.error('missing fixed prompt'); process.exit(5); }",
  "if (!prompt.includes('Only include findings at or above severity floor: medium')) { console.error('missing severity floor'); process.exit(6); }",
  "if (!prompt.includes('Focus on smoke-test correctness.')) { console.error('missing instruction'); process.exit(7); }",
  "console.log(JSON.stringify({",
  "  summary: 'Review found 1 issue.',",
  "  findings: [{",
  "    severity: 'high',",
  "    file: 'apps/server/src/routes/tools.mjs',",
  "    line: 34,",
  "    message: 'Guard project before invocation.',",
  "    suggestion: 'Resolve project through facade.',",
  "    confidence: 'medium'",
  "  }]",
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
    CODEX_TOOL_SMOKE_CAPTURE: codexCapturePath,
  });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device?.status === "online" ? state : false;
  }, "desktop bridge registration");
  ok("desktop bridge registered");

  const initialState = await request("GET", "/api/state");
  const branchName = `myagenttool/codex-tool-smoke-${Date.now().toString(36)}`;
  const worktreeCreated = await request("POST", "/api/worktrees", {
    name: "codex-tool-smoke",
    branchName,
    projectId: initialState.currentProject.id,
  });
  ok("worktree created for governed review");

  const registration = createCodexReviewAgentRegistration({
    wrapperScriptPath: resolve("tools/agents/codex-review-wrapper.mjs"),
    costOwner: "team_smoke_ops",
  });
  const registered = await request("POST", "/api/agents", registration);
  assert(registered.agent.id === "agt_codex_review_diff", "codex review agent should register with deterministic id");
  assert(registered.agent.status === "available", "codex review agent should be available while bridge is online");
  ok("governed codex.review.diff agent registered");

  const tools = await request("GET", "/api/tools");
  const codexTool = tools.tools.find((item) => item.name === "codex.review.diff");
  assert(codexTool, "codex.review.diff should be discoverable");
  assert(!JSON.stringify(codexTool).includes("codex-review-wrapper.mjs"), "tool discovery must not expose wrapper argv");
  ok("tool discovery exposes the governed channel without raw argv");

  const created = await request("POST", "/api/tools/codex.review.diff/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    instruction: "Focus on smoke-test correctness.",
    severityFloor: "medium",
  });
  assert(created.tool === "codex.review.diff", "tool invocation should identify the tool");
  assert(created.outputCollection === "codexReviewFindings", "tool invocation should advertise the import collection");
  ok("tool facade created a governed invocation");

  const finalState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === created.invocationId);
    if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation?.status)) {
      throw new Error(`codex.review.diff invocation ended unexpectedly: ${invocation.status}`);
    }
    const finding = state.codexReviewFindings.find((item) => item.invocationId === created.invocationId);
    return invocation?.status === "succeeded" && finding ? state : false;
  }, "codex review completion and finding import", 15_000);
  ok("desktop bridge completed the wrapper run and imported findings");

  const finalInvocation = finalState.invocations.find((item) => item.id === created.invocationId);
  const finalFinding = finalState.codexReviewFindings.find((item) => item.invocationId === created.invocationId);
  const unifiedFinding = finalState.reviewFindings.find((item) => item.invocationId === created.invocationId);
  assert(finalInvocation.options.metadata.worktreePath === worktreeCreated.worktree.worktreePath, "invocation metadata should carry the governed worktree path");
  assert(finalFinding.severity === "high", "imported finding should preserve severity");
  assert(finalFinding.file === "apps/server/src/routes/tools.mjs", "imported finding should preserve file");
  assert(finalFinding.raw === undefined, "public state should strip raw finding payloads");
  assert(unifiedFinding.source === "codex", "unified reviewFindings should include Codex findings");
  assert(unifiedFinding.raw === undefined, "unified reviewFindings should strip raw finding payloads");
  ok("public state exposes provider-specific and unified findings without raw payloads");

  const queriedFindings = await request("GET", `/api/review-findings?invocationId=${encodeURIComponent(created.invocationId)}&source=codex`);
  assert(queriedFindings.count === 1, "review finding query should return the Codex finding");
  assert(queriedFindings.reviewFindings[0].id === unifiedFinding.id, "query should return the unified finding row");
  assert(queriedFindings.reviewFindings[0].raw === undefined, "query should not expose raw finding payloads");
  ok("filtered review finding query returns the Codex result");

  const capture = await waitFor(() => readJsonFile(codexCapturePath), "fake Codex capture");
  assert(resolve(capture.cwd) === resolve(worktreeCreated.worktree.worktreePath), "wrapper should run Codex in the selected worktree");
  assert(capture.prompt.includes("Focus on smoke-test correctness."), "wrapper should pass the approved instruction");
  assert(capture.prompt.includes("severity floor: medium"), "wrapper should pass the approved severity floor");
  ok("wrapper received only governed review parameters");

  const recordedEvent = finalState.events.find((item) => item.invocationId === created.invocationId && item.type === "codex_review_findings_recorded");
  assert(recordedEvent, "completion should record a codex review import event");
  console.log(`\ncodex-tool-smoke: ${passed} checks passed`);
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
