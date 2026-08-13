import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { startVerificationProcessGuardian } from "../runtime/verification-process-guardian.mjs";

// The auto-run verification gate runs a project-owner-configured command in the
// worktree before a PR is opened. The command is resolved from an env var (not
// agent-proposed input) so the trust boundary is respected — an editing agent
// can never choose what runs here. Array form, no shell, mirroring the
// MYAGENTTOOL_GH_COMMAND_JSON contract.
function isArgv(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

export function resolveAutoRunVerifyCommand(env = process.env) {
  const raw = env.MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (isArgv(parsed)) return parsed;
  } catch {
    /* fall through to null */
  }
  return null;
}

// A4: named verify-command allowlist. The operator defines named commands in env
// (MYAGENTTOOL_AUTORUN_VERIFY_COMMANDS_JSON = { name: [argv], ... }); a project
// selects one BY NAME. This keeps per-project verify configurable while the argv
// stays operator-set — the UI/API only ever sets a name (a key), never a command,
// so the trust boundary holds. Returns a { name: argv } map of valid entries.
export function resolveVerifyCommandAllowlist(env = process.env) {
  const raw = env.MYAGENTTOOL_AUTORUN_VERIFY_COMMANDS_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = {};
    for (const [name, argv] of Object.entries(parsed)) {
      if (typeof name === "string" && name.trim() && isArgv(argv)) out[name] = argv;
    }
    return out;
  } catch {
    return {};
  }
}

// The verify command for a run: the project's chosen allowlisted name if valid,
// else the global single command (back-compat). Name that isn't in the allowlist
// falls back (never runs an unlisted command).
export function resolveAutoRunVerifyCommandFor({ verifyCommandName = null, env = process.env } = {}) {
  if (verifyCommandName) {
    const allow = resolveVerifyCommandAllowlist(env);
    if (allow[verifyCommandName]) return allow[verifyCommandName];
  }
  return resolveAutoRunVerifyCommand(env);
}

function safeChangedPath(value) {
  const normalized = String(value ?? "").replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../") || /^[A-Za-z]:/.test(normalized)) return null;
  return normalized;
}

function unique(values) {
  return [...new Set(values)];
}

// Local/dev installations should not silently turn every successful agent
// report into an "unverified success". When the operator has not selected an
// explicit allowlisted command, this deterministic planner derives platform-run
// checks from the files changed on the branch. Test paths are argv values (never
// shell input), and only repository-relative paths are admitted.
export function resolveAutoRunVerificationPlan({
  verifyCommandName = null,
  changedPaths = [],
  repositoryRoot = null,
  env = process.env,
} = {}) {
  const configured = resolveAutoRunVerifyCommandFor({ verifyCommandName, env });
  if (configured) return [configured];
  if (String(env.MYAGENTTOOL_AUTORUN_VERIFY_AUTO ?? "") !== "1") return [];

  const paths = unique(changedPaths.map(safeChangedPath).filter(Boolean)).slice(0, 100);
  const nodeTests = paths.filter((path) =>
    /\.(?:test|spec)\.(?:mjs|cjs|js)$/.test(path)
    && !path.startsWith("apps/web/"));
  const webTests = paths.filter((path) =>
    path.startsWith("apps/web/")
    && /\.(?:test|spec)\.(?:tsx?|jsx?)$/.test(path));
  const commands = [];
  const capabilities = verificationRepositoryCapabilities(repositoryRoot);

  // Documentation-only changes should not fan out the repository's entire test
  // matrix. Besides being disproportionate, two concurrent Auto-runs can make
  // unrelated integration suites contend for the same local ports and produce
  // false failures. The repository-owned docs check is deterministic, exercises
  // every Markdown relative link, and does not start application services.
  const docsOnly = paths.length > 0 && paths.every((path) =>
    path === "README.md"
    || path.startsWith("docs/")
    || path.endsWith(".md"));
  if (docsOnly && capabilities.docsCheck) {
    commands.push([
      "pwsh",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "tools/docs/check-markdown-links.ps1",
    ]);
  }

  if (nodeTests.length) commands.push(["node", "--test", ...nodeTests]);
  if (webTests.length && capabilities.pnpmWorkspace) {
    // `pnpm --filter` runs the script with apps/web as cwd, so Vitest needs
    // package-relative paths; repository-relative paths make it miss the target
    // and fall back to the entire Web suite.
    commands.push([
      "pnpm",
      "--filter",
      "@myagenttool/web",
      "test:unit",
      "--",
      ...webTests.map((path) => path.slice("apps/web/".length)),
    ]);
  }

  const typecheckFilters = [];
  if (capabilities.pnpmWorkspace && paths.some((path) => path.startsWith("packages/protocol/"))) typecheckFilters.push("@myagenttool/protocol");
  if (capabilities.pnpmWorkspace && paths.some((path) => path.startsWith("apps/server/"))) typecheckFilters.push("@myagenttool/server");
  if (capabilities.pnpmWorkspace && paths.some((path) => path.startsWith("apps/web/"))) typecheckFilters.push("@myagenttool/web");
  for (const filter of typecheckFilters) {
    commands.push(["pnpm", "--filter", filter, "typecheck"]);
  }

  // A branch without discoverable targeted tests still receives a real,
  // platform-owned gate. This is intentionally slower than inventing a pass.
  if (!commands.length && capabilities.testCi) commands.push(["pnpm", "test:ci"]);
  return commands;
}

