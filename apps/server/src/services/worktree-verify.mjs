import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The auto-run verification gate runs a project-owner-configured command in the
// worktree before a PR is opened. The command is resolved from an env var (not
// agent-proposed input) so the trust boundary is respected — an editing agent
// can never choose what runs here. Array form, no shell, mirroring the
// MYAGENTTOOL_GH_COMMAND_JSON contract.
export function resolveAutoRunVerifyCommand() {
  const raw = process.env.MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((item) => typeof item === "string" && item.length > 0)) {
      return parsed;
    }
  } catch {
    /* fall through to null */
  }
  return null;
}

// Run the verification command in the worktree. Returns a structured result:
// `verified` = a real check ran; `passed` = it exited 0. Never throws — a spawn
// failure is reported as a failed (but verified) check so the gate blocks.
export async function runWorktreeVerification({ cwd, command, timeoutMs = 300_000 }) {
  const [cmd, ...args] = command;
  const label = command.join(" ");
  try {
    await execFileAsync(cmd, args, { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    return { passed: true, verified: true, exitCode: 0, command: label, summary: `\`${label}\` passed.` };
  } catch (error) {
    const exitCode = typeof error?.code === "number" ? error.code : 1;
    const tail = String(error?.stdout ?? error?.stderr ?? error?.message ?? "")
      .split("\n")
      .slice(-8)
      .join("\n")
      .trim();
    return {
      passed: false,
      verified: true,
      exitCode,
      command: label,
      summary: `\`${label}\` failed (exit ${exitCode}).${tail ? ` Output:\n${tail}` : ""}`,
    };
  }
}
