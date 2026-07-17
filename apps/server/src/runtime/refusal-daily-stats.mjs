// Durable per-UTC-day refusal counters (mirrors applicationDailyStats). Refusals
// are the ONE work-report dimension the live snapshot loses: state.refusals caps
// at 200 (refusal-log.mjs), so a busy week/month/quarter would silently
// undercount them. Auto-runs are unbounded and stay computable from the snapshot
// for any window, so ONLY refusals need this durable rollup — one small row per
// day, summed by weekly/monthly/quarterly reports.
//
// Written at the refuse() chokepoint, BEFORE the 200-cap can evict anything, so
// every veto is counted exactly once regardless of retention.

const MAX_STAT_DAYS = 120; // a quarter (~90d) + margin; one row/day, bounded

function utcDate(iso) {
  // The refusal's own timestamp (ISO) → its UTC day key. Falls back to the raw
  // leading 10 chars, which for an ISO string is already YYYY-MM-DD.
  return String(iso ?? "").slice(0, 10);
}

/**
 * Increment today's refusal counters. Mutates state in place; the caller
 * persists (refuse() already calls persistStateSoon after this).
 * @param {object} state
 * @param {string} atIso - the refusal's `at` timestamp
 * @param {string} category - refusal category (from the closed taxonomy)
 */
export function recordRefusalDailyStat(state, atIso, category) {
  if (!Array.isArray(state.refusalDailyStats)) state.refusalDailyStats = [];
  const date = utcDate(atIso);
  if (!date) return;
  let row = state.refusalDailyStats.find((r) => r.date === date);
  if (!row) {
    row = { date, total: 0, byCategory: {} };
    state.refusalDailyStats.unshift(row);
    trimOldStats(state, date);
  }
  row.total += 1;
  const cat = category || "unknown";
  row.byCategory[cat] = (row.byCategory[cat] ?? 0) + 1;
}

// Keep only the trailing MAX_STAT_DAYS worth of rows, cutoff relative to the
// newest date just written (string date compare is valid for YYYY-MM-DD).
function trimOldStats(state, newestDate) {
  const cutoff = new Date(Date.parse(`${newestDate}T00:00:00Z`) - MAX_STAT_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  state.refusalDailyStats = state.refusalDailyStats.filter((r) => r.date >= cutoff);
}
