#!/usr/bin/env node
// Production held-out resolver.
//
// Runs `ai:work-runner --apply` for one held-out case inside an ISOLATED git
// worktree (never touches the caller's checkout or branch), then reports the
// files the coding adapter changed. This is the real capability path referenced
// by docs/engineering/L4_HELDOUT_EVAL.md — plug it into eval-heldout with:
//
//   pnpm ai:eval-heldout -- --resolver command \
//     --resolver-command-json '["node","tools/ai/src/evals/work-runner-resolver.mjs"]'
//
// Contract: reads the case as JSON on stdin, prints {changedFiles, notes} JSON
// on stdout. Any diagnostics go to stderr so stdout stays machine-parseable.
//
// Env:
//   MYAGENTTOOL_CODING_ADAPTER    adapter name (default: mock — changes nothing)
//   MYAGENTTOOL_HELDOUT_PROVIDER  code-plan provider (default: mock)
//   MYAGENTTOOL_HELDOUT_BASE      base ref for the worktree (default: HEAD)
//   <adapter>_COMMAND_JSON        real adapter command, passed through untouched

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");

function git(args, cwd = repoRoot) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryGit(args, cwd = repoRoot) {
  try {
    return git(args, cwd);
  } catch {
    return "";
  }
}

// Remove the isolated worktree, delete the branch work-runner created inside it,
// and prune. Idempotent and best-effort so a failure never masks the result.
function cleanup(worktree, workParent, runBranch) {
  if (tryGit(["worktree", "remove", "--force", worktree]) === "" && tryGit(["worktree", "list"]).includes(worktree)) {
    process.stderr.write(`worktree cleanup warning: ${worktree} may still exist\n`);
  }
  if (runBranch) tryGit(["branch", "-D", runBranch]);
  rmSync(workParent, { recursive: true, force: true });
  tryGit(["worktree", "prune"]);
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return process.env.MYAGENTTOOL_HELDOUT_CASE ?? "";
  }
}

function main() {
  const raw = readStdin().trim();
  if (!raw) throw new Error("No held-out case on stdin.");
  const caseObj = JSON.parse(raw);

  const adapter = process.env.MYAGENTTOOL_CODING_ADAPTER ?? "mock";
  const provider = process.env.MYAGENTTOOL_HELDOUT_PROVIDER ?? "mock";
  const base = process.env.MYAGENTTOOL_HELDOUT_BASE ?? "HEAD";
  const baseSha = git(["rev-parse", base]);

  const workParent = mkdtempSync(join(tmpdir(), "heldout-wt-"));
  const worktree = join(workParent, "repo");
  let notes = `work-runner resolver (adapter=${adapter}, provider=${provider})`;
  let cleaned = false;

  try {
    git(["worktree", "add", "--detach", worktree, baseSha]);

    const runArgs = [
      resolve(repoRoot, "tools/ai/src/index.mjs"),
      "run-work",
      "--issue", String(caseObj.issue ?? caseObj.id ?? "sim"),
      "--provider", provider,
      "--coding-adapter", adapter,
      "--apply",
      "--skip-verify",
      "--allow-drift", "held-out eval scoped by oracle",
    ];
    const run = spawnSync(process.execPath, runArgs, {
      cwd: worktree,
      env: {
        ...process.env,
        MYAGENTTOOL_REPO_ROOT: worktree,
        MYAGENTTOOL_HELDOUT_CASE: raw,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (run.status !== 0) {
      notes += `; work-runner exited ${run.status}: ${(run.stderr ?? "").trim().split("\n").pop()}`;
    }

    const changedFiles = collectChangedFiles(worktree);
    // Capture the branch work-runner created inside the worktree so we can delete
    // it after removal — git refuses to delete a branch checked out in a worktree,
    // and leaving it leaks a ref that collides with the next run's `git switch -c`.
    const runBranch = tryGit(["branch", "--show-current"], worktree);
    process.stdout.write(JSON.stringify({ changedFiles, notes }));

    cleanup(worktree, workParent, runBranch);
    cleaned = true;
  } finally {
    if (!cleaned) cleanup(worktree, workParent, tryGit(["branch", "--show-current"], worktree));
  }
}

// Union of modified/added tracked files and new untracked files (the adapter may
// create files), excluding gitignored run evidence under .myagenttool/.
function collectChangedFiles(worktree) {
  const tracked = splitLines(git(["diff", "--name-only"], worktree));
  const untracked = splitLines(git(["ls-files", "--others", "--exclude-standard"], worktree));
  return [...new Set([...tracked, ...untracked])].map((path) => path.replace(/\\/g, "/")).sort();
}

function splitLines(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
}
