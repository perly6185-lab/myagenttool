import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultReportPath = path.join(root, ".myagenttool", "reports", "batch-resilience.json");
const testFiles = [
  "apps/server/test/work-item-auto-run-batches.test.mjs",
  "apps/server/test/integration/work-items-http.test.mjs",
  "apps/server/test/worktree-verify.test.mjs",
  "apps/desktop/test/invocation-pool.test.mjs",
];
const requiredSubtests = [
  "durable work-item batch enforces concurrency and backfills the next slot",
  "batch idempotency replays the original batch and rejects key reuse with different input",
  "batch resolves a production repository agent and never falls back to the demo agent",
  "restart sweep returns an interrupted starting item to the durable queue",
  "local issues can be queued as a durable concurrency-limited Auto-run batch",
  "process-tree guardian kills a real executor when its bridge parent is absent",
  "aborting verification terminates the real subprocess tree",
  "verification guardian kills the real subprocess tree after its Server parent disappears",
];

function integerOption(value, { name, min, max }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const options = {
    rounds: 5,
    reportPath: defaultReportPath,
    timeoutMs: 60_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--rounds") {
      options.rounds = integerOption(argv[++index], { name: "--rounds", min: 1, max: 100 });
    } else if (argument === "--report") {
      const reportPath = argv[++index];
      if (!reportPath?.trim()) throw new Error("--report requires a path.");
      options.reportPath = path.resolve(root, reportPath);
    } else if (argument === "--timeout-ms") {
      options.timeoutMs = integerOption(argv[++index], {
        name: "--timeout-ms",
        min: 5_000,
        max: 300_000,
      });
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

function summaryValue(output, name) {
  const match = output.match(new RegExp(`^# ${name} (\\d+)\\r?$`, "m"));
  return match ? Number(match[1]) : null;
}

export function parseTapSummary(output) {
  const durationMatch = output.match(/^# duration_ms ([\d.]+)\r?$/m);
  const subtests = [...output.matchAll(/^# Subtest: (.+)\r?$/gm)].map((match) => match[1]);
  return {
    tests: summaryValue(output, "tests"),
    passed: summaryValue(output, "pass"),
    failed: summaryValue(output, "fail"),
    cancelled: summaryValue(output, "cancelled"),
    skipped: summaryValue(output, "skipped"),
    todo: summaryValue(output, "todo"),
    durationMs: durationMatch ? Number(durationMatch[1]) : null,
    subtests,
  };
}

export function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

function terminateTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    const killed = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    if (killed.status !== 0) {
      try {
        child.kill("SIGKILL");
      } catch {
        // The test runner already stopped.
      }
    }
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The test runner already stopped.
    }
  }
}

async function runRound(round, timeoutMs) {
  const startedAt = new Date();
  const started = performance.now();
  // The parser below consumes Node's TAP summary. Pin the reporter here so
  // running this tool directly cannot inherit the default spec reporter and
  // falsely report a healthy round as 0/0 tests.
  const child = spawn(process.execPath, ["--test", "--test-reporter=tap", ...testFiles], {
    cwd: root,
    detached: process.platform !== "win32",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    terminateTree(child);
  }, timeoutMs);
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code: code ?? 1, signal }));
  }).finally(() => clearTimeout(timer));
  const tap = parseTapSummary(stdout);
  const missingSubtests = requiredSubtests.filter((name) => !tap.subtests.includes(name));
  const passed = (
    !timedOut
    && exit.code === 0
    && tap.tests !== null
    && tap.tests > 0
    && tap.passed === tap.tests
    && tap.failed === 0
    && tap.skipped === 0
    && tap.cancelled === 0
    && missingSubtests.length === 0
  );
  return {
    round,
    status: passed ? "passed" : "failed",
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    wallDurationMs: Math.round(performance.now() - started),
    timedOut,
    exitCode: exit.code,
    signal: exit.signal,
    ...tap,
    missingSubtests,
    stdout: passed ? undefined : stdout.slice(-20_000),
    stderr: stderr ? stderr.slice(-20_000) : undefined,
  };
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function usage() {
  console.log(`Usage: node tools/dev/batch-resilience.mjs [options]

Options:
  --rounds <1-100>       Number of complete resilience rounds (default: 5)
  --report <path>        JSON report path
  --timeout-ms <ms>      Per-round timeout from 5000 to 300000 (default: 60000)
  --help                 Show this help`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    usage();
    return 0;
  }
  const report = {
    schemaVersion: 1,
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    configuration: {
      rounds: options.rounds,
      timeoutMs: options.timeoutMs,
      reportPath: path.relative(root, options.reportPath).replaceAll("\\", "/"),
      testFiles,
      requiredSubtests,
    },
    summary: null,
    rounds: [],
  };
  writeReport(options.reportPath, report);
  console.log(`Batch resilience: ${options.rounds} round(s), timeout ${options.timeoutMs}ms per round`);

  for (let round = 1; round <= options.rounds; round += 1) {
    console.log(`\n[batch-resilience] round ${round}/${options.rounds}`);
    let result;
    try {
      result = await runRound(round, options.timeoutMs);
    } catch (error) {
      result = {
        round,
        status: "failed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        wallDurationMs: 0,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
      };
    }
    report.rounds.push(result);
    writeReport(options.reportPath, report);
    console.log(
      `[batch-resilience] ${result.status}: ${result.passed ?? 0}/${result.tests ?? 0} tests, `
      + `${result.skipped ?? 0} skipped, ${result.wallDurationMs}ms`,
    );
    if (result.status !== "passed") {
      if (result.stdout) console.error(result.stdout);
      if (result.stderr) console.error(result.stderr);
      break;
    }
  }

  const durations = report.rounds.map((round) => round.wallDurationMs);
  const passedRounds = report.rounds.filter((round) => round.status === "passed");
  report.status = passedRounds.length === options.rounds ? "passed" : "failed";
  report.completedAt = new Date().toISOString();
  report.summary = {
    roundsRequested: options.rounds,
    roundsExecuted: report.rounds.length,
    roundsPassed: passedRounds.length,
    testsPassed: passedRounds.reduce((total, round) => total + (round.passed ?? 0), 0),
    testsFailed: report.rounds.reduce((total, round) => total + (round.failed ?? 0), 0),
    testsSkipped: report.rounds.reduce((total, round) => total + (round.skipped ?? 0), 0),
    minRoundMs: durations.length ? Math.min(...durations) : null,
    averageRoundMs: durations.length
      ? Math.round(durations.reduce((total, duration) => total + duration, 0) / durations.length)
      : null,
    p95RoundMs: percentile(durations, 95),
    maxRoundMs: durations.length ? Math.max(...durations) : null,
  };
  writeReport(options.reportPath, report);
  console.log(`\nBatch resilience ${report.status}. Report: ${options.reportPath}`);
  return report.status === "passed" ? 0 : 1;
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  process.exitCode = await main();
}
