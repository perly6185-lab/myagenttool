import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PDFCPU_RELEASE_VERSION, resolvePdfcpuReleaseArtifact } from "./pdfcpu-release.mjs";

const SCHEMA_VERSION = "application-install-plan/v1";
const RECIPE_VERSION = "2026-07-22.1";
const PLAN_TTL_MS = 10 * 60 * 1000;
const SUPPORTED_PLATFORMS = ["windows", "macos", "linux"];
const ALLOWED_REQUEST_FIELDS = new Set(["name", "projectId", "deviceId", "platform", "architecture"]);
const NPM_REGISTRY = "https://registry.npmjs.org/";
const CCUSAGE_VERSION = "20.0.14";
const CLAUDE_CODE_VERSION = "2.1.215";
const CODEX_VERSION = "0.144.6";
// #1356 (excalidraw-cli runtime, PR1 scaffolding). An OFFLINE Excalidraw CLI
// (oclif single command over node-canvas + roughjs — no browser, no network)
// whose bin is `excalidraw-cli`. Pinned like every other npm app; a bump is a
// reviewed recipe change (RECIPE_VERSION bump + release evidence), never drift.
const EXCALIDRAW_CLI_VERSION = "0.5.0";
const GIT_FOR_WINDOWS_VERSION = "2.50.1";
const WINDOWS_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const WINDOWS_GIT_BASH_X86 = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";

const APPLICATIONS = {
  git: {
    displayName: "Git",
    aliases: ["git"],
    packageIdentifier: "git",
    probe: { executable: "git", args: ["--version"] },
    recipes: {
      // #995: winget supports exact-version install — the promoted Git version
      // is PINNED like the npm apps; bumping it is a reviewed recipe change
      // (recipeVersion bump + release evidence), never a silent provider drift.
      windows: recipe("winget", "winget", ["install", "--id", "Git.Git", "--version", GIT_FOR_WINDOWS_VERSION, "--exact", "--source", "winget", "--silent", "--disable-interactivity", "--accept-package-agreements", "--accept-source-agreements"], `Git.Git@${GIT_FOR_WINDOWS_VERSION}`, {
        source: { kind: "winget-source", name: "winget" },
        versionPolicy: exactVersionPolicy(GIT_FOR_WINDOWS_VERSION),
      }),
      // #995 decision: homebrew/core has no versioned git formula, so an
      // arbitrary-version pin is structurally impossible without shipping our
      // own tap (out of scope). macOS stays provider-managed EXPLICITLY — the
      // post-install probe still records the exact version that landed.
      macos: recipe("homebrew", "brew", ["install", "--formula", "git"], "git", {
        source: { kind: "homebrew-core", name: "homebrew/core" },
        versionPolicy: providerVersionPolicy(),
      }),
      // #994 / ADR 0015 slice 1: Linux Git via apt-get, ELEVATED through the
      // bridge's polkit broker — pkexec wraps THIS mirrored argv at spawn time;
      // the recipe records the real command, never the elevation mechanism.
      // apt cannot pin an upstream version portably (distro epochs/revisions),
      // so provider-managed is the explicit #995-style decision here too; the
      // post-install probe records what landed. dnf/pacman stay fail-closed.
      linux: recipe("apt", "apt-get", ["install", "--yes", "git"], "git", {
        elevated: true,
        source: { kind: "apt-repository", name: "distro-main" },
        versionPolicy: providerVersionPolicy(),
      }),
    },
  },
  "git-bash": {
    displayName: "Git Bash",
    aliases: ["git-bash", "git bash"],
    packageIdentifier: "Git.Git",
    probe: {
      executable: WINDOWS_GIT_BASH,
      args: ["--version"],
      candidates: [
        { executable: WINDOWS_GIT_BASH, args: ["--version"] },
        { executable: WINDOWS_GIT_BASH_X86, args: ["--version"] },
        { executable: "git", args: ["--version"] },
      ],
    },
    recipes: {
      windows: recipe("winget", "winget", ["install", "--id", "Git.Git", "--version", GIT_FOR_WINDOWS_VERSION, "--exact", "--source", "winget", "--silent", "--disable-interactivity", "--accept-package-agreements", "--accept-source-agreements"], `Git.Git@${GIT_FOR_WINDOWS_VERSION}`, {
        source: { kind: "winget-source", name: "winget" },
        versionPolicy: exactVersionPolicy(GIT_FOR_WINDOWS_VERSION),
        riskReasons: ["installs_device_software", "adds_shell_runtime"],
      }),
    },
  },
  wsl: {
    displayName: "WSL",
    aliases: ["wsl", "wsl bash", "wsl-bash"],
    packageIdentifier: "Microsoft.WSL",
    probe: { executable: "wsl.exe", args: ["--status"] },
    recipes: {
      windows: recipe("windows-wsl", "wsl.exe", ["--install", "--no-launch"], "Microsoft.WSL", {
        source: { kind: "windows-feature", name: "wsl" },
        versionPolicy: providerVersionPolicy(),
        riskLevel: "high",
        riskReasons: ["installs_device_software", "enables_windows_subsystem", "may_require_reboot"],
      }),
    },
  },
  ccusage: {
    displayName: "ccusage",
    aliases: ["ccusage"],
    packageIdentifier: "ccusage",
    probe: { executable: "ccusage", args: ["--version"] },
    recipes: npmRecipes("ccusage", CCUSAGE_VERSION),
  },
  claude: {
    displayName: "Claude Code",
    aliases: ["claude", "claude code"],
    packageIdentifier: "@anthropic-ai/claude-code",
    probe: { executable: "claude", args: ["--version"] },
    recipes: npmRecipes("@anthropic-ai/claude-code", CLAUDE_CODE_VERSION),
  },
  codex: {
    displayName: "Codex CLI",
    aliases: ["codex", "codex cli"],
    packageIdentifier: "@openai/codex",
    probe: { executable: "codex", args: ["--version"] },
    recipes: npmRecipes("@openai/codex", CODEX_VERSION),
  },
  // #1356: the optional Excalidraw CLI runtime. npm-installed, cross-platform,
  // provider-neutral pinned version — installs identically on all three OSes with
  // no remote-install semantics. The probe is the oclif `--version` (exit 0 +
  // version string); an absent binary simply reports readiness "absent" and the
  // Canvas export/layout capability (PR2) degrades to browser export.
  "excalidraw-cli": {
    displayName: "Excalidraw CLI",
    aliases: ["excalidraw-cli"],
    packageIdentifier: "@tommywalkie/excalidraw-cli",
    probe: { executable: "excalidraw-cli", args: ["--version"] },
    recipes: npmRecipes("@tommywalkie/excalidraw-cli", EXCALIDRAW_CLI_VERSION),
  },
  pdfcpu: {
    displayName: "pdfcpu",
    aliases: ["pdfcpu", "pdf cpu"],
    packageIdentifier: "pdfcpu",
    probe: { executable: "pdfcpu", args: ["version", "--conf", "disable"] },
    // The concrete recipe is selected from the fixed platform/architecture
    // matrix in createApplicationInstallPlan; these keys advertise support only.
    recipes: Object.fromEntries(SUPPORTED_PLATFORMS.map((platform) => [platform, {
      provider: "verified-github-release",
      versionPolicy: exactVersionPolicy(PDFCPU_RELEASE_VERSION),
    }])),
  },
};

