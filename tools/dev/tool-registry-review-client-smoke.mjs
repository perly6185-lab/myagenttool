import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import { createClaudeReviewAgentRegistration } from "../../apps/server/src/services/claude-agent.mjs";

const serverPort = process.env.REVIEW_CLIENT_SMOKE_PORT
  ? Number(process.env.REVIEW_CLIENT_SMOKE_PORT)
  : await freePort();
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-review-client-smoke-${Date.now()}`);
const repoPath = join(tempRoot, "source");
const fixtureDir = join(tempRoot, "fixtures");
const statePath = join(tempRoot, "state.json");
const children = [];
let passed = 0;

const ok = (message) => {
  passed += 1;
  console.log(`  ok - ${message}`);
};

mkdirSync(repoPath, { recursive: true });
mkdirSync(fixtureDir, { recursive: true });
runGit(["init", "-b", "main"], repoPath);
runGit(["config", "user.email", "review-client-smoke@example.test"], repoPath);
runGit(["config", "user.name", "Review Client Smoke"], repoPath);
writeFileSync(join(repoPath, "README.md"), "# Review client smoke\n");
runGit(["add", "README.md"], repoPath);
runGit(["commit", "-m", "seed review client smoke repo"], repoPath);

const fakeClaudePath = join(fixtureDir, "claude-review-fixture.mjs");
writeFileSync(fakeClaudePath, [
  "const args = process.argv.slice(2);",
  "const promptIndex = args.indexOf('-p') + 1;",
  "const prompt = promptIndex > 0 ? args[promptIndex] : '';",
  "if (!args.includes('--permission-mode') || args[args.indexOf('--permission-mode') + 1] !== 'plan') process.exit(3);",
  "if (!prompt.includes('External client smoke instruction.')) process.exit(4);",
  "console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: JSON.stringify({",
  "  summary: 'Review found 1 issue.',",
  "  findings: [{ severity: 'high', file: 'apps/server/src/routes/review-findings.mjs', line: 20, message: 'Keep query facade scoped.', suggestion: 'Read from public state only.', confidence: 'high' }]",
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
  ok("server started");

  start("desktop", process.execPath, ["apps/desktop/src/index.mjs"], {
    BRIDGE_SERVER_URL: serverUrl,
    BRIDGE_POLL_INTERVAL_MS: "100",
    MYAGENTTOOL_CLAUDE_COMMAND: fakeClaudePath,
  });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device?.status === "online" ? state : false;
  }, "desktop bridge registration");
  ok("desktop bridge registered");

  const initialState = await request("GET", "/api/state");
  const branchName = `myagenttool/review-client-smoke-${Date.now().toString(36)}`;
  const worktreeCreated = await request("POST", "/api/worktrees", {
    name: "review-client-smoke",
    branchName,
    projectId: initialState.currentProject.id,
  });
  ok("worktree created");

  const registration = createClaudeReviewAgentRegistration({
    wrapperScriptPath: resolve("tools/agents/claude-review-wrapper.mjs"),
    costOwner: "team_smoke_ops",
  });
  const registered = await request("POST", "/api/agents", registration);
  assert(registered.agent.id === "agt_claude_review_diff", "Claude review agent should register");
  ok("governed Claude review agent registered");

  const client = spawnSync(process.execPath, [
    "tools/dev/tool-registry-review-client.mjs",
    "--base-url",
    serverUrl,
    "--tool",
    "claude.review.diff",
    "--project-id",
    worktreeCreated.project.id,
    "--worktree-id",
    worktreeCreated.worktree.id,
    "--instruction",
    "External client smoke instruction.",
    "--severity-floor",
    "medium",
    "--timeout-ms",
    "15000",
    "--interval-ms",
    "100",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert(client.status === 0, client.stderr || client.stdout);
  const result = JSON.parse(client.stdout);
  assert(result.tool === "claude.review.diff", "client should invoke the governed Claude review tool");
  assert(result.findingCount === 1, "client should poll one review finding");
  assert(result.reviewFindings[0].source === "claude", "finding should identify Claude source");
  assert(result.reviewFindings[0].raw === undefined, "client result should not expose raw payloads");
  assert(result.reviewFindings[0].file === "apps/server/src/routes/review-findings.mjs", "finding should come from fake Claude output");
  ok("external client discovered, invoked, and polled review findings");

  console.log(`\ntool-registry-review-client-smoke: ${passed} checks passed`);
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
