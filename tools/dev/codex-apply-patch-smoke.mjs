import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import {
  createCodexApplyPatchAgentRegistration,
  createCodexPatchProposalAgentRegistration,
  createCodexPlanAgentRegistration,
} from "../../apps/server/src/services/codex-agent.mjs";

const serverPort = process.env.CODEX_APPLY_PATCH_SMOKE_PORT
  ? Number(process.env.CODEX_APPLY_PATCH_SMOKE_PORT)
  : await freePort();
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-codex-apply-patch-smoke-${Date.now()}`);
const repoPath = join(tempRoot, "source");
const fixtureDir = join(tempRoot, "fixtures");
const statePath = join(tempRoot, "state.json");
const codexCapturePath = join(tempRoot, "codex-apply-patch-capture.json");
const children = [];
let passed = 0;

const ok = (message) => {
  passed += 1;
  console.log(`  ok - ${message}`);
};

mkdirSync(repoPath, { recursive: true });
mkdirSync(fixtureDir, { recursive: true });
runGit(["init", "-b", "main"], repoPath);
runGit(["config", "user.email", "codex-apply-patch-smoke@example.test"], repoPath);
runGit(["config", "user.name", "Codex Apply Patch Smoke"], repoPath);
writeFileSync(join(repoPath, "README.md"), "# Codex apply patch smoke\n", "utf8");
runGit(["add", "README.md"], repoPath);
runGit(["commit", "-m", "seed codex apply patch smoke repo"], repoPath);

const fakeCodexPath = join(fixtureDir, "codex-apply-patch-fixture.mjs");
writeFileSync(fakeCodexPath, [
  "import { writeFileSync } from 'node:fs';",
  "const args = process.argv.slice(2);",
  "const prompt = args.at(-1) ?? '';",
  "writeFileSync(process.env.CODEX_APPLY_PATCH_SMOKE_CAPTURE, JSON.stringify({ cwd: process.cwd(), args, prompt }, null, 2));",
  "if (!args.includes('exec')) { console.error('missing exec'); process.exit(3); }",
  "if (!args.includes('--json')) { console.error('missing json'); process.exit(4); }",
  "if (args[args.indexOf('--sandbox') + 1] !== 'read-only') { console.error('missing read-only sandbox'); process.exit(5); }",
  "if (prompt.includes('Plan the requested code change')) {",
  "  console.log(JSON.stringify({",
  "    summary: 'Plan generated for apply smoke.',",
  "    steps: [{ title: 'Patch README', rationale: 'Exercise the governed apply gate.', files: ['README.md'], risk: 'medium' }],",
  "    openQuestions: [],",
  "    verification: ['node tools/dev/codex-apply-patch-smoke.mjs']",
  "  }));",
  "} else if (prompt.includes('Generate a patch proposal')) {",
  "  if (!prompt.includes('Base change plan id: cpl_demo_')) { console.error('missing base plan id'); process.exit(6); }",
  "  console.log(JSON.stringify({",
  "    summary: 'Patch proposal generated for apply smoke.',",
  "    files: [{ path: 'README.md', changeType: 'modify', risk: 'medium' }],",
  "    diff: 'diff --git a/README.md b/README.md\\n--- a/README.md\\n+++ b/README.md\\n@@ -1 +1 @@\\n-# Codex apply patch smoke\\n+# Codex apply patch smoke ready\\n',",
  "    verification: ['node tools/dev/codex-apply-patch-smoke.mjs']",
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
    CODEX_APPLY_PATCH_SMOKE_CAPTURE: codexCapturePath,
  });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device?.status === "online" ? state : false;
  }, "desktop bridge registration");
  ok("desktop bridge registered");

  const initialState = await request("GET", "/api/state");
  const branchName = `myagenttool/codex-apply-patch-smoke-${Date.now().toString(36)}`;
  const worktreeCreated = await request("POST", "/api/worktrees", {
    name: "codex-apply-patch-smoke",
    branchName,
    projectId: initialState.currentProject.id,
  });
  const initialWorktreeReadme = readFileSync(join(worktreeCreated.worktree.worktreePath, "README.md"), "utf8");
  ok("worktree created for governed patch apply");

  await request("POST", "/api/agents", createCodexPlanAgentRegistration({
    wrapperScriptPath: resolve("tools/agents/codex-plan-wrapper.mjs"),
    costOwner: "team_smoke_ops",
  }));
  await request("POST", "/api/agents", createCodexPatchProposalAgentRegistration({
    wrapperScriptPath: resolve("tools/agents/codex-patch-proposal-wrapper.mjs"),
    costOwner: "team_smoke_ops",
  }));
  const registeredApply = await request("POST", "/api/agents", createCodexApplyPatchAgentRegistration({
    wrapperScriptPath: resolve("tools/agents/codex-apply-patch-wrapper.mjs"),
    costOwner: "team_smoke_ops",
  }));
  assert(registeredApply.agent.id === "agt_codex_apply_patch", "codex apply patch agent should register with deterministic id");
  ok("governed Codex plan, proposal, and apply agents registered");

  const tools = await request("GET", "/api/tools");
  const applyTool = tools.tools.find((item) => item.name === "codex.apply.patch");
  assert(applyTool, "codex.apply.patch should be discoverable");
  assert(applyTool.outputCollection === "codexPatchProposals", "apply output collection should be advertised");
  assert(!JSON.stringify(applyTool).includes("codex-apply-patch-wrapper.mjs"), "tool discovery must not expose apply wrapper argv");
  ok("tool discovery exposes the governed apply channel without raw argv");

  const planCreated = await request("POST", "/api/tools/codex.plan.change/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    goal: "Plan a tiny README patch for apply smoke.",
    constraints: "Keep the plan bounded.",
    severityFloor: "medium",
  });
  const stateWithPlan = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const plan = state.codexChangePlans.find((item) => item.invocationId === planCreated.invocationId);
    return plan ? state : false;
  }, "change plan import", 15_000);
  const basePlan = stateWithPlan.codexChangePlans.find((item) => item.invocationId === planCreated.invocationId);

  const proposalCreated = await request("POST", "/api/tools/codex.propose.patch/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    goal: "Generate a reviewable README patch for apply smoke.",
    constraints: "Do not apply the patch.",
    basePlanId: basePlan.id,
    maxFiles: 4,
  });
  const stateWithProposal = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === proposalCreated.invocationId);
    if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation?.status)) {
      throw new Error(`codex.propose.patch invocation ended unexpectedly: ${JSON.stringify(invocation?.result)}`);
    }
    const proposal = state.codexPatchProposals.find((item) => item.invocationId === proposalCreated.invocationId);
    return invocation?.status === "succeeded" && proposal ? state : false;
  }, "patch proposal import", 15_000);
  const proposal = stateWithProposal.codexPatchProposals.find((item) => item.invocationId === proposalCreated.invocationId);
  ok("patch proposal imported before apply");

  const unreviewedApply = await rawRequest("POST", "/api/tools/codex.apply.patch/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    proposalId: proposal.id,
    patchSha256: proposal.patchSha256,
  });
  assert(unreviewedApply.status === 409, "generated proposal should not be apply-eligible");
  assert(unreviewedApply.body.error === "proposal_not_approved", "unreviewed proposal should be rejected before approval request");
  assert(
    readFileSync(join(worktreeCreated.worktree.worktreePath, "README.md"), "utf8") === initialWorktreeReadme,
    "unreviewed apply must not mutate the worktree",
  );
  ok("generated proposal is blocked before local apply approval");

  const reviewed = await request("POST", `/api/tools/codex.propose.patch/proposals/${encodeURIComponent(proposal.id)}/review`, {
    action: "approve",
  });
  assert(reviewed.proposal.reviewState === "approved", "proposal review should approve the patch artifact");

  const approvalRequired = await request("POST", "/api/tools/codex.apply.patch/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    proposalId: proposal.id,
    patchSha256: proposal.patchSha256,
  });
  assert(approvalRequired.status === "waiting_for_local_approval", "first apply request should create a local approval request");
  assert(approvalRequired.approvalRequestRequired === true, "apply response should mark approval required");
  assert(approvalRequired.approvalRequestId, "apply approval request id should be returned");
  ok("approved proposal requests local apply approval");

  const notApproved = await rawRequest("POST", "/api/tools/codex.apply.patch/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    proposalId: proposal.id,
    patchSha256: proposal.patchSha256,
    approvalRequestId: approvalRequired.approvalRequestId,
  });
  assert(notApproved.status === 409, "pending local approval should not dispatch apply");
  assert(notApproved.body.error === "approval_not_approved", "pending approval should be rejected with approval_not_approved");

  const approved = await request("POST", `/api/approvals/${encodeURIComponent(approvalRequired.approvalRequestId)}/approve`, {});
  assert(approved.approval.status === "approved", "local apply approval should be approved through the normal approval route");

  const applyCreated = await request("POST", "/api/tools/codex.apply.patch/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    proposalId: proposal.id,
    patchSha256: proposal.patchSha256,
    approvalRequestId: approvalRequired.approvalRequestId,
  });
  assert(applyCreated.tool === "codex.apply.patch", "apply invocation should identify the apply tool");
  assert(applyCreated.agentId === "agt_codex_apply_patch", "apply invocation should target the governed apply agent");
  ok("approved local apply request dispatched to Desktop Bridge");

  const appliedState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === applyCreated.invocationId);
    if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation?.status)) {
      throw new Error(`codex.apply.patch invocation ended unexpectedly: ${JSON.stringify(invocation?.result)}`);
    }
    const appliedProposal = state.codexPatchProposals.find((item) => item.id === proposal.id && item.reviewState === "applied");
    return invocation?.status === "succeeded" && appliedProposal ? state : false;
  }, "patch apply completion", 15_000);
  ok("Desktop Bridge applied the approved patch and imported apply evidence");

  const applyInvocation = appliedState.invocations.find((item) => item.id === applyCreated.invocationId);
  const appliedProposal = appliedState.codexPatchProposals.find((item) => item.id === proposal.id);
  const readme = readFileSync(join(worktreeCreated.worktree.worktreePath, "README.md"), "utf8");
  assert(normalizeLineEndings(readme) === "# Codex apply patch smoke ready\n", "approved apply should mutate the selected worktree");
  assert(appliedProposal.reviewState === "applied", "proposal review state should become applied");
  assert(appliedProposal.appliedInvocationId === applyCreated.invocationId, "proposal should link to the apply invocation");
  assert(appliedProposal.applyResult?.files?.includes("README.md"), "apply result should include touched files");
  assert(applyInvocation.options?.metadata?.patchFilePath, "apply invocation metadata should carry a server-created temp patch path");
  assert(
    appliedState.events.some((item) => item.invocationId === applyCreated.invocationId && item.type === "codex_patch_proposal_applied"),
    "apply completion should record audit evidence",
  );
  ok("public state exposes applied proposal status, touched files, and audit evidence");

  const secondApply = await rawRequest("POST", "/api/tools/codex.apply.patch/invocations", {
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
    proposalId: proposal.id,
    patchSha256: proposal.patchSha256,
    approvalRequestId: approvalRequired.approvalRequestId,
  });
  assert(secondApply.status === 409, "already applied proposal should not dispatch a second apply");
  assert(secondApply.body.error === "proposal_not_approved", "applied proposals leave the approved-only apply state");
  assert(secondApply.body.reviewState === "applied", "second apply response should expose applied review state");
  ok("second apply attempt is blocked after proposal is applied");

  const capture = await waitFor(() => readJsonFile(codexCapturePath), "fake Codex capture");
  assert(resolve(capture.cwd) === resolve(worktreeCreated.worktree.worktreePath), "proposal wrapper should run in the selected worktree");
  assert(capture.args.includes("--sandbox") && capture.args[capture.args.indexOf("--sandbox") + 1] === "read-only", "proposal wrapper should force read-only sandbox");

  console.log(`\ncodex-apply-patch-smoke: ${passed} checks passed`);
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
  if (response.ok) return response.body;
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
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function normalizeLineEndings(value) {
  return String(value ?? "").replace(/\r\n/g, "\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
