import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { delimiter } from "node:path";
import * as pty from "node-pty";
import { callMcpTool, probeMcpServer } from "./mcp-client.mjs";
import { agentMinimalBaseEnv, minimizeAgentEnvEnabled, shouldMinimizeAgentEnv } from "./agent-env.mjs";
import { runAsUser, shouldRunAsUser, runAsSpawnPlan, runAsPreflightPlan, interpretPreflightResult } from "./agent-runas.mjs";
import { callA2aAgent, probeA2aAgent } from "./a2a-client.mjs";
import { probeContainerRuntime, runContainerAgent } from "./container-client.mjs";
import { codexResumeArgs } from "./codex-resume.mjs";
import { extractClaudeFileAccesses } from "./claude-file-access.mjs";
import { newRoundState, claudeRoundEmits, codexRoundEmits, claudeRequestContext } from "./round-telemetry.mjs";
import { createAgentLineSink } from "./agent-line-sink.mjs";
import { createInvocationPool, resolveBridgeConcurrency, refreshedConcurrency } from "./invocation-pool.mjs";
import { createCancellationWatcher } from "./cancellation-watcher.mjs";
import { spawnCapture } from "./spawn-capture.mjs";
import { isInactiveInvocationError } from "./bridge-events.mjs";
import { applicationWrapperArgs } from "./application-wrapper-args.mjs";
import { collectApplicationBinaryReadiness } from "./application-binary-readiness.mjs";
import { collectApplicationCredentialReadiness } from "./application-credential-readiness.mjs";
import { managedRuntimeBinDirectory, runApprovedApplicationInstall } from "./application-installer.mjs";
import { registerBridgeWithRetry } from "./bridge-registration-retry.mjs";
import {
  createLocalExecutionPolicyManifest,
  localExecutionGate,
  localPolicyForAdapter,
} from "./local-execution-policy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// B1b Tier 2 preflight (memoized across spawns). Before wrapping any real agent in
// `sudo -n -u <user>`, probe `sudo -n -u <user> /usr/bin/true` ONCE. If it fails
// (sudoers not configured for this runner), warn and return null so the spawn falls
// back to today's unsandboxed launch — otherwise every agent run would die with a
// cryptic "sudo: a password is required". Never a silent false confinement.
let _runAsProbe = null; // { user, promise<boolean> }
async function activeRunAsUser() {
  const user = runAsUser();
  if (!user) return null;
  if (!_runAsProbe || _runAsProbe.user !== user) {
    _runAsProbe = {
      user,
      promise: (async () => {
        const { command, args } = runAsPreflightPlan(user);
        const result = await new Promise((resolveProbe) => {
          try {
            let stderr = "";
            const probe = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
            probe.stderr?.on("data", (chunk) => { stderr += String(chunk); });
            probe.on("error", (error) => resolveProbe({ error }));
            probe.on("close", (code) => resolveProbe({ code, stderr }));
          } catch (error) {
            resolveProbe({ error });
          }
        });
        const verdict = interpretPreflightResult(result);
        if (verdict.ok) {
          console.log(`[desktop] Tier 2 sandbox active: coding agents run as '${user}'.`);
        } else {
          console.warn(`[desktop] Tier 2 requested (MYAGENTTOOL_BRIDGE_RUN_AS_USER=${user}) but the sudo hop failed: ${verdict.reason}. Falling back to an unsandboxed spawn — configure sudoers per docs/engineering/AUTORUN_SANDBOX_TIER2.md.`);
        }
        return verdict.ok;
      })(),
    };
  }
  return (await _runAsProbe.promise) ? user : null;
}
const serverUrl = process.env.BRIDGE_SERVER_URL ?? "http://127.0.0.1:5001";
const pollIntervalMs = Number(process.env.BRIDGE_POLL_INTERVAL_MS ?? 700);
const terminalPollIntervalMs = Number(process.env.BRIDGE_TERMINAL_POLL_INTERVAL_MS ?? 40);
const binaryReadinessIntervalMs = Number(process.env.BRIDGE_BINARY_READINESS_INTERVAL_MS ?? 15 * 1000);
// Where the one-time login flow leaves its NON-SECRET sidecar records
// (application id, provider, scope). The secret itself lives in the OS
// credential store and is read only by the MCP server that uses it; the bridge
// never opens it. Unset means "this device reports holding no credentials".
const credentialDir = process.env.BRIDGE_CREDENTIAL_DIR ?? null;
const demoAgentPath = resolve(__dirname, "demo-agent.mjs");
const codexFixtureAgentPath = resolve(__dirname, "codex-fixture-agent.mjs");
const remoteRelayPath = resolve(__dirname, "remote-relay.mjs");
const localExecutionPolicyManifest = withBundledAgentProbes(
  createLocalExecutionPolicyManifest({ demoAgentPath, codexFixtureAgentPath }),
);
const bridgeTokenPath = resolve(process.env.MYAGENTTOOL_BRIDGE_TOKEN_PATH ?? ".myagenttool/bridge-token.json");
let bridgeToken = String(process.env.MYAGENTTOOL_BRIDGE_TOKEN ?? "").trim() || loadBridgeToken();

if (process.argv.includes("--check")) {
  if (!existsSync(demoAgentPath) || !existsSync(codexFixtureAgentPath) || !existsSync(remoteRelayPath)) {
    throw new Error("Desktop agent fixtures are not configured.");
  }
  const lifecycleWorkContract = {
    lifecycleActionId: "lco_self_check",
    recipeId: "lcr_self_check",
    executionEnabled: true,
    command: {
      commandId: "demo_agent_version",
      executable: "demo-agent",
      args: ["--version"],
      shell: false,
      packageManager: null
    }
  };
  const lifecyclePlan = lifecycleCommandPlan(lifecycleWorkContract.command);
  if (!lifecycleWorkContract.executionEnabled || lifecyclePlan?.command !== process.execPath || !lifecyclePlan.args.includes("--version")) {
    throw new Error("Lifecycle bridge work contract is not mapped to a local allowlisted command.");
  }
  const ccusageInstallPlan = lifecycleCommandPlan({
    commandId: "npm_global_install_pinned",
    executable: "npm",
    args: ["install", "-g", "ccusage@20.0.14"],
    shell: false,
    packageManager: null
  });
  if (!ccusageInstallPlan || !ccusageInstallPlan.args.includes("ccusage@20.0.14")) {
    throw new Error("ccusage pinned lifecycle install is not mapped to an allowlisted command.");
  }
  const blockedLifecyclePlan = lifecycleCommandPlan({ commandId: "not_allowlisted", executable: "demo-agent", args: [], shell: false });
  if (blockedLifecyclePlan) {
    throw new Error("Lifecycle bridge execution must reject non-allowlisted command identifiers.");
  }
  const blockedPackagePlan = lifecycleCommandPlan({
    commandId: "npm_global_install_pinned",
    executable: "npm",
    args: ["install", "-g", "ccusage@latest"],
    shell: false,
    packageManager: null
  });
  if (blockedPackagePlan) {
    throw new Error("ccusage lifecycle install must reject unpinned package specs.");
  }
  const resumeArgs = codexArgsTemplate({ command: "codex", args: codexCliArgs() }, { options: { codexSessionMode: "continue_last" } });
  if (!resumeArgs.includes("resume") || resumeArgs.includes("--ephemeral")) {
    throw new Error("Codex continuation args are not configured.");
  }
  // True resume (#163): a resolved provider session id must be resumed BY ID,
  // not via the global `--last`.
  const resumeByIdArgs = codexArgsTemplate(
    { command: "codex", args: codexCliArgs() },
    { options: { codexSessionMode: "continue_last", codexResumeSessionId: "0198f2a1-DEF_4.5" } },
  );
  if (resumeByIdArgs[1] !== "resume" || resumeByIdArgs[2] !== "0198f2a1-DEF_4.5" || resumeByIdArgs.includes("--last")) {
    throw new Error("Codex resume-by-session-id args are not configured.");
  }
  // A malformed/hostile session id (e.g. a leading dash) must be rejected and
  // fall back to `--last`, never injected as an argv flag.
  const unsafeResumeArgs = codexArgsTemplate(
    { command: "codex", args: codexCliArgs() },
    { options: { codexSessionMode: "continue_last", codexResumeSessionId: "--dangerously-bypass-approvals-and-sandbox" } },
  );
  if (unsafeResumeArgs[2] !== "--last" || unsafeResumeArgs.includes("--dangerously-bypass-approvals-and-sandbox")) {
    throw new Error("Codex resume must reject an unsafe session id and fall back to --last.");
  }
  const imageArgs = insertCodexImageArgs(["exec", "--json", "{{task}}"], [{ path: "composer-image.png" }]);
  const taskArgIndex = imageArgs.indexOf("{{task}}");
  if (!imageArgs.includes("--image") || imageArgs[taskArgIndex - 1] !== "--") {
    throw new Error("Codex image attachment args are not configured.");
  }
  const fullAccessArgs = applyCodexPermissionMode(["exec", "--json", "{{task}}"], { options: { approvalMode: "full" } });
  if (fullAccessArgs[1] !== "--dangerously-bypass-approvals-and-sandbox") {
    throw new Error("Codex full-access permission mode is not configured.");
  }
  const codexReviewPlan = createCliSpawnPlan({
    type: "cli",
    command: "node",
    args: ["tools/agents/codex-review-wrapper.mjs", "--mode", "diff-review"],
    outputFormat: "plain_result",
  }, {
    invocationId: "inv_codex_review_check",
    task: "review",
    options: {
      metadata: {
        tool: "codex.review.diff",
        worktreePath: process.cwd(),
        instruction: "Focus on correctness.",
        severityFloor: "medium",
        shell: "must-not-render",
      },
    },
  });
  if (!codexReviewPlan.args.includes("--cwd") || !codexReviewPlan.args.includes(process.cwd())) {
    throw new Error("Codex review wrapper cwd injection is not configured.");
  }
  if (!codexReviewPlan.args.includes("--instruction") || !codexReviewPlan.args.includes("Focus on correctness.")) {
    throw new Error("Codex review wrapper instruction injection is not configured.");
  }
  if (!codexReviewPlan.args.includes("--severity-floor") || !codexReviewPlan.args.includes("medium")) {
    throw new Error("Codex review wrapper severity injection is not configured.");
  }
  if (codexReviewPlan.args.includes("must-not-render") || codexReviewPlan.args.includes("--shell")) {
    throw new Error("Codex review wrapper rendered unallowlisted metadata.");
  }
  const claudeReviewPlan = createCliSpawnPlan({
    type: "cli",
    command: "node",
    args: ["tools/agents/claude-review-wrapper.mjs", "--mode", "diff-review"],
    outputFormat: "plain_result",
  }, {
    invocationId: "inv_claude_review_check",
    task: "review",
    options: {
      metadata: {
        tool: "claude.review.diff",
        worktreePath: process.cwd(),
        instruction: "Focus on correctness.",
        severityFloor: "medium",
        permissionMode: "bypassPermissions",
      },
    },
  });
  if (!claudeReviewPlan.args.includes("--cwd") || !claudeReviewPlan.args.includes(process.cwd())) {
    throw new Error("Claude review wrapper cwd injection is not configured.");
  }
  if (!claudeReviewPlan.args.includes("--instruction") || !claudeReviewPlan.args.includes("Focus on correctness.")) {
    throw new Error("Claude review wrapper instruction injection is not configured.");
  }
  if (!claudeReviewPlan.args.includes("--severity-floor") || !claudeReviewPlan.args.includes("medium")) {
    throw new Error("Claude review wrapper severity injection is not configured.");
  }
  if (claudeReviewPlan.args.includes("bypassPermissions") || claudeReviewPlan.args.includes("--permission-mode")) {
    throw new Error("Claude review wrapper rendered unallowlisted permission metadata.");
  }
  // #359: the application-wrapper runner must receive the server-resolved,
  // approved command injected as discrete argv (never a shell string).
  const appWrapperWork = {
    invocationId: "inv_app_wrapper_check",
    task: "run",
    options: {
      metadata: {
        applicationWrapper: {
          execCommand: "ccusage",
          execArgs: ["daily", "--json", "--offline"],
          capability: "app.app_ccusage.wrapper.daily",
          filePolicy: "read_only",
          networkPolicy: "forbidden",
        },
      },
    },
  };
  const appWrapperPlan = createCliSpawnPlan(
    { type: "cli", command: "node", args: ["tools/agents/application-wrapper.mjs"] },
    appWrapperWork,
  );
  if (!appWrapperPlan.args.includes("--exec-command") || !appWrapperPlan.args.includes("ccusage") || !appWrapperPlan.args.includes("--offline")) {
    throw new Error("Application wrapper exec injection is not configured.");
  }
  const appWrapperGate = localExecutionGate(
    appWrapperWork,
    { type: "cli", command: "node", args: ["tools/agents/application-wrapper.mjs"] },
    appWrapperPlan,
    // This self-check verifies the argv/policy CONTRACT, not binary availability
    // (#802) — a bridge without ccusage installed must still pass its own startup
    // check. The real per-device availability refusal happens at execution time.
    { permissionDecision: "not_required", permissionHook: null, manifest: localExecutionPolicyManifest, resolveBinary: () => true },
  );
  if (!appWrapperGate.allowed) {
    throw new Error(`Application wrapper local execution gate rejected the allowlisted contract: ${appWrapperGate.reason}`);
  }
  const blockedAppWrapperWork = {
    invocationId: "inv_app_wrapper_blocked_check",
    task: "run",
    options: {
      metadata: {
        applicationWrapper: {
          execCommand: "node",
          execArgs: ["-e", "console.log('nope')"],
          capability: "app.app_ccusage.wrapper.daily",
          filePolicy: "read_only",
          networkPolicy: "forbidden",
        },
      },
    },
  };
  const blockedAppWrapperPlan = createCliSpawnPlan(
    { type: "cli", command: "node", args: ["tools/agents/application-wrapper.mjs"] },
    blockedAppWrapperWork,
  );
  const blockedAppWrapperGate = localExecutionGate(
    blockedAppWrapperWork,
    { type: "cli", command: "node", args: ["tools/agents/application-wrapper.mjs"] },
    blockedAppWrapperPlan,
    { permissionDecision: "not_required", permissionHook: null, manifest: localExecutionPolicyManifest },
  );
  if (blockedAppWrapperGate.allowed) {
    throw new Error("Application wrapper local execution gate must reject non-allowlisted inner commands.");
  }
  if (typeof pty.spawn !== "function") {
    throw new Error("node-pty is not available.");
  }
  const unsafeGate = localExecutionGate(
    { invocationId: "inv_unsafe_gate", options: {} },
    { type: "cli", command: "node", args: ["evil.mjs"] },
    { command: process.execPath, args: [resolve("evil.mjs")], cwd: process.cwd() },
    { permissionDecision: "not_required", permissionHook: null, manifest: localExecutionPolicyManifest },
  );
  if (unsafeGate.allowed) {
    throw new Error("Local execution gate must reject non-allowlisted scripts.");
  }
  const inheritedEnv = {
    CODEX_SANDBOX_NETWORK_DISABLED: "1",
    CODEX_CI: "1",
    CODEX_THREAD_ID: "thread-from-parent",
    CODEX_HOME: "C:\\Users\\demo\\.codex",
    HTTPS_PROXY: "http://127.0.0.1:7890",
    MYAGENTTOOL_CODEX_ENV_JSON: "{\"OPENAI_BASE_URL\":\"http://127.0.0.1:8787/v1\"}"
  };
  const codexEnv = buildEnv({ command: "codex", environmentPolicy: "inherit_safe", env: inheritedEnv });
  if (codexEnv.CODEX_SANDBOX_NETWORK_DISABLED || codexEnv.CODEX_CI || codexEnv.CODEX_THREAD_ID) {
    throw new Error("Codex child environment isolation is not configured.");
  }
  if (codexEnv.CODEX_HOME !== inheritedEnv.CODEX_HOME || codexEnv.HTTPS_PROXY !== inheritedEnv.HTTPS_PROXY) {
    throw new Error("Codex child environment stripped user configuration.");
  }
  const defaultHomeEnv = buildEnv({ command: "codex", environmentPolicy: "inherit_safe", env: { USERPROFILE: "C:\\Users\\demo" } });
  if (process.platform === "win32" && defaultHomeEnv.CODEX_HOME !== "C:\\Users\\demo\\.codex") {
    throw new Error("Codex child environment should default to the user Codex home.");
  }
  if (codexEnv.OPENAI_BASE_URL !== "http://127.0.0.1:8787/v1") {
    throw new Error("Codex child local env injection is not configured.");
  }
  const commandJsonPlan = codexCommandPlan({ command: "codex" }, ["exec", "--json", "{{task}}"], "fixture-task");
  const commandJsonPlanValid = process.platform === "win32"
    ? commandJsonPlan.command === process.execPath
      && commandJsonPlan.args[0]?.toLowerCase().endsWith("\\node_modules\\@openai\\codex\\bin\\codex.js")
      && commandJsonPlan.args[1] === "exec"
    : commandJsonPlan.command === "codex" && commandJsonPlan.args[0] === "exec";
  if (!commandJsonPlanValid) {
    throw new Error("Codex command plan is not configured.");
  }
  const codexCommand = resolveCodexCommandPlan("codex", [], { PATH: `${resolve(process.env.APPDATA ?? "", "npm")}${delimiter}${process.env.PATH ?? ""}`, APPDATA: process.env.APPDATA });
  if (process.platform === "win32" && !codexCommand.args[0]?.toLowerCase().endsWith("\\node_modules\\@openai\\codex\\bin\\codex.js")) {
    throw new Error("Codex command resolution should prefer the user npm shim on Windows.");
  }
  const shellPlan = resolveTerminalShell(process.platform === "win32" ? "powershell" : "bash");
  if (!shellPlan.file) {
    throw new Error("Managed terminal shell resolver is not configured.");
  }
  console.log("[desktop:check] local demo bridge check OK");
  process.exit(0);
}

