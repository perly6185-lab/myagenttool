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
import { buildRunFeedbackEvents, deriveFloors, floorBreaches, looksLikeInfraFailure, PROVISIONAL_FLOORS, runRegressed } from "../ai/src/evals/eval-signals.mjs";

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

// Auth preflight: `claude --version` only proves the binary exists. Under
// cron's detached session the CLI is logged out and prints "Not logged in ·
// Please run /login" while STILL EXITING 0 — so probe with a cheap prompt and
// parse the OUTPUT, not the exit code. A logged-out run must not burn 15 paid
// cases producing a misleading 40% (#285).
const auth = authPreflight();
console.log(`[eval:real] claude ${claudeVersion.stdout.trim()} · auth ${auth.ok ? "ok" : "FAILED"} · repo ${heldoutDirty ? "DIRTY (held-out eval will be skipped)" : "clean"}`);

if (dryRun) {
  if (!auth.ok) console.error(`[eval:real] auth preflight FAILED: ${auth.detail}`);
  console.log(`[eval:real] dry run ${auth.ok ? "OK" : "would fail-fast"} — would run: subcap real${subcapOnly ? "" : " + held-out real"}; trend -> ${trendFile}`);
  process.exit(auth.ok ? 0 : 1);
}

const startedAt = new Date().toISOString();

if (!auth.ok) {
  // Fail-fast: no paid eval, emit a feedback event, and record an
  // infraFailure trend row so the outage is visible but excluded from the
  // capability line (#285/#286/#250).
  const record = { startedAt, kind: subcapOnly ? "subcap-only" : "full", authFailure: true, authDetail: auth.detail, infraFailure: true, finishedAt: new Date().toISOString() };
  appendTrend(record);
  emitFeedbackEvents(record);
  console.error(`[eval:real] auth preflight failed (${auth.detail}); skipped paid evals. Fix the cron login (see eval-real-cron.sh) — next run recovers.`);
  process.exit(1);
}

// --- real runs --------------------------------------------------------------
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

// A mid-run infra failure (provider died after the auth probe) is caught here
// by the same provider-independent fingerprint the detector uses.
record.infraFailure = looksLikeInfraFailure(record.subcap);
record.finishedAt = new Date().toISOString();
appendTrend(record);
console.log(`[eval:real] trend record appended: ${trendLine(record)}`);

// --- L6 feedback events (docs/engineering/FEEDBACK_LOOP.md) -----------------
// Unattended runs must not let regressions rot silently: emit intake events
// for the triage pipeline. dedupeKey keeps nightly repeats from re-filing.
emitFeedbackEvents(record);

// Enforce the (provisional) #250 gate line: a real metric below its floor makes
// the scheduled run exit non-zero so cron/LaunchAgent logs turn red — a
// regression can no longer complete "green". Auth/infra outages already exited
// above; runRegressed excludes them so an outage never masquerades as a
// capability regression here.
// #250: the line is DERIVED from the accumulated clean trend when >=3 real
// points exist (ratcheted at the provisional baseline — a derived line only
// ever tightens); otherwise the provisional fallback applies, labelled as such.
const { floors: gateFloors, meta: gateMeta } = deriveFloors(readPriorTrend());
const floorLabel = (metric) => (gateMeta[metric]?.derived
  ? `derived from ${gateMeta[metric].n} real runs (min ${(gateMeta[metric].observedMin * 100).toFixed(0)}% − ${(gateMeta[metric].margin * 100).toFixed(0)}pt)`
  : `provisional (${gateMeta[metric]?.n ?? 0}/${gateMeta[metric]?.needed ?? 3} real runs)`);
console.log(`[eval:real] gate lines — subcap ${(gateFloors.subcap * 100).toFixed(0)}% [${floorLabel("subcap")}]; heldout ${(gateFloors.heldout * 100).toFixed(0)}% [${floorLabel("heldout")}]`);
if (runRegressed(record, gateFloors)) {
  const breaches = floorBreaches(record, gateFloors)
    .map((b) => `${b.metric} ${(b.passRate * 100).toFixed(0)}% < ${(b.floor * 100).toFixed(0)}% [${floorLabel(b.metric)}]`)
    .join(", ");
  console.error(`[eval:real] REGRESSION: capability below the gate line (${breaches}); exiting non-zero so the scheduled log turns red.`);
  process.exit(2);
}

// Prior trend records (excluding the row just appended) — shared by the
// feedback emitter and the #250 gate-line derivation.
function readPriorTrend() {
  return existsSync(trendFile)
    ? readFileSync(trendFile, "utf8").split("\n").filter(Boolean).slice(0, -1).map((line) => tryParse(line)).filter(Boolean)
    : [];
}

function emitFeedbackEvents(entry) {
  const prior = readPriorTrend();
  const events = buildRunFeedbackEvents(entry, prior);
  if (events.length === 0) return;
  const inbox = resolve(repoRoot, ".myagenttool/feedback/inbox.jsonl");
  mkdirSync(dirname(inbox), { recursive: true });
  const createdAt = new Date().toISOString();
  for (const event of events) {
    appendFileSync(inbox, `${JSON.stringify({ ...event, createdAt })}\n`, "utf8");
  }
  console.error(`[eval:real] ${events.length} feedback event(s) emitted; run \`pnpm ai:feedback-triage\` (cron applies automatically).`);
}

function appendTrend(entry) {
  mkdirSync(dirname(trendFile), { recursive: true });
  appendFileSync(trendFile, `${JSON.stringify(entry)}\n`, "utf8");
}

// Cheap auth probe: a logged-out CLI prints the /login notice and exits 0, so
// the OUTPUT is the only reliable signal.
function authPreflight() {
  const probe = spawnSync("claude", ["-p", "reply with the single word ok"], {
    encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
  });
  if (probe.error?.code === "ETIMEDOUT") return { ok: false, detail: "auth probe timed out" };
  const out = `${probe.stdout ?? ""}${probe.stderr ?? ""}`.toLowerCase();
  if (/not logged in|please run \/login|\/login\b/.test(out)) {
    return { ok: false, detail: "claude CLI is not logged in (cron session lacks the login)" };
  }
  if (probe.status !== 0) return { ok: false, detail: `claude probe exited ${probe.status ?? "unknown"}` };
  return { ok: true, detail: "" };
}

function tryParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

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
  if (entry.authFailure) return `${entry.startedAt.slice(0, 16)} [infra] auth preflight failed — no capability signal`;
  const subcap = entry.subcap?.total ? `subcap ${entry.subcap.resolved}/${entry.subcap.total}` : "subcap n/a";
  const heldout = entry.heldout?.total
    ? `heldout ${entry.heldout.resolved}/${entry.heldout.total}`
    : entry.heldout?.skipped ? `heldout skipped (${entry.heldout.skipped})` : "heldout n/a";
  const infra = entry.infraFailure ? " [infra — excluded from capability line]" : "";
  return `${entry.startedAt.slice(0, 16)} ${subcap} · ${heldout}${infra}`;
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
