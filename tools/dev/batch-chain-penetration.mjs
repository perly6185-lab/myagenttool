import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const agentFixture = path.join(repoRoot, "tools", "dev", "fixtures", "batch-chain-agent.mjs");
const verifyFixture = path.join(repoRoot, "tools", "dev", "fixtures", "batch-chain-verify.mjs");
const defaultReportPath = path.join(repoRoot, ".myagenttool", "reports", "batch-chain-penetration.json");
const terminalInvocationStatuses = new Set([
  "succeeded", "failed", "cancelled", "timed_out", "expired", "rejected",
]);
const scenarios = [
  {
    name: "baseline",
    description: "No injected fault; establishes the complete Server → Desktop → agent → verification path.",
    agentFirstDelayMs: 300,
    verifyFirstDelayMs: 200,
  },
  {
    name: "desktop_kill_running",
    description: "Hard-kill Desktop while two production-agent fixtures are running, then replace its bridge session.",
    agentFirstDelayMs: 3_000,
    verifyFirstDelayMs: 200,
  },
  {
    name: "server_kill_running",
    description: "Hard-kill Server while two agents are running, restore durable state, then replace Desktop.",
    agentFirstDelayMs: 3_000,
    verifyFirstDelayMs: 200,
  },
  {
    name: "server_kill_verifying",
    description: "Hard-kill Server during real verification and require boot reconciliation to re-drive it.",
    agentFirstDelayMs: 250,
    verifyFirstDelayMs: 4_000,
  },
  {
    name: "double_restart_idempotency",
    description: "Restart both processes, replay the batch key, restart again, and prove no duplicate Auto-runs.",
    agentFirstDelayMs: 2_500,
    verifyFirstDelayMs: 250,
  },
];

