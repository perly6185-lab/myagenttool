/*
 * Surfaces the scheduled real-agent eval trend (#248 trend.jsonl) into the
 * product's observability layer. This is the RESULTS-side integration only:
 * the eval scheduler stays a per-user LaunchAgent (it needs the maintainer's
 * Claude CLI login, which a server daemon — like the old crontab — can't see).
 * Here the server just READS the local trend file so a capability regression is
 * visible where the team already looks, instead of only in cron.log.
 *
 * Pure `summarizeEvalTrend(records)` + a best-effort `readEvalTrend()` reader.
 * Missing/partial file → empty, never throws: this is telemetry, not a gate.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROVISIONAL_FLOORS } from "../../../../tools/ai/src/evals/eval-signals.mjs";

// Same anchor eval-real-run.mjs uses so the two always agree on the path.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TREND_FILE = resolve(REPO_ROOT, ".myagenttool/evals/trend.jsonl");

// PROVISIONAL_FLOORS is the shared source of truth (tools/ai/src/evals/
// eval-signals.mjs) — the same line the scheduled runner exits non-zero on, so
// the panel's below-floor badge and the red cron log can never disagree.
// Re-exported for callers/tests of this module.
export { PROVISIONAL_FLOORS };
const MIN_RUNS_FOR_LINES = 3; // #250 acceptance: lines need >=3 real runs per set.

/** A record carries real rates only if it didn't fail auth/infra preflight. */
function isInfraFailure(record) {
  return Boolean(record?.authFailure || record?.infraFailure);
}

/** A metric block ({passRate,...}) is real only if it has a numeric passRate. */
function metricPoint(record, key) {
  const block = record?.[key];
  if (!block || typeof block.passRate !== "number") return null; // absent or {skipped}
  return {
    startedAt: record.startedAt ?? null,
    passRate: block.passRate,
    resolved: block.resolved ?? null,
    total: block.total ?? null,
    // Per-kind breakdown (subcap: issue-gate/pm-brief/review) so the panel can
    // show WHICH capability moved, not just the aggregate. Null when absent.
    byKind: block.byKind ?? null,
  };
}

/** Per-metric summary: chronological series + latest, delta, floor, regression. */
function summarizeMetric(records, key) {
  const series = records.map((r) => metricPoint(r, key)).filter(Boolean);
  const latest = series.length ? series[series.length - 1] : null;
  const previous = series.length > 1 ? series[series.length - 2] : null;
  const floor = PROVISIONAL_FLOORS[key] ?? null;
  return {
    latest,
    previous,
    delta: latest && previous ? Number((latest.passRate - previous.passRate).toFixed(4)) : null,
    series,
    realRuns: series.length,
    floor,
    floorProvisional: true,
    // Only a REAL low score is a regression; an infra/auth failure never counts
    // (those records produce no metric point, so they're already excluded).
    regressed: latest && floor != null ? latest.passRate < floor : false,
    // #250 can't set a real line until this clears.
    enoughForLines: series.length >= MIN_RUNS_FOR_LINES,
  };
}

/**
 * Summarize the eval trend for the observability panel. Pure function of the
 * parsed records (oldest-first, as trend.jsonl is appended). Never throws.
 */
export function summarizeEvalTrend(records = []) {
  const list = Array.isArray(records) ? records.filter((r) => r && typeof r === "object") : [];
  const infraFailures = list.filter(isInfraFailure);
  const lastRecord = list.length ? list[list.length - 1] : null;
  const lastInfraFailure = infraFailures.length ? infraFailures[infraFailures.length - 1] : null;
  return {
    total: list.length,
    subcap: summarizeMetric(list, "subcap"),
    heldout: summarizeMetric(list, "heldout"),
    infraFailures: infraFailures.length,
    // A run that fired but couldn't authenticate (the pre-fix crontab symptom)
    // — surfaced so a silently-broken scheduler is visible, not just missing data.
    lastInfraFailure: lastInfraFailure
      ? { startedAt: lastInfraFailure.startedAt ?? null, detail: lastInfraFailure.authDetail ?? null }
      : null,
    lastRunAt: lastRecord?.startedAt ?? null,
    claude: lastRecord?.claude ?? null,
    minRunsForLines: MIN_RUNS_FOR_LINES,
  };
}

/** Parse one JSONL line, tolerating blanks/garbage (telemetry, not a gate). */
function tryParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Read + parse the local trend file. Best-effort: missing file or unreadable
 * lines yield []. `trendFile` is injectable for tests.
 */
export function readEvalTrend({ trendFile = TREND_FILE } = {}) {
  if (!existsSync(trendFile)) return [];
  try {
    return readFileSync(trendFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(tryParse)
      .filter(Boolean);
  } catch {
    return [];
  }
}
