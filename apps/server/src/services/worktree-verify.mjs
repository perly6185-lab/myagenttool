import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The auto-run verification gate runs a project-owner-configured command in the
// worktree before a PR is opened. The command is resolved from an env var (not
// agent-proposed input) so the trust boundary is respected — an editing agent
// can never choose what runs here. Array form, no shell, mirroring the
// MYAGENTTOOL_GH_COMMAND_JSON contract.
function isArgv(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

export function resolveAutoRunVerifyCommand(env = process.env) {
  const raw = env.MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (isArgv(parsed)) return parsed;
  } catch {
    /* fall through to null */
  }
  return null;
}

// A4: named verify-command allowlist. The operator defines named commands in env
// (MYAGENTTOOL_AUTORUN_VERIFY_COMMANDS_JSON = { name: [argv], ... }); a project
// selects one BY NAME. This keeps per-project verify configurable while the argv
// stays operator-set — the UI/API only ever sets a name (a key), never a command,
// so the trust boundary holds. Returns a { name: argv } map of valid entries.
export function resolveVerifyCommandAllowlist(env = process.env) {
  const raw = env.MYAGENTTOOL_AUTORUN_VERIFY_COMMANDS_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = {};
    for (const [name, argv] of Object.entries(parsed)) {
      if (typeof name === "string" && name.trim() && isArgv(argv)) out[name] = argv;
    }
    return out;
  } catch {
    return {};
  }
}

// The verify command for a run: the project's chosen allowlisted name if valid,
// else the global single command (back-compat). Name that isn't in the allowlist
// falls back (never runs an unlisted command).
export function resolveAutoRunVerifyCommandFor({ verifyCommandName = null, env = process.env } = {}) {
  if (verifyCommandName) {
    const allow = resolveVerifyCommandAllowlist(env);
    if (allow[verifyCommandName]) return allow[verifyCommandName];
  }
  return resolveAutoRunVerifyCommand(env);
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
