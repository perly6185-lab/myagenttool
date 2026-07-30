import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("./process-tree-guardian-worker.mjs", import.meta.url));

/**
 * Start an out-of-process guardian for a bridge-owned child tree. It is
 * intentionally detached from the Bridge: if the Bridge is terminated without
 * running its shutdown handler, the guardian remains alive long enough to kill
 * the executor tree. It exits by itself as soon as either cleanup is complete
 * or the executor has already stopped.
 */
export function startProcessTreeGuardian(child, {
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
