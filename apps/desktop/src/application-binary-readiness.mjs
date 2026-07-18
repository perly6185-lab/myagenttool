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
    }))
    .filter((entry) => entry.command && entry.capabilityPrefix.startsWith("app."));

  return Promise.all(
    entries.map(async ({ command, capabilityPrefix }) => {
      if (!resolveBinary(command)) {
        return { command, capabilityPrefix, status: "absent", version: null, checkedAt: now() };
      }
      return {
        command,
        capabilityPrefix,
        status: "available",
        version: sanitizeVersion(await runVersion(command)),
        checkedAt: now(),
      };
    }),
  );
}

async function defaultRunVersion(command) {
  const result = await spawnCapture(command, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 3000 });
  return result.status === 0 ? result.stdout || result.stderr : "";
}

function sanitizeVersion(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 120) || null;
}
