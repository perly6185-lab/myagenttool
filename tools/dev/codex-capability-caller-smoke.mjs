// Demo: an internal caller agent consumes Codex as an OPEN CAPABILITY API.
//
// This is the "A" proof for "开放 API 给内部其他应用/agent 使用" — it shows the
// existing chain already works end to end WITHOUT any new code:
//
//   1. Platform setup (operator): boot server + bridge, register the governed
//      `codex.review.diff` agent. The caller does NOT do this — it only consumes.
//   2. internalCallerAgent(): a black-box consumer that speaks ONLY the capability
//      layer HTTP surface. It never imports a Codex module, never knows the wrapper
//      argv, never touches /api/tools. It:
//        a. DISCOVERS the capability from the catalog   GET  /api/capabilities
//        b. READS its machine-readable input contract   GET  /api/capabilities/<name>
//        c. INVOKES it                                   POST /api/capabilities/<name>/invocations
//        d. READS the findings back                      GET  /api/review-findings
//
// The distinction from tool-registry-review-client(-smoke): that client uses
// /api/tools. This demo proves the *capability* layer — the superset that also
// carries actor tenancy scoping and the capability_not_granted refusal model — is
// a working open API for internal callers today.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import { createCodexReviewAgentRegistration } from "../../apps/server/src/services/codex-agent.mjs";

const CAPABILITY_NAME = "codex.review.diff";

