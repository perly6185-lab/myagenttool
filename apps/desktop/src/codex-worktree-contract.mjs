import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";

function hasOption(args, ...names) {
  return args.some((arg) => names.includes(String(arg)));
}

function optionValue(args, ...names) {
  for (let index = 0; index < args.length; index += 1) {
    if (names.includes(String(args[index]))) return String(args[index + 1] ?? "");
  }
  return null;
}

/**
 * Resolve only the linked-worktree administration directory named by the
 * worktree's own .git file. Never return the source checkout or its whole .git
 * directory: Codex needs this narrow directory for Git's worktree-local index
 * and HEAD, while the platform remains responsible for staging and committing.
 */
export function linkedWorktreeGitAdminDir(cwd) {
  if (!cwd || !isAbsolute(cwd) || !existsSync(cwd)) return null;
  const dotGit = join(cwd, ".git");
  try {
    if (!lstatSync(dotGit).isFile()) return null;
    const match = /^gitdir:\s*(.+)\s*$/i.exec(readFileSync(dotGit, "utf8").trim());
    if (!match) return null;
    const candidate = isAbsolute(match[1]) ? resolve(match[1]) : resolve(cwd, match[1]);
    if (!existsSync(candidate) || !lstatSync(candidate).isDirectory()) return null;
    const canonical = realpathSync(candidate);
    const marker = `${sep}.git${sep}worktrees${sep}`.toLowerCase();
    return canonical.toLowerCase().includes(marker) ? canonical : null;
  } catch {
    return null;
  }
}

/**
 * Apply the safe default contract to a fresh `codex exec` invocation.
 * Resumed sessions retain the sandbox/workspace contract of their originating
 * session; the resume subcommand does not accept --sandbox/--cd/--add-dir.
 */
export function applyCodexWorktreeContract(args, { cwd } = {}) {
  const input = Array.isArray(args) ? args.map(String) : [];
  if (input[0] !== "exec"
    || input[1] === "resume"
    || input.includes("--dangerously-bypass-approvals-and-sandbox")
    || !cwd
    || !isAbsolute(cwd)) {
    return { args: input, additionalWritableRoots: [] };
  }

  const injected = [];
  if (!hasOption(input, "--sandbox", "-s")) {
    injected.push("--sandbox", "workspace-write");
  }
  if (!hasOption(input, "--cd", "-C")) {
    injected.push("--cd", cwd);
  }

  // A linked-worktree Git admin directory is writable state. It is required for
  // workspace-write tasks, but must never be added to a strict read-only run.
  const sandbox = optionValue(input, "--sandbox", "-s") ?? "workspace-write";
  const gitAdminDir = sandbox === "read-only" ? null : linkedWorktreeGitAdminDir(cwd);
  if (gitAdminDir && !hasOption(input, "--add-dir")) {
    injected.push("--add-dir", gitAdminDir);
  }

  return {
    args: [input[0], ...injected, ...input.slice(1)],
    additionalWritableRoots: gitAdminDir ? [gitAdminDir] : [],
  };
}