export function verificationRepositoryCapabilities(repositoryRoot = null) {
  // Callers that only need deterministic command classification can omit a
  // repository root. Runtime callers always provide the actual worktree so a
  // business-document folder never inherits assumptions from this source repo.
  if (!repositoryRoot) {
    return { packageManifest: true, pnpmWorkspace: true, docsCheck: true, testCi: true };
  }
  const packagePath = join(repositoryRoot, "package.json");
  const packageManifest = existsSync(packagePath);
  let testCi = false;
  if (packageManifest) {
    try {
      const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
      testCi = typeof manifest?.scripts?.["test:ci"] === "string" && Boolean(manifest.scripts["test:ci"].trim());
    } catch {
      testCi = false;
    }
  }
  return {
    packageManifest,
    pnpmWorkspace: packageManifest && existsSync(join(repositoryRoot, "pnpm-workspace.yaml")),
    docsCheck: existsSync(join(repositoryRoot, "tools", "docs", "check-markdown-links.ps1")),
    testCi,
  };
}

export function autoRunVerificationTimeoutMs(env = process.env) {
  const value = Number(env.MYAGENTTOOL_AUTORUN_VERIFY_TIMEOUT_MS ?? 900_000);
  return Number.isFinite(value) ? Math.max(30_000, Math.min(3_600_000, value)) : 900_000;
}

export function resolveVerificationInvocation(command, args = [], {
  platform = process.platform,
  env = process.env,
  fileExists = existsSync,
  nodePath = process.execPath,
} = {}) {
  if (platform === "win32" && command === "pnpm") {
    const candidates = [
      env.npm_execpath,
      env.APPDATA ? join(env.APPDATA, "npm", "node_modules", "pnpm", "bin", "pnpm.cjs") : null,
    ].filter(Boolean);
    const cli = candidates.find((candidate) => /pnpm(?:\.cjs)?$/i.test(candidate) && fileExists(candidate))
      ?? candidates.find((candidate) => /pnpm[\\/].*pnpm\.cjs$/i.test(candidate) && fileExists(candidate));
    if (cli) return { executable: nodePath, args: [cli, ...args] };
    return { executable: "pnpm.cmd", args };
  }
  return { executable: command, args };
}

