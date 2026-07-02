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
// Contract: reads the case as JSON on stdin, prints {changedFiles, notes,
// verify} JSON on stdout. Any diagnostics go to stderr so stdout stays
// machine-parseable.
//
// Behavior oracle: when the case carries oracle.verify, the probe command runs
// inside the worktree BEFORE the agent (base run — fail-to-pass cases must fail
// here) and again AFTER the agent; both exit codes are reported as
// {baseStatus, status} and the judge applies the mode rules.
//
// Env:
//   MYAGENTTOOL_CODING_ADAPTER    adapter name (default: mock — changes nothing)
//   MYAGENTTOOL_HELDOUT_PROVIDER  code-plan provider (default: mock)
//   MYAGENTTOOL_HELDOUT_BASE      base ref for the worktree (default: HEAD;
//                                 a case-level `base` field wins)
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
  // Case-pinned base wins: real cases mined from history set base to the parent
  // of the original fix commit so the fix is absent from the evaluated tree.
  const base = caseObj.base || process.env.MYAGENTTOOL_HELDOUT_BASE || "HEAD";
  const baseSha = git(["rev-parse", base]);
  const verifyOracle = normalizeVerifyOracle(caseObj.oracle?.verify);

  const workParent = mkdtempSync(join(tmpdir(), "heldout-wt-"));
  const worktree = join(workParent, "repo");
  let notes = `work-runner resolver (adapter=${adapter}, provider=${provider}, base=${baseSha.slice(0, 8)})`;
  let cleaned = false;

  try {
    git(["worktree", "add", "--detach", worktree, baseSha]);

    // Base probe first: fail-to-pass cases must fail here, before the agent
    // has touched anything. Recorded even for regression mode (informational).
    let verify = null;
    if (verifyOracle) {
      const baseStatus = runVerifyProbe(verifyOracle, worktree);
      verify = { baseStatus, status: null };
      notes += `; verify base exit ${baseStatus}`;
    }

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
      const stderrLines = (run.stderr ?? "").trim().split(/\r?\n/);
      const errLine = stderrLines.find((line) => line.includes("Error")) ?? stderrLines.pop() ?? "";
      notes += `; work-runner exited ${run.status}: ${errLine.trim()}`;
    }

    const changedFiles = collectChangedFiles(worktree);
    if (verifyOracle) {
      verify.status = runVerifyProbe(verifyOracle, worktree);
      notes += `; verify post exit ${verify.status}`;
    }
    // Capture the branch work-runner created inside the worktree so we can delete
    // it after removal — git refuses to delete a branch checked out in a worktree,
    // and leaving it leaks a ref that collides with the next run's `git switch -c`.
    const runBranch = tryGit(["branch", "--show-current"], worktree);
    process.stdout.write(JSON.stringify({ changedFiles, notes, verify }));

    cleanup(worktree, workParent, runBranch);
    cleaned = true;
  } finally {
    if (!cleaned) cleanup(worktree, workParent, tryGit(["branch", "--show-current"], worktree));
  }
}

function normalizeVerifyOracle(raw) {
  if (!raw || typeof raw !== "object") return null;
  const command = Array.isArray(raw.command) ? raw.command.map(String).filter(Boolean) : [];
  if (command.length === 0) return null;
  const timeoutMs = Number.isFinite(Number(raw.timeoutMs)) && Number(raw.timeoutMs) > 0 ? Number(raw.timeoutMs) : 120000;
  return { command, timeoutMs };
}

// Run the behavior probe inside the worktree; the exit code is the signal.
// A timeout or spawn failure counts as a non-zero exit, never a pass.
function runVerifyProbe(verifyOracle, worktree) {
  const [command, ...args] = verifyOracle.command;
  const result = spawnSync(command, args, {
    cwd: worktree,
    env: { ...process.env, MYAGENTTOOL_REPO_ROOT: worktree },
    encoding: "utf8",
    timeout: verifyOracle.timeoutMs,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error?.code === "ETIMEDOUT") return 124;
  return result.status ?? 1;
}

// Union of modified/added tracked files and new untracked files (the adapter may
// create files), excluding gitignored run evidence under .myagenttool/.
function collectChangedFiles(worktree) {
  const tracked = splitLines(git(["diff", "--name-only"], worktree));
  const untracked = splitLines(git(["ls-files", "--others", "--exclude-standard"], worktree));
  return [...new Set([...tracked, ...untracked])]
    .map((path) => path.replace(/\\/g, "/"))
    // Run evidence is gitignored today, but old base refs may predate that
    // .gitignore line — never count harness evidence as an agent change.
    .filter((path) => !path.startsWith(".myagenttool/"))
    .sort();
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
