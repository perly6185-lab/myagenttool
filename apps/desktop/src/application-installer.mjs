import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const SCHEMA_VERSION = "application-install-plan/v1";
const RECIPE_VERSION = "2026-07-19.1";
const PLAN_TTL_MS = 10 * 60 * 1000;
const NPM_REGISTRY = "https://registry.npmjs.org/";
const GIT_FOR_WINDOWS_VERSION = "2.50.1";
const WINDOWS_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const WINDOWS_GIT_BASH_X86 = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";
const PROVIDER_MANAGED = { kind: "provider-managed", channel: "stable", allowCallerOverride: false, exactVersion: null };
const WINDOWS_GIT_BASH_PROBE = {
  executable: WINDOWS_GIT_BASH,
  args: ["--version"],
  candidates: [
    { executable: WINDOWS_GIT_BASH, args: ["--version"] },
    { executable: WINDOWS_GIT_BASH_X86, args: ["--version"] },
    { executable: "git", args: ["--version"] },
  ],
};

const RECIPES = {
  git: {
    windows: recipe("winget", ["install", "--id", "Git.Git", "--version", GIT_FOR_WINDOWS_VERSION, "--exact", "--source", "winget", "--silent", "--disable-interactivity", "--accept-package-agreements", "--accept-source-agreements"], `Git.Git@${GIT_FOR_WINDOWS_VERSION}`, {
      provider: "winget",
      identifier: "git",
      source: { kind: "winget-source", name: "winget" },
      versionPolicy: exactVersionPolicy(GIT_FOR_WINDOWS_VERSION),
      probe: { executable: "git", args: ["--version"] },
    }),
    macos: recipe("brew", ["install", "--formula", "git"], "git", {
      provider: "homebrew",
      identifier: "git",
      source: { kind: "homebrew-core", name: "homebrew/core" },
      versionPolicy: PROVIDER_MANAGED,
      probe: { executable: "git", args: ["--version"] },
    }),
    // #994 / ADR 0015: the mirror records the REAL command; pkexec wraps it at
    // spawn time, and only for this exact entry.
    linux: recipe("apt-get", ["install", "--yes", "git"], "git", {
      provider: "apt",
      identifier: "git",
      elevated: true,
      source: { kind: "apt-repository", name: "distro-main" },
      versionPolicy: PROVIDER_MANAGED,
      probe: { executable: "git", args: ["--version"] },
    }),
  },
  "git-bash": {
    windows: recipe("winget", ["install", "--id", "Git.Git", "--version", GIT_FOR_WINDOWS_VERSION, "--exact", "--source", "winget", "--silent", "--disable-interactivity", "--accept-package-agreements", "--accept-source-agreements"], `Git.Git@${GIT_FOR_WINDOWS_VERSION}`, {
      provider: "winget",
      identifier: "Git.Git",
      source: { kind: "winget-source", name: "winget" },
      versionPolicy: exactVersionPolicy(GIT_FOR_WINDOWS_VERSION),
      probe: WINDOWS_GIT_BASH_PROBE,
    }),
  },
  wsl: {
    windows: recipe("wsl.exe", ["--install", "--no-launch"], "Microsoft.WSL", {
      provider: "windows-wsl",
      identifier: "Microsoft.WSL",
      source: { kind: "windows-feature", name: "wsl" },
      versionPolicy: PROVIDER_MANAGED,
      probe: { executable: "wsl.exe", args: ["--status"] },
    }),
  },
  ccusage: {
    windows: npmRecipe("npm.cmd", "ccusage", "20.0.14", "ccusage"),
    macos: npmRecipe("npm", "ccusage", "20.0.14", "ccusage"),
    linux: npmRecipe("npm", "ccusage", "20.0.14", "ccusage"),
  },
  claude: {
    windows: npmRecipe("npm.cmd", "@anthropic-ai/claude-code", "2.1.215", "claude"),
    macos: npmRecipe("npm", "@anthropic-ai/claude-code", "2.1.215", "claude"),
    linux: npmRecipe("npm", "@anthropic-ai/claude-code", "2.1.215", "claude"),
  },
  codex: {
    windows: npmRecipe("npm.cmd", "@openai/codex", "0.144.6", "codex"),
    macos: npmRecipe("npm", "@openai/codex", "0.144.6", "codex"),
    linux: npmRecipe("npm", "@openai/codex", "0.144.6", "codex"),
  },
};

function exactVersionPolicy(version) {
  return { kind: "exact", channel: null, allowCallerOverride: false, exactVersion: version };
}

function recipe(command, args, resolvedIdentifier, { provider, identifier, elevated = false, source, versionPolicy, probe }) {
  return { command, args, resolvedIdentifier, provider, identifier, elevated, source, versionPolicy, probe };
}

