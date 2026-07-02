/*
 * Real-agent eval runner (#248) — the scheduled path for measuring actual
 * coding/PM/review capability with the local Claude Code CLI.
 *
 *   pnpm eval:real -- --dry-run        # validate prerequisites, no paid calls
 *   pnpm eval:real -- --subcap-only    # cheap run: subcap real only (~10 min)
 *   pnpm eval:real                     # full run: subcap + held-out real (~1-2h)
 *   pnpm eval:real -- --trend          # print the accumulated trend table
 *
 * Runs on the maintainer's machine (cron; see tools/dev/eval-real-cron.sh):
 * the local `claude` CLI uses the logged-in session, so no API key is stored
 * anywhere. Paid runs stay OFF per-PR CI by design — CI's eval-gates job runs
 * the hermetic mock; this runner produces the real trend line.
 *
 * Evidence: each underlying eval writes its usual .myagenttool/evals/<runId>/
 * bundle; this runner appends ONE JSONL record per invocation to
 * .myagenttool/evals/trend.jsonl (gitignored, local-only). Rates are only
 * comparable within the same set version, so every record carries set sizes.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const trendFile = resolve(repoRoot, ".myagenttool/evals/trend.jsonl");
const args = process.argv.slice(2);

if (args.includes("--trend")) {
  printTrend();
  process.exit(0);
}

const dryRun = args.includes("--dry-run");
const subcapOnly = args.includes("--subcap-only");

// --- prerequisites (checked in every mode) ---------------------------------
const claudeVersion = tryRun("claude", ["--version"]);
if (!claudeVersion.ok) {
  console.error("eval:real requires the claude CLI on PATH (logged-in session).");
  process.exit(1);
}
const gitClean = tryRun("git", ["-C", repoRoot, "status", "--porcelain"]);
const heldoutDirty = !gitClean.ok || gitClean.stdout.trim().length > 0;

console.log(`[eval:real] claude ${claudeVersion.stdout.trim()} · repo ${heldoutDirty ? "DIRTY (held-out eval will be skipped)" : "clean"}`);
if (dryRun) {
  console.log(`[eval:real] dry run OK — would run: subcap real${subcapOnly ? "" : " + held-out real"}; trend -> ${trendFile}`);
  process.exit(0);
}

// --- real runs --------------------------------------------------------------
const startedAt = new Date().toISOString();
const record = { startedAt, claude: claudeVersion.stdout.trim(), kind: subcapOnly ? "subcap-only" : "full" };

{
  const summary = runEval("subcap", [
    "eval-subcap",
    "--provider", "command",
    "--json",
  ], {
    MYAGENTTOOL_AI_COMMAND: `node "${resolve(repoRoot, "tools/ai/src/evals/claude-provider.mjs")}"`,
  });
  record.subcap = summary && {
    passRate: summary.passRate,
    resolved: summary.resolved,
    total: summary.total,
    byKind: summary.byKind,
  };
}

if (!subcapOnly) {
  if (heldoutDirty) {
    // The held-out resolver creates worktrees and runs work-runner; a dirty
    // repo means eval noise (and work-runner refuses dirty trees) — skip and
    // say so rather than record a misleading number.
    record.heldout = { skipped: "repo dirty" };
    console.error("[eval:real] held-out eval skipped: repo has uncommitted changes.");
  } else {
    const summary = runEval("heldout", [
      "eval-heldout",
      "--set", "tools/ai/evals/heldout-real",
      "--resolver", "command",
      "--resolver-command-json", JSON.stringify(["node", resolve(repoRoot, "tools/ai/src/evals/work-runner-resolver.mjs")]),
      "--json",
    ], {
      MYAGENTTOOL_CODING_ADAPTER: "claude",
      MYAGENTTOOL_CLAUDE_COMMAND_JSON: JSON.stringify(["node", resolve(repoRoot, "tools/ai/src/evals/claude-adapter.mjs")]),
    });
    record.heldout = summary && {
      passRate: summary.passRate,
      resolved: summary.resolved,
      total: summary.total,
      byDifficulty: summary.byDifficulty,
    };
  }
}

record.finishedAt = new Date().toISOString();
mkdirSync(dirname(trendFile), { recursive: true });
appendFileSync(trendFile, `${JSON.stringify(record)}\n`, "utf8");
console.log(`[eval:real] trend record appended: ${trendLine(record)}`);

// --- helpers ----------------------------------------------------------------
function runEval(label, cliArgs, extraEnv) {
  console.log(`[eval:real] running ${label} (real provider)…`);
  const run = spawnSync(process.execPath, [resolve(repoRoot, "tools/ai/src/index.mjs"), ...cliArgs], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  // eval commands exit non-zero on gate violations (issue-gate 100% rule);
  // record what we can parse either way — the trend must show bad runs too.
  try {
    return JSON.parse(run.stdout);
  } catch {
    console.error(`[eval:real] ${label} produced no parseable summary (exit ${run.status}).`);
    return { error: `exit ${run.status}` };
  }
}

function tryRun(command, commandArgs) {
  try {
    return { ok: true, stdout: execFileSync(command, commandArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch {
    return { ok: false, stdout: "" };
  }
}

function trendLine(entry) {
  const subcap = entry.subcap?.total ? `subcap ${entry.subcap.resolved}/${entry.subcap.total}` : "subcap n/a";
  const heldout = entry.heldout?.total
    ? `heldout ${entry.heldout.resolved}/${entry.heldout.total}`
    : entry.heldout?.skipped ? `heldout skipped (${entry.heldout.skipped})` : "heldout n/a";
  return `${entry.startedAt.slice(0, 16)} ${subcap} · ${heldout}`;
}

function printTrend() {
  if (!existsSync(trendFile)) {
    console.log("No trend records yet. Run `pnpm eval:real` (or wait for cron).");
    return;
  }
  const lines = readFileSync(trendFile, "utf8").split("\n").filter(Boolean);
  console.log(`# Real-eval trend (${lines.length} run(s), local only)\n`);
  for (const line of lines) {
    try {
      console.log(`- ${trendLine(JSON.parse(line))}`);
    } catch {
      console.log(`- (unparseable record)`);
    }
  }
}