// #1242: `polling` guards the poll TICK against re-entry (the claim round trips),
// NOT the runs themselves — invocations run concurrently in invocationPool up to
// the server's cap. `auxBusy` keeps aux work (health/discovery/probe/lifecycle/
// install) single-flight while letting it interleave with in-flight invocations,
// which the old single `busy` flag blocked.
let polling = false;
let auxBusy = false;
let terminalBusy = false;
let stopped = false;
const terminalSessions = new Map();

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

// Backstop for stray async work (cancel/health pollers, timers) whose rejections
// aren't caught locally: a transient network error should log and let the bridge
// keep running, not crash the process and cascade the whole dev stack down.
process.on("unhandledRejection", (reason) => {
  if (stopped) return;
  console.error(`[desktop] unhandled rejection (continuing): ${reason instanceof Error ? reason.message : String(reason)}`);
});

await waitForServer();
let registration;
try {
  const runtimeReadiness = await collectApplicationBinaryReadiness(localExecutionPolicyManifest);
  registration = await registerBridgeWithRetry(() => request("POST", "/api/bridge/register", {
      bridgeVersion: "0.0.0",
      capabilities: ["demo_cli_agent", "managed_terminal_pty", "remote_ssh_relay"],
      runtimeReadiness,
      applicationBinaryReadiness: runtimeReadiness,
      applicationCredentialReadiness: collectApplicationCredentialReadiness(credentialDir),
    }), {
      onRetry: (_error, attempt) => console.warn(`[desktop] bridge registration network error; retrying (${attempt}/2).`),
    });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // A credential rejection at register is a pairing problem, not a bug — tell the
  // operator how to recover instead of dying with a raw stack. Covers a lost token
  // (invalid), an operator unlink (revoked), AND an idle-expired credential
  // (bridge_credentials_expired: the server was unreachable past the ~12h TTL, so
  // register can no longer rotate the expired token — by design).
  if (/invalid_bridge_credentials|device_credentials_revoked|bridge_credentials_expired/.test(message)) {
    const expired = /bridge_credentials_expired/.test(message);
    console.error(`[desktop] bridge registration was refused by ${serverUrl}: ${expired ? "the paired credential idled out (server unreachable past the TTL)" : "the server holds a paired credential this bridge cannot present"}.`);
    console.error(`[desktop] recover: re-pair the device — POST ${serverUrl}/api/device/relink (or the console's Re-pair action), then restart this bridge; it will register with a fresh credential.`);
    console.error(`[desktop] alternative: restore the original token file at ${bridgeTokenPath}.`);
    console.error("[desktop] see docs/engineering/AUTORUN_PILOT_RUNBOOK.md (operational cautions).");
    process.exit(1);
  }
  throw error;
}
if (registration?.bridgeToken) {
  bridgeToken = registration.bridgeToken;
  saveBridgeToken(bridgeToken, registration.bridgeCredential);
}
console.log(`[desktop] registered with ${serverUrl}`);

// Cross-worktree concurrency: honor the server's authoritative cap (echoed on
// the register response), falling back to env then a default. The server stays
// the hard limit — it 204s past its own cap or the per-worktree lock — so this
// is the bridge's own ceiling on parallel children. Seeded at register time and
// refreshed from the readiness response (#1272), so a live change in the Devices
// UI takes effect within one readiness cycle without a bridge restart.
let bridgeConcurrency = resolveBridgeConcurrency({
  serverMaxConcurrency: registration?.device?.maxConcurrency,
  envValue: process.env.BRIDGE_MAX_CONCURRENT,
});
console.log(`[desktop] invocation concurrency: ${bridgeConcurrency}`);
const invocationPool = createInvocationPool({
  // A getter, not a number: the pool re-reads it every fill(), so a refreshed
  // cap takes effect on the next tick.
  cap: () => bridgeConcurrency,
  claim: () => request("GET", "/api/bridge/next"),
  run: (work) => runInvocation(work),
  // runInvocation self-reports every terminal outcome; a reject here is an
  // unexpected bug in the runner itself — log it and free the slot (the pool's
  // finally already decremented), never crash the poll loop.
  onError: (error) => logPollError("invocation", error),
});

// #1251/#1302: one shared cancellation channel for all in-flight runs. Each run
// watches its own id; the watcher long-polls GET /api/bridge/cancellations?wait=1
// once for the whole device instead of one cancel-status GET per run. Started
// once, here.
const cancellationWatcher = createCancellationWatcher({
  request: (method, path) => request(method, path),
  onError: (error) => logPollError("cancellation", error),
}).start();

// A transient server blip — e.g. ECONNRESET while the API restarts — must never
// escape a poll tick as an unhandled rejection: the dev supervisor tears down the
// whole stack when any child exits non-zero, so one dropped fetch would take the
// entire demo down. Swallow-and-log per tick (throttled); the next interval retries.
let lastPollErrorAt = 0;
function logPollError(label, error) {
  const now = Date.now();
  if (now - lastPollErrorAt > 5000) {
    lastPollErrorAt = now;
    console.error(`[desktop] ${label} poll error (retrying): ${error instanceof Error ? error.message : String(error)}`);
  }
}
const guarded = (fn, label) => () => Promise.resolve().then(fn).catch((error) => logPollError(label, error));

async function refreshApplicationBinaryReadiness() {
  const runtimeReadiness = await collectApplicationBinaryReadiness(localExecutionPolicyManifest);
  const response = await request("POST", "/api/bridge/readiness", {
    runtimeReadiness,
    applicationBinaryReadiness: runtimeReadiness,
    // A credential revoked in the provider's account shows up here as the sidecar
    // going away — the same tick that reports a binary vanishing. That is what
    // lets the server's health probe auto-degrade the application to offline.
    applicationCredentialReadiness: collectApplicationCredentialReadiness(credentialDir),
  });
  // #1272: the readiness response echoes the device (publicDeviceView), so adopt
  // a live maxConcurrency change here — no restart needed. Only a usable server
  // value moves the cap; an absent/invalid field leaves it as-is.
  const next = refreshedConcurrency(bridgeConcurrency, {
    serverMaxConcurrency: response?.device?.maxConcurrency,
    envValue: process.env.BRIDGE_MAX_CONCURRENT,
  });
  if (next !== bridgeConcurrency) {
    console.log(`[desktop] invocation concurrency updated ${bridgeConcurrency} -> ${next}`);
    bridgeConcurrency = next;
  }
}

guarded(poll, "bridge")();
const timer = setInterval(guarded(poll, "bridge"), pollIntervalMs);
guarded(pollTerminal, "terminal")();
const terminalTimer = setInterval(guarded(pollTerminal, "terminal"), terminalPollIntervalMs);
const binaryReadinessTimer = setInterval(guarded(refreshApplicationBinaryReadiness, "binary readiness"), binaryReadinessIntervalMs);

// Aux (non-invocation) work: still single-flight, but decoupled from
// invocations so a long run no longer starves health/discovery. #1251: one
// multiplexed GET /api/bridge/aux-next replaces walking five endpoints per
// tick; the server returns the first available item across all queues in the
// same priority order, tagged with `kind`. Each runner self-reports its own
// terminal state to the server.
const AUX_RUNNERS = {
  health: (work) => runHealthCheck(work),
  discovery: (work) => runDiscovery(work),
  probe: (work) => runIntegrationProbe(work),
  lifecycle: (work) => runLifecycleAction(work),
  application_install: (work) => runApplicationInstall(work),
};

async function pumpAux() {
  if (auxBusy) {
    return;
  }
  const work = await request("GET", "/api/bridge/aux-next");
  if (!work) {
    return;
  }
  const runner = AUX_RUNNERS[work.kind];
  if (!runner) {
    logPollError("aux", new Error(`Unknown aux work kind: ${work.kind}`));
    return;
  }
  // Launch in the background and free the tick — like invocations, aux work
  // must not block the poll loop (an install can take minutes).
  auxBusy = true;
  Promise.resolve()
    .then(() => runner(work))
    .catch((error) => logPollError("aux", error))
    .finally(() => {
      auxBusy = false;
    });
}

async function poll() {
  if (polling || stopped) {
    return;
  }
  polling = true;
  try {
    // Fill the invocation pool up to the cap (the server 204s past its own
    // limit / the per-worktree lock), then give aux work a turn. Neither awaits
    // the actual runs — only the claim round trips — so the tick stays short.
    await invocationPool.fill();
    await pumpAux();
  } finally {
    polling = false;
  }
}

async function runApplicationInstall(work) {
  const result = await runApprovedApplicationInstall({
    plan: work.plan,
    env: buildEnv({ command: "application-installer", environmentPolicy: "inherit_safe" }),
    pollCancellation: async () => {
      const status = await request("GET", `/api/bridge/application-install-cancel-status?runId=${encodeURIComponent(work.runId)}`);
      return status?.cancelRequested === true;
    },
    onProgress: (progress) => request("POST", "/api/bridge/application-install-progress", { runId: work.runId, ...progress }),
    terminate: (child) => terminateProcessTree(child),
  });
  await request("POST", "/api/bridge/application-install-complete", { runId: work.runId, ...result });
}

async function runLifecycleAction(work) {
  if (!work?.lifecycleActionId) {
    throw new Error("Lifecycle work item is missing lifecycleActionId.");
  }
  const plan = work.executionEnabled === true ? lifecycleCommandPlan(work.command) : null;
  if (!plan) {
    // Uniform refusal auditing: a declined lifecycle spawn records structured
    // refusal evidence (like the CLI local_execution_refused path), not just a
    // prose failure — the bridge, not server policy, is declining local execution.
    await postLifecycleResult({
      lifecycleActionId: work.lifecycleActionId,
      status: "failed",
      summary: "Lifecycle command is not allowlisted for this Desktop Bridge build.",
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: null,
      healthStatus: "unknown",
      policyDecision: "local_execution_refused",
      refusal: {
        gate: "lifecycle_allowlist",
        commandId: work.command?.commandId ?? null,
        executable: work.command?.executable ?? null,
        executionEnabled: work.executionEnabled === true,
        reason: "Lifecycle command is not allowlisted for this Desktop Bridge build."
      }
    });
    return;
  }

  console.log(`[desktop] lifecycle action ${work.lifecycleActionId}: ${work.command.commandId}`);
  const startedAt = Date.now();
  // #1246: async so a slow lifecycle command (10s timeout) no longer freezes
  // the loop and stalls every in-flight agent run's output forwarding.
  const result = await spawnCapture(plan.command, plan.args, {
    cwd: process.cwd(),
    env: buildEnv({ command: "demo-agent", environmentPolicy: "inherit_safe" }),
    timeout: 10_000,
    windowsHide: true,
    encoding: "utf8",
    shell: false,
  });
  const durationMs = Date.now() - startedAt;
  const succeeded = result.status === 0 && !result.error;
  const summary = lifecycleResultSummary({
    commandId: work.command.commandId,
    error: result.error,
    signal: result.signal,
    status: result.status,
    succeeded,
  });
  await postLifecycleResult({
    lifecycleActionId: work.lifecycleActionId,
    status: succeeded ? "succeeded" : "failed",
    summary,
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs,
    healthStatus: succeeded ? "healthy" : "unhealthy"
  });
}

