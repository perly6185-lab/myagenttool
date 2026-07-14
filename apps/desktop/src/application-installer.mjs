import crypto from "node:crypto";
import { spawn } from "node:child_process";

const SCHEMA_VERSION = "application-install-plan/v1";
const RECIPE_VERSION = "2026-07-14.1";

const RECIPES = {
  git: {
    windows: ["winget", ["install", "--id", "Git.Git", "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements"], "Git.Git"],
    macos: ["brew", ["install", "git"], "git"],
    linux: ["apt-get", ["install", "-y", "git"], "git"],
  },
  ccusage: {
    windows: ["npm.cmd", ["install", "--global", "ccusage@latest"], "ccusage@latest"],
    macos: ["npm", ["install", "--global", "ccusage@latest"], "ccusage@latest"],
    linux: ["npm", ["install", "--global", "ccusage@latest"], "ccusage@latest"],
  },
  claude: {
    windows: ["npm.cmd", ["install", "--global", "@anthropic-ai/claude-code@latest"], "@anthropic-ai/claude-code@latest"],
    macos: ["npm", ["install", "--global", "@anthropic-ai/claude-code@latest"], "@anthropic-ai/claude-code@latest"],
    linux: ["npm", ["install", "--global", "@anthropic-ai/claude-code@latest"], "@anthropic-ai/claude-code@latest"],
  },
};

function bridgePlatform(value = process.platform) {
  if (value === "win32" || value === "windows") return "windows";
  if (value === "darwin" || value === "macos") return "macos";
  if (value === "linux") return "linux";
  return String(value);
}

function sameArgs(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => String(value) === expected[index]);
}

