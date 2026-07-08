import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Layer B rendering: an OPERATOR-configured command that rasterizes a design
// run's design/*.html mockups into design/*.png inside the worktree, so the PNGs
// can be pushed and embedded on the issue. Same trust boundary as the verify /
// review / judge commands — argv resolved from an env var (never agent-proposed),
// no shell — so an editing agent can never choose what runs here. The product
// bundles NO browser; the operator wires their own (e.g. playwright), exactly like
// the D5 screenshot command. Best-effort: a missing/failing renderer never blocks
// the design report — it just means no inline preview (Layer A still posts).

function isArgv(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

export function resolveDesignRenderCommand(env = process.env) {
  const raw = env.MYAGENTTOOL_AUTORUN_DESIGN_RENDER_COMMAND_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (isArgv(parsed)) return parsed;
  } catch {
    /* fall through */
  }
  return null;
}

export function designRenderTimeoutMs(env = process.env) {
  const n = Math.round(Number(env.MYAGENTTOOL_AUTORUN_DESIGN_RENDER_TIMEOUT_MS));
  return Number.isFinite(n) && n >= 1000 ? Math.min(n, 300_000) : 120_000;
}

/**
 * Run the design-render command in the worktree. Never throws; returns whether a
 * renderer actually ran and exited clean. The effect is files written to design/.
 * @param {{ worktreePath: string, command?: string[]|null, timeoutMs?: number }} opts
 */
export async function runDesignRender({ worktreePath, command, timeoutMs } = {}) {
  if (!worktreePath || !isArgv(command)) return { rendered: false, reason: "not configured" };
  const [file, ...args] = command;
  try {
    await execFileAsync(file, args, {
      cwd: worktreePath,
      timeout: timeoutMs ?? 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { rendered: true };
  } catch (error) {
    return { rendered: false, reason: String(error?.message ?? error).slice(0, 300) };
  }
}
