import { spawn } from "node:child_process";
import { extractJsonObject } from "./decision-command.mjs";

// The deploy stage — autonomous DELIVERY. After a human-approved run's PR is
// MERGED, an operator-configured one-shot command performs the deploy and reports
// its outcome. Same local trust boundary as the decider/judge/verify commands:
// env array form, no shell, never agent-proposed. Off by default; a failure never
// throws into the fire-and-forget merge caller.
//
// The command reads { link, prNumber, mergeCommit, repoPath } as JSON on stdin.
// Outcome is taken from the EXIT CODE (0 = deployed) so a plain deploy script
// works with no JSON, and an optional { "deployed": bool, "summary": "..." } on
// stdout can add detail or veto a zero exit. A spawn/timeout failure (couldn't
// run at all) resolves to null — an infra miss, distinct from a real failed
// deploy (deployed:false), which matters for change-failure accounting later.

export function resolveDeployCommand(env = process.env) {
  const raw = env.MYAGENTTOOL_AUTORUN_DEPLOY_COMMAND_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((item) => typeof item === "string" && item.length > 0)) {
      return parsed;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function deployTimeoutMs(env = process.env) {
  const raw = Number(env.MYAGENTTOOL_AUTORUN_DEPLOY_TIMEOUT_MS);
  // Deploys take longer than a decision; allow up to 30 min, default 5.
  return Number.isFinite(raw) && raw >= 1000 && raw <= 1_800_000 ? raw : 300_000;
}

// Self-healing (H1): the operator's ROLLBACK command — the recovery action run
// when a deploy fails. Same shape and trust boundary as the deploy command
// (env argv, no shell, exit code is the success signal); reuses runDeployCommand.
export function resolveRollbackCommand(env = process.env) {
  const raw = env.MYAGENTTOOL_AUTORUN_ROLLBACK_COMMAND_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((item) => typeof item === "string" && item.length > 0)) {
      return parsed;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function rollbackTimeoutMs(env = process.env) {
  const raw = Number(env.MYAGENTTOOL_AUTORUN_ROLLBACK_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 1000 && raw <= 1_800_000 ? raw : 300_000;
}

// Shape the command's optional stdout JSON into the outcome contract (or null).
export function normalizeDeployResult(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return {
    deployed: raw.deployed === true,
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 2000) : "",
  };
}

/**
 * Run the deploy command. Resolves to { deployed, summary } when the command
 * ran to completion (exit 0 ⇒ deployed unless stdout explicitly vetoes; non-zero
 * ⇒ deployed:false), or null when it could not be run at all. Never rejects.
 */
export function runDeployCommand({ command, input, timeoutMs = deployTimeoutMs() }) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolvePromise(value);
      }
    };
    let child;
    try {
      const [cmd, ...args] = command;
      // detached: the child leads its own process group, so a timeout can kill the
      // WHOLE tree. A real deploy script forks (kubectl/ssh/terraform); killing only
      // the direct child would leave grandchildren still mutating the target while
      // we've already given up (M1).
      child = spawn(cmd, args, { stdio: ["pipe", "pipe", "ignore"], detached: true });
    } catch {
      return done(null);
    }
    const timer = setTimeout(() => {
      try {
        // Negative pid = the process group (POSIX). Falls back to the direct child
        // on platforms without process groups (e.g. Windows).
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
      done(null); // couldn't finish → infra miss, not a failed deploy
    }, timeoutMs);
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 256 * 1024) stdout += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      done(null); // spawn failure → infra miss
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const raw = extractJsonObject(stdout);
      const parsed = normalizeDeployResult(raw);
      if (code === 0) {
        // Exit 0 = success unless stdout EXPLICITLY vetoes with {"deployed": false}.
        // A bare {"summary": "…"} (no `deployed`) on exit 0 is still a success —
        // normalizeDeployResult collapses an absent `deployed` to false, which
        // would wrongly record a successful deploy as failed (and trigger a
        // destructive rollback), so recompute from the raw JSON here.
        done({ deployed: raw?.deployed !== false, summary: parsed?.summary ?? "" });
      } else {
        done({ deployed: false, summary: parsed?.summary || `deploy command exited ${code}` });
      }
    });
    try {
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(input ?? {}));
    } catch {
      /* surfaces via close/error */
    }
  });
}
