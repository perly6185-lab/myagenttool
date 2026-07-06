import { spawn } from "node:child_process";

// The default decision-agent execution shape (ISSUE_DECISION_AGENT_PLAN.md
// slice 3): an operator-configured one-shot command — any LLM CLI or script —
// that reads the issue context as JSON on stdin and prints the decision
// contract as JSON on stdout. Resolved from env (array form, no shell, never
// agent-proposed), mirroring MYAGENTTOOL_GH_COMMAND_JSON so the local trust
// boundary holds. Every failure mode (unconfigured, spawn error, timeout,
// junk output) yields null and the caller falls back to the heuristic.

export function resolveDeciderCommand(env = process.env) {
  const raw = env.MYAGENTTOOL_AUTORUN_DECIDER_COMMAND_JSON;
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

export function deciderTimeoutMs(env = process.env) {
  const raw = Number(env.MYAGENTTOOL_AUTORUN_DECIDER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 1000 && raw <= 300_000 ? raw : 30_000;
}

// LLM CLIs often wrap their JSON in prose; parse strictly first, then try the
// outermost {...} block. The caller's normalizeDecision does the real
// validation — this only has to produce a candidate object.
export function extractJsonObject(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    /* try the embedded object */
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Run the decider command: issue context JSON on stdin, decision JSON expected
 * on stdout. Resolves to the raw decision object or null; never rejects.
 */
export function runDeciderCommand({ command, input, timeoutMs = deciderTimeoutMs() }) {
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
      child = spawn(cmd, args, { stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      return done(null);
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      done(null);
    }, timeoutMs);
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      // Cap the buffer: a decision is small; a runaway stream is a failure.
      if (stdout.length < 256 * 1024) stdout += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      done(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done(code === 0 ? extractJsonObject(stdout) : null);
    });
    try {
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(input ?? {}));
    } catch {
      /* stdin failures surface via close/error */
    }
  });
}