function lifecycleResultSummary({ commandId, error, signal, status, succeeded }) {
  if (succeeded) {
    return `Lifecycle command ${commandId} completed.`;
  }
  if (error?.code === "ETIMEDOUT" || signal) {
    return `Lifecycle command ${commandId} timed out.`;
  }
  if (error) {
    return `Lifecycle command ${commandId} failed to start: ${error.message}.`;
  }
  return `Lifecycle command ${commandId} failed with exit code ${status ?? "unknown"}.`;
}

function lifecycleCommandPlan(command) {
  if (!command || command.shell !== false || command.packageManager) {
    return null;
  }
  const commandId = String(command.commandId ?? "");
  if (commandId === "npm_global_install_pinned") {
    return lifecycleExactPlan(command, {
      executable: "npm",
      args: ["install", "-g", "ccusage@20.0.14"],
      command: process.platform === "win32" ? "npm.cmd" : "npm",
      planArgs: ["install", "-g", "ccusage@20.0.14"],
    });
  }
  if (commandId === "npm_global_uninstall_package") {
    return lifecycleExactPlan(command, {
      executable: "npm",
      args: ["uninstall", "-g", "ccusage"],
      command: process.platform === "win32" ? "npm.cmd" : "npm",
      planArgs: ["uninstall", "-g", "ccusage"],
    });
  }
  if (commandId === "ccusage_version") {
    return lifecycleExactPlan(command, {
      executable: "ccusage",
      args: ["--version"],
      command: process.platform === "win32" ? "ccusage.cmd" : "ccusage",
      planArgs: ["--version"],
    });
  }
  if (commandId === "ccusage_report_probe") {
    return lifecycleExactPlan(command, {
      executable: "ccusage",
      args: ["daily", "--json", "--offline"],
      command: process.platform === "win32" ? "ccusage.cmd" : "ccusage",
      planArgs: ["daily", "--json", "--offline"],
    });
  }
  const commands = {
    demo_agent_version: [demoAgentPath, "--version"],
    demo_agent_update: [demoAgentPath, "--self-check-update"],
    demo_agent_health: [demoAgentPath, "--self-check-health"],
    demo_agent_rollback: [demoAgentPath, "--self-check-rollback"],
  };
  const args = commands[commandId];
  if (!args) {
    return null;
  }
  return {
    command: process.execPath,
    args,
  };
}

function lifecycleExactPlan(command, expected) {
  if (String(command.executable ?? "") !== expected.executable) {
    return null;
  }
  const args = Array.isArray(command.args) ? command.args.map(String) : [];
  if (args.length !== expected.args.length || args.some((arg, index) => arg !== expected.args[index])) {
    return null;
  }
  return {
    command: expected.command,
    args: expected.planArgs,
  };
}

async function postLifecycleResult(payload) {
  await request("POST", "/api/bridge/lifecycle-complete", payload);
}

async function pollTerminal() {
  if (terminalBusy || stopped) {
    return;
  }
  terminalBusy = true;
  try {
    for (let index = 0; index < 25 && !stopped; index += 1) {
      const terminalWork = await request("GET", "/api/bridge/terminal-next");
      if (!terminalWork) {
        break;
      }
      await runTerminalAction(terminalWork);
    }
  } finally {
    terminalBusy = false;
  }
}

async function runTerminalAction(action) {
  const sessionId = action.terminalSessionId;
  const actionId = action.id;
  try {
    if (action.session?.runtimeKind === "remote_ssh_relay") {
      await runRemoteRelayAction(action);
      return;
    }
    if (action.actionType === "create") {
      await createPtySession(action);
      return;
    }
    const current = terminalSessions.get(sessionId);
    if (!current) {
      await postTerminalEvent({
        terminalSessionId: sessionId,
        actionId,
        type: "terminal.runtime.warning",
        summary: "Managed terminal session is not active in Desktop Bridge."
      });
      return;
    }
    if (action.actionType === "input") {
      current.pty.write(String(action.payload?.input ?? ""));
      await postTerminalEvent({
        terminalSessionId: sessionId,
        actionId,
        type: "terminal.input.submit",
        summary: "Managed terminal input submitted."
      });
      return;
    }
    if (action.actionType === "resize") {
      const cols = Math.max(20, Number(action.payload?.cols ?? 100));
      const rows = Math.max(5, Number(action.payload?.rows ?? 30));
      current.pty.resize(cols, rows);
      await postTerminalEvent({
        terminalSessionId: sessionId,
        actionId,
        type: "terminal.resize",
        summary: `Managed terminal resized to ${cols}x${rows}.`,
        cols,
        rows
      });
      return;
    }
    if (action.actionType === "close") {
      current.pty.kill();
      terminalSessions.delete(sessionId);
      await postTerminalEvent({
        terminalSessionId: sessionId,
        actionId,
        type: "terminal.close",
        summary: "Managed terminal close requested."
      });
    }
  } catch (error) {
    await postTerminalEvent({
      terminalSessionId: sessionId,
      actionId,
      type: "terminal.runtime.warning",
      summary: error instanceof Error ? error.message : String(error)
    });
  }
}

async function runRemoteRelayAction(action) {
  const sessionId = action.terminalSessionId;
  const actionId = action.id;
  if (action.actionType === "create") {
    await createRemoteRelaySession(action);
    return;
  }
  const current = terminalSessions.get(sessionId);
  if (!current?.relay) {
    await postTerminalEvent({
      terminalSessionId: sessionId,
      actionId,
      type: "terminal.runtime.warning",
      summary: "Remote relay session is not active in Desktop Bridge."
    });
    return;
  }
  if (action.actionType === "input") {
    writeRelay(current.relay, { type: "input", sessionId, actionId, input: String(action.payload?.input ?? "") });
    return;
  }
  if (action.actionType === "resize") {
    writeRelay(current.relay, {
      type: "resize",
      sessionId,
      actionId,
      cols: Math.max(20, Number(action.payload?.cols ?? 100)),
      rows: Math.max(5, Number(action.payload?.rows ?? 30))
    });
    return;
  }
  if (action.actionType === "close") {
    writeRelay(current.relay, { type: "close", sessionId, actionId });
  }
}

async function createPtySession(action) {
  const session = action.session ?? {};
  const shellPlan = resolveTerminalShell(action.payload?.shell ?? session.shell);
  const cwd = String(action.payload?.cwd ?? session.cwd ?? process.cwd());
  const cols = Math.max(20, Number(action.payload?.cols ?? 100));
  const rows = Math.max(5, Number(action.payload?.rows ?? 30));
  const child = pty.spawn(shellPlan.file, shellPlan.args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: { ...process.env, TERM: process.env.TERM && process.env.TERM !== "dumb" ? process.env.TERM : "xterm-256color" }
  });
  terminalSessions.set(action.terminalSessionId, { pty: child, shellPlan, cwd });
  child.onData((output) => {
    postTerminalEvent({
      terminalSessionId: action.terminalSessionId,
      type: "terminal.output.chunk",
      stream: "stdout",
      output,
      byteCount: Buffer.byteLength(output),
      summary: summarizeTerminalOutput(output)
    });
  });
  child.onExit(({ exitCode }) => {
    terminalSessions.delete(action.terminalSessionId);
    postTerminalEvent({
      terminalSessionId: action.terminalSessionId,
      type: "terminal.exit",
      exitCode,
      summary: `Managed terminal exited with code ${exitCode}.`
    });
  });
  await postTerminalEvent({
    terminalSessionId: action.terminalSessionId,
    actionId: action.id,
    type: "terminal.session.attached",
    summary: `Managed terminal attached to ${shellPlan.label}.`
  });
}

async function postTerminalEvent(event) {
  await request("POST", "/api/bridge/terminal-events", event);
}

function resolveTerminalShell(requested) {
  const normalized = String(requested ?? "").trim().toLowerCase();
  if (process.platform === "win32") {
    const gitBash = process.env.MYAGENTTOOL_GIT_BASH_COMMAND || "C:\\Program Files\\Git\\bin\\bash.exe";
    const candidates = {
      cmd: { file: "cmd.exe", args: [], label: "cmd.exe" },
      "cmd.exe": { file: "cmd.exe", args: [], label: "cmd.exe" },
      powershell: { file: "powershell.exe", args: ["-NoLogo"], label: "powershell.exe" },
      "powershell.exe": { file: "powershell.exe", args: ["-NoLogo"], label: "powershell.exe" },
      pwsh: { file: "pwsh.exe", args: ["-NoLogo"], label: "pwsh.exe" },
      "pwsh.exe": { file: "pwsh.exe", args: ["-NoLogo"], label: "pwsh.exe" },
      wsl: { file: "wsl.exe", args: [], label: "wsl.exe" },
      "wsl.exe": { file: "wsl.exe", args: [], label: "wsl.exe" },
      "git-bash": { file: existsSync(gitBash) ? gitBash : "bash.exe", args: ["--login"], label: "Git Bash" }
    };
    return candidates[normalized] ?? candidates.powershell;
  }
  const fallback = process.env.SHELL || "/bin/bash";
  if (normalized === "zsh") return { file: "/bin/zsh", args: [], label: "zsh" };
  if (normalized === "sh") return { file: "/bin/sh", args: [], label: "sh" };
  if (normalized === "bash") return { file: "/bin/bash", args: [], label: "bash" };
  return { file: fallback, args: [], label: fallback };
}

