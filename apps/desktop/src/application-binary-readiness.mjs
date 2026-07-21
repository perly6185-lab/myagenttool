import { binaryAvailableOnPath } from "./local-execution-policy.mjs";
import { spawnCapture } from "./spawn-capture.mjs";

const RUNTIME_IDS = new Map([
  ["git", "runtime_git"],
  ["ccusage", "runtime_ccusage"],
  ["claude", "runtime_claude"],
  ["codex", "runtime_codex"],
  ["git-bash", "runtime_git_bash"],
  ["wsl", "runtime_wsl"],
]);

// #1246: async so the `--version` probes never freeze the event loop (this runs
// at register time and every 5 minutes; a sync sweep stalled every in-flight
// run). Probes run in parallel with the row order preserved, so a sweep costs
// the slowest probe, not the sum.
export async function collectApplicationBinaryReadiness(
  manifest,
  { now = () => new Date().toISOString(), resolveBinary = binaryAvailableOnPath, runVersion = defaultRunVersion, runAuthentication = defaultRunAuthentication } = {},
) {
  const entries = (manifest?.applicationWrapperCommands ?? [])
    .map((entry) => ({
      command: String(entry?.command ?? "").trim(),
      capabilityPrefix: String(entry?.capabilityPrefix ?? "").trim(),
      probe: normalizeProbe(entry),
      authenticationProbe: normalizeAuthenticationProbe(entry),
    }))
    .filter((entry) => entry.command && entry.capabilityPrefix.startsWith("app."));

  return Promise.all(
    entries.map(async ({ command, capabilityPrefix, probe, authenticationProbe }) => {
      for (const candidate of probe.candidates) {
        if (!resolveBinary(candidate.executable)) continue;
        const version = sanitizeVersion(await runVersion(candidate.executable, candidate.args));
        if (version) {
          const authentication = authenticationProbe
            ? await runAuthentication(authenticationProbe.executable, authenticationProbe.args, authenticationProbe.format)
            : null;
          return {
            runtimeId: runtimeIdFor(command),
            command,
            capabilityPrefix,
            status: "available",
            version,
            ...(authentication ? {
              authenticationStatus: authentication.status,
              authenticationMethod: authentication.method,
            } : {}),
            checkedAt: now(),
          };
        }
      }
      return { runtimeId: runtimeIdFor(command), command, capabilityPrefix, status: "absent", version: null, checkedAt: now() };
    }),
  );
}

function runtimeIdFor(command) {
  return RUNTIME_IDS.get(command) ?? `runtime_${command.replace(/-/g, "_")}`;
}

function normalizeAuthenticationProbe(entry) {
  const probe = entry?.authenticationProbe && typeof entry.authenticationProbe === "object" && !Array.isArray(entry.authenticationProbe)
    ? entry.authenticationProbe
    : null;
  if (!probe) return null;
  const executable = String(probe.executable ?? entry.command ?? "").trim();
  const args = Array.isArray(probe.args) ? probe.args.map(String) : [];
  const format = probe.format === "claude-json" ? "claude-json" : "exit-code";
  return executable && args.length ? { executable, args, format } : null;
}

function normalizeProbe(entry) {
  const probe = entry?.probe && typeof entry.probe === "object" && !Array.isArray(entry.probe)
    ? entry.probe
    : null;
  const executable = String(probe?.executable ?? entry?.command ?? "").trim();
  const args = Array.isArray(probe?.args) ? probe.args.map(String) : ["--version"];
  const candidates = [
    { executable, args },
    ...(Array.isArray(probe?.candidates) ? probe.candidates.map((candidate) => ({
      executable: String(candidate?.executable ?? "").trim(),
      args: Array.isArray(candidate?.args) ? candidate.args.map(String) : args,
    })) : []),
  ].filter((candidate) => candidate.executable);
  return { executable, args, candidates: dedupeCandidates(candidates) };
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.executable}\0${JSON.stringify(candidate.args)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function defaultRunVersion(command, args = ["--version"]) {
  const result = await spawnCapture(command, args, { encoding: "utf8", windowsHide: true, timeout: 3000 });
  return result.status === 0 ? result.stdout || result.stderr : "";
}

async function defaultRunAuthentication(command, args, format) {
  const result = await spawnCapture(command, args, { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (format === "claude-json") {
    try {
      const parsed = JSON.parse(String(result.stdout ?? "").trim());
      return {
        status: parsed?.loggedIn === true ? "authenticated" : "unauthenticated",
        method: safeAuthenticationMethod(parsed?.authMethod),
      };
    } catch {
      return { status: "unknown", method: null };
    }
  }
  return {
    status: result.status === 0 ? "authenticated" : result.status == null ? "unknown" : "unauthenticated",
    method: result.status === 0 ? codexAuthenticationMethod(result.stdout || result.stderr) : null,
  };
}

function codexAuthenticationMethod(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("api key")) return "api_key";
  if (text.includes("chatgpt")) return "chatgpt";
  if (text.includes("access token")) return "access_token";
  return null;
}

function safeAuthenticationMethod(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 32);
  return normalized && normalized !== "none" ? normalized : null;
}

function sanitizeVersion(value) {
  return String(value ?? "").replace(/[\0\r\n\t]+/g, " ").trim().slice(0, 120) || null;
}
