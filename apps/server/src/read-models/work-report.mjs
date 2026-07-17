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

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

const CURRENT_LABELS = { day: "Today", week: "This week", month: "This month", quarter: "This quarter" };
const PREVIOUS_LABELS = { day: "Yesterday", week: "Last week", month: "Last month", quarter: "Last quarter" };

// The start-of-current and start-of-previous UTC instants for a period key.
function periodStarts(nowMs, key) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (key === "day") {
    const cur = Date.UTC(y, m, d.getUTCDate());
    return { currentStart: cur, prevStart: cur - DAY_MS };
  }
  if (key === "week") {
    const day = Date.UTC(y, m, d.getUTCDate());
    const mondayOffset = (d.getUTCDay() + 6) % 7; // Sun→6 so Monday=start
    const cur = day - mondayOffset * DAY_MS;
    return { currentStart: cur, prevStart: cur - 7 * DAY_MS };
  }
  if (key === "month") {
    return { currentStart: Date.UTC(y, m, 1), prevStart: Date.UTC(y, m - 1, 1) }; // Date.UTC rolls Jan→Dec prev-year
  }
  // quarter
  const q = Math.floor(m / 3) * 3;
  return { currentStart: Date.UTC(y, q, 1), prevStart: Date.UTC(y, q - 3, 1) };
}

// One reporting window spec. `coverage: "current"` = period-to-date [start, now];
// `"previous"` = the fully-CLOSED prior period [prevStart, currentStart) — what a
// scheduled "weekly Monday" push wants (last week, not the just-started one).
// windowEnd/endDate are the inclusive upper bounds (ms / YYYY-MM-DD) so previous
// windows don't bleed into the current period.
export function periodSpec(nowMs, key, coverage = "current") {
  if (Number.isNaN(new Date(nowMs).getTime())) return null;
  const { currentStart, prevStart } = periodStarts(nowMs, key);
  if (coverage === "previous") {
    const windowEnd = currentStart - 1;
    return { key, label: PREVIOUS_LABELS[key] ?? key, coverage, windowStart: prevStart, windowEnd, startDate: utcDate(prevStart), endDate: utcDate(windowEnd) };
  }
  return { key, label: CURRENT_LABELS[key] ?? key, coverage: "current", windowStart: currentStart, windowEnd: nowMs, startDate: utcDate(currentStart), endDate: utcDate(nowMs) };
}

// The four calendar-aligned CURRENT-period windows (UTC), as of `nowMs` — the set
// the live Status strip shows. Scheduled pushes build their own single spec via
// periodSpec(..., "previous"). Returns [] on a bad clock rather than throwing.
export function calendarPeriods(nowMs) {
  if (Number.isNaN(new Date(nowMs).getTime())) return [];
  return ["day", "week", "month", "quarter"].map((key) => periodSpec(nowMs, key, "current"));
}

function inWindow(iso, windowStart, windowEnd) {
  if (!iso) return false;
  const ms = Date.parse(iso);
  return !Number.isNaN(ms) && ms >= windowStart && ms <= windowEnd;
}

function ageHours(iso, now) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round(((now - ms) / HOUR_MS) * 10) / 10);
}

// Runs opened/completed/failed within [windowStart, now], from the snapshot.
// "Completed" mirrors the board's 已做完 lens: no auto-run status is ever set to
// "done" — a successful run settles as a MERGED pr_open — so a merged PR is the
// real completion signal, timestamped at prMergedAt (merge does not bump
// updatedAt). The bare `done` status is kept for forward-compat.
function runFlow(autoRuns, windowStart, windowEnd) {
  let opened = 0;
  let completed = 0;
  let failed = 0;
  for (const run of autoRuns) {
    if (inWindow(run?.createdAt, windowStart, windowEnd)) opened += 1;
    const merged = run?.status === "pr_open" && run?.prState === "MERGED";
    const finishedAt = merged ? (run?.prMergedAt ?? run?.updatedAt) : (run?.updatedAt ?? run?.createdAt ?? null);
    if ((merged || run?.status === "done") && inWindow(finishedAt, windowStart, windowEnd)) completed += 1;
    if (run?.status === "failed" && inWindow(run?.updatedAt ?? run?.createdAt ?? null, windowStart, windowEnd)) failed += 1;
  }
  return { opened, completed, failed };
}

// Refusals within [startDate, endDate] (inclusive UTC dates), summed from the
// durable per-day rollup. endDate bounds a "previous" window so it doesn't count
// the current period's days.
function refusalFlow(refusalDailyStats, startDate, endDate, refusalDataSince) {
  let refusals = 0;
  const refusalsByCategory = {};
  for (const row of refusalDailyStats) {
    if (!row?.date || row.date < startDate || row.date > endDate) continue;
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
  const { label, startDate, endDate, coverage, flow } = report;
  // A closed (previous) window reads as a date RANGE; a to-date window as "since".
  const span = coverage === "previous" && endDate && endDate !== startDate ? `${startDate} → ${endDate}` : `since ${startDate}`;
  const lines = [];
  lines.push(`# Work report — ${label} (${span})`);
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
      // Oldest first; stable id tiebreak so equal-age rows don't reshuffle (and
      // flip which survive the slice) between refreshes.
      .sort((a, b) => (b.ageHours !== a.ageHours ? b.ageHours - a.ageHours : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
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
    const windowEnd = spec.windowEnd ?? now;
    const endDate = spec.endDate ?? new Date(windowEnd).toISOString().slice(0, 10);
    const refusalPart = refusalsAvailable
      ? refusalFlow(refusalDailyStats, spec.startDate, endDate, refusalDataSince)
      : { refusals: null, refusalsByCategory: {}, refusalsPartial: false };
    const flow = { ...runFlow(autoRuns, spec.windowStart, windowEnd), ...refusalPart };
    const report = { key: spec.key, label: spec.label, coverage: spec.coverage ?? "current", windowStart: spec.windowStart, windowEnd, startDate: spec.startDate, endDate, flow };
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
