#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DESKTOP_RELEASE_CONTRACT } from "../../apps/electron/desktop-release-contract.mjs";

const SUPPORTED_MODES = new Set(["development", "release"]);
const SUPPORTED_PLATFORMS = new Set(["win32", "darwin", "linux"]);

export function evaluateDesktopReleasePreflight({ mode, platform, architecture, environment = process.env }) {
  if (!SUPPORTED_MODES.has(mode)) {
    return failure(`unsupported mode: ${mode || "(missing)"}; expected development or release`);
  }
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    return failure(`unsupported platform: ${platform || "(missing)"}; expected win32, darwin, or linux`);
  }
  const target = DESKTOP_RELEASE_CONTRACT.targets.find((item) => item.platform === platform && item.architecture === architecture);
  if (!target) {
    return failure(`unsupported target: ${platform}/${architecture || "(missing)"}; choose a target from the desktop release contract`);
  }

  if (mode === "development") {
    return {
      ok: true,
      mode,
      platform,
      architecture,
      message: "development packaging remains credential-free and ad-hoc",
      missingCredentialNames: [],
    };
  }

  const credentialContract = DESKTOP_RELEASE_CONTRACT.credentials[platform];
  const presentNames = new Set(Object.keys(environment));
  const missingRequired = credentialContract.required.filter((name) => !presentNames.has(name));
  const alternatives = credentialContract.alternatives.map((group) => ({
    id: group.id,
    missing: group.required.filter((name) => !presentNames.has(name)),
  }));
  const hasCompleteAlternative = alternatives.length === 0 || alternatives.some((group) => group.missing.length === 0);
  const missingCredentialNames = [
    ...missingRequired,
    ...(!hasCompleteAlternative ? alternatives.flatMap((group) => group.missing) : []),
  ].filter((name, index, names) => names.indexOf(name) === index);

  if (missingRequired.length > 0 || !hasCompleteAlternative) {
    const requirements = [];
    if (missingRequired.length > 0) requirements.push(`required: ${missingRequired.join(", ")}`);
    if (!hasCompleteAlternative) {
      requirements.push(`one complete notarization group: ${alternatives.map((group) => `${group.id} (${group.missing.join(", ") || "complete"})`).join(" OR ")}`);
    }
    return {
      ok: false,
      mode,
      platform,
      architecture,
      message: `release credentials are incomplete; ${requirements.join("; ")}`,
      missingCredentialNames,
    };
  }

  return {
    ok: true,
    mode,
    platform,
    architecture,
    message: "release credential names are present; no credential value was read or exercised",
    missingCredentialNames: [],
  };
}

function failure(message) {
  return { ok: false, mode: null, platform: null, architecture: null, message, missingCredentialNames: [] };
}

function parseArguments(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const name = item.slice(2);
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      args.set(name, value);
      index += 1;
    }
  }
  return {
    mode: String(args.get("mode") ?? ""),
    platform: String(args.get("platform") ?? ""),
    architecture: String(args.get("arch") ?? ""),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = evaluateDesktopReleasePreflight(parseArguments(process.argv.slice(2)));
  const stream = result.ok ? console.log : console.error;
  stream(`[desktop-release-preflight] ${result.ok ? "OK" : "ERROR"}: ${result.message}`);
  if (!result.ok) process.exitCode = 1;
}
