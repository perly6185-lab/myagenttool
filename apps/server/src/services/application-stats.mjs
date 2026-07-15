// Durable per-application daily execution counters (capability review item ③,
// 细节追踪): the inspector's digest is honest but window-scoped — it can only
// count the invocations still in the snapshot. These counters are bumped at
// completion time and persist, so "how did this app do last month?" survives
// the invocation cap. Aggregates only (no row growth per run): one row per
// application per UTC day, trimmed to a bounded horizon.

import { makeRunTx } from "../runtime/store/run-tx.mjs";

const TERMINAL_BUCKETS = {
  succeeded: "succeeded",
  failed: "failed",
  timed_out: "timedOut",
  cancelled: "cancelled",
};
const MAX_STAT_DAYS = 90;

export function createApplicationStatsRuntime({ state, now, persistStateSoon, store }) {
  const runTx = makeRunTx({ store, persistStateSoon });
  function recordApplicationExecutionStat(invocation) {
    const applicationId = invocation?.options?.metadata?.applicationId;
    const bucket = TERMINAL_BUCKETS[invocation?.status];
    if (!applicationId || !bucket) return;
    runTx(() => {
      const date = String(now()).slice(0, 10); // UTC day
      state.applicationDailyStats = Array.isArray(state.applicationDailyStats) ? state.applicationDailyStats : [];
      let row = state.applicationDailyStats.find((item) => item.applicationId === applicationId && item.date === date);
      if (!row) {
        row = { applicationId, date, succeeded: 0, failed: 0, timedOut: 0, cancelled: 0, recovered: 0 };
        state.applicationDailyStats.unshift(row);
        trimOldStats(date);
      }
      row[bucket] += 1;
      if (invocation.options?.metadata?.recoveryActionType) row.recovered += 1;
    });
  }

  function trimOldStats(today) {
    const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - MAX_STAT_DAYS * 86_400_000).toISOString().slice(0, 10);
    state.applicationDailyStats = state.applicationDailyStats.filter((item) => item.date >= cutoff);
  }

  return { recordApplicationExecutionStat };
}
