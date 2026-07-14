import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import { createClaudeReviewAgentRegistration } from "../../apps/server/src/services/claude-agent.mjs";
import { createClaudeApplicationRegistration } from "../../apps/server/src/services/claude-application.mjs";

const serverPort = process.env.CLAUDE_TOOL_SMOKE_PORT
  ? Number(process.env.CLAUDE_TOOL_SMOKE_PORT)
  : await freePort();
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-claude-tool-smoke-${Date.now()}`);
const repoPath = join(tempRoot, "source");
const fixtureDir = join(tempRoot, "fixtures");
const statePath = join(tempRoot, "state.json");
const claudeCapturePath = join(tempRoot, "claude-capture.json");
const children = [];
let passed = 0;

const ok = (message) => {
  passed += 1;
  console.log(`  ok - ${message}`);
};

mkdirSync(repoPath, { recursive: true });
mkdirSync(fixtureDir, { recursive: true });
runGit(["init", "-b", "main"], repoPath);
runGit(["config", "user.email", "claude-tool-smoke@example.test"], repoPath);
runGit(["config", "user.name", "Claude Tool Smoke"], repoPath);
writeFileSync(join(repoPath, "README.md"), "# Claude tool smoke\n");
runGit(["add", "README.md"], repoPath);
runGit(["commit", "-m", "seed claude tool smoke repo"], repoPath);

const fakeClaudePath = join(fixtureDir, "claude-review-fixture.mjs");
writeFileSync(fakeClaudePath, [
  "import { writeFileSync } from 'node:fs';",
  "const args = process.argv.slice(2);",
  "const promptIndex = args.indexOf('-p') + 1;",
  "const prompt = promptIndex > 0 ? args[promptIndex] : '';",
  "writeFileSync(process.env.CLAUDE_TOOL_SMOKE_CAPTURE, JSON.stringify({ cwd: process.cwd(), args, prompt }, null, 2));",
  "if (!args.includes('--output-format') || args[args.indexOf('--output-format') + 1] !== 'stream-json') { console.error('missing stream-json'); process.exit(3); }",
  "if (!args.includes('--verbose')) { console.error('missing verbose'); process.exit(4); }",
  "if (!args.includes('--permission-mode') || args[args.indexOf('--permission-mode') + 1] !== 'plan') { console.error('missing plan mode'); process.exit(5); }",
  "if (args.includes('bypassPermissions') || args.includes('acceptEdits')) { console.error('unsafe permission leaked'); process.exit(6); }",
  "if (!prompt.includes('Review the current worktree diff')) { console.error('missing fixed prompt'); process.exit(7); }",
  "if (!prompt.includes('Only include findings at or above severity floor: medium')) { console.error('missing severity floor'); process.exit(8); }",
  "if (!prompt.includes('Focus on smoke-test correctness.')) { console.error('missing instruction'); process.exit(9); }",
  "console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: JSON.stringify({",
  "  summary: 'Review found 1 issue.',",
  "  findings: [{",
  "    severity: 'high',",
  "    file: 'apps/server/src/routes/tools.mjs',",
  "    line: 34,",
  "    message: 'Guard project before invocation.',",
  "    suggestion: 'Resolve project through facade.',",
  "    confidence: 'medium'",
  "  }]",
  "}) }] } }));",
  "console.log(JSON.stringify({ type: 'result', total_cost_usd: 0.01, model: 'claude-3-5-sonnet' }));",
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
    MYAGENTTOOL_CLAUDE_COMMAND: fakeClaudePath,
    CLAUDE_TOOL_SMOKE_CAPTURE: claudeCapturePath,
  });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device?.status === "online" ? state : false;
  }, "desktop bridge registration");
  ok("desktop bridge registered");

  const initialState = await request("GET", "/api/state");
  const branchName = `myagenttool/claude-tool-smoke-${Date.now().toString(36)}`;
  const worktreeCreated = await request("POST", "/api/worktrees", {
    name: "claude-tool-smoke",
    branchName,
    projectId: initialState.currentProject.id,
  });
  ok("worktree created for governed review");

  const registration = createClaudeReviewAgentRegistration({
    wrapperScriptPath: resolve("tools/agents/claude-review-wrapper.mjs"),
    costOwner: "team_smoke_ops",
  });
  const registered = await request("POST", "/api/agents", registration);
  assert(registered.agent.id === "agt_claude_review_diff", "claude review agent should register with deterministic id");
  assert(registered.agent.status === "available", "claude review agent should be available while bridge is online");
  ok("governed claude.review.diff agent registered");

  const applicationRegistration = await request("POST", "/api/applications/register", {
    ...createClaudeApplicationRegistration({ autoOnline: true }),
    projectId: initialState.currentProject.id,
  });
  assert(applicationRegistration.application.id === "app_claude", "Claude Application should register with deterministic id");
  assert(applicationRegistration.application.status === "active", "Claude Application should register active");
  const claudeCapability = applicationRegistration.capabilities.find((item) => item.name === "app.app_claude.review.diff");
  assert(claudeCapability, "Claude Application should expose the governed review capability");
  assert(claudeCapability.metadata.execution.mode === "tool_facade", "Claude review capability should use the governed Tool facade");
  ok("Claude Application registered with its governed review capability");

  const tools = await request("GET", "/api/tools");
  const claudeTool = tools.tools.find((item) => item.name === "claude.review.diff");
  assert(claudeTool, "claude.review.diff should be discoverable");
  assert(claudeTool.application?.id === "app_claude", "Claude Tool should link to the Claude Application");
  assert(claudeTool.application?.capability === "app.app_claude.review.diff", "Claude Tool should link to the Application capability");
  assert(!JSON.stringify(claudeTool).includes("claude-review-wrapper.mjs"), "tool discovery must not expose wrapper argv");
  ok("tool discovery links the Application channel without exposing raw argv");

  const created = await request("POST", "/api/capabilities/app.app_claude.review.diff/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    instruction: "Focus on smoke-test correctness.",
    severityFloor: "medium",
  });
  assert(created.tool === "claude.review.diff", "tool invocation should identify the tool");
  assert(created.outputCollection === "claudeReviewFindings", "tool invocation should advertise the import collection");
  ok("tool facade created a governed invocation");

  const finalState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === created.invocationId);
    const application = state.applications.find((item) => item.id === "app_claude");
    const evidence = state.evidenceCenterRecords.find((item) => item.invocationId === created.invocationId && item.type === "application_result");
    if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation?.status)) {
      throw new Error(`claude.review.diff invocation ended unexpectedly: ${invocation.status}`);
    }
    const finding = state.claudeReviewFindings.find((item) => item.invocationId === created.invocationId);
    return invocation?.status === "succeeded"
      && finding
      && application?.latestResult?.invocationId === created.invocationId
      && application.latestResult.importedRecordCount > 0
      && evidence
      ? state
      : false;
  }, "Claude Application result, evidence, and finding import", 15_000);
  ok("desktop bridge completed the Application run and imported evidence");

  const finalInvocation = finalState.invocations.find((item) => item.id === created.invocationId);
  const finalFinding = finalState.claudeReviewFindings.find((item) => item.invocationId === created.invocationId);
  const unifiedFinding = finalState.reviewFindings.find((item) => item.invocationId === created.invocationId);
  const application = finalState.applications.find((item) => item.id === "app_claude");
  const applicationEvidence = finalState.evidenceCenterRecords.find((item) => item.invocationId === created.invocationId && item.type === "application_result");
  assert(finalInvocation.options.metadata.worktreePath === worktreeCreated.worktree.worktreePath, "invocation metadata should carry the governed worktree path");
  assert(finalInvocation.options.metadata.providerType === "application", "invocation should record the Application provider type");
  assert(finalInvocation.options.metadata.applicationId === "app_claude", "invocation should record the Claude Application id");
  assert(finalInvocation.options.metadata.capability === "app.app_claude.review.diff", "invocation should record the Application capability");
  assert(finalInvocation.options.metadata.applicationAction === "tool:claude.review.diff", "invocation should record the delegated Tool action");
  assert(finalInvocation.result?.applicationResult?.invocationId === created.invocationId, "invocation should link its imported Application result");
  assert(application.latestResult.invocationId === created.invocationId, "Claude Application should expose the latest imported result");
  assert(application.latestResult.importedRecordCount > 0, "Claude Application result should include imported records");
  assert(applicationEvidence.source === "imported_application_result", "Claude Application result should enter the Evidence Center");
  ok("Application invocation lineage and Evidence Center result are complete");
  assert(finalFinding.severity === "high", "imported finding should preserve severity");
  assert(finalFinding.file === "apps/server/src/routes/tools.mjs", "imported finding should preserve file");
  assert(finalFinding.raw === undefined, "public state should strip raw finding payloads");
  assert(unifiedFinding.source === "claude", "unified reviewFindings should include Claude findings");
  assert(unifiedFinding.raw === undefined, "unified reviewFindings should strip raw finding payloads");
  ok("public state exposes provider-specific and unified Claude findings without raw payloads");

  const queriedFindings = await request("GET", `/api/review-findings?invocationId=${encodeURIComponent(created.invocationId)}&source=claude`);
  assert(queriedFindings.count === 1, "review finding query should return the Claude finding");
  assert(queriedFindings.reviewFindings[0].id === unifiedFinding.id, "query should return the unified finding row");
  assert(queriedFindings.reviewFindings[0].raw === undefined, "query should not expose raw finding payloads");
  ok("filtered review finding query returns the Claude result");

  const capture = await waitFor(() => readJsonFile(claudeCapturePath), "fake Claude capture");
  assert(resolve(capture.cwd) === resolve(worktreeCreated.worktree.worktreePath), "wrapper should run Claude in the selected worktree");
  assert(capture.prompt.includes("Focus on smoke-test correctness."), "wrapper should pass the approved instruction");
  assert(capture.prompt.includes("severity floor: medium"), "wrapper should pass the approved severity floor");
  assert(capture.args.includes("--permission-mode"), "Claude should receive a permission mode");
  assert(capture.args[capture.args.indexOf("--permission-mode") + 1] === "plan", "Claude permission mode must be plan");
  assert(!capture.args.includes("bypassPermissions"), "unsafe permission metadata must not reach Claude");
  ok("wrapper received governed review parameters and forced plan mode");

  const recordedEvent = finalState.events.find((item) => item.invocationId === created.invocationId && item.type === "claude_review_findings_recorded");
  assert(recordedEvent, "completion should record a Claude review import event");
  console.log(`\nclaude-tool-smoke: ${passed} checks passed`);
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