function summarizeTerminalOutput(output) {
  const clean = String(output ?? "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\s+/g, " ").trim();
  return clean ? `Terminal output: ${clean.slice(0, 180)}` : "Terminal output received.";
}

async function runInvocation(work) {
  const invocationId = work.invocationId;
  const task = String(work.input?.task ?? "");
  const adapter = work.adapter;
  const runtimeName = agentRuntimeName(work.agentName, adapter);
  console.log(`[desktop] running ${invocationId}: ${task}`);

  // Pre-ack refusal (docs/design/BRIDGE_LIVENESS_AND_REFUSAL.md): a delivery whose
  // adapter this bridge has no runtime for cannot run HERE — say so honestly via
  // the refuse verb (leased→refused, terminal) instead of acking and failing, so
  // it classifies as agent_unavailable rather than a generic runtime failure.
  const RUNNABLE_ADAPTER_TYPES = new Set(["cli", "mcp", "a2a", "container"]);
  if (!RUNNABLE_ADAPTER_TYPES.has(adapter?.type)) {
    await request("POST", "/api/bridge/refuse", {
      invocationId,
      reason: `Desktop Bridge has no runtime for adapter type ${adapter?.type ?? "unknown"}.`,
      errorCode: "agent_unavailable",
    });
    return;
  }

  await request("POST", "/api/bridge/ack", { invocationId });

  let finalResult = null;
  let cancelled = false;
  let cancelResult = null;
  let timedOut = false;
  let spawnError = null;
  // #1250: flipped true the instant the child closes and the main flow takes
  // over the terminal outcome. The detached cancel/timeout pollers check it
  // (before AND after their awaits) so they stop posting events once the run is
  // settling — otherwise a late event races the terminal /api/bridge/complete
  // and the server rejects it with bridge_invocation_not_active.
  let settled = false;
  const roundState = newRoundState();

  if (adapter?.type === "mcp") {
    await runMcpInvocation(work);
    return;
  }
  if (adapter?.type === "a2a") {
    await runA2aInvocation(work);
    return;
  }
  if (adapter?.type === "container") {
    await runContainerInvocation(work);
    return;
  }

  if (!adapter || adapter.type !== "cli") {
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "failed",
      summary: `Desktop Bridge cannot execute adapter type ${adapter?.type ?? "unknown"}.`,
      result: { errorCode: "agent_unavailable" }
    });
    return;
  }

  const spawnPlan = createCliSpawnPlan(adapter, { invocationId, task, options: work.options ?? {} });
  const preview = await executionPreview(adapter, spawnPlan, task);
  await sendCodexHookEvent(invocationId, adapter, {
    eventName: "SessionStart",
    summary: `Managed Codex launcher started with ${preview.sessionMode}.`
  });
  const promptHook = await sendCodexHookEvent(invocationId, adapter, {
    eventName: "UserPromptSubmit",
    summary: summarizeTaskForHook(task)
  });
  if (promptHook?.policyDecision === "blocked") {
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "failed",
      summary: promptHook.hookEvent?.policyReason ?? "Codex prompt was blocked by policy.",
      result: {
        touchedUserFiles: false,
        policyDecision: "blocked",
        errorCode: "policy_blocked"
      }
    });
    return;
  }
  await request("POST", "/api/bridge/events", {
    invocationId,
    type: "execution_preview",
    level: "info",
    message: `Execution preview: ${preview.commandLine}`,
    data: preview
  });
  await sendCodexHookEvent(invocationId, adapter, {
    eventName: "PreToolUse",
    toolName: "Bash",
    summary: preview.commandLine
  });
  const permissionHook = await sendCodexHookEvent(invocationId, adapter, {
    eventName: "PermissionRequest",
    toolName: "Bash",
    summary: "Codex requested permission for a sandbox-bound command preview.",
    timeoutSeconds: process.env.MYAGENTTOOL_CODEX_APPROVAL_TIMEOUT_SECONDS
  });
  const permissionDecision = await waitForCodexApprovalDecision(permissionHook);
  if (permissionDecision === "denied" || permissionDecision === "timed_out") {
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "failed",
      summary: permissionDecision === "timed_out"
        ? "Codex approval broker timed out before execution."
        : "Codex approval broker denied the request before execution.",
      result: {
        touchedUserFiles: false,
        policyDecision: permissionDecision,
        errorCode: permissionDecision === "timed_out" ? "dispatch_timeout" : "policy_blocked"
      }
    });
    return;
  }
  const gate = localExecutionGate(work, adapter, spawnPlan, {
    permissionDecision,
    permissionHook,
    manifest: localExecutionPolicyManifest,
  });
  if (!gate.allowed) {
    await request("POST", "/api/bridge/events", {
      invocationId,
      type: "local_execution_refused",
      level: "error",
      message: gate.reason,
      data: gate.evidence
    });
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "failed",
      summary: gate.reason,
      result: {
        touchedUserFiles: false,
        policyDecision: "local_execution_refused",
        localExecutionGate: gate.evidence,
        // The gate's recovery-category code (local-execution-policy.mjs) so a
        // post-ack local refusal classifies honestly instead of as a generic run.
        errorCode: gate.code ?? "policy_blocked"
      }
    });
    return;
  }

  // B1b Tier 2 (opt-in, default OFF): run the agent as a low-priv user via sudo -n.
  // Applied AFTER the local-execution gate so the gate validated the real agent
  // command; only the exec is wrapped (cwd/env preserved). Falls through unchanged
  // when the flag is unset, the adapter isn't a real CLI coding agent, or the
  // memoized sudo preflight failed (activeRunAsUser → null with a warning).
  const runAsTarget = await activeRunAsUser();
  const launchPlan = shouldRunAsUser(adapter, { user: runAsTarget }) ? runAsSpawnPlan(spawnPlan, { user: runAsTarget }) : spawnPlan;
  let child;
  try {
    child = spawn(launchPlan.command, launchPlan.args, {
      cwd: launchPlan.cwd,
      env: launchPlan.env,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    await sendCodexHookEvent(invocationId, adapter, {
      eventName: "Stop",
      summary: `${runtimeName} failed to start.`
    });
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "failed",
      summary: `${runtimeName} failed to start: ${error instanceof Error ? error.message : String(error)}.`,
      result: finalResult
    });
    return;
  }

  const timeoutMs = Number(adapter.timeoutSeconds ?? work.options?.timeoutSeconds ?? 30) * 1000;
  const timeoutTimer = setTimeout(async () => {
    try {
      if (settled || child.exitCode !== null || child.killed || cancelled) {
        return;
      }
      timedOut = true;
      await request("POST", "/api/bridge/events", {
        invocationId,
        type: "invocation_timed_out",
        level: "warn",
        message: `${runtimeName} exceeded its configured timeout.`
      });
      cancelResult = await terminateProcessTree(child);
      await reportForcedKill(invocationId, runtimeName, cancelResult);
    } catch (error) {
      tolerateLateEvent("timeout", invocationId, error);
    }
  }, timeoutMs);

  // #1251: react to cancellation via the shared watcher (one device-wide poll)
  // instead of a per-run cancel-status timer. The handler fires at most once,
  // and keeps the #1250 terminal-race guards: it does nothing once the run owns
  // its terminal outcome, and tolerates a late event post.
  const stopWatchingCancel = cancellationWatcher.watch(invocationId, async () => {
    if (settled || cancelled) {
      return;
    }
    cancelled = true;
    try {
      await request("POST", "/api/bridge/events", {
        invocationId,
        type: "cancel_dispatched",
        level: "info",
        message: `Desktop Bridge sent cancellation to ${runtimeName}.`
      });
      cancelResult = await terminateProcessTree(child);
      await reportForcedKill(invocationId, runtimeName, cancelResult);
      if (!cancelResult.ok) {
        await request("POST", "/api/bridge/events", {
          invocationId,
          type: "cancel_failed",
          level: "warn",
          message: cancelResult.message
        });
      }
    } catch (error) {
      tolerateLateEvent("cancel", invocationId, error);
    }
  });

  // #1228: line handling is serialized and drained before any outcome is
  // reported. The jsonl handlers await event posts BEFORE returning the
  // terminal result, and the CLI's normal behavior is to print that result
  // line and exit immediately — fire-and-forget here let `close` win the
  // race, completing the run with finalResult still null (summary degraded,
  // usage/cost lost) and landing line events after invocation_completed.
  const stdoutSink = createAgentLineSink(
    async (line) => {
      const result = await handleAgentLine(invocationId, line, adapter, roundState);
      if (result) {
        finalResult = result;
      }
    },
    { onError: (error, line) => console.error(`[desktop] ${invocationId} stdout line handling failed (continuing): ${error instanceof Error ? error.message : String(error)} — line: ${String(line).slice(0, 200)}`) },
  );
  const stderrSink = createAgentLineSink(
    async (line) => {
      if (line.trim()) {
        await emitAgentStderrLine(invocationId, adapter, line);
      }
    },
    { onError: (error) => console.error(`[desktop] ${invocationId} stderr line handling failed (continuing): ${error instanceof Error ? error.message : String(error)}`) },
  );

  child.stdout.on("data", (chunk) => stdoutSink.push(chunk));
  child.stderr.on("data", (chunk) => stderrSink.push(chunk));

  child.on("error", (error) => {
    spawnError = error;
  });

  const exitCode = await new Promise((resolveExit) => {
    child.on("close", resolveExit);
  });
  // #1250: the main flow now owns the terminal outcome. Mark settled BEFORE
  // detaching the watcher / clearing the timeout so any cancel handler already
  // in flight bails on its `settled` guard instead of posting after complete.
  settled = true;
  stopWatchingCancel();
  clearTimeout(timeoutTimer);
  // The temp patch file the apply runner read (materialized in governedApplyWrapperArgs)
  // is a per-run throwaway — delete it now that the child has exited so an authorized
  // diff does not linger in the shared temp directory.
  cleanupApplyPatchFile(spawnPlan.args);

  // Drain both sinks (residual partial line included) so finalResult is
  // settled and no agent line event can land after the terminal report below.
  await stdoutSink.flush();
  await stderrSink.flush();

  if (timedOut) {
    const forcedNote = cancelResult?.message ? ` ${cancelResult.message}` : "";
    await sendCodexHookEvent(invocationId, adapter, {
      eventName: "Stop",
      summary: "Codex run timed out."
    });
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "timed_out",
      summary: `${runtimeName} exceeded its configured timeout.${forcedNote}`,
      result: finalResult
    });
    return;
  }

  if (cancelled) {
    const forcedNote = cancelResult?.message ? ` ${cancelResult.message}` : "";
    await sendCodexHookEvent(invocationId, adapter, {
      eventName: "Stop",
      summary: "Codex run was cancelled."
    });
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: cancelResult?.ok === false ? "failed" : "cancelled",
      summary: cancelResult?.ok === false
        ? `${runtimeName} cancellation failed.${forcedNote}`
        : `${runtimeName} was cancelled locally.${forcedNote}`,
      result: finalResult
    });
    return;
  }

  if (exitCode === 0) {
    await sendCodexHookEvent(invocationId, adapter, {
      eventName: "PostToolUse",
      toolName: "Bash",
      summary: "Codex command completed."
    });
    await sendCodexHookEvent(invocationId, adapter, {
      eventName: "Stop",
      summary: "Codex run stopped after completion."
    });
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "succeeded",
      summary: finalResult?.summary ?? `${runtimeName} completed.`,
      result: finalResult
    });
    return;
  }

  await sendCodexHookEvent(invocationId, adapter, {
    eventName: "PostToolUse",
    toolName: "Bash",
    summary: `Codex command exited with code ${exitCode}.`
  });
  await sendCodexHookEvent(invocationId, adapter, {
    eventName: "Stop",
    summary: "Codex run stopped after failure."
  });
  await request("POST", "/api/bridge/complete", {
    invocationId,
    status: "failed",
    summary: spawnError
      ? `${runtimeName} could not start: ${spawnError.message}`
      : `${runtimeName} exited with code ${exitCode}.`,
    result: finalResult
  });
}

// Protocol-client dispatch: the transports live in {mcp,a2a,container}-client
// modules; this shared glue watches for cancellation (via the shared watcher),
// forwards client events to the server, and completes the invocation with the
// client's terminal outcome. The ack already happened in runInvocation before
// dispatching here.
async function runMcpInvocation(work) {
  await runClientInvocation(work, callMcpTool, "MCP server");
}

async function runA2aInvocation(work) {
  await runClientInvocation(work, callA2aAgent, "A2A agent");
}

async function runContainerInvocation(work) {
  await runClientInvocation(work, runContainerAgent, "container");
}

async function runClientInvocation(work, clientFn, runtimeLabel) {
  const invocationId = work.invocationId;
  const task = String(work.input?.task ?? "");
  const adapter = work.adapter;

  let cancelRequested = false;
  // #1250: same terminal-race guard as the CLI path — once the client finishes
  // and the finally marks settled, a late cancel handler must not post an event
  // after the terminal complete.
  let settled = false;
  // #1251: react via the shared cancellation watcher (one device-wide poll)
  // instead of a per-run cancel-status timer. clientFn reads cancelRequested
  // through shouldCancel; the handler sets it and posts cancel_dispatched once.
  const stopWatchingCancel = cancellationWatcher.watch(invocationId, async () => {
    if (settled || cancelRequested) return;
    cancelRequested = true;
    try {
      await request("POST", "/api/bridge/events", {
        invocationId,
        type: "cancel_dispatched",
        level: "info",
        message: `Desktop Bridge sent cancellation to the ${runtimeLabel}.`
      });
    } catch (error) {
      tolerateLateEvent("cancel", invocationId, error);
    }
  });

  let outcome;
  try {
    outcome = await clientFn({
      adapter,
      task,
      options: work.options ?? {},
      shouldCancel: () => cancelRequested,
      onEvent: (event) => {
        request("POST", "/api/bridge/events", {
          invocationId,
          type: "log",
          level: event.level ?? "info",
          message: event.message
        }).catch(() => undefined);
      }
    });
  } finally {
    settled = true;
    stopWatchingCancel();
  }

  await request("POST", "/api/bridge/complete", {
    invocationId,
    status: outcome.status,
    summary: outcome.summary,
    result: outcome.result
  });
}

async function runHealthCheck(work) {
  const adapter = work.adapter;
  const protocolProbes = { mcp: probeMcpServer, a2a: probeA2aAgent, container: probeContainerRuntime };
  if (protocolProbes[adapter?.type]) {
    const probe = await protocolProbes[adapter.type](adapter);
    await request("POST", "/api/bridge/health-complete", {
      checkId: work.checkId,
      agentId: work.agentId,
      status: probe.ok ? "healthy" : "unhealthy",
      message: probe.message,
      nextAction: probe.ok ? null : probe.nextAction
    });
    return;
  }
  if (!adapter || adapter.type !== "cli") {
    await request("POST", "/api/bridge/health-complete", {
      checkId: work.checkId,
      agentId: work.agentId,
      status: "unhealthy",
      message: `Desktop Bridge cannot health-check adapter type ${adapter?.type ?? "unknown"}.`,
      nextAction: "Use a CLI demo agent for bridge health checks."
    });
    return;
  }

  const result = await checkCliAgentHealth(adapter);
  await request("POST", "/api/bridge/health-complete", {
    checkId: work.checkId,
    agentId: work.agentId,
    status: result.ok ? "healthy" : "unhealthy",
    message: result.message,
    nextAction: result.ok ? null : result.nextAction
  });
}

async function checkCliAgentHealth(adapter) {
  if (isCodexCliCommand(adapter.command)) {
    const probe = await probeCodexCli(adapter);
    return {
      ok: probe.ok,
      message: probe.ok ? "Codex CLI non-interactive surface is reachable." : probe.summary,
      nextAction: probe.ok ? null : "Verify Codex CLI installation and authentication."
    };
  }
  if (isClaudeCliCommand(adapter.command)) {
    const probe = await probeClaudeCli(adapter);
    return {
      ok: probe.ok,
      message: probe.ok ? "Claude CLI surface is reachable." : probe.summary,
      nextAction: probe.ok ? null : "Verify Claude CLI installation and authentication."
    };
  }
  if (adapter.command === "demo-agent") {
    return {
      ok: true,
      message: "Demo CLI Agent is reachable through Desktop Bridge.",
      nextAction: null
    };
  }
  if (!adapter.command || typeof adapter.command !== "string") {
    return {
      ok: false,
      message: "CLI agent command is missing.",
      nextAction: "Register the agent with a command, then retry the health check."
    };
  }
  return {
    ok: true,
    message: `Desktop Bridge can attempt CLI command: ${adapter.command}.`,
    nextAction: null
  };
}

