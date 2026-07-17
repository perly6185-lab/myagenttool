// The work report — daily / weekly / monthly / quarterly rollups of the same
// six-state work the Status board shows. Supersedes the day-only digest.
//
// It is PURE over the team-scoped locals it is handed, and it draws each metric
// from the source that stays honest over its window:
//   • Runs (opened / completed / failed) — from the auto-run snapshot. Auto-runs
//     are UNBOUNDED and never reaped, so any window is computable losslessly.
//     "Finished in window" uses updatedAt as the terminal-transition proxy, the
//     same documented approximation the board uses.
//   • Refusals — from the DURABLE per-day rollup (refusalDailyStats), because the
//     live refusals array caps at 200. Summed by UTC-day over the window; a
//     window that starts before the rollup began is flagged `refusalsPartial`.
//   • Standing + attention — from the already-computed board (shared across all
//     periods; both are "now", not per-window).

const HOUR_MS = 60 * 60 * 1000;
const AGING_THRESHOLD_MS = 24 * HOUR_MS;
const ATTENTION_LIMIT = 5;

const STATE_LABELS = {
  pending_decision: "待决策 Pending decision",
  in_progress: "正在做 In progress",
  waiting: "在等待 Waiting",
  done: "已做完 Done",
  failed: "已失败 Failed",
  follow_up: "要跟进 Follow-up",
};

// The four calendar-aligned reporting windows, in UTC, as of `nowMs`. Returned
// as {key,label,windowStart,startDate} specs so the read-model stays pure over
// primitives (and tests can pass fixed windows). Kept next to the report it
// feeds so the date semantics live in one place.
export function calendarPeriods(nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = Date.UTC(y, m, d.getUTCDate());
  // ISO week: Monday start. getUTCDay() is 0(Sun)..6(Sat); shift so Monday=0.
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  const week = day - mondayOffset * 24 * 60 * 60 * 1000;
  const month = Date.UTC(y, m, 1);
  const quarter = Date.UTC(y, Math.floor(m / 3) * 3, 1);
  const spec = (key, label, ms) => ({ key, label, windowStart: ms, startDate: new Date(ms).toISOString().slice(0, 10) });
  return [
    spec("day", "Today", day),
    spec("week", "This week", week),
    spec("month", "This month", month),
    spec("quarter", "This quarter", quarter),
  ];
}

function inWindow(iso, windowStart, now) {
  if (!iso) return false;
  const ms = Date.parse(iso);
  return !Number.isNaN(ms) && ms >= windowStart && ms <= now;
}

function ageHours(iso, now) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round(((now - ms) / HOUR_MS) * 10) / 10);
}

// Runs opened/completed/failed within [windowStart, now], from the snapshot.
function runFlow(autoRuns, windowStart, now) {
  let opened = 0;
  let completed = 0;
  let failed = 0;
  for (const run of autoRuns) {
    if (inWindow(run?.createdAt, windowStart, now)) opened += 1;
    const finishedAt = run?.updatedAt ?? run?.createdAt ?? null;
    if (run?.status === "done" && inWindow(finishedAt, windowStart, now)) completed += 1;
    if (run?.status === "failed" && inWindow(finishedAt, windowStart, now)) failed += 1;
  }
  return { opened, completed, failed };
}

// Refusals within the window, summed from the durable per-day rollup by date.
function refusalFlow(refusalDailyStats, startDate, refusalDataSince) {
  let refusals = 0;
  const refusalsByCategory = {};
  for (const row of refusalDailyStats) {
    if (!row?.date || row.date < startDate) continue;
    refusals += row.total ?? 0;
    for (const [cat, n] of Object.entries(row.byCategory ?? {})) {
      refusalsByCategory[cat] = (refusalsByCategory[cat] ?? 0) + n;
    }
  }
  // Honest coverage: if the rollup's earliest day is after the window start,
  // refusals from before that day were never recorded → this is a lower bound.
  const refusalsPartial = refusalDataSince != null && startDate < refusalDataSince;
  return { refusals, refusalsByCategory, refusalsPartial };
}

