import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationStatsRuntime } from "../src/services/application-stats.mjs";

const runtimeAt = (iso, state) => createApplicationStatsRuntime({ state, now: () => iso, persistStateSoon: () => {} });
const invocation = (status, metadata = { applicationId: "app_1" }) => ({ status, options: { metadata } });

test("terminal statuses bump their buckets; recovery products bump recovered; non-app runs ignored", () => {
  const state = { applicationDailyStats: [] };
  const { recordApplicationExecutionStat } = runtimeAt("2026-07-11T10:00:00.000Z", state);
  recordApplicationExecutionStat(invocation("succeeded"));
  recordApplicationExecutionStat(invocation("failed"));
  recordApplicationExecutionStat(invocation("timed_out"));
  recordApplicationExecutionStat(invocation("cancelled"));
  recordApplicationExecutionStat(invocation("succeeded", { applicationId: "app_1", recoveryActionType: "rerun" }));
  recordApplicationExecutionStat(invocation("running")); // not terminal
  recordApplicationExecutionStat(invocation("succeeded", {})); // no applicationId

  assert.equal(state.applicationDailyStats.length, 1);
  assert.deepEqual(state.applicationDailyStats[0], {
    applicationId: "app_1",
    date: "2026-07-11",
    succeeded: 2,
    failed: 1,
    timedOut: 1,
    cancelled: 1,
    recovered: 1,
  });
});

test("one row per app per UTC day; a new day starts a new row and trims beyond the horizon", () => {
  const state = { applicationDailyStats: [] };
  runtimeAt("2026-07-10T23:59:00.000Z", state).recordApplicationExecutionStat(invocation("succeeded"));
  runtimeAt("2026-07-11T00:01:00.000Z", state).recordApplicationExecutionStat(invocation("succeeded"));
  assert.equal(state.applicationDailyStats.length, 2, "day rollover starts a fresh row");

  // A row far beyond the 90-day horizon is trimmed when a new day's row lands.
  state.applicationDailyStats.push({ applicationId: "app_1", date: "2026-01-01", succeeded: 9, failed: 0, timedOut: 0, cancelled: 0, recovered: 0 });
  runtimeAt("2026-07-12T00:01:00.000Z", state).recordApplicationExecutionStat(invocation("failed"));
  assert.ok(!state.applicationDailyStats.some((row) => row.date === "2026-01-01"), "ancient row trimmed");
  assert.ok(state.applicationDailyStats.some((row) => row.date === "2026-07-10"), "in-horizon rows kept");
});

test("two applications never share a row", () => {
  const state = { applicationDailyStats: [] };
  const { recordApplicationExecutionStat } = runtimeAt("2026-07-11T10:00:00.000Z", state);
  recordApplicationExecutionStat(invocation("succeeded", { applicationId: "app_a" }));
  recordApplicationExecutionStat(invocation("succeeded", { applicationId: "app_b" }));
  assert.equal(state.applicationDailyStats.length, 2);
});