const serverPort = process.env.CODEX_CAPABILITY_SMOKE_PORT
  ? Number(process.env.CODEX_CAPABILITY_SMOKE_PORT)
  : await freePort();
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-codex-capability-smoke-${Date.now()}`);
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
runGit(["config", "user.email", "codex-capability-smoke@example.test"], repoPath);
runGit(["config", "user.name", "Codex Capability Smoke"], repoPath);
writeFileSync(join(repoPath, "README.md"), "# Codex capability caller smoke\n");
runGit(["add", "README.md"], repoPath);
runGit(["commit", "-m", "seed codex capability smoke repo"], repoPath);

// Deterministic fake Codex CLI — same fixture shape as codex-tool-smoke so the
// bridge parses JSONL findings without a live model call.
const fakeCodexPath = join(fixtureDir, "codex-review-fixture.mjs");
writeFileSync(fakeCodexPath, [
  "import { writeFileSync } from 'node:fs';",
  "const args = process.argv.slice(2);",
  "const prompt = args.at(-1) ?? '';",
  "writeFileSync(process.env.CODEX_CAPABILITY_SMOKE_CAPTURE, JSON.stringify({ cwd: process.cwd(), args, prompt }, null, 2));",
  "if (!args.includes('exec')) { console.error('missing exec'); process.exit(3); }",
  "if (!prompt.includes('Only include findings at or above severity floor: medium')) { console.error('missing severity floor'); process.exit(6); }",
  "if (!prompt.includes('Internal caller agent requested this review.')) { console.error('missing instruction'); process.exit(7); }",
  "console.log(JSON.stringify({",
  "  summary: 'Review found 1 issue.',",
  "  findings: [{",
  "    severity: 'high',",
  "    file: 'apps/server/src/services/capabilities.mjs',",
  "    line: 71,",
  "    message: 'Confirm tenancy before dispatching application capability.',",
  "    suggestion: 'Keep the visibleApplications gate.',",
  "    confidence: 'high'",
  "  }]",
  "}));",
].join("\n"));

try {
  // ---- Platform setup (operator, not the caller) -------------------------
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
    CODEX_CAPABILITY_SMOKE_CAPTURE: codexCapturePath,
  });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device?.status === "online" ? state : false;
  }, "desktop bridge registration");
  ok("desktop bridge registered");

  const initialState = await request("GET", "/api/state");
  const branchName = `myagenttool/codex-capability-smoke-${Date.now().toString(36)}`;
  const worktreeCreated = await request("POST", "/api/worktrees", {
    name: "codex-capability-smoke",
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
  ok("operator registered the governed codex.review.diff agent");

  // ---- Internal caller agent (consumes the open capability API only) ------
  const result = await internalCallerAgent({
    projectId: worktreeCreated.project.id,
    worktreeId: worktreeCreated.worktree.id,
  });

  assert(result.findings.length === 1, "caller should read exactly one imported finding");
  assert(result.findings[0].source === "codex", "finding should be attributed to the Codex source");
  assert(result.findings[0].file === "apps/server/src/services/capabilities.mjs", "finding should carry the fixture file");
  assert(result.findings[0].raw === undefined, "caller must never see raw finding payloads");
  ok("internal caller read Codex findings back through the public read model");

  // The wrapper argv (the real local command) must never be reachable by a caller
  // that only speaks the capability API — that is the whole point of "governed".
  assert(!JSON.stringify(result.catalogEntry).includes("codex-review-wrapper.mjs"), "catalog must not leak wrapper argv");
  assert(!JSON.stringify(result.detail).includes("codex-review-wrapper.mjs"), "capability detail must not leak wrapper argv");
  ok("capability catalog + detail expose the contract without raw argv");

  // Prove the fake Codex actually ran in the governed worktree with governed args.
  const capture = await waitFor(() => readJsonFile(codexCapturePath), "fake Codex capture");
  assert(resolve(capture.cwd) === resolve(worktreeCreated.worktree.worktreePath), "Codex ran in the selected worktree");
  assert(capture.prompt.includes("Internal caller agent requested this review."), "caller instruction reached the wrapper");
  ok("capability invocation drove the governed wrapper in the right worktree");

  console.log(`\ncodex-capability-caller-smoke: ${passed} checks passed`);
} finally {
  for (const child of children.reverse()) {
    child.kill();
  }
  if (resolve(tempRoot).startsWith(resolve(tmpdir()))) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

// A minimal internal caller. It knows the capability NAME and its project/worktree
// scope — nothing about Codex internals. Everything else is discovered at runtime.
async function internalCallerAgent({ projectId, worktreeId }) {
  // (a) Discover the capability from the shared catalog.
  const catalog = await request("GET", "/api/capabilities?providerType=tool");
  const catalogEntry = catalog.capabilities.find((capability) => capability.name === CAPABILITY_NAME);
  assert(catalogEntry, `caller should discover ${CAPABILITY_NAME} in the capability catalog`);
  assert(catalogEntry.provider?.type === "tool", "discovered capability should declare its provider type");
  assert(catalogEntry.status === "available", "discovered capability should be available");
  ok("caller discovered Codex via GET /api/capabilities");

  // (b) Read the machine-readable input contract before building a request.
  const detail = await request("GET", `/api/capabilities/${encodeURIComponent(CAPABILITY_NAME)}`);
  const schema = detail.capability?.inputSchema;
  assert(schema && schema.type === "object", "capability detail should expose an input schema");
  assert((schema.required ?? []).includes("worktreeId"), "input schema should mark worktreeId as required");
  ok("caller read the input contract from GET /api/capabilities/<name>");

  // (c) Invoke through the capability layer (NOT /api/tools).
  const invoked = await request("POST", `/api/capabilities/${encodeURIComponent(CAPABILITY_NAME)}/invocations`, {
    projectId,
    worktreeId,
    instruction: "Internal caller agent requested this review.",
    severityFloor: "medium",
  });
  assert(invoked.capability === CAPABILITY_NAME || invoked.tool === CAPABILITY_NAME, "invocation response should identify the capability");
  assert(invoked.invocationId, "invocation response should carry an invocationId to poll");
  assert(invoked.outputCollection === "codexReviewFindings", "response should advertise where findings land");
  ok("caller invoked Codex via POST /api/capabilities/<name>/invocations");

  // (d) Poll until the invocation completes and findings are queryable.
  const findings = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === invoked.invocationId);
    if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation?.status)) {
      throw new Error(`capability invocation ended unexpectedly: ${invocation.status}`);
    }
    if (invocation?.status !== "succeeded") return false;
    const query = await request("GET", `/api/review-findings?invocationId=${encodeURIComponent(invoked.invocationId)}&source=codex`);
    return query.count >= 1 ? query.reviewFindings : false;
  }, "capability invocation completion and finding import", 15_000);
  ok("caller polled the invocation to completion");

  return { catalogEntry, detail, invocationId: invoked.invocationId, findings };
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
