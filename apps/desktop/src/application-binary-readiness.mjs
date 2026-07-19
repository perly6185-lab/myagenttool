import { binaryAvailableOnPath } from "./local-execution-policy.mjs";
import { spawnCapture } from "./spawn-capture.mjs";

// #1246: async so the `--version` probes never freeze the event loop (this runs
// at register time and every 5 minutes; a sync sweep stalled every in-flight
// run). Probes run in parallel with the row order preserved, so a sweep costs
// the slowest probe, not the sum.
export async function collectApplicationBinaryReadiness(
  manifest,
  { now = () => new Date().toISOString(), resolveBinary = binaryAvailableOnPath, runVersion = defaultRunVersion } = {},
) {
  const entries = (manifest?.applicationWrapperCommands ?? [])
    .map((entry) => ({
      command: String(entry?.command ?? "").trim(),
      capabilityPrefix: String(entry?.capabilityPrefix ?? "").trim(),
      probe: normalizeProbe(entry),
    }))
    .filter((entry) => entry.command && entry.capabilityPrefix.startsWith("app."));

  return Promise.all(
    entries.map(async ({ command, capabilityPrefix, probe }) => {
      for (const candidate of probe.candidates) {
        if (!resolveBinary(candidate.executable)) continue;
        const version = sanitizeVersion(await runVersion(candidate.executable, candidate.args));
        if (version) {
          return {
            command,
            capabilityPrefix,
            status: "available",
            version,
            checkedAt: now(),
          };
        }
      }
      return { command, capabilityPrefix, status: "absent", version: null, checkedAt: now() };
    }),
  );
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

function sanitizeVersion(value) {
  return String(value ?? "").replace(/[\0\r\n\t]+/g, " ").trim().slice(0, 120) || null;
}
