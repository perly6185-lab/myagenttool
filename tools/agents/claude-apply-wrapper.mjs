#!/usr/bin/env node
// Claude governance Phase 4b (#914): the write-capable apply RUNNER. It applies a
// reviewed, approval-authorized patch into the bound worktree with `git apply`.
// This is the ONLY Claude wrapper that writes files, and it runs only for an
// invocation the server already authorized (Phase 4a: bound proposal + consumed
// single-use grant). It refuses to apply a patch that does not cleanly check, and
// it reports the authoritative applied-file list plus reversible rollback guidance.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

const TOOL = "claude.apply.patch";
const options = parseArgs(process.argv.slice(2));
requireApplyInputs(options);

// `--reverse` is the governed ROLLBACK: the exact same patch the server holds on
// the authorization, undone with git's own reversal. Same check-then-apply
// discipline in both directions — a reverse that does not check cleanly (e.g. the
// worktree moved on since the apply) is refused, never force-applied.
const direction = options.reverse ? ["--reverse"] : [];
const word = options.reverse ? "reverse" : "apply";

console.log(`Claude ${word} started: ${options.cwd}`);

// The file list is derived from git, never the model — `--numstat` reports exactly
// which files this patch touches without applying anything.
const numstat = git(options.cwd, ["apply", ...direction, "--numstat", "--", options.patchFile], { allowFailure: true });
const files = parseNumstat(numstat.stdout);

// Verify before writing. A patch that does not apply cleanly is refused, not
// force-applied — a half-applied worktree is worse than a rejected one.
const check = git(options.cwd, ["apply", ...direction, "--check", "--", options.patchFile], { allowFailure: true });
if (check.status !== 0) {
  emit({
    applied: false,
    reversed: options.reverse,
    appliedFiles: [],
    verification: { checkPassed: false, error: truncate(check.stderr) },
    rollback: null,
    summary: `Patch did not ${word} cleanly; nothing was written.`,
  }, /* exitCode */ 1);
}

const apply = git(options.cwd, ["apply", ...direction, "--", options.patchFile], { allowFailure: true });
if (apply.status !== 0) {
  // --check passed but apply failed (rare: races/permissions). Report as not
  // applied; git apply is atomic, so a failed apply leaves the tree untouched.
  emit({
    applied: false,
    reversed: options.reverse,
    appliedFiles: [],
    verification: { checkPassed: true, error: truncate(apply.stderr) },
    rollback: null,
    summary: `git ${word} failed after a clean check; nothing was written.`,
  }, /* exitCode */ 1);
}

emit({
  applied: true,
  reversed: options.reverse,
  appliedFiles: files,
  verification: { checkPassed: true },
  // git apply is reversible: re-running the SAME patch with --reverse undoes it.
  // The server holds the patch (on the authorization), so rollback re-invokes this
  // runner with --reverse. A completed rollback is itself not re-reversible here.
  rollback: options.reverse
    ? null
    : { available: true, strategy: "git_apply_reverse", command: "git apply --reverse" },
  summary: options.reverse
    ? `Rolled back a Claude patch touching ${files.length} file(s).`
    : `Applied a Claude patch touching ${files.length} file(s).`,
}, /* exitCode */ 0);

function emit(output, exitCode) {
  console.log(`RESULT ${JSON.stringify({
    summary: output.summary,
    // This wrapper DID write files when applied is true — report it honestly so the
    // bridge's audit reflects a real worktree mutation.
    touchedUserFiles: output.applied === true,
    output: { source: "claude", tool: TOOL, ...output },
  })}`);
  process.exit(exitCode);
}

function parseArgs(args) {
  const parsed = { cwd: null, patchFile: null, reverse: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cwd") parsed.cwd = requireValue(args, ++index, arg);
    else if (arg === "--patch-file") parsed.patchFile = requireValue(args, ++index, arg);
    else if (arg === "--reverse") parsed.reverse = true;
    else if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
    else fail(`Unsupported Claude apply wrapper argument: ${arg}`);
  }
  return parsed;
}

function requireApplyInputs(opts) {
  if (!opts.cwd || !isAbsolute(opts.cwd) || !existsSync(opts.cwd)) {
    fail("--cwd must be an absolute path to an existing worktree.");
  }
  // Confirm the target is a git worktree before we try to write to it.
  const gitDir = git(opts.cwd, ["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
  if (gitDir.status !== 0 || String(gitDir.stdout).trim() !== "true") {
    fail("--cwd must be inside a git work tree.");
  }
  if (!opts.patchFile || !isAbsolute(opts.patchFile) || !existsSync(opts.patchFile)) {
    fail("--patch-file must be an absolute path to an existing patch file.");
  }
  const patch = readFileSync(opts.patchFile, "utf8");
  if (!patch.trim()) fail("--patch-file is empty.");
}

function requireValue(args, index, name) {
  const value = args[index];
  if (value === undefined) fail(`Missing value for ${name}.`);
  return value;
}

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0 && !allowFailure) {
    fail(`git ${args.join(" ")} failed: ${truncate(result.stderr)}`);
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// `git apply --numstat` prints: "<added>\t<deleted>\t<path>" per file. A binary
// file prints "-\t-\t<path>". Renames print "old => new"; keep the new path.
function parseNumstat(stdout) {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      if (parts.length < 3) return null;
      const rawPath = parts.slice(2).join("\t");
      const path = rawPath.includes("=>") ? rawPath.split("=>").at(-1).trim().replace(/}$/, "") : rawPath;
      return { path, added: numOrNull(parts[0]), deleted: numOrNull(parts[1]) };
    })
    .filter((item) => item && item.path);
}

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function truncate(text) {
  const trimmed = String(text ?? "").trim();
  return trimmed.length <= 2000 ? trimmed : `${trimmed.slice(0, 2000)}\n... (truncated)`;
}

function fail(message) {
  console.log(`RESULT ${JSON.stringify({
    summary: message,
    touchedUserFiles: false,
    output: { source: "claude", tool: TOOL, applied: false, error: message },
  })}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  node tools/agents/claude-apply-wrapper.mjs --cwd <worktree> --patch-file <path> [--reverse]
`);
}
