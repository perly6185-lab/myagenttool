import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import {
  createCodexPatchProposalAgentRegistration,
  createCodexPlanAgentRegistration,
} from "../../apps/server/src/services/codex-agent.mjs";

const serverPort = process.env.CODEX_PATCH_PROPOSAL_SMOKE_PORT
  ? Number(process.env.CODEX_PATCH_PROPOSAL_SMOKE_PORT)
  : await freePort();
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-codex-patch-proposal-smoke-${Date.now()}`);
const repoPath = join(tempRoot, "source");
const fixtureDir = join(tempRoot, "fixtures");
const statePath = join(tempRoot, "state.json");
const codexCapturePath = join(tempRoot, "codex-patch-proposal-capture.json");
const children = [];
let passed = 0;

const ok = (message) => {
  passed += 1;
  console.log(`  ok - ${message}`);
};

mkdirSync(repoPath, { recursive: true });
mkdirSync(fixtureDir, { recursive: true });
runGit(["init", "-b", "main"], repoPath);
runGit(["config", "user.email", "codex-patch-proposal-smoke@example.test"], repoPath);
runGit(["config", "user.name", "Codex Patch Proposal Smoke"], repoPath);
writeFileSync(join(repoPath, "README.md"), "# Codex patch proposal smoke\n");
runGit(["add", "README.md"], repoPath);
runGit(["commit", "-m", "seed codex patch proposal smoke repo"], repoPath);

const fakeCodexPath = join(fixtureDir, "codex-patch-proposal-fixture.mjs");
writeFileSync(fakeCodexPath, [
  "import { writeFileSync } from 'node:fs';",
  "const args = process.argv.slice(2);",
  "const prompt = args.at(-1) ?? '';",
  "writeFileSync(process.env.CODEX_PATCH_PROPOSAL_SMOKE_CAPTURE, JSON.stringify({ cwd: process.cwd(), args, prompt }, null, 2));",
  "if (!args.includes('exec')) { console.error('missing exec'); process.exit(3); }",
  "if (!args.includes('--json')) { console.error('missing json'); process.exit(4); }",
  "if (args[args.indexOf('--sandbox') + 1] !== 'read-only') { console.error('missing read-only sandbox'); process.exit(5); }",
  "if (prompt.includes('Plan the requested code change')) {",
  "  console.log(JSON.stringify({",
  "    summary: 'Plan generated for patch proposal smoke.',",
  "    steps: [{ title: 'Add proposal model', rationale: 'Store patch text for review.', files: ['README.md'], risk: 'medium' }],",
  "    openQuestions: [],",
  "    verification: ['node tools/dev/codex-patch-proposal-smoke.mjs']",
  "  }));",
  "} else if (prompt.includes('Generate a patch proposal')) {",
  "  if (!prompt.includes('Base change plan id: cpl_demo_')) { console.error('missing base plan id'); process.exit(6); }",
  "  if (!prompt.includes('Maximum files: 4.')) { console.error('missing max files'); process.exit(7); }",
  "  console.log(JSON.stringify({",
  "    summary: 'Patch proposal generated for review.',",
  "    files: [{ path: 'README.md', changeType: 'modify', risk: 'medium' }],",
  "    diff: 'diff --git a/README.md b/README.md\\n--- a/README.md\\n+++ b/README.md\\n@@ -1 +1 @@\\n-# Codex patch proposal smoke\\n+# Codex patch proposal smoke ready\\n',",
  "    verification: ['node tools/dev/codex-patch-proposal-smoke.mjs']",
  "  }));",
  "} else {",
  "  console.error('unexpected prompt');",
  "  process.exit(8);",
  "}",
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
    CODEX_PATCH_PROPOSAL_SMOKE_CAPTURE: codexCapturePath,
  });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device?.status === "online" ? state : false;
  }, "desktop bridge registration");
  ok("desktop bridge registered");

  const initialState = await request("GET", "/api/state");
  const branchName = `myagenttool/codex-patch-proposal-smoke-${Date.now().toString(36)}`;
  const worktreeCreated = await request("POST", "/api/worktrees", {
    name: "codex-patch-proposal-smoke",
    branchName,
    projectId: initialState.currentProject.id,
  });
  ok("worktree created for governed patch proposal");

  const planRegistration = createCodexPlanAgentRegistration({
    wrapperScriptPath: resolve("tools/agents/codex-plan-wrapper.mjs"),
    costOwner: "team_smoke_ops",
  });
  const proposalRegistration = createCodexPatchProposalAgentRegistration({
    wrapperScriptPath: resolve("tools/agents/codex-patch-proposal-wrapper.mjs"),
    costOwner: "team_smoke_ops",
  });
  await request("POST", "/api/agents", planRegistration);
  const registeredProposal = await request("POST", "/api/agents", proposalRegistration);
  assert(registeredProposal.agent.id === "agt_codex_propose_patch", "codex patch proposal agent should register with deterministic id");
  ok("governed Codex plan and patch proposal agents registered");

  const tools = await request("GET", "/api/tools");
  const proposalTool = tools.tools.find((item) => item.name === "codex.propose.patch");
  assert(proposalTool, "codex.propose.patch should be discoverable");
  assert(proposalTool.outputCollection === "codexPatchProposals", "patch proposal output collection should be advertised");
  assert(!JSON.stringify(proposalTool).includes("codex-patch-proposal-wrapper.mjs"), "tool discovery must not expose wrapper argv");
  ok("tool discovery exposes the governed patch proposal channel without raw argv");

  const blockedLargeScope = await rawRequest("POST", "/api/tools/codex.propose.patch/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    goal: "This should require approval.",
    maxFiles: 16,
  });
  assert(blockedLargeScope.status === 409, "large patch proposal should be blocked before Codex runs");
  assert(blockedLargeScope.body.error === "approval_required", "large patch proposal should require approval");
  ok("tool facade blocks large patch proposals before invocation creation");

  const planCreated = await request("POST", "/api/tools/codex.plan.change/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    goal: "Plan a tiny README patch proposal.",
    constraints: "Keep the worktree untouched.",
    severityFloor: "medium",
  });
  const stateWithPlan = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const plan = state.codexChangePlans.find((item) => item.invocationId === planCreated.invocationId);
    return plan ? state : false;
  }, "change plan import", 15_000);
  const basePlan = stateWithPlan.codexChangePlans.find((item) => item.invocationId === planCreated.invocationId);
  ok("base change plan imported for proposal binding");

  const proposalCreated = await request("POST", "/api/tools/codex.propose.patch/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    goal: "Generate a reviewable README patch proposal.",
    constraints: "Do not apply the patch.",
    basePlanId: basePlan.id,
    maxFiles: 4,
  });
  assert(proposalCreated.tool === "codex.propose.patch", "tool invocation should identify the patch proposal tool");
  assert(proposalCreated.outputCollection === "codexPatchProposals", "tool invocation should advertise proposal import collection");
  ok("tool facade created a governed patch proposal invocation");

  const finalState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === proposalCreated.invocationId);
    if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation?.status)) {
      const events = state.events
        .filter((item) => item.invocationId === proposalCreated.invocationId)
        .map((item) => ({ type: item.type, level: item.level, message: item.message, data: item.data ?? null }));
      throw new Error(`codex.propose.patch invocation ended unexpectedly: ${JSON.stringify({ status: invocation.status, result: invocation.result, events }, null, 2)}`);
    }
    const proposal = state.codexPatchProposals.find((item) => item.invocationId === proposalCreated.invocationId);
    return invocation?.status === "succeeded" && proposal ? state : false;
  }, "codex patch proposal completion and import", 15_000);
  ok("desktop bridge completed the wrapper run and imported the patch proposal");

  const finalInvocation = finalState.invocations.find((item) => item.id === proposalCreated.invocationId);
  const finalProposal = finalState.codexPatchProposals.find((item) => item.invocationId === proposalCreated.invocationId);
  assert(finalInvocation.options.metadata.worktreePath === worktreeCreated.worktree.worktreePath, "invocation metadata should carry the governed worktree path");
  assert(finalProposal.summary === "Patch proposal generated for review.", "imported proposal should preserve summary");
  assert(finalProposal.files[0].path === "README.md", "imported proposal should preserve file metadata");
  assert(finalProposal.patchSha256.length === 64, "proposal should expose a patch digest");
  assert(finalProposal.immutable === true, "proposal should be immutable");
  assert(finalProposal.raw === undefined, "public state should strip raw proposal payloads");
  ok("public state exposes proposal metadata, preview, and hash without raw payloads");

  const capture = await waitFor(() => readJsonFile(codexCapturePath), "fake Codex capture");
  assert(resolve(capture.cwd) === resolve(worktreeCreated.worktree.worktreePath), "wrapper should run Codex in the selected worktree");
  assert(capture.args.includes("--sandbox") && capture.args[capture.args.indexOf("--sandbox") + 1] === "read-only", "wrapper should force read-only sandbox");
  assert(capture.prompt.includes(basePlan.id), "wrapper should pass the approved base plan id");
  assert(capture.prompt.includes("Generate a reviewable README patch proposal."), "wrapper should pass the approved goal");
  ok("wrapper received governed proposal parameters and read-only sandbox");

  const status = runGit(["status", "--porcelain"], worktreeCreated.worktree.worktreePath).trim();
  assert(status === "", `patch proposal smoke must leave worktree unchanged, got ${status}`);
  ok("patch proposal run left the worktree unchanged");

  const recordedEvent = finalState.events.find((item) => item.invocationId === proposalCreated.invocationId && item.type === "codex_patch_proposal_recorded");
  assert(recordedEvent, "completion should record a codex patch proposal import event");
  console.log(`\ncodex-patch-proposal-smoke: ${passed} checks passed`);
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
  return result.stdout;
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
