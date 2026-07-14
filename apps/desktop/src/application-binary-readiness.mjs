import { spawnSync } from "node:child_process";
import { binaryAvailableOnPath } from "./local-execution-policy.mjs";

export function collectApplicationBinaryReadiness(manifest, { now = () => new Date().toISOString(), resolveBinary = binaryAvailableOnPath, runVersion = defaultRunVersion } = {}) {
  return (manifest?.applicationWrapperCommands ?? []).flatMap((entry) => {
    const command = String(entry?.command ?? "").trim();
    const capabilityPrefix = String(entry?.capabilityPrefix ?? "").trim();
    if (!command || !capabilityPrefix.startsWith("app.")) return [];
    if (!resolveBinary(command)) return [{ command, capabilityPrefix, status: "absent", version: null, checkedAt: now() }];
    return [{ command, capabilityPrefix, status: "available", version: sanitizeVersion(runVersion(command)), checkedAt: now() }];
  });
}

function defaultRunVersion(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 3000 });
  return result.status === 0 ? result.stdout || result.stderr : "";
}

function sanitizeVersion(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 120) || null;
}