function expectedFingerprint(plan, executable, args, resolvedIdentifier) {
  const identity = {
    schemaVersion: SCHEMA_VERSION,
    recipeVersion: RECIPE_VERSION,
    application: plan.application.name,
    projectId: plan.target.projectId ?? null,
    deviceId: plan.target.deviceId,
    platform: plan.target.platform,
    architecture: plan.target.architecture ?? null,
    provider: plan.package.provider,
    packageIdentifier: resolvedIdentifier,
    executable,
    args,
  };
  return crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export function resolveApplicationInstallSpawnPlan(plan, { platform = process.platform } = {}) {
  if (!plan || plan.schemaVersion !== SCHEMA_VERSION || plan.recipeVersion !== RECIPE_VERSION) return null;
  const targetPlatform = bridgePlatform(platform);
  if (plan.target?.platform !== targetPlatform || plan.execution?.shell !== false) return null;
  const recipe = RECIPES[plan.application?.name]?.[targetPlatform];
  if (!recipe) return null;
  const [executable, args, resolvedIdentifier] = recipe;
  const expectedProvider = plan.application?.name === "git"
    ? { windows: "winget", macos: "homebrew", linux: "apt" }[targetPlatform]
    : "npm";
  const expectedIdentifier = { git: "git", ccusage: "ccusage", claude: "@anthropic-ai/claude-code" }[plan.application?.name];
  const expectedProbe = plan.application?.name === "git" ? "git" : plan.application?.name === "claude" ? "claude" : "ccusage";
  if (plan.execution.executable !== executable || !sameArgs(plan.execution.args, args)) return null;
  if (plan.package?.provider !== expectedProvider || plan.package?.identifier !== expectedIdentifier || plan.package?.resolvedIdentifier !== resolvedIdentifier) return null;
  if (plan.execution.elevated !== (plan.application?.name === "git" && targetPlatform === "linux")) return null;
  if (plan.approval?.required !== true || plan.approval?.action !== "application.install" || plan.approval?.bindsToPlanFingerprint !== true) return null;
  if (plan.policy?.timeoutMs !== 300_000 || plan.policy?.cancellable !== true) return null;
  if (plan.postInstallProbe?.executable !== expectedProbe || !sameArgs(plan.postInstallProbe?.args, ["--version"]) || plan.postInstallProbe?.timeoutMs !== 15_000) return null;
  const fingerprint = expectedFingerprint(plan, executable, args, resolvedIdentifier);
  if (plan.fingerprint !== fingerprint || plan.planId !== `aip_${fingerprint.slice(0, 24)}`) return null;
  return { command: executable, args: [...args], timeoutMs: Math.max(1_000, Math.min(900_000, Number(plan.policy?.timeoutMs ?? 300_000))) };
}

export async function runApprovedApplicationInstall({
  plan,
  platform = process.platform,
  spawnProcess = spawn,
  env = process.env,
  pollCancellation = async () => false,
  onProgress = async () => {},
  terminate = async (child) => ({ ok: child.kill(), message: "Installation process termination requested." }),
  scheduleTimeout = setTimeout,
  clearScheduledTimeout = clearTimeout,
}) {
  const spawnPlan = resolveApplicationInstallSpawnPlan(plan, { platform });
  if (!spawnPlan) {
    return { status: "refused", classification: "plan_not_allowlisted", summary: "Desktop Bridge refused a stale or modified Application installation plan.", exitCode: null, durationMs: null };
  }
  await onProgress({ type: "spawning", summary: `Starting approved ${plan.application.displayName} installation.` });
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let cancelled = false;
    let timedOut = false;
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearScheduledTimeout(timeoutTimer);
      clearInterval(cancelTimer);
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };
    try {
      child = spawnProcess(spawnPlan.command, spawnPlan.args, {
        cwd: process.cwd(), env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ status: "failed", classification: "spawn_failed", summary: `Approved installation failed to start: ${error instanceof Error ? error.message : String(error)}`, exitCode: null, durationMs: Date.now() - startedAt });
      return;
    }
    const watchChild = (current, phase) => {
      current.stdout?.resume?.();
      current.stderr?.resume?.();
      current.on("error", (error) => finish({
        status: "failed",
        classification: phase === "probe" ? "probe_spawn_failed" : "spawn_failed",
        summary: `${phase === "probe" ? "Post-install probe" : "Approved installation"} failed to start: ${error.message}`,
        exitCode: null,
      }));
      current.on("close", async (code) => {
        if (cancelled) return finish({ status: "cancelled", classification: "cancelled", summary: "Application installation was cancelled locally.", exitCode: Number.isInteger(code) ? code : null });
        if (timedOut) return finish({ status: "timed_out", classification: "timeout", summary: "Application installation exceeded its approved timeout.", exitCode: Number.isInteger(code) ? code : null });
        if (phase === "install" && code === 0) {
          await onProgress({ type: "probing", summary: `Verifying ${plan.application.displayName} readiness.` });
          try {
            child = spawnProcess(plan.postInstallProbe.executable, [...plan.postInstallProbe.args], {
              cwd: process.cwd(), env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
            });
            watchChild(child, "probe");
          } catch (error) {
            finish({ status: "failed", classification: "probe_spawn_failed", summary: `Post-install probe failed to start: ${error instanceof Error ? error.message : String(error)}`, exitCode: null });
          }
          return;
        }
        const succeeded = code === 0;
        const classification = succeeded ? "installed_and_ready" : phase === "probe" ? "probe_failed" : "nonzero_exit";
        const summary = succeeded
          ? `${plan.application.displayName} installation and readiness probe completed.`
          : phase === "probe"
            ? `${plan.application.displayName} installed, but its readiness probe failed with exit code ${code ?? "unknown"}.`
            : `${plan.application.displayName} installation failed with exit code ${code ?? "unknown"}.`;
        return finish({ status: succeeded ? "succeeded" : "failed", classification, summary, exitCode: Number.isInteger(code) ? code : null });
      });
    };
    watchChild(child, "install");
    const timeoutTimer = scheduleTimeout(async () => {
      timedOut = true;
      await terminate(child);
    }, spawnPlan.timeoutMs);
    const cancelTimer = setInterval(async () => {
      if (cancelled || timedOut || settled) return;
      if (await pollCancellation()) {
        cancelled = true;
        await onProgress({ type: "cancelling", summary: "Cancelling approved Application installation." });
        await terminate(child);
      }
    }, 500);
  });
}