export function parseArgs(argv) {
  const options = {
    scenarioNames: scenarios.map((scenario) => scenario.name),
    reportPath: defaultReportPath,
    keepArtifacts: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--scenario") {
      const value = argv[++index];
      if (!value?.trim()) throw new Error("--scenario requires a name or comma-separated names.");
      options.scenarioNames = value === "all"
        ? scenarios.map((scenario) => scenario.name)
        : [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
      const unknown = options.scenarioNames.filter(
        (name) => !scenarios.some((scenario) => scenario.name === name),
      );
      if (unknown.length) throw new Error(`Unknown scenario(s): ${unknown.join(", ")}`);
    } else if (argument === "--report") {
      const value = argv[++index];
      if (!value?.trim()) throw new Error("--report requires a path.");
      options.reportPath = path.resolve(repoRoot, value);
    } else if (argument === "--keep-artifacts") {
      options.keepArtifacts = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (options.scenarioNames.length === 0) throw new Error("At least one scenario is required.");
  return options;
}

function usage() {
  console.log(`Usage: node tools/dev/batch-chain-penetration.mjs [options]

Options:
  --scenario <name,...>  Scenario(s), or all (default: all)
  --report <path>        JSON report path
  --keep-artifacts       Preserve isolated repositories and state
  --help                 Show this help

Scenarios:
${scenarios.map((scenario) => `  ${scenario.name.padEnd(28)} ${scenario.description}`).join("\n")}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function availablePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function initializeRepository(projectPath) {
  fs.mkdirSync(projectPath, { recursive: true });
  execFileSync("git", ["init", "-b", "main", projectPath], { stdio: "ignore" });
  execFileSync("git", ["-C", projectPath, "config", "user.email", "batch-chain@example.test"]);
  execFileSync("git", ["-C", projectPath, "config", "user.name", "Batch Chain Fixture"]);
  execFileSync("git", ["-C", projectPath, "config", "core.autocrlf", "false"]);
  fs.writeFileSync(path.join(projectPath, "README.md"), "# Batch chain penetration fixture\n");
  execFileSync("git", ["-C", projectPath, "add", "README.md"]);
  execFileSync("git", ["-C", projectPath, "commit", "-m", "test: initialize chain fixture"], {
    stdio: "ignore",
  });
}

function startManagedProcess(context, name, script, env) {
  const child = spawn(process.execPath, [script], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    detached: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const processRecord = {
    name,
    pid: child.pid,
    child,
    logs: "",
    exitCode: null,
    signal: null,
    startedAt: new Date().toISOString(),
    exitedAt: null,
  };
  const appendLog = (stream, chunk) => {
    processRecord.logs += `[${stream}] ${chunk.toString("utf8")}`;
    if (processRecord.logs.length > 80_000) processRecord.logs = processRecord.logs.slice(-80_000);
  };
  child.stdout.on("data", (chunk) => appendLog("stdout", chunk));
  child.stderr.on("data", (chunk) => appendLog("stderr", chunk));
  processRecord.exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      processRecord.exitCode = code;
      processRecord.signal = signal;
      processRecord.exitedAt = new Date().toISOString();
      resolve({ code, signal });
    });
  });
  context.processes.push(processRecord);
  return processRecord;
}

async function waitFor(check, label, {
  timeoutMs = 120_000,
  intervalMs = 100,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError?.message ?? "condition was not met"}`);
}

async function api(context, method, requestPath, body = undefined, { allowError = false } = {}) {
  const response = await fetch(`${context.serverUrl}${requestPath}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json();
  if (!allowError && !response.ok) {
    throw new Error(`${method} ${requestPath} failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return { status: response.status, data };
}

async function startServer(context) {
  const processRecord = startManagedProcess(context, `server-${context.serverStarts + 1}`, "apps/server/src/index.mjs", {
    SERVER_HOST: "127.0.0.1",
    SERVER_PORT: String(context.port),
    SERVER_DISPATCH_LEASE_MS: "5000",
    MYAGENTTOOL_STATE_PATH: context.statePath,
    MYAGENTTOOL_PROJECT_PATH: context.projectPath,
    MYAGENTTOOL_BRIDGE_SESSION_HANDOFF_GRACE_MS: "0",
    MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON: JSON.stringify([process.execPath, verifyFixture]),
    MYAGENTTOOL_AUTORUN_VERIFY_TIMEOUT_MS: "15000",
    MYAGENTTOOL_CHAIN_CONTROL_DIR: context.controlDir,
    MYAGENTTOOL_CHAIN_VERIFY_FIRST_DELAY_MS: String(context.scenario.verifyFirstDelayMs),
    MYAGENTTOOL_CHAIN_VERIFY_RETRY_DELAY_MS: "100",
  });
  context.server = processRecord;
  context.serverStarts += 1;
  await waitFor(async () => {
    if (processRecord.exitedAt) {
      throw new Error(`Server exited early (${processRecord.exitCode}): ${processRecord.logs.slice(-3000)}`);
    }
    const response = await fetch(`${context.serverUrl}/health`);
    return response.ok && (await response.json()).status === "ok";
  }, `${processRecord.name} health`, { timeoutMs: 30_000, intervalMs: 150 });
}

async function startDesktop(context) {
  const processRecord = startManagedProcess(context, `desktop-${context.desktopStarts + 1}`, "apps/desktop/src/index.mjs", {
    BRIDGE_SERVER_URL: context.serverUrl,
    BRIDGE_POLL_INTERVAL_MS: "50",
    BRIDGE_TERMINAL_POLL_INTERVAL_MS: "25",
    BRIDGE_SERVER_READY_ATTEMPTS: "240",
    BRIDGE_MAX_CONCURRENT: "2",
    MYAGENTTOOL_BRIDGE_TOKEN_PATH: context.bridgeTokenPath,
    MYAGENTTOOL_CODEX_COMMAND: "fixture",
    MYAGENTTOOL_CODEX_FIXTURE_PATH: agentFixture,
    MYAGENTTOOL_CODEX_TRANSPORT: "jsonl",
    MYAGENTTOOL_CODEX_APPROVAL_TIMEOUT_SECONDS: "3",
    MYAGENTTOOL_CHAIN_CONTROL_DIR: context.controlDir,
    MYAGENTTOOL_CHAIN_AGENT_FIRST_DELAY_MS: String(context.scenario.agentFirstDelayMs),
    MYAGENTTOOL_CHAIN_AGENT_RETRY_DELAY_MS: "150",
  });
  context.desktop = processRecord;
  context.desktopStarts += 1;
  await waitFor(async () => {
    if (processRecord.exitedAt) {
      throw new Error(`Desktop exited early (${processRecord.exitCode}): ${processRecord.logs.slice(-3000)}`);
    }
    const state = (await api(context, "GET", "/api/state")).data;
    const productionAgent = state.agents?.find((agent) => agent.id === "agt_codex_cli");
    return state.device?.status === "online" && productionAgent?.status === "available";
  }, `${processRecord.name} registration`, { timeoutMs: 30_000, intervalMs: 150 });
}

async function hardKillPrimary(processRecord, label) {
  if (!processRecord || processRecord.exitedAt) return;
  const killed = processRecord.child.kill("SIGKILL");
  assert(killed, `${label} did not accept SIGKILL`);
  const exited = await Promise.race([
    processRecord.exitPromise.then(() => true),
    sleep(5_000).then(() => false),
  ]);
  assert(exited, `${label} did not exit within 5 seconds after primary-process SIGKILL`);
}

function killTree(processRecord) {
  if (!processRecord?.pid || processRecord.exitedAt) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(processRecord.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-processRecord.pid, "SIGKILL");
  } catch {
    try {
      processRecord.child.kill("SIGKILL");
    } catch {
      // Already stopped.
    }
  }
}

async function stopManaged(processRecord) {
  if (!processRecord || processRecord.exitedAt) return;
  processRecord.child.kill("SIGTERM");
  const exited = await Promise.race([
    processRecord.exitPromise.then(() => true),
    sleep(3_000).then(() => false),
  ]);
  if (!exited) {
    killTree(processRecord);
    await Promise.race([processRecord.exitPromise, sleep(2_000)]);
  }
}

async function replayBatch(context) {
  const replay = await api(context, "POST", "/api/work-item-auto-run-batches", context.batchRequest);
  assert(replay.status === 200, `idempotent replay returned ${replay.status}`);
  assert(replay.data.replayed === true, "idempotent replay was not marked replayed");
  assert(replay.data.batch.id === context.batchId, "idempotent replay returned a different batch");
  context.idempotentReplays += 1;
}

async function currentBatch(context) {
  const listed = (await api(context, "GET", "/api/work-item-auto-run-batches")).data;
  const batch = listed.batches.find((candidate) => candidate.id === context.batchId);
  assert(batch, `batch ${context.batchId} disappeared`);
  context.maxObservedActive = Math.max(context.maxObservedActive, Number(batch.active ?? 0));
  return batch;
}

async function waitForActiveAgents(context) {
  return waitFor(async () => {
    const batch = await currentBatch(context);
    const runningAgents = readControlRecords(context.controlDir)
      .filter((record) => record.kind === "agent" && record.status === "running" && pidAlive(record.pid));
    return batch.active >= 2 && runningAgents.length >= 2 ? { batch, runningAgents } : false;
  }, `${context.scenario.name} to have two active production agents`, {
    timeoutMs: 45_000,
    intervalMs: 100,
  });
}

async function waitForVerification(context) {
  return waitFor(async () => {
    await currentBatch(context);
    const listed = (await api(context, "GET", "/api/auto-runs")).data;
    const verifying = listed.autoRuns?.filter((run) => run.status === "verifying") ?? [];
    const verifierRecords = readControlRecords(context.controlDir)
      .filter((record) => record.kind === "verify" && record.status === "running" && pidAlive(record.pid));
    return verifying.length > 0 && verifierRecords.length > 0 ? { verifying, verifierRecords } : false;
  }, `${context.scenario.name} verification`, { timeoutMs: 60_000, intervalMs: 100 });
}

async function restartServer(context) {
  await sleep(300);
  await startServer(context);
}

async function restartDesktop(context) {
  await sleep(300);
  await startDesktop(context);
}

async function injectFault(context) {
  switch (context.scenario.name) {
    case "baseline":
      return;
    case "desktop_kill_running":
      await waitForActiveAgents(context);
      context.injections.push({ type: "desktop_sigkill", at: new Date().toISOString() });
      await hardKillPrimary(context.desktop, "Desktop");
      context.desktop = null;
      await restartDesktop(context);
      await replayBatch(context);
      return;
    case "server_kill_running":
      await waitForActiveAgents(context);
      context.injections.push({ type: "server_sigkill_running", at: new Date().toISOString() });
      await hardKillPrimary(context.server, "Server");
      context.server = null;
      await restartServer(context);
      await hardKillPrimary(context.desktop, "Desktop after Server restart");
      context.desktop = null;
      await restartDesktop(context);
      await replayBatch(context);
      return;
    case "server_kill_verifying":
      await waitForVerification(context);
      context.injections.push({ type: "server_sigkill_verifying", at: new Date().toISOString() });
      await hardKillPrimary(context.server, "Server during verification");
      context.server = null;
      await restartServer(context);
      await replayBatch(context);
      return;
    case "double_restart_idempotency":
      await waitForActiveAgents(context);
      context.injections.push({ type: "desktop_server_sigkill", at: new Date().toISOString() });
      await hardKillPrimary(context.desktop, "Desktop first restart");
      context.desktop = null;
      await hardKillPrimary(context.server, "Server first restart");
      context.server = null;
      await restartServer(context);
      await restartDesktop(context);
      await replayBatch(context);
      await waitForActiveAgents(context);
      context.injections.push({ type: "server_sigkill_second", at: new Date().toISOString() });
      await hardKillPrimary(context.server, "Server second restart");
      context.server = null;
      await restartServer(context);
      await hardKillPrimary(context.desktop, "Desktop second restart");
      context.desktop = null;
      await restartDesktop(context);
      await replayBatch(context);
      return;
    default:
      throw new Error(`No injection implementation for ${context.scenario.name}`);
  }
}

async function waitForCompletedBatch(context) {
  const batch = await waitFor(async () => {
    const batch = await currentBatch(context);
    return ["completed", "completed_with_failures", "cancelled"].includes(batch.status)
      ? batch
      : false;
  }, `${context.scenario.name} batch completion`, { timeoutMs: 150_000, intervalMs: 150 });
  if (batch.status !== "completed") {
    throw new Error(`Batch settled unsuccessfully: ${JSON.stringify(batch)}`);
  }
  return batch;
}

function readControlRecords(controlDir) {
  if (!fs.existsSync(controlDir)) return [];
  return fs.readdirSync(controlDir)
    .filter((name) => /^(agent|verify)-\d+-\d+\.json$/.test(name))
    .map((name) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(controlDir, name), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function pidAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function removeScenarioRoot(root) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error?.code) || attempt === 7) throw error;
      await sleep(150 * (attempt + 1));
    }
  }
}

