import crypto from "node:crypto";
import { spawn } from "node:child_process";

const SCHEMA_VERSION = "application-install-plan/v1";
const RECIPE_VERSION = "2026-07-16.1";
const PLAN_TTL_MS = 10 * 60 * 1000;
const NPM_REGISTRY = "https://registry.npmjs.org/";

const RECIPES = {
  git: {
    windows: ["winget", ["install", "--id", "Git.Git", "--version", "2.50.1", "--exact", "--source", "winget", "--silent", "--disable-interactivity", "--accept-package-agreements", "--accept-source-agreements"], "Git.Git@2.50.1"],
    macos: ["brew", ["install", "--formula", "git"], "git"],
  },
  ccusage: {
    windows: ["npm.cmd", ["install", "--global", `--registry=${NPM_REGISTRY}`, "ccusage@20.0.14"], "ccusage@20.0.14"],
    macos: ["npm", ["install", "--global", `--registry=${NPM_REGISTRY}`, "ccusage@20.0.14"], "ccusage@20.0.14"],
    linux: ["npm", ["install", "--global", `--registry=${NPM_REGISTRY}`, "ccusage@20.0.14"], "ccusage@20.0.14"],
  },
  claude: {
    windows: ["npm.cmd", ["install", "--global", `--registry=${NPM_REGISTRY}`, "@anthropic-ai/claude-code@2.1.206"], "@anthropic-ai/claude-code@2.1.206"],
    macos: ["npm", ["install", "--global", `--registry=${NPM_REGISTRY}`, "@anthropic-ai/claude-code@2.1.206"], "@anthropic-ai/claude-code@2.1.206"],
    linux: ["npm", ["install", "--global", `--registry=${NPM_REGISTRY}`, "@anthropic-ai/claude-code@2.1.206"], "@anthropic-ai/claude-code@2.1.206"],
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
    source: plan.package.source,
    versionPolicy: plan.package.versionPolicy,
    issuedAt: plan.validity.issuedAt,
    expiresAt: plan.validity.expiresAt,
  };
  return crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export function resolveApplicationInstallSpawnPlan(plan, { platform = process.platform, now = Date.now } = {}) {
  if (!plan || plan.schemaVersion !== SCHEMA_VERSION || plan.recipeVersion !== RECIPE_VERSION) return null;
  const targetPlatform = bridgePlatform(platform);
  if (plan.target?.platform !== targetPlatform || plan.execution?.shell !== false) return null;
  const recipe = RECIPES[plan.application?.name]?.[targetPlatform];
  if (!recipe) return null;
  const [executable, args, resolvedIdentifier] = recipe;
  const expectedProvider = plan.application?.name === "git"
    ? { windows: "winget", macos: "homebrew" }[targetPlatform]
    : "npm";
  const expectedIdentifier = { git: "git", ccusage: "ccusage", claude: "@anthropic-ai/claude-code" }[plan.application?.name];
  const expectedProbe = plan.application?.name === "git" ? "git" : plan.application?.name === "claude" ? "claude" : "ccusage";
  if (plan.execution.executable !== executable || !sameArgs(plan.execution.args, args)) return null;
  if (plan.package?.provider !== expectedProvider || plan.package?.identifier !== expectedIdentifier || plan.package?.resolvedIdentifier !== resolvedIdentifier) return null;
  if (plan.execution.elevated !== false) return null;
  const expectedSource = plan.application?.name === "git"
    ? targetPlatform === "windows" ? { kind: "winget-source", name: "winget" } : { kind: "homebrew-core", name: "homebrew/core" }
    : { kind: "npm-registry", registry: NPM_REGISTRY, packageName: expectedIdentifier };
  // #995: git-windows is now exact-pinned like the npm apps; git-macos stays
  // provider-managed (homebrew/core has no versioned formula — explicit
  // decision, mirrored from the server recipe).
  const expectedVersionPolicy = plan.application?.name === "git" && targetPlatform === "macos"
    ? { kind: "provider-managed", channel: "stable", allowCallerOverride: false, exactVersion: null }
    : { kind: "exact", channel: null, allowCallerOverride: false, exactVersion: resolvedIdentifier.slice(resolvedIdentifier.lastIndexOf("@") + 1) };
  if (JSON.stringify(plan.package?.source) !== JSON.stringify(expectedSource) || JSON.stringify(plan.package?.versionPolicy) !== JSON.stringify(expectedVersionPolicy)) return null;
  if (plan.approval?.required !== true || plan.approval?.action !== "application.install" || plan.approval?.bindsToPlanFingerprint !== true) return null;
  if (plan.policy?.timeoutMs !== 300_000 || plan.policy?.cancellable !== true) return null;
  if (plan.postInstallProbe?.executable !== expectedProbe || !sameArgs(plan.postInstallProbe?.args, ["--version"]) || plan.postInstallProbe?.timeoutMs !== 15_000) return null;
  const issuedAtMs = Date.parse(plan.validity?.issuedAt);
  const expiresAtMs = Date.parse(plan.validity?.expiresAt);
  const currentMs = Number(now());
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || !Number.isFinite(currentMs)) return null;
  if (plan.validity?.ttlMs !== PLAN_TTL_MS || expiresAtMs - issuedAtMs !== PLAN_TTL_MS || currentMs < issuedAtMs - 60_000 || currentMs > expiresAtMs) return null;
  if (plan.rollback?.automatic !== false || plan.rollback?.uninstallSupported !== false) return null;
  const fingerprint = expectedFingerprint(plan, executable, args, resolvedIdentifier);
  if (plan.fingerprint !== fingerprint || plan.planId !== `aip_${fingerprint.slice(0, 24)}`) return null;
  return {
    command: executable,
    args: [...args],
    timeoutMs: Math.max(1_000, Math.min(900_000, Number(plan.policy?.timeoutMs ?? 300_000))),
    probeTimeoutMs: plan.postInstallProbe.timeoutMs,
  };
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
  now = Date.now,
}) {
  const spawnPlan = resolveApplicationInstallSpawnPlan(plan, { platform, now });
  if (!spawnPlan) {
    return { status: "refused", classification: "plan_not_allowlisted", summary: "Desktop Bridge refused a stale or modified Application installation plan.", exitCode: null, durationMs: null };
  }
  await onProgress({ type: "spawning", summary: `Starting approved ${plan.application.displayName} installation.` });
  const startedAt = now();
  return new Promise((resolve) => {
    let settled = false;
    let cancelled = false;
    let timedOut = false;
    let child;
    let timeoutTimer;
    let cancelTimer;
    let timedOutPhase = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearScheduledTimeout(timeoutTimer);
      if (cancelTimer) clearInterval(cancelTimer);
      resolve({ ...result, durationMs: now() - startedAt });
    };
    const schedulePhaseTimeout = (phase, timeoutMs) => {
      if (timeoutTimer) clearScheduledTimeout(timeoutTimer);
      timedOut = false;
      timedOutPhase = null;
      timeoutTimer = scheduleTimeout(async () => {
        timedOut = true;
        timedOutPhase = phase;
        await terminate(child);
      }, timeoutMs);
    };
    try {
      child = spawnProcess(spawnPlan.command, spawnPlan.args, {
        cwd: process.cwd(), env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve({ status: "failed", classification: "spawn_failed", summary: "Approved installation failed to start.", exitCode: null, durationMs: now() - startedAt });
      return;
    }
    const watchChild = (current, phase) => {
      current.stdout?.resume?.();
      current.stderr?.resume?.();
      current.on("error", () => finish({
        status: "failed",
        classification: phase === "probe" ? "probe_spawn_failed" : "spawn_failed",
        summary: `${phase === "probe" ? "Post-install probe" : "Approved installation"} failed to start.`,
        exitCode: null,
      }));
      current.on("close", async (code) => {
        if (cancelled) return finish({ status: "cancelled", classification: "cancelled", summary: "Application installation was cancelled locally.", exitCode: Number.isInteger(code) ? code : null });
        if (timedOut) return finish({
          status: "timed_out",
          classification: timedOutPhase === "probe" ? "probe_timeout" : "install_timeout",
          summary: timedOutPhase === "probe" ? "Post-install readiness probe exceeded its approved timeout." : "Application installation exceeded its approved timeout.",
          exitCode: Number.isInteger(code) ? code : null,
        });
        if (phase === "install" && code === 0) {
          if (timeoutTimer) clearScheduledTimeout(timeoutTimer);
          timeoutTimer = undefined;
          await onProgress({ type: "probing", summary: `Verifying ${plan.application.displayName} readiness.` });
          if (cancelled) {
            return finish({ status: "cancelled", classification: "cancelled", summary: "Application installation was cancelled locally.", exitCode: 0 });
          }
          try {
            child = spawnProcess(plan.postInstallProbe.executable, [...plan.postInstallProbe.args], {
              cwd: process.cwd(), env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
            });
            watchChild(child, "probe");
            schedulePhaseTimeout("probe", spawnPlan.probeTimeoutMs);
          } catch {
            finish({ status: "failed", classification: "probe_spawn_failed", summary: "Post-install probe failed to start.", exitCode: null });
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
    schedulePhaseTimeout("install", spawnPlan.timeoutMs);
    cancelTimer = setInterval(async () => {
      if (cancelled || timedOut || settled) return;
      if (await pollCancellation()) {
        cancelled = true;
        await onProgress({ type: "cancelling", summary: "Cancelling approved Application installation." });
        await terminate(child);
      }
    }, 500);
  });
}