function renderPeriodMarkdown(report, standing) {
  const { label, startDate, flow } = report;
  const lines = [];
  lines.push(`# Work report — ${label} (since ${startDate})`);
  lines.push("");
  lines.push("**Flow this period**");
  lines.push(`- Opened: ${flow.opened} · Completed: ${flow.completed} · Failed: ${flow.failed}`);
  if (flow.refusals == null) {
    lines.push("- Refusals: — (not available at team scope)");
  } else {
    const refCats = Object.entries(flow.refusalsByCategory).map(([c, n]) => `${c} ${n}`).join(", ");
    lines.push(`- Refusals: ${flow.refusals}${refCats ? ` (${refCats})` : ""}${flow.refusalsPartial ? " — partial (rollup started mid-window)" : ""}`);
  }
  lines.push("");
  lines.push("**Standing now**");
  for (const [key, text] of Object.entries(STATE_LABELS)) lines.push(`- ${text}: ${standing[key] ?? 0}`);
  return lines.join("\n");
}

/**
 * @param {object} sources
 * @param {{states: Record<string,{count:number,items:object[]}>}} sources.board - workBoard() output
 * @param {Array<object>} [sources.autoRuns]
 * @param {Array<object>} [sources.refusalDailyStats] - durable per-day refusal rollup
 * @param {Array<{key:string,label:string,windowStart:number,startDate:string}>} sources.periods - window specs (calendar-aligned by the caller)
 * @param {number} [sources.now]
 * @returns {object} standing + attention + a report per period
 */
export function workReport({ board, autoRuns = [], refusalDailyStats = [], refusalsAvailable = true, periods = [], now = Date.now() } = {}) {
  const states = board?.states ?? {};
  const standing = Object.fromEntries(Object.keys(STATE_LABELS).map((key) => [key, states[key]?.count ?? 0]));

  const agingFrom = (items) =>
    (items ?? [])
      .map((i) => ({ id: i.id, title: i.title, section: i.section, targetId: i.targetId ?? null, ageHours: ageHours(i.updatedAt, now) }))
      .filter((i) => i.ageHours != null && i.ageHours * HOUR_MS >= AGING_THRESHOLD_MS)
      .sort((a, b) => b.ageHours - a.ageHours)
      .slice(0, ATTENTION_LIMIT);
  const attention = {
    agingDecisions: agingFrom(states.pending_decision?.items),
    stuckRuns: agingFrom(states.waiting?.items),
  };

  // Earliest UTC day the durable refusal rollup covers — the honesty anchor for
  // partial-coverage flags and the UI's "refusal data since …" note.
  const refusalDataSince = refusalDailyStats.reduce(
    (min, r) => (r?.date && (min == null || r.date < min) ? r.date : min),
    null,
  );

  const periodReports = {};
  for (const spec of periods) {
    // Refusals are gated: the durable rollup is a global aggregate with no
    // per-team attribution, so a team-scoped viewer gets null (not a foreign
    // team's count). Run metrics are already team-scoped by the caller.
    const refusalPart = refusalsAvailable
      ? refusalFlow(refusalDailyStats, spec.startDate, refusalDataSince)
      : { refusals: null, refusalsByCategory: {}, refusalsPartial: false };
    const flow = { ...runFlow(autoRuns, spec.windowStart, now), ...refusalPart };
    const report = { key: spec.key, label: spec.label, windowStart: spec.windowStart, startDate: spec.startDate, flow };
    report.markdown = renderPeriodMarkdown(report, standing);
    periodReports[spec.key] = report;
  }

  return {
    generatedAt: now,
    standing,
    attention,
    refusalsAvailable,
    refusalDataSince: refusalsAvailable ? refusalDataSince : null,
    periods: periodReports,
  };
}