function npmRecipe(command, packageName, version, probeExecutable) {
  const resolvedIdentifier = `${packageName}@${version}`;
  return recipe(command, ["install", "--global", `--registry=${NPM_REGISTRY}`, resolvedIdentifier], resolvedIdentifier, {
    provider: "npm",
    identifier: packageName,
    source: { kind: "npm-registry", registry: NPM_REGISTRY, packageName },
    versionPolicy: exactVersionPolicy(version),
    probe: { executable: probeExecutable, args: ["--version"] },
  });
}

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
  const { command: executable, args, resolvedIdentifier } = recipe;
  if (plan.execution.executable !== executable || !sameArgs(plan.execution.args, args)) return null;
  if (plan.package?.provider !== recipe.provider || plan.package?.identifier !== recipe.identifier || plan.package?.resolvedIdentifier !== resolvedIdentifier) return null;
  // ADR 0015: elevation is an exact per-mirror expectation, both directions —
  // an elevated plan for an unelevated recipe is refused, and vice versa.
  const expectedElevated = Boolean(recipe.elevated);
  if (plan.execution.elevated !== expectedElevated) return null;
  // #995/#994: git-windows is exact-pinned like the npm apps; git-macos
  // (homebrew/core has no versioned formula) and git-linux (apt cannot pin
  // portably) stay provider-managed — explicit decisions, mirrored from the
  // server recipes.
  if (JSON.stringify(plan.package?.source) !== JSON.stringify(recipe.source) || JSON.stringify(plan.package?.versionPolicy) !== JSON.stringify(recipe.versionPolicy)) return null;
  if (plan.approval?.required !== true || plan.approval?.action !== "application.install" || plan.approval?.bindsToPlanFingerprint !== true) return null;
  if (plan.policy?.timeoutMs !== 300_000 || plan.policy?.cancellable !== true) return null;
  if (!sameProbe(plan.postInstallProbe, recipe.probe)) return null;
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
  preInstallProbe = true,
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
  const startedAt = now();
  if (preInstallProbe) {
    await onProgress({ type: "probing", summary: `Checking whether ${plan.application.displayName} is already available.` });
    const existing = await runProbe({
      probe: plan.postInstallProbe,
      spawnProcess,
      env,
      scheduleTimeout,
      clearScheduledTimeout,
      terminate,
    });
    if (existing.ok) {
      return {
        status: "succeeded",
        classification: "already_installed",
        summary: `${plan.application.displayName} is already available; installation was skipped.`,
        exitCode: existing.exitCode,
        durationMs: now() - startedAt,
      };
    }
  }
  await onProgress({ type: "spawning", summary: `Starting approved ${plan.application.displayName} installation.` });
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

function runProbe({
  probe,
  spawnProcess,
  env,
  scheduleTimeout,
  clearScheduledTimeout,
  terminate,
}) {
  return new Promise((resolve) => {
    let settled = false;
    let child;
    const candidates = probeCandidates(probe);
    let index = 0;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearScheduledTimeout(timeoutTimer);
      resolve(result);
    };
    const timeoutTimer = scheduleTimeout(async () => {
      if (child) await terminate(child);
      finish({ ok: false, exitCode: null, timedOut: true });
    }, Math.max(1_000, Math.min(30_000, Number(probe?.timeoutMs ?? 15_000))));
    const tryNext = () => {
      if (settled) return;
      const candidate = candidates[index++];
      if (!candidate) {
        finish({ ok: false, exitCode: null, timedOut: false });
        return;
      }
      try {
        child = spawnProcess(candidate.executable, [...candidate.args], {
          cwd: process.cwd(), env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        tryNext();
        return;
      }
      child.stdout?.resume?.();
      child.stderr?.resume?.();
      let childDone = false;
      const failCandidate = () => {
        if (childDone) return;
        childDone = true;
        tryNext();
      };
      child.on("error", failCandidate);
      child.on("close", (code) => {
        if (childDone) return;
        if (code === 0) {
          childDone = true;
          finish({ ok: true, exitCode: 0, timedOut: false });
          return;
        }
        failCandidate();
      });
    };
    tryNext();
  });
}

function sameProbe(actual, expected) {
  if (actual?.executable !== expected.executable || !sameArgs(actual?.args, expected.args) || actual?.timeoutMs !== 15_000) return false;
  return JSON.stringify(probeCandidates(actual)) === JSON.stringify(probeCandidates(expected));
}

function probeCandidates(probe) {
  const primary = {
    executable: String(probe?.executable ?? "").trim(),
    args: Array.isArray(probe?.args) ? probe.args.map(String) : ["--version"],
  };
  const candidates = [
    primary,
    ...(Array.isArray(probe?.candidates) ? probe.candidates.map((candidate) => ({
      executable: String(candidate?.executable ?? "").trim(),
      args: Array.isArray(candidate?.args) ? candidate.args.map(String) : primary.args,
    })) : []),
  ].filter((candidate) => candidate.executable);
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.executable}\0${JSON.stringify(candidate.args)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