async function runDiscovery(work) {
  const candidates = [];
  const scope = Array.isArray(work.scope) ? work.scope : [];

  if (scope.includes("known_command_allowlist") && Array.isArray(work.knownCommands) && work.knownCommands.includes("demo-agent")) {
    candidates.push(cliCandidate({
      id: "cand_demo_cli",
      name: "Demo CLI Agent",
      command: "demo-agent",
      source: "known_command_allowlist",
      confidence: "high",
      riskLevel: "low",
      riskTags: ["read_only"],
      riskHints: [
        "Found from the built-in known command allowlist.",
        "Discovery did not scan the full operating system.",
        "Review the command before enabling."
      ]
    }));
  }

  if (scope.includes("user_provided_path")) {
    for (const path of normalizeStringArray(work.userProvidedPaths)) {
      const codexCommand = isCodexCliCommand(path);
      candidates.push(cliCandidate({
        id: `cand_user_cli_${safeId(path)}`,
        name: codexCommand ? "Codex CLI" : `User-provided CLI: ${path}`,
        command: path,
        source: "user_provided_path",
        confidence: path === "demo-agent" ? "high" : "medium",
        riskLevel: highRiskCliCommand(path) ? "high" : "medium",
        riskTags: codexCommand ? codexRiskTags() : highRiskCliCommand(path) ? ["read_local", "write_local", "shell_exec", "network_access"] : ["read_local", "shell_exec"],
        riskHints: [
          "Found from a user-provided command path.",
          "No broad filesystem scan was performed.",
          codexCommand
            ? "Codex CLI is configured for codex exec and JSONL output; permissions stay with Codex CLI native controls."
            : highRiskCliCommand(path)
            ? "High-risk coding CLI commands still require local approval before invocation."
            : "Review shell execution risk before enabling.",
          codexCommand ? "MyAgentTool records invocation evidence but does not replace Codex CLI authorization." : "Generated integrations stay disabled until explicit registration."
        ]
      }));
    }
  }

  if (scope.includes("known_local_endpoint")) {
    for (const endpoint of Array.isArray(work.knownLocalEndpoints) ? work.knownLocalEndpoints : []) {
      candidates.push(httpCandidate({
        id: `cand_known_http_${safeId(endpoint.baseUrl)}`,
        name: endpoint.name ?? "Known Local HTTP Agent",
        baseUrl: endpoint.baseUrl,
        requestPath: endpoint.requestPath ?? "/invoke",
        healthPath: endpoint.healthPath ?? "/health",
        source: "known_local_endpoint",
        confidence: "medium"
      }));
    }
  }

  if (scope.includes("user_provided_endpoint")) {
    for (const endpoint of normalizeStringArray(work.userProvidedEndpoints)) {
      candidates.push(httpCandidate({
        id: `cand_user_http_${safeId(endpoint)}`,
        name: `User-provided HTTP Agent: ${endpoint}`,
        baseUrl: endpoint,
        requestPath: "/invoke",
        healthPath: "/health",
        source: "user_provided_endpoint",
        confidence: "medium"
      }));
    }
  }

  if (scope.includes("bridge_managed_config")) {
    candidates.push(cliCandidate({
      id: "cand_bridge_managed_demo",
      name: "Bridge-managed Demo CLI Agent",
      command: "demo-agent",
      source: "bridge_managed_config",
      confidence: "high",
      riskLevel: "low",
      riskTags: ["read_only"],
      riskHints: [
        "Found from bridge-managed demo configuration.",
        "Discovery stayed inside bridge-managed config.",
        "Review before enabling."
      ]
    }));
  }

  await request("POST", "/api/bridge/discovery-complete", {
    discoveryRunId: work.discoveryRunId,
    status: "succeeded",
    message: `Desktop Bridge returned ${candidates.length} conservative discovery candidate(s).`,
    candidates: uniqueCandidates(candidates)
  });
}

async function runIntegrationProbe(work) {
  const adapter = work.adapter;
  // MCP dry-probe: run the same live client that executes MCP invocations, but
  // stop at the handshake + tools/list so the Web Console can show the operator
  // what a config resolves to *before* an agent is registered/enabled.
  if (adapter?.type === "mcp") {
    const probe = await probeMcpServer(adapter);
    await request("POST", "/api/bridge/probe-complete", {
      probeRunId: work.probeRunId,
      status: probe.ok ? "succeeded" : "failed",
      summary: probe.message,
      details: probe.nextAction ? [probe.nextAction] : [],
      tools: probe.tools ?? []
    });
    return;
  }
  if (!adapter || adapter.type !== "cli") {
    await request("POST", "/api/bridge/probe-complete", {
      probeRunId: work.probeRunId,
      status: "failed",
      summary: `Desktop Bridge cannot probe adapter type ${adapter?.type ?? "unknown"}.`,
      details: ["Use HTTP server-side probe or CLI adapter config."]
    });
    return;
  }

  if (isCodexCliCommand(adapter.command)) {
    const probe = await probeCodexCli(adapter);
    await request("POST", "/api/bridge/probe-complete", {
      probeRunId: work.probeRunId,
      status: probe.ok ? "succeeded" : "failed",
      summary: probe.summary,
      details: probe.details
    });
    return;
  }

  const health = await checkCliAgentHealth(adapter);
  const highRisk = highRiskCliCommand(adapter.command);
  await request("POST", "/api/bridge/probe-complete", {
    probeRunId: work.probeRunId,
    status: health.ok ? "succeeded" : "failed",
    summary: health.ok ? `Restricted CLI probe passed for ${adapter.command}.` : health.message,
    details: [
      "No install scripts were run.",
      "No broad filesystem scan was performed.",
      highRisk
        ? "Command is high risk and remains subject to local approval before invocation."
        : "Command can be reviewed and registered explicitly.",
      health.nextAction ?? "Probe complete."
    ]
  });
}

function cliCandidate({ id, name, command, source, confidence, riskLevel, riskTags, riskHints }) {
  const codexCommand = isCodexCliCommand(command);
  return {
    id,
    name,
    description: codexCommand ? "Runs Codex CLI non-interactively through a reviewed local adapter config." : "Runs a local CLI command discovered conservatively.",
    adapter: {
      type: "cli",
      command,
      args: codexCommand ? codexCliArgs() : ["{{payloadJson}}"],
      // Coding agents default to 600s (real edit tasks exceed the old 120s).
      timeoutSeconds: codexCommand ? 600 : 30,
      cancellation: "supported",
      outputFormat: codexCommand ? "codex_jsonl" : "plain_result",
      sandbox: null
    },
    source,
    confidence,
    riskLevel,
    riskTags,
    riskHints,
    healthProbeAvailable: true
  };
}

function httpCandidate({ id, name, baseUrl, requestPath, healthPath, source, confidence }) {
  return {
    id,
    name,
    description: "Calls a local HTTP endpoint discovered conservatively.",
    adapter: {
      type: "http",
      baseUrl,
      requestPath,
      healthPath,
      timeoutSeconds: 30,
      cancellation: "supported"
    },
    source,
    confidence,
    riskLevel: "medium",
    riskTags: ["network_access", "external_data_transfer"],
    riskHints: [
      "Found from a known or user-provided local endpoint.",
      "Discovery did not scan the network.",
      "Review data sent to this endpoint before enabling."
    ],
    healthProbeAvailable: true
  };
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.adapter.type}:${candidate.adapter.command ?? candidate.adapter.baseUrl}:${candidate.source}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createCliSpawnPlan(adapter, payload) {
  const payloadJson = JSON.stringify(payload);
  const codexCommandOverride = isCodexCliCommand(adapter.command) ? process.env.MYAGENTTOOL_CODEX_COMMAND : null;
  const claudeCommandOverride = isClaudeCliCommand(adapter.command) ? process.env.MYAGENTTOOL_CLAUDE_COMMAND : null;
  const codexImageAttachments = isCodexCliCommand(adapter.command) ? prepareCodexImageAttachments(payload) : [];
  const argsTemplate = isCodexCliCommand(adapter.command)
    ? insertCodexImageArgs(codexArgsTemplate(adapter, payload), codexImageAttachments)
    : codexArgsTemplate(adapter, payload);
  const renderedArgs = isCodexCliCommand(adapter.command)
    ? applyCodexPermissionMode(renderArgs(argsTemplate, payloadJson, payload), payload)
    : applicationWrapperArgs(
        governedApplyWrapperArgs(governedExecWrapperArgs(governedReviewWrapperArgs(renderArgs(argsTemplate, payloadJson, payload), payload), payload), payload),
        payload,
        { resolveCwd: (spec, metadata) => normalizedExistingPath(spec.cwd) ?? normalizedExistingPath(metadata?.worktreePath) ?? normalizedExistingPath(metadata?.projectPath) },
      );
  const baseCommand = codexCommandOverride || claudeCommandOverride || String(adapter.command);
  const command = adapter.command === "demo-agent" || codexCommandOverride === "fixture"
    ? process.execPath
    : isCodexCliCommand(adapter.command)
      ? codexCommandPlan(adapter, renderedArgs, payload.task).command
      : baseCommand;
  const args = adapter.command === "demo-agent"
    ? [demoAgentPath, ...renderArgs(argsTemplate, payloadJson, payload)]
    : codexCommandOverride === "fixture"
      ? [codexFixtureAgentPath, ...renderedArgs]
      : isCodexCliCommand(adapter.command)
        ? codexCommandPlan(adapter, renderedArgs, payload.task).args
        : renderedArgs;
  const env = buildEnv(withMinimizedAgentEnv(adapter));
  const cwd = adapter.workingDirectoryPolicy === "explicit" && adapter.workingDirectory
    ? String(adapter.workingDirectory)
    : projectCwd(payload);
  const localPolicy = localPolicyForAdapter(adapter, payload);
  return {
    command,
    args,
    env,
    cwd,
    localPolicy,
    sessionMode: payload.options?.codexSessionMode ?? "not_applicable",
    workspacePolicy: payload.options?.codexWorkspacePolicy ?? "current_repo",
    attachments: codexImageAttachments
  };
}

function projectCwd(payload) {
  const projectPath = String(payload.project?.path ?? payload.options?.metadata?.projectPath ?? "").trim();
  if (projectPath && isAbsolute(projectPath) && existsSync(projectPath)) {
    return projectPath;
  }
  return process.cwd();
}

function governedReviewWrapperArgs(renderedArgs, payload) {
  const metadata = payload.options?.metadata && typeof payload.options.metadata === "object" && !Array.isArray(payload.options.metadata)
    ? payload.options.metadata
    : {};
  if (!usesGovernedReviewWrapper(String(metadata.tool ?? ""), renderedArgs)) {
    return renderedArgs;
  }
  const injected = [...renderedArgs];
  const cwd = normalizedExistingPath(metadata.worktreePath) ?? normalizedExistingPath(metadata.projectPath);
  if (cwd && !hasFlag(injected, "--cwd")) {
    injected.push("--cwd", cwd);
  }
  const instruction = boundedString(metadata.instruction, 1200);
  if (instruction && !hasFlag(injected, "--instruction")) {
    injected.push("--instruction", instruction);
  }
  const severityFloor = ["low", "medium", "high"].includes(String(metadata.severityFloor ?? ""))
    ? String(metadata.severityFloor)
    : null;
  if (severityFloor && !hasFlag(injected, "--severity-floor")) {
    injected.push("--severity-floor", severityFloor);
  }
  // Present only for claude.propose.patch — the change to propose. Read-only:
  // the wrapper stays in plan mode and outputs a diff as text, never applies it.
  const task = boundedString(metadata.task, 4000);
  if (task && !hasFlag(injected, "--task")) {
    injected.push("--task", task);
  }
  // Present only for claude.explain.code (#1049) — the code target. The server
  // shape-gated the path (worktree-relative, traversal-free) and the wrapper
  // re-checks filesystem confinement against --cwd before Claude spawns; the
  // bridge refuses to inject a path that fails the same relative-shape test.
  const targetPath = boundedString(metadata.targetPath, 512);
  if (targetPath && !isAbsolute(targetPath) && !targetPath.includes("..") && !hasFlag(injected, "--path")) {
    injected.push("--path", targetPath);
  }
  const targetSymbol = boundedString(metadata.targetSymbol, 200);
  if (targetSymbol && !hasFlag(injected, "--symbol")) {
    injected.push("--symbol", targetSymbol);
  }
  const targetLines = typeof metadata.targetLines === "string" && /^\d+-\d+$/.test(metadata.targetLines)
    ? metadata.targetLines
    : null;
  if (targetLines && !hasFlag(injected, "--lines")) {
    injected.push("--lines", targetLines);
  }
  // Present only for claude.analyze.issue (#1050) — the server-resolved issue
  // reference. The bridge injects the fenced block ONLY when it carries the
  // ADR-0011 BEGIN/END markers (mirrored in the wrapper, which refuses an
  // unfenced body); a raw body can never reach the prompt through this path.
  const issueNumber = Number.isInteger(metadata.issueNumber) && metadata.issueNumber >= 1
    ? String(metadata.issueNumber)
    : null;
  if (issueNumber && !hasFlag(injected, "--issue")) {
    injected.push("--issue", issueNumber);
  }
  const issueBlock = boundedString(metadata.issueUntrustedBlock, 8000);
  const fenced = issueBlock
    && /----- BEGIN ISSUE DESCRIPTION \(untrusted\) -----/.test(issueBlock)
    && /----- END ISSUE DESCRIPTION -----/.test(issueBlock);
  if (fenced && !hasFlag(injected, "--issue-data")) {
    injected.push("--issue-data", issueBlock);
  }
  // Present only for claude.plan.change (#1051) — the optional fenced analysis
  // context (the goal itself rides the --task injection above). Same fence rule:
  // an unfenced block is never injected, and the wrapper refuses one anyway.
  const planContext = boundedString(metadata.planContextBlock, 6000);
  const planFenced = planContext
    && /----- BEGIN ANALYSIS DESCRIPTION \(untrusted\) -----/.test(planContext)
    && /----- END ANALYSIS DESCRIPTION -----/.test(planContext);
  if (planFenced && !hasFlag(injected, "--plan-context")) {
    injected.push("--plan-context", planContext);
  }
  return injected;
}

// Phase 4b: materialize the authorized patch for the Claude apply runner. The
// server sends the patch in metadata (too large for argv); write it to a temp file
// and inject --cwd + --patch-file. The runner git-applies it into the bound
// worktree. Only fires for the governed claude.apply.patch wrapper.
// Delete the temp patch file passed to the apply runner (--patch-file <path>),
// but only when it lives under our own myagenttool-apply temp dir so we never
// remove a caller-supplied file.
function cleanupApplyPatchFile(args) {
  const list = Array.isArray(args) ? args.map(String) : [];
  const idx = list.indexOf("--patch-file");
  const path = idx >= 0 ? list[idx + 1] : null;
  const applyTempDir = join(tmpdir(), "myagenttool-apply");
  if (path && resolve(path).startsWith(resolve(applyTempDir))) {
    try { rmSync(path, { force: true }); } catch { /* best-effort */ }
  }
}

