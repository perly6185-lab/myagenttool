#!/usr/bin/env node
// Production held-out resolver.
//
// Runs `ai:work-runner --apply` for one held-out case inside an ISOLATED git
// worktree (never touches the caller's checkout or branch), then reports the
// files the coding adapter changed. This is the real capability path referenced
// by docs/engineering/L4_HELDOUT_EVAL.md — plug it into eval-heldout with an
// ABSOLUTE script path (the eval worktree is at an old ref that may predate
// this script; a relative path would resolve inside that worktree):
//
//   pnpm ai:eval-heldout -- --resolver command \
//     --resolver-command-json "[\"node\",\"$PWD/tools/ai/src/evals/work-runner-resolver.mjs\"]"
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
// Eval integrity: the agent-facing side (work-runner + coding adapter) receives
// a SANITIZED case without the oracle — expectedFiles/forbiddenFiles are the
// answer key, and finding the right files is the capability under test.
//
// Env:
//   MYAGENTTOOL_CODING_ADAPTER    adapter name (default: mock — changes nothing)
//   MYAGENTTOOL_HELDOUT_PROVIDER  code-plan provider (default: mock)
//   MYAGENTTOOL_HELDOUT_BASE      base ref for the worktree (default: HEAD;
//                                 a case-level `base` field wins)
//   <adapter>_COMMAND_JSON        real adapter command (ABSOLUTE paths only),
//                                 passed through untouched

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectChangedFiles } from "./git-files.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");

function git(args, cwd = repoRoot) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Returns null on git failure (success output may legitimately be "").
function tryGit(args, cwd = repoRoot) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

// Remove the isolated worktree, delete the branch work-runner created inside it
// (git refuses to delete a branch checked out in a worktree, and a leaked ref
// collides with the next run's `git switch -c`), and prune only when removal
// failed. Best-effort so a cleanup failure never masks the result.
function cleanup(worktree, workParent) {
  const runBranch = tryGit(["branch", "--show-current"], worktree);
  if (tryGit(["worktree", "remove", "--force", worktree]) === null) {
    process.stderr.write(`worktree cleanup warning: ${worktree} may still exist\n`);
    tryGit(["worktree", "prune"]);
  }
  if (runBranch) tryGit(["branch", "-D", runBranch]);
  rmSync(workParent, { recursive: true, force: true });
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
  // Loaded cases arrive validated (loadHeldoutSet materialized mode/command/
  // timeoutMs), so trust the shape; the guard only covers hand-fed stdin cases.
  const verifyOracle = caseObj.oracle?.verify?.command?.length ? caseObj.oracle.verify : null;
  // The agent-facing side must not see the answer key.
  const sanitizedCase = JSON.stringify({
    id: caseObj.id,
    issue: caseObj.issue,
    title: caseObj.title,
    spec: caseObj.spec,
    risk: caseObj.risk,
    base: caseObj.base,
    difficulty: caseObj.difficulty,
  });

  const workParent = mkdtempSync(join(tmpdir(), "heldout-wt-"));
  const worktree = join(workParent, "repo");
  let notes = `work-runner resolver (adapter=${adapter}, provider=${provider}, base=${baseSha.slice(0, 8)})`;

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
        MYAGENTTOOL_HELDOUT_CASE: sanitizedCase,
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
    process.stdout.write(JSON.stringify({ changedFiles, notes, verify }));
  } finally {
    cleanup(worktree, workParent);
  }
}

// Run the behavior probe inside the worktree; the exit code is the signal.
// A timeout or spawn failure counts as a non-zero exit, never a pass.
function runVerifyProbe(verifyOracle, worktree) {
  const [command, ...args] = verifyOracle.command;
  const result = spawnSync(command, args, {
    cwd: worktree,
    env: { ...process.env, MYAGENTTOOL_REPO_ROOT: worktree },
    encoding: "utf8",
    timeout: verifyOracle.timeoutMs ?? 120000,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error?.code === "ETIMEDOUT") return 124;
  return result.status ?? 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
}
