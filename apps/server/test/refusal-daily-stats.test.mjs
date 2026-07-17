import assert from "node:assert/strict";
import { test } from "node:test";

import { recordRefusalDailyStat } from "../src/runtime/refusal-daily-stats.mjs";

test("records into the refusal's UTC day, incrementing total + per-category", () => {
  const state = {};
  recordRefusalDailyStat(state, "2026-07-17T09:00:00Z", "policy");
  recordRefusalDailyStat(state, "2026-07-17T23:59:00Z", "policy");
  recordRefusalDailyStat(state, "2026-07-17T10:00:00Z", "human");
  assert.equal(state.refusalDailyStats.length, 1);
  const row = state.refusalDailyStats[0];
  assert.equal(row.date, "2026-07-17");
  assert.equal(row.total, 3);
  assert.deepEqual(row.byCategory, { policy: 2, human: 1 });
});

test("separate days get separate rows; a missing category falls back to 'unknown'", () => {
  const state = { refusalDailyStats: [] };
  recordRefusalDailyStat(state, "2026-07-17T09:00:00Z", "policy");
  recordRefusalDailyStat(state, "2026-07-18T09:00:00Z", null);
  assert.equal(state.refusalDailyStats.length, 2);
  const byDate = Object.fromEntries(state.refusalDailyStats.map((r) => [r.date, r]));
  assert.deepEqual(byDate["2026-07-18"].byCategory, { unknown: 1 });
});

test("rows older than the 120-day horizon are trimmed relative to the newest write", () => {
  const state = { refusalDailyStats: [{ date: "2026-01-01", total: 1, byCategory: { policy: 1 } }] };
  // Write a day ~200 days later → the old January row falls outside the window.
  recordRefusalDailyStat(state, "2026-07-20T00:00:00Z", "policy");
  const dates = state.refusalDailyStats.map((r) => r.date);
  assert.ok(dates.includes("2026-07-20"));
  assert.ok(!dates.includes("2026-01-01"), "over-horizon row trimmed");
});

test("a malformed timestamp is ignored, not crashed on", () => {
  const state = {};
  recordRefusalDailyStat(state, null, "policy");
  recordRefusalDailyStat(state, "", "policy");
  assert.deepEqual(state.refusalDailyStats, []);
});