function governedApplyWrapperArgs(renderedArgs, payload) {
  const metadata = payload.options?.metadata && typeof payload.options.metadata === "object" && !Array.isArray(payload.options.metadata)
    ? payload.options.metadata
    : {};
  const usesApplyWrapper = String(metadata.tool ?? "") === "claude.apply.patch"
    && renderedArgs.some((arg) => String(arg).replaceAll("\\", "/").endsWith("tools/agents/claude-apply-wrapper.mjs"));
  if (!usesApplyWrapper) {
    return renderedArgs;
  }
  const injected = [...renderedArgs];
  const cwd = normalizedExistingPath(metadata.worktreePath) ?? normalizedExistingPath(metadata.projectPath);
  if (cwd && !hasFlag(injected, "--cwd")) {
    injected.push("--cwd", cwd);
  }
  // #1052: the deferred verify leg — a read-only run of the allowlisted command
  // in the already-applied worktree. Nothing write-shaped is injected for it;
  // the wrapper additionally refuses any such combination.
  if (metadata.claudeApplyVerify === true) {
    const verifyOnlyId = boundedString(metadata.verifyCommandId, 64);
    if (verifyOnlyId && !hasFlag(injected, "--verify-only")) {
      injected.push("--verify-only", verifyOnlyId);
    }
    return injected;
  }
  const patch = typeof metadata.applyPatch === "string" ? metadata.applyPatch : null;
  if (patch && !hasFlag(injected, "--patch-file")) {
    const dir = join(tmpdir(), "myagenttool-apply");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Name by the (globally unique) invocation id, not payload.id (always
    // undefined here) — the old fixed `patch-<pid>-inv.diff` name left one
    // world-readable diff on disk and overwrote it every run. The wrapper deletes
    // this file when it exits.
    const invocationId = String(payload.invocationId ?? payload.id ?? `inv-${process.pid}`).replace(/[^A-Za-z0-9_-]/g, "");
    const patchFile = join(dir, `patch-${invocationId}.diff`);
    writeFileSync(patchFile, patch, { encoding: "utf8", mode: 0o600 });
    injected.push("--patch-file", patchFile);
  }
  // A governed rollback run re-applies the same server-held patch in reverse; the
  // runner then refuses a reverse that no longer checks cleanly.
  if (metadata.claudeApplyRollback === true && !hasFlag(injected, "--reverse")) {
    injected.push("--reverse");
  }
  // #914: the apply gate stamps the proposal's base commit; the runner refuses a
  // worktree whose HEAD moved off it. Never on rollback — a rollback reverses on
  // top of the APPLIED state, whose HEAD legitimately differs from the base.
  const expectedBase = typeof metadata.expectedBaseCommit === "string" && /^[0-9a-f]{40}$/i.test(metadata.expectedBaseCommit)
    ? metadata.expectedBaseCommit.toLowerCase()
    : null;
  if (expectedBase && metadata.claudeApplyRollback !== true && !hasFlag(injected, "--expect-base")) {
    injected.push("--expect-base", expectedBase);
  }
  // Post-apply verification: an allowlisted command ID (never argv); the wrapper
  // maps it to fixed argv independently and refuses unknown IDs. Never on rollback.
  const verifyId = boundedString(metadata.verifyCommandId, 64);
  if (verifyId && metadata.claudeApplyRollback !== true && !hasFlag(injected, "--verify")) {
    injected.push("--verify", verifyId);
  }
  return injected;
}

function governedExecWrapperArgs(renderedArgs, payload) {
  const metadata = payload.options?.metadata && typeof payload.options.metadata === "object" && !Array.isArray(payload.options.metadata)
    ? payload.options.metadata
    : {};
  const usesExecWrapper = String(metadata.tool ?? "") === "codex.exec"
    && renderedArgs.some((arg) => String(arg).replaceAll("\\", "/").endsWith("tools/agents/codex-exec-wrapper.mjs"));
  if (!usesExecWrapper) {
    return renderedArgs;
  }
  const injected = [...renderedArgs];
  const cwd = normalizedExistingPath(metadata.worktreePath) ?? normalizedExistingPath(metadata.projectPath);
  if (cwd && !hasFlag(injected, "--cwd")) {
    injected.push("--cwd", cwd);
  }
  const task = boundedString(metadata.task, 4000);
  if (task && !hasFlag(injected, "--task")) {
    injected.push("--task", task);
  }
  return injected;
}

function usesGovernedReviewWrapper(tool, args) {
  const wrapper = tool === "codex.review.diff"
    ? "codex-review-wrapper.mjs"
    : tool === "claude.review.diff" || tool === "claude.explain.diff" || tool === "claude.explain.code" || tool === "claude.analyze.issue" || tool === "claude.plan.change" || tool === "claude.propose.patch"
      ? "claude-review-wrapper.mjs"
      : null;
  // Require the full canonical directory segment, not just the basename — a
  // bare-basename match would let a script at an arbitrary path
  // (…/evil/codex-review-wrapper.mjs) receive the injected governed flags.
  // This mirrors the server-side governed-agent gate.
  return Boolean(wrapper) && args.some((arg) => {
    return String(arg).replaceAll("\\", "/").endsWith(`tools/agents/${wrapper}`);
  });
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function normalizedExistingPath(value) {
  const text = String(value ?? "").trim();
  return text && isAbsolute(text) && existsSync(text) ? text : null;
}

function boundedString(value, maxLength) {
  const text = String(value ?? "").trim();
  return text && text.length <= maxLength ? text : null;
}

function codexArgsTemplate(adapter, payload) {
  const args = Array.isArray(adapter.args) && adapter.args.length > 0 ? adapter.args : ["{{payloadJson}}"];
  if (isCodexCliCommand(adapter.command) && payload.options?.codexSessionMode === "continue_last") {
    // True resume (#163): continue the specific provider session the server
    // resolved (resume by id), not whatever ran last globally. See codexResumeArgs
    // for the safe-token guard + `--last` fallback.
    return codexResumeArgs(payload.options);
  }
  return args;
}

function applyCodexPermissionMode(args, payload) {
  if (normalizeCodexApprovalMode(payload.options?.approvalMode ?? payload.options?.metadata?.permissionMode) !== "full") {
    return args;
  }
  if (args.includes("--dangerously-bypass-approvals-and-sandbox")) {
    return args;
  }
  const insertionIndex = args[0] === "exec" ? 1 : 0;
  return [
    ...args.slice(0, insertionIndex),
    "--dangerously-bypass-approvals-and-sandbox",
    ...args.slice(insertionIndex)
  ];
}

function normalizeCodexApprovalMode(value) {
  const normalized = String(value ?? "ask").trim().toLowerCase();
  return ["ask", "auto", "full"].includes(normalized) ? normalized : "ask";
}

function codexCommandPlan(adapter, renderedArgs, task) {
  const commandPrefix = parseCodexCommandJson();
  if (!commandPrefix) {
    return resolveCodexCommandPlan(adapter.command, renderedArgs);
  }
  const [command, ...prefixArgs] = commandPrefix;
  const args = [...prefixArgs, ...dedupeCommandPrefixArgs(prefixArgs, renderedArgs)];
  return {
    command,
    args
  };
}

function resolveCodexCommandPlan(command, args, env = process.env) {
  const rawCommand = String(command ?? "codex");
  if (!isCodexCliCommand(rawCommand) || rawCommand.includes("\\") || rawCommand.includes("/")) {
    return { command: rawCommand, args };
  }
  if (process.platform !== "win32") {
    return { command: rawCommand, args };
  }
  const appDataNpm = env.APPDATA ? resolve(String(env.APPDATA), "npm") : null;
  const appDataPlan = appDataNpm ? codexNpmShimPlan(appDataNpm, args) : null;
  if (appDataPlan) {
    return appDataPlan;
  }
  for (const pathEntry of String(env.PATH ?? "").split(delimiter)) {
    if (!pathEntry) {
      continue;
    }
    const plan = codexNpmShimPlan(pathEntry, args);
    if (plan) {
      return plan;
    }
  }
  return { command: rawCommand, args };
}

function codexNpmShimPlan(directory, args) {
  const commandShim = resolve(directory, "codex.cmd");
  const script = resolve(directory, "node_modules", "@openai", "codex", "bin", "codex.js");
  if (!existsSync(commandShim) || !existsSync(script)) {
    return null;
  }
  return {
    command: process.execPath,
    args: [script, ...args]
  };
}

function parseCodexCommandJson() {
  const raw = String(process.env.MYAGENTTOOL_CODEX_COMMAND_JSON ?? "").trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || !item.trim())) {
      console.error("[desktop] MYAGENTTOOL_CODEX_COMMAND_JSON must be a non-empty JSON string array; ignoring it.");
      return null;
    }
    return parsed.map((item) => item.trim());
  } catch (error) {
    console.error(`[desktop] could not parse MYAGENTTOOL_CODEX_COMMAND_JSON; ignoring it: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function dedupeCommandPrefixArgs(prefixArgs, renderedArgs) {
  if (!prefixArgs.length || !renderedArgs.length) {
    return renderedArgs;
  }
  const lastPrefixArg = String(prefixArgs[prefixArgs.length - 1]).toLowerCase();
  const firstRenderedArg = String(renderedArgs[0]).toLowerCase();
  return lastPrefixArg === firstRenderedArg ? renderedArgs.slice(1) : renderedArgs;
}

async function executionPreview(adapter, spawnPlan, task) {
  const args = previewArgs(adapter, spawnPlan.args, task);
  return {
    adapterType: adapter.type,
    command: spawnPlan.command,
    args,
    commandLine: [spawnPlan.command, ...args].map(shellQuote).join(" "),
    cwd: spawnPlan.cwd,
    taskSummary: summarizeTask(task),
    sessionMode: spawnPlan.sessionMode,
    workspace: await workspacePreview(adapter, spawnPlan),
    environmentPolicy: withMinimizedAgentEnv(adapter).environmentPolicy ?? "inherit_safe",
    envVisible: false,
    attachments: spawnPlan.attachments?.map((attachment) => ({
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      path: attachment.path,
      transport: "codex_image_arg"
    })) ?? []
  };
}

async function workspacePreview(adapter, spawnPlan) {
  if (!isCodexCliCommand(adapter.command)) {
    return null;
  }
  const git = await inspectGitWorkspace(spawnPlan.cwd);
  return {
    policy: spawnPlan.workspacePolicy,
    repoPath: git.repoPath ?? spawnPlan.cwd,
    worktreePath: spawnPlan.workspacePolicy === "current_repo" ? null : "pending_explicit_worktree",
    baseBranch: git.baseBranch,
    branchName: git.branchName,
    dirtyState: git.dirtyState,
    lastCommit: git.lastCommit,
    status: spawnPlan.workspacePolicy === "new_worktree" ? "pending_explicit_creation" : git.status
  };
}

async function inspectGitWorkspace(cwd) {
  const root = await gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root.ok) {
    return {
      status: "unknown",
      repoPath: cwd,
      baseBranch: null,
      branchName: null,
      dirtyState: "unknown",
      lastCommit: null
    };
  }
  // #1266: the three follow-up reads are independent — run them in parallel so a
  // preview costs one git round trip, not three, and never blocks the loop.
  const [branch, commit, dirty] = await Promise.all([
    gitOutput(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    gitOutput(cwd, ["rev-parse", "--short", "HEAD"]),
    gitOutput(cwd, ["status", "--porcelain"]),
  ]);
  return {
    status: "observed",
    repoPath: root.stdout,
    baseBranch: null,
    branchName: branch.ok ? branch.stdout : "unknown",
    dirtyState: dirty.ok ? dirty.stdout ? "dirty" : "clean" : "unknown",
    lastCommit: commit.ok ? commit.stdout : null
  };
}

async function gitOutput(cwd, args) {
  const result = await spawnCapture("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 2000
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? "").trim()
  };
}

function previewArgs(adapter, renderedArgs, task) {
  const templates = Array.isArray(adapter.args) && adapter.args.length > 0 ? adapter.args : ["{{payloadJson}}"];
  const sanitizedTemplates = templates.map((arg) => String(arg).replaceAll("{{payloadJson}}", "<payload-json>").replaceAll("{{task}}", "<task>"));
  if (adapter.command === "demo-agent") {
    return [demoAgentPath, ...sanitizedTemplates];
  }
  if (isCodexCliCommand(adapter.command) && process.env.MYAGENTTOOL_CODEX_COMMAND === "fixture") {
    return [codexFixtureAgentPath, ...sanitizeRenderedArgs(renderedArgs.slice(1), task)];
  }
  return sanitizeRenderedArgs(renderedArgs, task);
}

function sanitizeRenderedArgs(renderedArgs, task) {
  const taskText = String(task ?? "");
  return renderedArgs.map((arg) => {
    const text = String(arg);
    if (taskText && text === taskText) {
      return "[task redacted]";
    }
    if (taskText && text.includes(taskText)) {
      return text.replaceAll(taskText, "[task redacted]");
    }
    return text;
  });
}

function summarizeTask(task) {
  const normalized = String(task ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[a-zA-Z0-9_./:=@{}-]+$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function renderArgs(args, payloadJson, payload) {
  return args.map((arg) => String(arg).replaceAll("{{payloadJson}}", payloadJson).replaceAll("{{task}}", String(payload.task ?? "")));
}

function insertCodexImageArgs(args, attachments) {
  if (!attachments.length) {
    return args;
  }
  const imageArgs = attachments.flatMap((attachment) => ["--image", attachment.path]);
  const taskIndex = args.findIndex((arg) => String(arg).includes("{{task}}"));
  if (taskIndex >= 0) {
    return [...args.slice(0, taskIndex), ...imageArgs, "--", ...args.slice(taskIndex)];
  }
  return [...args, ...imageArgs];
}

function prepareCodexImageAttachments(payload) {
  const attachments = Array.isArray(payload.options?.metadata?.attachments)
    ? payload.options.metadata.attachments
    : [];
  return attachments
    .filter((attachment) => attachment?.included && attachment?.kind === "image" && attachment?.transport?.kind === "data_url")
    .map((attachment, index) => writeCodexImageAttachment(payload, attachment, index))
    .filter(Boolean);
}

function writeCodexImageAttachment(payload, attachment, index) {
  const parsed = parseDataUrl(attachment.transport?.dataUrl);
  if (!parsed || !parsed.mimeType.startsWith("image/")) {
    return null;
  }
  const attachmentRoot = resolve(process.cwd(), ".myagenttool", "attachments", safeId(payload.invocationId ?? "invocation"));
  mkdirSync(attachmentRoot, { recursive: true });
  const fileName = `${String(index + 1).padStart(2, "0")}-${safeAttachmentFileName(attachment.name, parsed.mimeType)}`;
  const filePath = resolve(attachmentRoot, fileName);
  const relativePath = relative(attachmentRoot, filePath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Attachment path escaped managed attachment directory.");
  }
  writeFileSync(filePath, parsed.buffer);
  return {
    name: String(attachment.name ?? fileName),
    type: parsed.mimeType,
    size: parsed.buffer.byteLength,
    path: filePath
  };
}

function parseDataUrl(value) {
  const match = String(value ?? "").match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) {
    return null;
  }
  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  try {
    const buffer = isBase64
      ? Buffer.from(match[3], "base64")
      : Buffer.from(decodeURIComponent(match[3]), "utf8");
    return { mimeType, buffer };
  } catch {
    return null;
  }
}

function safeAttachmentFileName(name, mimeType) {
  const raw = String(name ?? "composer-image").split(/[\\/]/).filter(Boolean).pop() || "composer-image";
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96) || "composer-image";
  if (/\.[a-zA-Z0-9]{1,8}$/.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}${extensionForMime(mimeType)}`;
}

function extensionForMime(mimeType) {
  const map = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp"
  };
  return map[String(mimeType ?? "").toLowerCase()] ?? ".img";
}