function processEvidence(context) {
  return context.processes.map((record) => ({
    name: record.name,
    pid: record.pid,
    exitCode: record.exitCode,
    signal: record.signal,
    startedAt: record.startedAt,
    exitedAt: record.exitedAt,
    logTail: record.logs.slice(-5_000),
  }));
}

async function runScenario(scenario, { keepArtifacts }) {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const scenarioRoot = fs.mkdtempSync(path.join(os.tmpdir(), `myagenttool-chain-${scenario.name}-`));
  const context = {
    scenario,
    scenarioRoot,
    projectPath: path.join(scenarioRoot, "project"),
    statePath: path.join(scenarioRoot, "state", "server.json"),
    bridgeTokenPath: path.join(scenarioRoot, "bridge", "token.json"),
    controlDir: path.join(scenarioRoot, "control"),
    port: await availablePort(),
    serverUrl: null,
    server: null,
    desktop: null,
    processes: [],
    serverStarts: 0,
    desktopStarts: 0,
    maxObservedActive: 0,
    idempotentReplays: 0,
    injections: [],
    batchId: null,
    batchRequest: null,
    workItemIds: [],
  };
  context.serverUrl = `http://127.0.0.1:${context.port}`;
  let status = "failed";
  let error = null;
  let finalEvidence = null;
  try {
    initializeRepository(context.projectPath);
    fs.mkdirSync(context.controlDir, { recursive: true });
    await startServer(context);
    await startDesktop(context);
    const initialState = (await api(context, "GET", "/api/state")).data;
    const project = initialState.projects?.find(
      (candidate) => path.resolve(candidate.path ?? "") === path.resolve(context.projectPath),
    ) ?? initialState.projects?.[0];
    assert(project?.id, "Default project was not registered");
    const productionAgent = initialState.agents?.find((agent) => agent.id === "agt_codex_cli");
    assert(productionAgent?.status === "available", "Canonical production agent is not available");
    assert(productionAgent.id !== "agt_demo_cli", "Demo agent must never be selected");

    for (let index = 1; index <= 5; index += 1) {
      const created = await api(context, "POST", "/api/work-items", {
        projectId: project.id,
        title: `Implement batch chain task ${index}`,
        body: `Create deterministic chain evidence for task ${index}.`,
        acceptanceCriteria: ["CHAIN_RESULT.md exists", "Configured verification passes"],
      });
      context.workItemIds.push(created.data.workItem.id);
    }
    context.batchRequest = {
      workItemIds: context.workItemIds,
      maxConcurrent: 2,
      agentId: "agt_codex_cli",
      idempotencyKey: `batch-chain-${scenario.name}`,
    };
    const createdBatch = await api(context, "POST", "/api/work-item-auto-run-batches", context.batchRequest);
    assert(createdBatch.status === 201, `batch acceptance returned ${createdBatch.status}`);
    context.batchId = createdBatch.data.batch.id;
    assert(createdBatch.data.batch.agentId === "agt_codex_cli", "Batch did not pin the production agent");
    assert(createdBatch.data.batch.maxConcurrent === 2, "Batch concurrency is not 2");
    await replayBatch(context);
    const conflict = await api(context, "POST", "/api/work-item-auto-run-batches", {
      ...context.batchRequest,
      workItemIds: [context.workItemIds[0]],
      maxConcurrent: 1,
    }, { allowError: true });
    assert(conflict.status === 409, `idempotency conflict returned ${conflict.status}`);
    assert(conflict.data?.error === "idempotency_key_conflict", "idempotency conflict was not explicit");

    await injectFault(context);
    const batch = await waitForCompletedBatch(context);
    const state = (await api(context, "GET", "/api/state")).data;
    const batchAutoRunIds = new Set(batch.items.map((item) => item.autoRunId).filter(Boolean));
    const listedAutoRuns = (await api(context, "GET", "/api/auto-runs")).data.autoRuns ?? [];
    const autoRuns = listedAutoRuns.filter((run) => batchAutoRunIds.has(run.id));
    assert(batch.total === 5, `batch total is ${batch.total}, expected 5`);
    assert(batch.completed === 5, `batch completed is ${batch.completed}, expected 5`);
    assert(batch.active === 0, `batch active is ${batch.active}, expected 0`);
    assert(batch.counts?.done === 5, `batch done count is ${batch.counts?.done}, expected 5`);
    assert(context.maxObservedActive === 2, `observed peak concurrency ${context.maxObservedActive}, expected 2`);
    assert(autoRuns.length === 5, `found ${autoRuns.length} Auto-runs for 5 work items`);
    assert(new Set(autoRuns.map((run) => run.executionChainId)).size === 5, "Duplicate Auto-run execution chains detected");
    assert(autoRuns.every((run) => run.agentId === "agt_codex_cli"), "A non-production agent handled a batch item");
    assert(autoRuns.every((run) => run.status === "done"), "Not every Auto-run reached done");
    assert(
      autoRuns.every((run) => run.verification?.verified === true && run.verification?.passed === true),
      "Not every Auto-run completed real verification",
    );
    const autoRunIds = new Set(autoRuns.map((run) => run.id));
    const relatedInvocations = (state.invocations ?? []).filter(
      (invocation) => autoRunIds.has(invocation.options?.metadata?.autoRunId),
    );
    assert(
      relatedInvocations.every((invocation) => terminalInvocationStatuses.has(invocation.status)),
      "An invocation remained active after batch completion",
    );
    const records = readControlRecords(context.controlDir);
    const agentRecords = records.filter((record) => record.kind === "agent");
    const verifyRecords = records.filter((record) => record.kind === "verify");
    assert(agentRecords.filter((record) => record.status === "completed").length >= 5, "Fewer than five agent attempts completed");
    assert(verifyRecords.filter((record) => record.status === "completed").length >= 5, "Fewer than five verification attempts completed");
    if (scenario.name !== "baseline") {
      assert(
        records.some((record) => Number(record.attempt) > 1),
        "Fault injection did not cause a recorded retry attempt",
      );
    }
    finalEvidence = {
      batch: {
        id: batch.id,
        status: batch.status,
        total: batch.total,
        completed: batch.completed,
        active: batch.active,
        counts: batch.counts,
        agentId: batch.agentId,
        agentResolution: batch.agentResolution,
      },
      autoRuns: autoRuns.map((run) => ({
        id: run.id,
        executionChainId: run.executionChainId,
        status: run.status,
        agentId: run.agentId,
        timeoutRecoveryAttempts: run.timeoutRecoveryAttempts ?? 0,
        verification: run.verification,
      })),
      invocationCount: relatedInvocations.length,
      controlRecords: records,
      eventTypes: [...new Set((state.events ?? [])
        .filter((event) => relatedInvocations.some((invocation) => invocation.id === event.invocationId))
        .map((event) => event.type))],
    };
    status = "passed";
  } catch (caught) {
    error = caught instanceof Error ? caught.stack ?? caught.message : String(caught);
  } finally {
    await stopManaged(context.desktop);
    await stopManaged(context.server);
    for (const processRecord of context.processes) killTree(processRecord);
    const records = readControlRecords(context.controlDir);
    for (let attempt = 0; attempt < 25; attempt += 1) {
      if (records.every((record) => !pidAlive(record.pid))) break;
      await sleep(100);
    }
    const residualPids = [...new Set(records.map((record) => Number(record.pid)).filter(pidAlive))];
    if (residualPids.length > 0) {
      status = "failed";
      error = `${error ? `${error}\n` : ""}Residual fixture processes: ${residualPids.join(", ")}`;
    }
    finalEvidence = {
      ...(finalEvidence ?? {}),
      controlRecordCount: records.length,
      residualPids,
    };
    if (!keepArtifacts && status === "passed") {
      await removeScenarioRoot(scenarioRoot);
    }
  }
  return {
    name: scenario.name,
    description: scenario.description,
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    serverStarts: context.serverStarts,
    desktopStarts: context.desktopStarts,
    idempotentReplays: context.idempotentReplays,
    maxObservedActive: context.maxObservedActive,
    injections: context.injections,
    artifactRoot: keepArtifacts || status !== "passed" ? scenarioRoot : null,
    error,
    evidence: finalEvidence,
    processes: processEvidence(context),
  };
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    usage();
    return 0;
  }
  const selected = options.scenarioNames.map(
    (name) => scenarios.find((scenario) => scenario.name === name),
  );
  const report = {
    schemaVersion: 1,
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    configuration: {
      scenarios: options.scenarioNames,
      keepArtifacts: options.keepArtifacts,
      reportPath: path.relative(repoRoot, options.reportPath).replaceAll("\\", "/"),
      taskCount: 5,
      maxConcurrent: 2,
      agentId: "agt_codex_cli",
    },
    summary: null,
    scenarios: [],
  };
  writeReport(options.reportPath, report);
  for (const scenario of selected) {
    console.log(`\n[batch-chain] ${scenario.name}: ${scenario.description}`);
    const result = await runScenario(scenario, options);
    report.scenarios.push(result);
    writeReport(options.reportPath, report);
    console.log(
      `[batch-chain] ${result.status}: duration=${result.durationMs}ms `
      + `serverStarts=${result.serverStarts} desktopStarts=${result.desktopStarts} `
      + `peak=${result.maxObservedActive} replays=${result.idempotentReplays}`,
    );
    if (result.status !== "passed") {
      console.error(result.error);
      break;
    }
  }
  const passed = report.scenarios.filter((scenario) => scenario.status === "passed");
  report.status = passed.length === selected.length ? "passed" : "failed";
  report.completedAt = new Date().toISOString();
  report.summary = {
    scenariosRequested: selected.length,
    scenariosExecuted: report.scenarios.length,
    scenariosPassed: passed.length,
    tasksCompleted: passed.length * 5,
    residualProcesses: report.scenarios.reduce(
      (total, scenario) => total + (scenario.evidence?.residualPids?.length ?? 0),
      0,
    ),
    durationMs: report.scenarios.reduce((total, scenario) => total + scenario.durationMs, 0),
  };
  writeReport(options.reportPath, report);
  console.log(`\nBatch-chain penetration ${report.status}. Report: ${options.reportPath}`);
  return report.status === "passed" ? 0 : 1;
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) process.exitCode = await main();
