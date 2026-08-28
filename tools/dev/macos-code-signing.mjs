import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const APP_ID = "com.myagenttool.desktop";
const APPLE_IDENTITY_PREFIXES = ["Developer ID Application:", "Apple Development:"];

export function parseSigningIdentities(output) {
  return [...String(output ?? "").matchAll(/^\s*\d+\)\s+[A-F0-9]+\s+"([^"]+)"/gim)]
    .map((match) => match[1])
    .filter((name) => APPLE_IDENTITY_PREFIXES.some((prefix) => name.startsWith(prefix)));
}

export function chooseSigningIdentity(output, preferred = "") {
  const identities = parseSigningIdentities(output);
  if (preferred) {
    if (!identities.includes(preferred)) throw new Error(`requested Apple signing identity is unavailable: ${preferred}`);
    return preferred;
  }
  return identities.find((name) => name.startsWith("Developer ID Application:")) ?? identities[0] ?? null;
}

export function certificateRequirementOf(output) {
  return String(output ?? "").split("\n").map((line) => line.trim()).find((line) => line.startsWith("designated =>")) ?? null;
}

export function isStableAppleRequirement(requirement, appId = APP_ID) {
  const value = String(requirement ?? "");
  return value.includes(`identifier "${appId}"`)
    && value.includes("anchor apple generic")
    && !/\bcdhash\b/i.test(value);
}

export function teamIdentifierOf(output) {
  const value = String(output ?? "").split("\n").map((line) => line.trim()).find((line) => line.startsWith("TeamIdentifier="))?.slice("TeamIdentifier=".length);
  return value && value !== "not set" ? value : null;
}

export function hasElectronRuntimeEntitlements(output) {
  const value = String(output ?? "");
  return value.includes("com.apple.security.cs.allow-jit")
    && value.includes("com.apple.security.cs.allow-unsigned-executable-memory")
    && value.includes("com.apple.security.cs.disable-library-validation");
}

export function codesignArguments(target, identity) {
  const timestamp = identity.startsWith("Developer ID Application:") ? "--timestamp" : "--timestamp=none";
  return ["--deep", "--force", "--sign", identity, timestamp, "--options", "runtime", "--preserve-metadata=identifier,entitlements,flags", target];
}

export function signMacApp({ appPath, requireStable = false, preferredIdentity = process.env.CSC_NAME ?? "", run = runCommand }) {
  if (process.platform !== "darwin") throw new Error("macOS signing requires a macOS host");
  const target = resolve(appPath);
  if (!existsSync(target)) throw new Error(`packaged app not found: ${target}`);

  const identityOutput = run("security", ["find-identity", "-v", "-p", "codesigning"]).stdout;
  const identity = chooseSigningIdentity(identityOutput, preferredIdentity);
  if (!identity) {
    const message = "no Apple Development or Developer ID Application identity is installed; this ad-hoc package may request Keychain access again after code changes";
    if (requireStable) throw new Error(message);
    console.warn(`[macos-code-signing] WARNING: ${message}`);
    return { stable: false, identity: null, teamIdentifier: null };
  }

  run("codesign", codesignArguments(target, identity));
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", target]);

  const entitlementResult = run("codesign", ["-d", "--entitlements", ":-", target], { allowStderr: true });
  if (!hasElectronRuntimeEntitlements(`${entitlementResult.stdout ?? ""}\n${entitlementResult.stderr ?? ""}`)) {
    throw new Error("packaged app lost required Electron runtime entitlements during signing");
  }

  const requirementResult = run("codesign", ["-d", "-r-", target], { allowStderr: true });
  const requirement = certificateRequirementOf(`${requirementResult.stdout ?? ""}\n${requirementResult.stderr ?? ""}`);
  if (!isStableAppleRequirement(requirement)) throw new Error("packaged app did not receive a stable Apple certificate requirement");

  const signingInfoResult = run("codesign", ["-d", "-vvv", target], { allowStderr: true });
  const teamIdentifier = teamIdentifierOf(`${signingInfoResult.stdout ?? ""}\n${signingInfoResult.stderr ?? ""}`);
  if (!teamIdentifier) throw new Error("packaged app did not receive an Apple Team Identifier required for Keychain continuity");
  const expectedTeamIdentifier = process.env.MYAGENTTOOL_MAC_TEAM_ID?.trim();
  if (expectedTeamIdentifier && teamIdentifier !== expectedTeamIdentifier) {
    throw new Error(`signed with unexpected Apple Team Identifier: ${teamIdentifier}`);
  }

  console.log(`[macos-code-signing] signed ${basename(target)} with ${identity}`);
  console.log(`[macos-code-signing] TeamIdentifier=${teamIdentifier}`);
  return { stable: true, identity, teamIdentifier, requirement };
}

function runCommand(command, args, { acceptCodes = [0], allowStderr = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!acceptCodes.includes(result.status)) {
    const detail = String(result.stderr || result.stdout || "command failed").trim();
    throw new Error(`${command} ${args[0] ?? ""} failed: ${detail}`);
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr && !allowStderr) process.stderr.write(result.stderr);
  return result;
}

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    signMacApp({
      appPath: argument("--app", "apps/electron/release/mac-arm64/MyAgentTool.app"),
      requireStable: process.argv.includes("--require-stable"),
    });
  } catch (error) {
    console.error(`[macos-code-signing] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