// B1b Tier 1 opt-in: when enabled, real CLI coding agents run under the minimized
// env (agent_minimal). The gate + allowlist live in agent-env.mjs (pure/tested);
// an adapter with an explicit/stricter policy is respected as-is. Default OFF —
// env inheritance is byte-for-byte unchanged until the operator opts in.
function withMinimizedAgentEnv(adapter) {
  return shouldMinimizeAgentEnv(adapter, { enabled: minimizeAgentEnvEnabled() })
    ? { ...adapter, environmentPolicy: "agent_minimal" }
    : adapter;
}

function buildEnv(adapter) {
  if (adapter.environmentPolicy === "none") {
    return {};
  }
  const explicitEnv = normalizeEnv(adapter.env);
  if (adapter.environmentPolicy === "explicit_only") {
    return isCodexCliCommand(adapter.command) ? sanitizeCodexChildEnv(withCodexUserDefaults({ ...explicitEnv, ...codexLocalEnv(explicitEnv) })) : explicitEnv;
  }
  if (adapter.environmentPolicy === "agent_minimal") {
    // B1b Tier 1: curated non-secret base + operator env only (agentMinimalBaseEnv).
    // Coding agents authenticate via the LOCAL login state (keychain / ~/.claude /
    // ~/.codex via HOME), not env secrets — so this closes T1 without breaking auth.
    const merged = agentMinimalBaseEnv(process.env, explicitEnv);
    return isCodexCliCommand(adapter.command)
      ? sanitizeCodexChildEnv(withCodexUserDefaults({ ...merged, ...codexLocalEnv(merged) }))
      : merged;
  }
  const baseEnv = { ...process.env, ...explicitEnv };
  baseEnv.PATH = `${managedRuntimeBinDirectory(baseEnv)}${delimiter}${baseEnv.PATH ?? ""}`;
  const inheritedEnv = { ...baseEnv, ...codexLocalEnv(baseEnv), ...explicitEnv };
  return isCodexCliCommand(adapter.command) ? sanitizeCodexChildEnv(withCodexUserDefaults(inheritedEnv)) : inheritedEnv;
}

function normalizeEnv(env) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [String(key), String(value)]));
}

function sanitizeCodexChildEnv(env) {
  const clean = { ...env };
  for (const key of codexParentRuntimeEnvKeys()) {
    delete clean[key];
  }
  return clean;
}

function withCodexUserDefaults(env) {
  const nextEnv = { ...env };
  if (!nextEnv.CODEX_HOME) {
    const userProfile = String(nextEnv.USERPROFILE ?? "").trim();
    const home = String(nextEnv.HOME ?? "").trim();
    const root = process.platform === "win32" ? userProfile || home : home || userProfile;
    if (root) {
      nextEnv.CODEX_HOME = resolve(root, ".codex");
    }
  }
  return nextEnv;
}

function codexLocalEnv(env = process.env) {
  return {
    ...parseEnvFile(resolve(process.cwd(), ".env.local")),
    ...parseEnvFile(resolve(process.cwd(), ".myagenttool", "codex.env")),
    ...parseEnvJson(env.MYAGENTTOOL_CODEX_ENV_JSON, "MYAGENTTOOL_CODEX_ENV_JSON")
  };
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }
  const entries = {};
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = unquoteEnvValue(line.slice(separatorIndex + 1).trim());
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      entries[key] = value;
    }
  }
  return entries;
}

function parseEnvJson(raw, label) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    return normalizeEnv(parsed);
  } catch (error) {
    console.error(`[desktop] could not parse ${label}; ignoring it: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function unquoteEnvValue(value) {
  const text = String(value ?? "");
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function codexParentRuntimeEnvKeys() {
  return [
    "CODEX_SANDBOX_NETWORK_DISABLED",
    "CODEX_CI",
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
    "CODEX_THREAD_ID",
    "CODEX_SESSION_ID",
    "CODEX_PARENT_PID"
  ];
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function safeId(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 48) || "candidate";
}

function highRiskCliCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return ["codex", "codex.cmd", "codex.ps1", "claude", "qwen", "qwen-code", "openclaw", "qclaw"].some((name) => normalized === name || normalized.endsWith(`/${name}`) || normalized.endsWith(`\\${name}`));
}

async function probeCodexCli(adapter) {
  const codexCommandOverride = process.env.MYAGENTTOOL_CODEX_COMMAND;
  const helpArgs = ["exec", "--help"];
  const commandPlan = codexCommandPlan({ ...adapter, command: adapter.command ?? "codex" }, helpArgs, "");
  const command = codexCommandOverride === "fixture"
    ? process.execPath
    : codexCommandOverride || commandPlan.command;
  const args = codexCommandOverride === "fixture"
    ? [codexFixtureAgentPath, "exec", "--help"]
    : commandPlan.args;
  const result = await spawnCapture(command, args, {
    cwd: process.cwd(),
    env: buildEnv({ ...adapter, environmentPolicy: "inherit_safe" }),
    windowsHide: true,
    encoding: "utf8",
    shell: false,
  });
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const hasExecHelp = result.status === 0 && /Run Codex non-interactively|Usage:\s+codex exec/i.test(combined);
  return {
    ok: hasExecHelp,
    summary: hasExecHelp ? "Restricted Codex CLI probe passed." : "Restricted Codex CLI probe failed.",
    details: [
      "Probe used codex exec --help only.",
      "No prompt was executed.",
      "No install scripts were run.",
      "No broad filesystem scan was performed.",
      `Configured output format: ${adapter.outputFormat ?? "unknown"}.`,
      `Configured sandbox: ${adapter.sandbox ?? "unset"}.`,
      hasExecHelp ? "Codex exec surface is available." : `Codex exec help was not detected. Exit: ${result.status ?? "unknown"}.`
    ]
  };
}

async function probeClaudeCli(adapter) {
  const command = process.env.MYAGENTTOOL_CLAUDE_COMMAND || String(adapter.command ?? "claude");
  const result = await spawnCapture(command, ["--help"], {
    cwd: process.cwd(),
    env: buildEnv({ ...adapter, environmentPolicy: "inherit_safe" }),
    windowsHide: true,
    encoding: "utf8",
    shell: false,
  });
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const hasHelp = result.status === 0 && /claude|anthropic|usage/i.test(combined);
  return {
    ok: hasHelp,
    summary: hasHelp ? "Restricted Claude CLI probe passed." : "Restricted Claude CLI probe failed.",
    details: [
      "Probe used claude --help only.",
      "No prompt was executed.",
      "No install scripts were run.",
      `Configured output format: ${adapter.outputFormat ?? "unknown"}.`,
      hasHelp ? "Claude CLI help is available." : `Claude help was not detected. Exit: ${result.status ?? "unknown"}.`
    ]
  };
}

function withBundledAgentProbes(manifest) {
  const codexPrefix = parseCodexCommandJson();
  const claudeCommand = String(process.env.MYAGENTTOOL_CLAUDE_COMMAND ?? "").trim();
  const gitBashCommand = String(process.env.MYAGENTTOOL_GIT_BASH_COMMAND ?? "").trim();
  const gitCommand = String(process.env.MYAGENTTOOL_GIT_COMMAND ?? "").trim();
  return {
    ...manifest,
    applicationWrapperCommands: (manifest.applicationWrapperCommands ?? []).map((entry) => {
      if (entry.command === "codex" && codexPrefix) {
        const [executable, ...prefixArgs] = codexPrefix;
        return { ...entry, probe: { executable, args: [...prefixArgs, "--version"] }, authenticationProbe: { executable, args: [...prefixArgs, "login", "status"], format: "exit-code" } };
      }
      if (entry.command === "claude" && claudeCommand) {
        return { ...entry, probe: { executable: claudeCommand, args: ["--version"] }, authenticationProbe: { executable: claudeCommand, args: ["auth", "status"], format: "claude-json" } };
      }
      if (entry.command === "git-bash" && gitBashCommand) {
        return { ...entry, probe: { executable: gitBashCommand, args: ["--version"] } };
      }
      if (entry.command === "git" && gitCommand) {
        return { ...entry, probe: { executable: gitCommand, args: ["--version"] } };
      }
      return entry;
    }),
  };
}

function isCodexCliCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return ["codex", "codex.cmd", "codex.ps1", "codex.exe"].some((name) => normalized === name || normalized.endsWith(`/${name}`) || normalized.endsWith(`\\${name}`));
}

function isClaudeCliCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return ["claude", "claude.cmd", "claude.ps1", "claude.exe"].some((name) => normalized === name || normalized.endsWith(`/${name}`) || normalized.endsWith(`\\${name}`));
}

function agentRuntimeName(agentName, adapter) {
  const selectedAgentName = typeof agentName === "string" ? agentName.trim() : "";
  if (selectedAgentName) return selectedAgentName;
  if (isCodexCliCommand(adapter?.command)) return "Codex CLI";
  if (isClaudeCliCommand(adapter?.command)) return "Claude CLI";
  return "Demo CLI Agent";
}

function codexCliArgs() {
  return ["exec", "--skip-git-repo-check", "--json", "{{task}}"];
}

function codexRiskTags() {
  return ["read_local", "write_local", "shell_exec", "network_access", "repo_context", "code_change"];
}

async function terminateProcessTree(child, { graceMs = 2000 } = {}) {
  if (!child.pid) {
    return { ok: false, message: "Cannot cancel CLI process because no process id was assigned." };
  }
  if (child.exitCode !== null || child.killed) {
    return { ok: true, message: "Process already exited." };
  }

  if (process.platform === "win32") {
    const graceful = await taskkillTree(child.pid, false);
    if (graceful.ok) {
      const exited = await awaitChildExit(child, graceMs);
      if (exited) return { ok: true, message: "Windows process tree terminated." };
    }
    const forced = await taskkillTree(child.pid, true);
    const alreadyExited = child.exitCode !== null || child.killed;
    return {
      ok: forced.ok || alreadyExited,
      forced: true,
      message: forced.ok
        ? "Windows process tree force-terminated."
        : alreadyExited
          ? "Process already exited before Windows force cancellation completed."
          : forced.message
    };
  }

  const graceful = safeGroupKill(child.pid, "SIGTERM");
  if (!graceful.ok) return graceful;
  const exited = await awaitChildExit(child, graceMs);
  if (exited) {
    return { ok: true, message: "SIGTERM cancellation terminated the CLI process." };
  }
  const forced = safeGroupKill(child.pid, "SIGKILL");
  return {
    ok: forced.ok || child.exitCode !== null || child.killed,
    forced: true,
    message: forced.ok ? "SIGKILL force-terminated the CLI process group." : forced.message
  };
}

function awaitChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.killed) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      cleanup();
      resolveExit(child.exitCode !== null || child.killed);
    }, timeoutMs);
    const onClose = () => {
      cleanup();
      resolveExit(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("close", onClose);
      child.off("exit", onClose);
    };
    child.once("close", onClose);
    child.once("exit", onClose);
  });
}

function safeGroupKill(pid, signal) {
  try {
    process.kill(-pid, signal);
    return { ok: true, message: `${signal} sent to CLI process group.` };
  } catch (error) {
    try {
      process.kill(pid, signal);
      return { ok: true, message: `${signal} sent to CLI process.` };
    } catch (fallbackError) {
      return {
        ok: false,
        message: `${signal} cancellation failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
      };
    }
  }
}

function taskkillTree(pid, force) {
  return new Promise((resolveResult) => {
    const args = ["/pid", String(pid), "/t"];
    if (force) args.push("/f");
    const killer = spawn("taskkill", args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    killer.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    killer.on("close", (code) => {
      resolveResult({
        ok: code === 0,
        message: code === 0
          ? `taskkill ${force ? "force " : ""}terminated the process tree.`
          : `taskkill ${force ? "/f " : ""}failed: ${stderr.trim() || `exit ${code}`}`
      });
    });
    killer.on("error", (error) => {
      resolveResult({
        ok: false,
        message: `taskkill failed to start: ${error instanceof Error ? error.message : String(error)}`
      });
    });
  });
}

async function reportForcedKill(invocationId, runtimeName, result) {
  if (!result?.forced) return;
  await request("POST", "/api/bridge/events", {
    invocationId,
    type: result.ok ? "process_force_killed" : "process_force_kill_failed",
    level: result.ok ? "warn" : "error",
    message: `${runtimeName}: ${result.message}`
  });
}

// #1250: the detached cancel/timeout pollers post events off the main await
// chain. The `settled` guard stops them in the common case, but a post already
// in flight when the run settles can still land after complete — the server
// answers bridge_invocation_not_active. Swallow exactly that (and a missing
// invocation) so it does not surface as an unhandledRejection; anything else is
// a real fault and is logged.
function tolerateLateEvent(label, invocationId, error) {
  if (isInactiveInvocationError(error)) {
    return;
  }
  console.error(`[desktop] ${invocationId} ${label} poller error (continuing): ${error instanceof Error ? error.message : String(error)}`);
}

async function handleAgentLine(invocationId, line, adapter = {}, roundState = null) {
  if (!line) {
    return null;
  }
  if (adapter.outputFormat === "codex_jsonl") {
    return handleCodexJsonLine(invocationId, line, roundState);
  }
  if (adapter.outputFormat === "claude_jsonl") {
    return handleClaudeJsonLine(invocationId, line, roundState);
  }
  if (line.startsWith("RESULT ")) {
    return JSON.parse(line.slice("RESULT ".length));
  }
  await request("POST", "/api/bridge/events", {
    invocationId,
    type: "log",
    level: "info",
    message: line
  });
  return null;
}

async function emitAgentStderrLine(invocationId, adapter = {}, line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) {
    return;
  }
  if (adapter.outputFormat === "codex_jsonl") {
    await request("POST", "/api/bridge/events", codexRuntimeWarningEvent(invocationId, trimmed));
    return;
  }
  await request("POST", "/api/bridge/events", {
    invocationId,
    type: "log",
    level: "warn",
    message: trimmed
  });
}