// Run the verification command in the worktree. Returns a structured result:
// `verified` = a real check ran; `passed` = it exited 0. Never throws — a spawn
// failure is reported as a failed (but verified) check so the gate blocks.
export async function runWorktreeVerification({
  cwd,
  command,
  timeoutMs = 300_000,
  signal = null,
  startGuardian = startVerificationProcessGuardian,
}) {
  const [cmd, ...args] = command;
  const label = command.join(" ");
  if (signal?.aborted) return abortedVerification(label);
  const invocation = resolveVerificationInvocation(cmd, args);
  return new Promise((resolveResult) => {
    let child;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let spawnError = null;
    let terminationPromise = null;
    const appendBounded = (current, chunk) =>
      `${current}${String(chunk)}`.slice(-(8 * 1024 * 1024));
    const finish = async (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if ((aborted || timedOut) && terminationPromise) {
        await terminationPromise;
      }
      if (aborted) {
        resolveResult(abortedVerification(label));
        return;
      }
      const code = typeof exitCode === "number"
        ? exitCode
        : typeof spawnError?.code === "number"
          ? spawnError.code
          : 1;
      if (code === 0 && !spawnError && !timedOut) {
        resolveResult({ passed: true, verified: true, exitCode: 0, command: label, summary: `\`${label}\` passed.` });
        return;
      }
      const diagnostic = [stdout, stderr, spawnError?.message, timedOut ? `Timed out after ${timeoutMs}ms.` : null]
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
        .join("\n");
      const tail = diagnostic.split("\n").slice(-8).join("\n").trim();
      resolveResult({
        passed: false,
        verified: true,
        repairable: verificationFailureIsRepairable({ command: label, summary: diagnostic }),
        exitCode: code,
        command: label,
        summary: `\`${label}\` failed (exit ${code}).${tail ? ` Output:\n${tail}` : ""}`,
      });
    };
    const stopTree = () => {
      if (!child || child.exitCode !== null) return terminationPromise ?? Promise.resolve();
      terminationPromise ??= terminateVerificationProcessTree(child);
      return terminationPromise;
    };
    const onAbort = () => {
      aborted = true;
      stopTree();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stopTree();
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      child = spawn(invocation.executable, invocation.args, {
        cwd,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      startGuardian?.(child);
      child.stdout?.on("data", (chunk) => {
        stdout = appendBounded(stdout, chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr = appendBounded(stderr, chunk);
      });
      child.once("error", (error) => {
        spawnError = error;
        void finish(typeof error?.code === "number" ? error.code : 1);
      });
      child.once("close", (code) => void finish(code));
      if (signal?.aborted) onAbort();
    } catch (error) {
      spawnError = error;
      void finish(typeof error?.code === "number" ? error.code : 1);
    }
  });
}

export async function runWorktreeVerificationPlan({ cwd, commands, timeoutMs = 900_000, signal = null }) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return { passed: true, verified: false, commands: [], summary: "No verification command configured." };
  }
  const executionCommands = [...commands];
  if (
    executionCommands.some((command) => command[0] === "pnpm")
    && !existsSync(join(cwd, "node_modules"))
  ) {
    // Managed worktrees intentionally do not copy node_modules. Restore links
    // from the already-populated local pnpm store before running target checks;
    // offline mode prevents a verification click from performing network I/O.
    executionCommands.unshift(["pnpm", "install", "--offline", "--frozen-lockfile"]);
  }
  const results = [];
  for (const command of executionCommands) {
    if (signal?.aborted) {
      return { passed: false, verified: false, aborted: true, commands: results.map((item) => item.command), summary: "Verification aborted because its Auto-run reaction was superseded." };
    }
    const result = await runWorktreeVerification({ cwd, command, timeoutMs, signal });
    results.push(result);
    if (result.aborted) {
      return {
        passed: false,
        verified: false,
        aborted: true,
        commands: results.map((item) => item.command),
        summary: result.summary,
      };
    }
    if (!result.passed) {
      return {
        passed: false,
        verified: true,
        repairable: result.repairable,
        commands: results.map((item) => item.command),
        exitCode: result.exitCode,
        summary: results.map((item) => item.summary).join("\n"),
      };
    }
  }
  return {
    passed: true,
    verified: true,
    commands: results.map((item) => item.command),
    exitCode: 0,
    summary: results.map((item) => item.summary).join("\n"),
  };
}

export function verificationFailureIsRepairable({ command = "", summary = "" } = {}) {
  const diagnostic = `${command}\n${summary}`;
  return ![
    /ERR_PNPM_NO_PKG_MANIFEST/i,
    /No package\.json found/i,
    /is not recognized as the name of a script file/i,
    /cannot find (?:the )?(?:file|path|module)/i,
    /ENOENT/i,
    /command not found/i,
    /not recognized as an internal or external command/i,
  ].some((pattern) => pattern.test(diagnostic));
}

function abortedVerification(label) {
  return {
    passed: false,
    verified: false,
    aborted: true,
    exitCode: null,
    command: label,
    summary: `\`${label}\` aborted because its Auto-run reaction was superseded.`,
  };
}

function terminateVerificationProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolveKill) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The verification process already exited.
        }
        resolveKill();
      });
      killer.once("close", (code) => {
        if (code !== 0 && child.exitCode === null) {
          try {
            child.kill("SIGKILL");
          } catch {
            // The verification process already exited.
          }
        }
        resolveKill();
      });
    });
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The verification process already exited.
    }
  }
  return Promise.resolve();
}
