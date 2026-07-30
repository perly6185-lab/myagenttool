import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("./verification-process-guardian-worker.mjs", import.meta.url));

/**
 * Arm a detached guardian for a verification command. The verifier is owned by
 * the Server process, so an ordinary AbortSignal can clean it up only while the
 * Server is alive. This worker survives a hard Server exit long enough to kill
 * the verifier's complete process tree, then exits by itself.
 */
export function startVerificationProcessGuardian(child, {
  parentPid = process.pid,
  spawnProcess = spawn,
  pollIntervalMs = 200,
  detached = true,
  stdio = "ignore",
} = {}) {
  if (!Number.isInteger(child?.pid) || child.pid <= 0) return null;
  const guardian = spawnProcess(process.execPath, [
    workerPath,
    String(parentPid),
    String(child.pid),
    String(Math.max(50, Math.floor(pollIntervalMs))),
  ], {
    detached,
    windowsHide: true,
    stdio,
  });
  if (detached && stdio === "ignore") guardian.unref?.();
  return guardian;
}