function codexRuntimeWarningEvent(invocationId, line) {
  const summary = codexRuntimeWarningSummary(line);
  return {
    invocationId,
    type: "codex_runtime_warning",
    level: summary.level,
    message: summary.message,
    data: {
      source: "codex_stderr",
      warningCategory: summary.category,
      redactionState: "summary_only"
    }
  };
}

function codexRuntimeWarningSummary(line) {
  const normalized = String(line ?? "").replace(/\s+/g, " ").trim();
  if (/featured plugins?/i.test(normalized) && /401|unauthorized/i.test(normalized)) {
    return {
      level: "warn",
      category: "plugin_catalog_auth",
      message: "Codex plugin catalog warning: Codex CLI could not refresh featured plugins authorization. The task can still complete."
    };
  }
  if (/command timed out after \d+ milliseconds/i.test(normalized)) {
    const redacted = redactLocalPaths(normalized);
    return {
      level: "info",
      category: "command_timeout",
      message: `Codex command note: ${redacted.length > 180 ? `${redacted.slice(0, 177)}...` : redacted}`
    };
  }
  if (looksLikeImageFileListing(normalized)) {
    const redacted = redactLocalPaths(normalized);
    return {
      level: "info",
      category: "command_output_noise",
      message: `Codex command output note: ignored unrelated local image listing (${redacted.length > 140 ? `${redacted.slice(0, 137)}...` : redacted}).`
    };
  }
  const redacted = redactLocalPaths(normalized);
  return {
    level: "info",
    category: "codex_cli_stderr",
    message: `Codex runtime note: ${redacted.length > 180 ? `${redacted.slice(0, 177)}...` : redacted}`
  };
}

function redactLocalPaths(value) {
  let redacted = String(value ?? "");
  for (const home of [process.env.HOME, process.env.USERPROFILE]) {
    if (home) {
      redacted = redacted.split(home).join("<home>");
    }
  }
  return redacted;
}

function looksLikeImageFileListing(value) {
  return /(?:^|\s)[A-Za-z]:\\[^\n]+?\.(?:png|jpe?g|gif|webp|bmp|tiff?)\b/i.test(value)
    && /\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/.test(value)
    && /\b\d{2}:\d{2}(?::\d{2})?\b/.test(value);
}

async function sendCodexHookEvent(invocationId, adapter, event) {
  if (adapter?.outputFormat !== "codex_jsonl") {
    return null;
  }
  return request("POST", "/api/codex/hooks", {
    invocationId,
    eventName: event.eventName,
    toolName: event.toolName ?? null,
    summary: event.summary ?? event.eventName,
    timeoutSeconds: event.timeoutSeconds ?? null
  });
}

async function waitForCodexApprovalDecision(hookResult) {
  const requestId = hookResult?.brokerRequest?.id;
  if (!requestId) {
    return "not_required";
  }
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await request("GET", `/api/codex/approval-broker/${encodeURIComponent(requestId)}`);
    const status = response?.approvalRequest?.status;
    if (status === "approved" || status === "denied" || status === "timed_out") {
      return status;
    }
    await delay(250);
  }
  return "denied";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeTaskForHook(task) {
  const normalized = String(task ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Empty prompt";
  }
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
}

async function emitRoundEvents(invocationId, roundState, event, emitter) {
  if (!roundState) return;
  const emits = emitter(roundState, event, new Date().toISOString());
  for (const emit of emits) {
    await request("POST", "/api/bridge/events", { invocationId, ...emit });
  }
}

async function handleClaudeJsonLine(invocationId, line, roundState = null) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    await request("POST", "/api/bridge/events", {
      invocationId,
      type: "agent_output",
      level: "info",
      message: line
    });
    return null;
  }

  await emitRoundEvents(invocationId, roundState, event, claudeRoundEmits);

  // The init event carries the run's request-setup summary (model, permission
  // mode, tool/MCP/skill/agent inventory). Report it once so the console can show
  // what the call was dispatched with — NOT the raw system prompt (the CLI never
  // emits that; only a wire proxy can see it).
  const requestContext = claudeRequestContext(event);
  if (requestContext) {
    await request("POST", "/api/bridge/events", {
      invocationId,
      type: "request_context",
      level: "info",
      message: "Claude request context captured.",
      data: requestContext,
    });
  }

  const message = claudeEventMessage(event);
  if (message) {
    const fileAccess = extractClaudeFileAccesses(event);
    await request("POST", "/api/bridge/events", {
      invocationId,
      type: "agent_output",
      level: event.type === "error" ? "warn" : "info",
      message,
      data: {
        source: "claude_jsonl",
        eventType: event.type ?? null,
        subtype: event.subtype ?? null,
        sessionId: event.session_id ?? event.sessionId ?? null,
        model: event.message?.model ?? event.model ?? null,
        usage: event.usage ?? event.message?.usage ?? null,
        ...(fileAccess.length ? { fileAccess } : {}),
      }
    });
  }

  if (event.type === "result" || event.subtype === "success" || event.result || event.summary) {
    const summary = String(event.result ?? event.summary ?? message ?? "Claude CLI completed.").trim();
    // Claude's result event reports a real total_cost_usd + token usage; surface
    // them so the server can attribute the run to the ledger/budget instead of
    // marking it unknown.
    const usage = event.usage ?? event.message?.usage ?? null;
    const amountUsd = Number(event.total_cost_usd ?? event.cost_usd);
    const reported = Number.isFinite(amountUsd) && amountUsd > 0;
    return {
      summary: summary.length > 240 ? `${summary.slice(0, 237)}...` : summary,
      touchedUserFiles: false,
      output: {
        latestMessage: summary,
        usage,
      },
      cost: {
        model: event.message?.model ?? event.model ?? "claude",
        billable: true,
        unknown: !reported,
        currency: "USD",
        inputTokens: Number(usage?.input_tokens ?? 0) || 0,
        outputTokens: Number(usage?.output_tokens ?? 0) || 0,
        ...(reported ? { amountUsd, amountSource: "reported" } : {})
      }
    };
  }

  return null;
}

function claudeEventMessage(event) {
  if (event.type === "system" && event.subtype === "init") return `Claude session started: ${event.session_id ?? "unknown"}.`;
  if (event.type === "assistant") {
    const text = claudeMessageText(event.message?.content ?? event.content);
    return text || "Claude assistant message received.";
  }
  if (event.type === "user") return "Claude user message acknowledged.";
  if (event.type === "result") return String(event.result ?? event.summary ?? "Claude result received.");
  if (event.type === "error") return `Claude error: ${event.message ?? event.error?.message ?? "unknown error"}.`;
  if (event.message?.content) return claudeMessageText(event.message.content);
  return event.type ? `Claude event: ${event.type}.` : null;
}

function claudeMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const text = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text;
      if (part?.type === "tool_use") return `[tool: ${part.name ?? "unknown"}]`;
      if (part?.type === "tool_result") return "[tool result]";
      return "";
    })
    .filter(Boolean)
    .join(" ");
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

async function handleCodexJsonLine(invocationId, line, roundState = null) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    await request("POST", "/api/bridge/events", {
      invocationId,
      type: "agent_output",
      level: "info",
      message: line
    });
    return null;
  }

  await emitRoundEvents(invocationId, roundState, event, codexRoundEmits);

  const message = codexEventMessage(event);
  if (message) {
    await request("POST", "/api/bridge/events", {
      invocationId,
      type: "agent_output",
      level: event.type === "turn.failed" || event.type === "error" ? "warn" : "info",
      message,
      data: {
        source: "codex_jsonl",
        eventType: event.type,
        itemType: event.item?.type ?? null,
        threadId: event.thread_id ?? null,
        sessionId: event.session_id ?? event.sessionId ?? null,
        commandSummary: codexCommandSummary(event),
        fileChangeSummary: codexFileChangeSummary(event),
        fileChangePath: codexFileChangePath(event),
        fileChangeAction: codexFileChangeAction(event),
        diffPreview: codexDiffPreview(event),
        changeRisk: codexChangeRisk(event)
      }
    });
  }

  if (event.type === "turn.completed") {
    const usage = event.usage ?? null;
    return {
      summary: "Codex CLI completed.",
      touchedUserFiles: Boolean(roundState?.touchedUserFiles),
      output: { usage },
      // Codex reports token usage but no billed USD. Carry the full token
      // breakdown so the server can estimate cost from configured per-token rates
      // (cached input is cheaper); when no rate is set it falls back to an
      // unmetered entry so the run still stays visible in economics.
      cost: {
        model: "codex",
        billable: true,
        unknown: true,
        currency: "USD",
        inputTokens: Number(usage?.input_tokens ?? 0) || 0,
        cachedInputTokens: Number(usage?.cached_input_tokens ?? 0) || 0,
        outputTokens: Number(usage?.output_tokens ?? 0) || 0,
        reasoningOutputTokens: Number(usage?.reasoning_output_tokens ?? 0) || 0
      }
    };
  }

  if (event.item?.type === "agent_message" && event.item?.text) {
    return {
      summary: String(event.item.text),
      touchedUserFiles: false,
      output: { latestMessage: String(event.item.text) },
      cost: { model: "codex", billable: true, unknown: true }
    };
  }

  return null;
}

function codexEventMessage(event) {
  if (event.type === "thread.started") return `Codex thread started: ${event.thread_id ?? "unknown"}.`;
  if (event.type === "turn.started") return "Codex turn started.";
  if (event.type === "turn.completed") return "Codex turn completed.";
  if (event.type === "turn.failed") return `Codex turn failed: ${event.error?.message ?? "unknown error"}.`;
  if (event.type === "error") return `Codex error: ${event.message ?? event.error?.message ?? "unknown error"}.`;
  if (event.item?.type === "agent_message" && event.item?.text) return String(event.item.text);
  if (event.item?.type) return `Codex event: ${event.item.type}.`;
  return null;
}

function codexCommandSummary(event) {
  if (event.item?.type !== "command_execution") {
    return null;
  }
  const command = String(event.item.command ?? "").replace(/\s+/g, " ").trim();
  if (!command) {
    return "Command execution";
  }
  return command.length > 160 ? `${command.slice(0, 157)}...` : command;
}

function codexFileChangeSummary(event) {
  const item = event.item ?? {};
  if (!["file_change", "file_changes"].includes(item.type)) {
    return null;
  }
  const path = codexFileChangePath(event);
  const action = codexFileChangeAction(event);
  return path ? `${action}: ${path}` : action;
}

function codexFileChangePath(event) {
  const item = event.item ?? {};
  if (!["file_change", "file_changes"].includes(item.type)) {
    return null;
  }
  return String(item.path ?? item.file ?? item.files?.[0]?.path ?? "").trim() || null;
}

function codexFileChangeAction(event) {
  const item = event.item ?? {};
  if (!["file_change", "file_changes"].includes(item.type)) {
    return null;
  }
  return String(item.action ?? item.change_type ?? item.status ?? "changed").trim() || "changed";
}

function codexDiffPreview(event) {
  const item = event.item ?? {};
  if (!["file_change", "file_changes"].includes(item.type)) {
    return null;
  }
  const diff = String(item.diff ?? item.patch ?? item.diffPreview ?? item.summary ?? "").trim();
  if (!diff) {
    return null;
  }
  return diff.length <= 4000 ? diff : `${diff.slice(0, 3997)}...`;
}

function codexChangeRisk(event) {
  const item = event.item ?? {};
  if (!["file_change", "file_changes"].includes(item.type)) {
    return null;
  }
  const normalized = String(item.risk ?? item.riskLevel ?? "unknown").trim().toLowerCase();
  return ["low", "medium", "high", "critical"].includes(normalized) ? normalized : "unknown";
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const health = await request("GET", "/health");
      if (health?.status === "ok") {
        return;
      }
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Server did not become ready at ${serverUrl}`);
}

async function request(method, path, body) {
  const headers = {
    ...(bridgeToken ? { Authorization: `Bearer ${bridgeToken}` } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
  };
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 204) {
    return null;
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${JSON.stringify(data)}`);
  }
  return data;
}

function loadBridgeToken() {
  try {
    if (!existsSync(bridgeTokenPath)) return "";
    const data = JSON.parse(readFileSync(bridgeTokenPath, "utf8"));
    return typeof data?.token === "string" ? data.token.trim() : "";
  } catch {
    return "";
  }
}

function saveBridgeToken(token, credential = null) {
  try {
    mkdirSync(dirname(bridgeTokenPath), { recursive: true });
    writeFileSync(bridgeTokenPath, `${JSON.stringify({
      token,
      credentialId: credential?.id ?? null,
      tokenPrefix: credential?.tokenPrefix ?? String(token ?? "").slice(0, 8),
      serverUrl,
      savedAt: new Date().toISOString(),
    }, null, 2)}\n`);
  } catch (error) {
    console.error(`[desktop] could not save bridge credential: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stop() {
  stopped = true;
  clearInterval(timer);
  clearInterval(terminalTimer);
  clearInterval(binaryReadinessTimer);
  cancellationWatcher.stop();
  process.exit(0);
}