function providerVersionPolicy() {
  return { kind: "provider-managed", channel: "stable", allowCallerOverride: false, exactVersion: null };
}

function exactVersionPolicy(version) {
  return { kind: "exact", channel: null, allowCallerOverride: false, exactVersion: version };
}

function recipe(provider, executable, args, packageIdentifier, { elevated = false, source, versionPolicy, riskLevel = null, riskReasons = null } = {}) {
  return { provider, executable, args, packageIdentifier, elevated, source, versionPolicy, riskLevel, riskReasons };
}

function npmRecipes(packageName, version) {
  const packageSpecifier = `${packageName}@${version}`;
  return Object.fromEntries(SUPPORTED_PLATFORMS.map((platform) => [
    platform,
    recipe("npm", platform === "windows" ? "npm.cmd" : "npm", ["install", "--global", `--registry=${NPM_REGISTRY}`, packageSpecifier], packageSpecifier, {
      source: { kind: "npm-registry", registry: NPM_REGISTRY, packageName },
      versionPolicy: exactVersionPolicy(version),
    }),
  ]));
}

function resolveApplication(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return Object.entries(APPLICATIONS).find(([, application]) => application.aliases.includes(normalized)) ?? null;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function planError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function listApplicationInstallCatalog() {
  return Object.entries(APPLICATIONS).map(([name, application]) => ({
    name,
    displayName: application.displayName,
    supportedPlatforms: SUPPORTED_PLATFORMS.filter((platform) => application.recipes[platform]),
    providers: Object.fromEntries(SUPPORTED_PLATFORMS.map((platform) => [platform, application.recipes[platform]?.provider ?? null])),
    versionPolicies: Object.fromEntries(SUPPORTED_PLATFORMS.map((platform) => [platform, application.recipes[platform]?.versionPolicy ?? null])),
    approvalRequired: true,
  }));
}

export function createApplicationInstallPlan(input, { device, projectId = null, now = () => new Date().toISOString(), issuedAt = null } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw planError("invalid_install_plan_request", "Request body must be an object.");
  }
  const unsupportedFields = Object.keys(input).filter((key) => !ALLOWED_REQUEST_FIELDS.has(key));
  if (unsupportedFields.length) {
    throw planError("install_plan_fields_not_allowed", `Unsupported install plan fields: ${unsupportedFields.sort().join(", ")}.`);
  }
  const resolved = resolveApplication(input.name);
  if (!resolved) {
    throw planError("known_application_not_supported", "Known application is not supported.");
  }
  if (!device?.id) {
    throw planError("device_not_found", "Device was not found.", 404);
  }
  const [name, application] = resolved;
  const platform = String(device.platform ?? "").toLowerCase();
  if (input.platform && String(input.platform).toLowerCase() !== platform) {
    throw planError("install_plan_target_mismatch", "Requested platform does not match the target device.", 409);
  }
  if (input.architecture && String(input.architecture).toLowerCase() !== String(device.architecture ?? "").toLowerCase()) {
    throw planError("install_plan_target_mismatch", "Requested architecture does not match the target device.", 409);
  }
  const selected = name === "pdfcpu"
    ? pdfcpuArtifactRecipe(platform, device.architecture)
    : application.recipes[platform];
  if (!selected) {
    throw planError("install_platform_not_supported", `Installation is not supported on platform: ${platform || "unknown"}.`);
  }
  const issuedAtValue = issuedAt ?? now();
  const issuedAtMs = Date.parse(issuedAtValue);
  if (!Number.isFinite(issuedAtMs)) {
    throw planError("invalid_install_plan_time", "Installation plan time is invalid.");
  }
  const expiresAt = new Date(issuedAtMs + PLAN_TTL_MS).toISOString();

  const identity = {
    schemaVersion: SCHEMA_VERSION,
    recipeVersion: RECIPE_VERSION,
    application: name,
    projectId,
    deviceId: device.id,
    platform,
    architecture: device.architecture ?? null,
    provider: selected.provider,
    packageIdentifier: selected.packageIdentifier,
    executable: selected.executable,
    args: selected.args,
    source: selected.source,
    versionPolicy: selected.versionPolicy,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt,
  };
  const planFingerprint = fingerprint(identity);
  return {
    schemaVersion: SCHEMA_VERSION,
    recipeVersion: RECIPE_VERSION,
    planId: `aip_${planFingerprint.slice(0, 24)}`,
    fingerprint: planFingerprint,
    application: { name, displayName: application.displayName },
    target: { projectId, deviceId: device.id, platform, architecture: device.architecture ?? null },
    package: {
      provider: selected.provider,
      identifier: application.packageIdentifier,
      resolvedIdentifier: selected.packageIdentifier,
      versionPolicy: selected.versionPolicy,
      source: selected.source,
    },
    execution: { executable: selected.executable, args: [...selected.args], shell: false, elevated: selected.elevated },
    risk: {
      level: selected.riskLevel ?? (selected.elevated ? "high" : "medium"),
      reasons: selected.riskReasons ?? (selected.elevated ? ["installs_device_software", "requires_elevation"] : ["installs_device_software"]),
    },
    approval: { required: true, action: "application.install", bindsToPlanFingerprint: true },
    policy: { timeoutMs: 300_000, cancellable: true },
    validity: { issuedAt: identity.issuedAt, expiresAt, ttlMs: PLAN_TTL_MS },
    postInstallProbe: publicProbe(application.probe),
    rollback: {
      automatic: false,
      uninstallSupported: false,
      summary: "Automatic rollback is disabled because installation may modify pre-existing package-manager state; failed installs require operator review.",
    },
    summary: `Install ${application.displayName} on ${device.name ?? device.id} with ${selected.provider}; explicit local approval is required.`,
  };
}

