import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const SCHEMA_VERSION = "application-install-plan/v1";
const RECIPE_VERSION = "2026-07-16.2";
const PLAN_TTL_MS = 10 * 60 * 1000;
const NPM_REGISTRY = "https://registry.npmjs.org/";

const RECIPES = {
  git: {
    windows: ["winget", ["install", "--id", "Git.Git", "--version", "2.50.1", "--exact", "--source", "winget", "--silent", "--disable-interactivity", "--accept-package-agreements", "--accept-source-agreements"], "Git.Git@2.50.1"],
    macos: ["brew", ["install", "--formula", "git"], "git"],
    // #994 / ADR 0015: the mirror records the REAL command; pkexec wraps it at
    // spawn time, and only for this exact entry.
    linux: ["apt-get", ["install", "--yes", "git"], "git"],
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
    ? { windows: "winget", macos: "homebrew", linux: "apt" }[targetPlatform]
    : "npm";
  const expectedIdentifier = { git: "git", ccusage: "ccusage", claude: "@anthropic-ai/claude-code" }[plan.application?.name];
  const expectedProbe = plan.application?.name === "git" ? "git" : plan.application?.name === "claude" ? "claude" : "ccusage";
  if (plan.execution.executable !== executable || !sameArgs(plan.execution.args, args)) return null;
  if (plan.package?.provider !== expectedProvider || plan.package?.identifier !== expectedIdentifier || plan.package?.resolvedIdentifier !== resolvedIdentifier) return null;
  // ADR 0015: elevation is an exact per-mirror expectation, both directions —
  // an elevated plan for an unelevated recipe is refused, and vice versa.
  const expectedElevated = plan.application?.name === "git" && targetPlatform === "linux";
  if (plan.execution.elevated !== expectedElevated) return null;
  const expectedSource = plan.application?.name === "git"
    ? { windows: { kind: "winget-source", name: "winget" }, macos: { kind: "homebrew-core", name: "homebrew/core" }, linux: { kind: "apt-repository", name: "distro-main" } }[targetPlatform]
    : { kind: "npm-registry", registry: NPM_REGISTRY, packageName: expectedIdentifier };
  // #995/#994: git-windows is exact-pinned like the npm apps; git-macos
  // (homebrew/core has no versioned formula) and git-linux (apt cannot pin
  // portably) stay provider-managed — explicit decisions, mirrored from the
  // server recipes.
  const expectedVersionPolicy = plan.application?.name === "git" && (targetPlatform === "macos" || targetPlatform === "linux")
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
  // ADR 0015: the polkit broker. Only the mirrored argv above is ever elevated;
  // pkexec runs that ONE command under a per-action authentication (never
  // auth_admin_keep), with its default scrubbed environment. When polkit is
  // absent the plan is refused with a coded reason BEFORE any privilege is
  // involved — fail closed, explainable.
  if (expectedElevated) {
    if (!polkitAvailable()) {
      return { refusal: { classification: "elevation_unavailable", summary: "This installation requires per-action elevation, but polkit (pkexec) is not available on this device." } };
    }
    return {
      command: PKEXEC_PATH,
      args: [executable, ...args],
      elevated: true,
      elevation: { mechanism: "polkit-pkexec", wrappedExecutable: executable },
      timeoutMs: Math.max(1_000, Math.min(900_000, Number(plan.policy?.timeoutMs ?? 300_000))),
      probeTimeoutMs: plan.postInstallProbe.timeoutMs,
    };
  }
  return {
    command: executable,
    args: [...args],
    elevated: false,
    timeoutMs: Math.max(1_000, Math.min(900_000, Number(plan.policy?.timeoutMs ?? 300_000))),
    probeTimeoutMs: plan.postInstallProbe.timeoutMs,
  };
}

// ADR 0015: pkexec presence is the device-side readiness signal for elevated
// installs. Overridable for tests (and for a future readiness report surface).
const PKEXEC_PATH = "/usr/bin/pkexec";
let polkitProbe = null;
export function setPolkitProbeForTests(probe) {
  polkitProbe = probe;
}
function polkitAvailable() {
  if (typeof polkitProbe === "function") return Boolean(polkitProbe());
  return existsSync(PKEXEC_PATH);
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
  // ADR 0015: a coded pre-privilege refusal (e.g. polkit absent) — explainable,
  // never an opaque spawn failure.
  if (spawnPlan.refusal) {
    return { status: "refused", classification: spawnPlan.refusal.classification, summary: spawnPlan.refusal.summary, exitCode: null, durationMs: null };
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
      // ADR 0015: every outcome of an elevated run is audited AS elevated —
      // the mechanism and the wrapped executable ride the run record.
      resolve({ ...(spawnPlan.elevated ? { elevated: true, elevation: spawnPlan.elevation } : {}), ...result, durationMs: now() - startedAt });
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
