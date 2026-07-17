import { spawn } from "node:child_process";

/**
 * Async replacement for spawnSync (#1246). spawnSync freezes the whole event
 * loop for the child's lifetime — fine for a one-shot CLI, fatal for the bridge,
 * which must keep forwarding output for every in-flight run (#1242), firing the
 * 40ms terminal poll, and answering the 250ms cancel poll. This spawns the same
 * way but resolves a Promise, so nothing else stalls while the child runs.
 *
 * The resolved shape mirrors the spawnSync result fields callers already read
 * (`status`, `signal`, `error`, `stdout`, `stderr`), plus `timedOut`, so a
 * caller can swap `spawnSync(...)` for `await spawnCapture(...)` unchanged.
 *
 * Timeout matches spawnSync's contract: the child is killed and the result
 * carries an ETIMEDOUT error (and the kill signal), never a resolved success.
 */
export function spawnCapture(
  command,
  args = [],
  { cwd, env, timeout, encoding = "utf8", windowsHide = true, shell = false, maxBuffer = 10 * 1024 * 1024, killSignal = "SIGTERM" } = {},
) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env, windowsHide, shell, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      // A synchronous spawn throw (e.g. a bad cwd) — spawnSync would return this
      // as result.error with a null status. Match that instead of rejecting.
      resolve({ status: null, signal: null, error, stdout: "", stderr: "", timedOut: false });
      return;
    }

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let timer = null;

    const append = (key, chunk) => {
      if (truncated) return;
      const text = chunk.toString(encoding);
      if (key === "stdout") stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > maxBuffer) {
        truncated = true;
        try {
          child.kill(killSignal);
        } catch {
          /* already gone */
        }
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    child.stdout?.on("data", (chunk) => append("stdout", chunk));
    child.stderr?.on("data", (chunk) => append("stderr", chunk));

    child.on("error", (error) => {
      finish({ status: null, signal: null, error, stdout, stderr, timedOut });
    });
    child.on("close", (status, signal) => {
      finish({
        status,
        signal,
        error: timedOut ? Object.assign(new Error("spawnCapture timed out"), { code: "ETIMEDOUT" }) : null,
        stdout,
        stderr,
        timedOut,
      });
    });

    if (Number.isFinite(timeout) && timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill(killSignal);
        } catch {
          /* already exited */
        }
      }, timeout);
    }
  });
}
