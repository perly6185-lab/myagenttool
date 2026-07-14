import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const SCHEMA_VERSION = "application-install-plan/v1";
const RECIPE_VERSION = "2026-07-14.1";
const SUPPORTED_PLATFORMS = ["windows", "macos", "linux"];
const ALLOWED_REQUEST_FIELDS = new Set(["name", "projectId", "deviceId", "platform", "architecture"]);

const APPLICATIONS = {
  git: {
    displayName: "Git",
    aliases: ["git"],
    packageIdentifier: "git",
    probe: { executable: "git", args: ["--version"] },
    recipes: {
      windows: recipe("winget", "winget", ["install", "--id", "Git.Git", "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements"], "Git.Git"),
      macos: recipe("homebrew", "brew", ["install", "git"], "git"),
      linux: recipe("apt", "apt-get", ["install", "-y", "git"], "git", { elevated: true }),
    },
  },
  ccusage: {
    displayName: "ccusage",
    aliases: ["ccusage"],
    packageIdentifier: "ccusage",
    probe: { executable: "ccusage", args: ["--version"] },
    recipes: npmRecipes("ccusage@latest"),
  },
  claude: {
    displayName: "Claude Code",
    aliases: ["claude", "claude code"],
    packageIdentifier: "@anthropic-ai/claude-code",
    probe: { executable: "claude", args: ["--version"] },
    recipes: npmRecipes("@anthropic-ai/claude-code@latest"),
  },
};

function recipe(provider, executable, args, packageIdentifier, { elevated = false } = {}) {
  return { provider, executable, args, packageIdentifier, elevated };
}

function npmRecipes(packageSpecifier) {
  return Object.fromEntries(SUPPORTED_PLATFORMS.map((platform) => [
    platform,
    recipe("npm", platform === "windows" ? "npm.cmd" : "npm", ["install", "--global", packageSpecifier], packageSpecifier),
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
    versionPolicy: { kind: "approved-channel", channel: "stable", allowCallerOverride: false },
    approvalRequired: true,
  }));
}

export function createApplicationInstallPlan(input, { device, projectId = null } = {}) {
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
  const selected = application.recipes[platform];
  if (!selected) {
    throw planError("install_platform_not_supported", `Installation is not supported on platform: ${platform || "unknown"}.`);
  }

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
      versionPolicy: { kind: "approved-channel", channel: "stable", allowCallerOverride: false },
    },
    execution: { executable: selected.executable, args: [...selected.args], shell: false, elevated: selected.elevated },
    risk: {
      level: selected.elevated ? "high" : "medium",
      reasons: selected.elevated ? ["installs_device_software", "requires_elevation"] : ["installs_device_software"],
    },
    approval: { required: true, action: "application.install", bindsToPlanFingerprint: true },
    policy: { timeoutMs: 300_000, cancellable: true },
    postInstallProbe: { executable: application.probe.executable, args: [...application.probe.args], timeoutMs: 15_000 },
    summary: `Install ${application.displayName} on ${device.name ?? device.id} with ${selected.provider}; explicit local approval is required.`,
  };
}

export function applicationInstallPlanMatchesCurrent(plan, context) {
  if (!plan || typeof plan !== "object") return false;
  try {
    const current = createApplicationInstallPlan({
      name: plan.application?.name,
      projectId: plan.target?.projectId ?? null,
      deviceId: plan.target?.deviceId,
      platform: plan.target?.platform,
      architecture: plan.target?.architecture,
    }, context);
    return current.planId === plan.planId
      && current.fingerprint === plan.fingerprint
      && isDeepStrictEqual(current, plan);
  } catch {
    return false;
  }
}
