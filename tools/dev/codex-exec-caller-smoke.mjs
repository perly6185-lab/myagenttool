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
const bridgeTokenPath = join(tempRoot, "bridge-token.json");
const bridgeSessionPath = join(tempRoot, "bridge-session.json");
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
  "await new Promise((resolve) => setTimeout(resolve, 1000));",
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
    MYAGENTTOOL_BRIDGE_TOKEN_PATH: bridgeTokenPath,
  });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device?.status === "online" ? state : false;
  }, "desktop bridge registration");
  ok("desktop bridge registered");
  const bridgeToken = await waitFor(
    () => readJsonFile(bridgeTokenPath)?.token ?? false,
    "desktop bridge credential",
  );
  const bridgeSessionId = await waitFor(
    () => readJsonFile(bridgeSessionPath)?.bridgeSessionId ?? false,
    "desktop bridge process session",
  );

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
    bridgeToken,
    bridgeSessionId,
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

  // Phase 3: the promote gate refuses an unreviewed changeset — no PR machinery
  // runs until every change is approved.
  const prematurePromote = await fetch(`${serverUrl}/api/codex-exec/invocations/${encodeURIComponent(result.invocationId)}/promote`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  const prematureBody = JSON.parse(await prematurePromote.text());
  assert(prematurePromote.status === 409 && prematureBody.error === "exec_changes_not_approved", "promote must be blocked before approval");
  assert((prematureBody.unapproved ?? []).some((item) => item.file === "greeting.txt"), "the gate should name the unapproved file");
  ok("promote gate blocks an unreviewed changeset");

  // Phase 2b: a human reviews the changeset. Approval is recorded and gates a
  // later promote; the review is itself trust-ledger evidence.
  const greetingChange = result.changes.find((change) => change.file === "greeting.txt");

  // Feedback → follow-up loop: a feedback review yields a ready-to-run prompt for
  // the caller to re-invoke codex.exec with the SAME worktreeId (reuse model), so
  // the fix accumulates on top of the reviewed change.
  const feedbackResp = await request("POST", "/api/codex-exec/change-reviews", {
    execChangeId: greetingChange.id,
    decision: "feedback",
    comment: "Please add a trailing newline.",
  });
  assert(feedbackResp.execChangeReview?.decision === "feedback", "feedback review should be recorded");
  const followUp = feedbackResp.execChangeReview?.followUpPrompt ?? "";
  assert(followUp.includes("greeting.txt") && followUp.includes("trailing newline"), "feedback should yield a follow-up prompt naming the change + comment");
  ok("feedback review yields a follow-up prompt for a same-worktree re-run");

  const reviewResp = await request("POST", "/api/codex-exec/change-reviews", {
    execChangeId: greetingChange.id,
    decision: "approved",
    comment: "Looks good.",
  });
  assert(reviewResp.execChangeReview?.decision === "approved", "review should record an approval");
  const reviewedState = await request("GET", "/api/state");
  const storedReview = (reviewedState.codexExecChangeReviews ?? []).find((item) => item.execChangeId === greetingChange.id);
  assert(storedReview && storedReview.decision === "approved", "approval should be queryable in public state");
  const reviewEvidence = (reviewedState.evidenceCenterRecords ?? []).find(
    (record) => record.source === "governed_codex_exec_review" && record.id === reviewResp.execChangeReview.id,
  );
  assert(reviewEvidence, "the review should surface in the Evidence Center");
  // Unknown / cross-team id is opaque (no existence leak).
  const badReview = await fetch(`${serverUrl}/api/codex-exec/change-reviews`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ execChangeId: "cec_demo_does_not_exist", decision: "approved" }),
  });
  assert(badReview.status === 400, "an unknown exec change id should be rejected");
  ok("human review of the exec changeset is recorded, queryable, and evidence-logged");

  // Phase 3: once every change is approved the gate opens. The PR machinery
  // itself needs a real remote (absent in this smoke), so we assert the gate is
  // PASSED — the response is no longer the approval refusal.
  const promoteAfter = await fetch(`${serverUrl}/api/codex-exec/invocations/${encodeURIComponent(result.invocationId)}/promote`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  const promoteBody = JSON.parse(await promoteAfter.text());
  assert(promoteBody.error !== "exec_changes_not_approved", "approval gate should be satisfied after every change is approved");
  ok(`promote gate opens after approval (downstream result: ${promoteAfter.status} ${promoteBody.error ?? "promoted"})`);

  // Full access is a distinct, explicit mode. It is accepted by the contract,
  // but the high-risk local approval gate must hold it before Desktop can launch
  // the no-sandbox Codex process.
  const fullResponse = await fetch(`${serverUrl}/api/capabilities/${encodeURIComponent(CAPABILITY_NAME)}/invocations`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: worktreeCreated.project.id, worktreeId: worktreeCreated.worktree.id, task: "anything", approvalMode: "full" }),
  });
  const fullBody = JSON.parse(await fullResponse.text());
  assert(fullResponse.status === 201 && fullBody.status === "waiting_for_local_approval", "approvalMode full must wait at the local approval gate");
  const fullState = await request("GET", "/api/state");
  const fullInvocation = fullState.invocations.find((item) => item.id === fullBody.invocationId);
  assert(fullInvocation?.options?.approvalMode === "full", "full mode must survive the capability-to-invocation bridge");
  ok("approvalMode full is accepted only behind the explicit local approval gate");

  console.log(`\ncodex-exec-caller-smoke: ${passed} checks passed`);
} finally {
  for (const child of children.reverse()) {
    child.kill();
  }
  if (resolve(tempRoot).startsWith(resolve(tmpdir()))) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function internalCallerAgent({
  projectId,
  worktreeId,
  bridgeToken,
  bridgeSessionId,
}) {
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

  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === invoked.invocationId);
    return invocation?.status === "running" && invocation.delivery?.state === "acknowledged";
  }, "active acknowledged codex.exec invocation");

  // An exec run carries its approvalMode, so a device-authenticated Codex
  // PermissionRequest hook for this active invocation is governed by the same
  // approval broker as managed sessions.
  const bridgeHeaders = {
    Authorization: `Bearer ${bridgeToken}`,
    "X-MyAgentTool-Bridge-Session": bridgeSessionId,
  };
  const benignHook = await request("POST", "/api/bridge/codex/hooks", {
    invocationId: invoked.invocationId,
    eventName: "PermissionRequest",
    toolName: "apply_patch",
    summary: "Write greeting.txt in the worktree.",
  }, bridgeHeaders);
  assert(benignHook.brokerRequest?.status === "approved", "auto mode should auto-approve a low-risk exec permission request");
  ok("exec approvalMode=auto auto-approves a low-risk Codex permission request");

  const sensitiveHook = await request("POST", "/api/bridge/codex/hooks", {
    invocationId: invoked.invocationId,
    eventName: "PermissionRequest",
    toolName: "shell",
    summary: "Read ~/.codex/auth.json to inspect the API key.",
  }, bridgeHeaders);
  assert(sensitiveHook.brokerRequest?.status === "pending", "even in auto mode a credential-shaped request must fall to manual review");
  ok("sensitive-pattern request forces manual review even under auto mode");

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

async function request(method, path, body = undefined, headers = {}) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  }
  return data;
}

async function waitFor(check, label, timeoutMs = 20_000) {
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
