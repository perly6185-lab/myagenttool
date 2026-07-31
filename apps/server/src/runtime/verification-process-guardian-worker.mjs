import { spawn } from "node:child_process";

const parentPid = Number(process.argv[2]);
const childPid = Number(process.argv[3]);
const pollIntervalMs = Number(process.argv[4]) || 200;

if (!Number.isInteger(parentPid) || parentPid <= 0 || !Number.isInteger(childPid) || childPid <= 0) {
  process.exit(2);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function killVerificationTree() {
  if (!alive(childPid)) {
    process.exit(0);
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(childPid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", () => process.exit(1));
    killer.once("close", (code) => {
      if (code === 0 || !alive(childPid)) {
        process.exit(0);
        return;
      }
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // It exited between taskkill and the direct fallback.
      }
      setTimeout(() => process.exit(1), 100);
    });
    return;
  }
  try {
    process.kill(-childPid, "SIGKILL");
  } catch {
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // The verifier already stopped between the liveness probe and kill.
    }
  }
  process.exit(0);
}

const timer = setInterval(() => {
  if (!alive(childPid)) {
    clearInterval(timer);
    process.exit(0);
  }
  if (!alive(parentPid)) {
    clearInterval(timer);
    killVerificationTree();
  }
}, pollIntervalMs);