function pdfcpuArtifactRecipe(platform, architecture) {
  const artifact = resolvePdfcpuReleaseArtifact(platform, architecture);
  if (!artifact) return null;
  return recipe("verified-github-release", "myagenttool-verified-artifact-installer", [artifact.filename], artifact.filename, {
    source: {
      kind: "github-release-artifact",
      repository: "pdfcpu/pdfcpu",
      version: PDFCPU_RELEASE_VERSION,
      url: artifact.url,
      filename: artifact.filename,
      sha256: artifact.sha256,
      archive: artifact.archive,
    },
    versionPolicy: exactVersionPolicy(PDFCPU_RELEASE_VERSION),
  });
}

function publicProbe(probe) {
  return {
    executable: probe.executable,
    args: [...probe.args],
    timeoutMs: 15_000,
    ...(Array.isArray(probe.candidates) ? { candidates: probe.candidates.map((candidate) => ({ executable: candidate.executable, args: [...candidate.args] })) } : {}),
  };
}

export function applicationInstallPlanMatchesCurrent(plan, context) {
  if (!plan || typeof plan !== "object") return false;
  try {
    const issuedAtMs = Date.parse(plan.validity?.issuedAt);
    const expiresAtMs = Date.parse(plan.validity?.expiresAt);
    const currentMs = Date.parse(context?.now?.() ?? new Date().toISOString());
    if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || !Number.isFinite(currentMs)) return false;
    if (expiresAtMs - issuedAtMs !== PLAN_TTL_MS || currentMs < issuedAtMs - 60_000 || currentMs > expiresAtMs) return false;
    const current = createApplicationInstallPlan({
      name: plan.application?.name,
      projectId: plan.target?.projectId ?? null,
      deviceId: plan.target?.deviceId,
      platform: plan.target?.platform,
      architecture: plan.target?.architecture,
    }, { ...context, issuedAt: plan.validity.issuedAt });
    return current.planId === plan.planId
      && current.fingerprint === plan.fingerprint
      && isDeepStrictEqual(current, plan);
  } catch {
    return false;
  }
}
