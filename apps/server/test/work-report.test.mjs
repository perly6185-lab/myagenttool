import assert from "node:assert/strict";
import { test } from "node:test";

import { workBoard } from "../src/read-models/work-board.mjs";
import { workReport, calendarPeriods } from "../src/read-models/work-report.mjs";

const NOW = Date.parse("2026-07-17T12:00:00Z"); // a Friday

test("calendarPeriods aligns day/week/month/quarter to UTC boundaries", () => {
  const p = Object.fromEntries(calendarPeriods(NOW).map((s) => [s.key, s]));
  assert.equal(p.day.startDate, "2026-07-17");
  assert.equal(p.week.startDate, "2026-07-13"); // Monday of that week
  assert.equal(p.month.startDate, "2026-07-01");
  assert.equal(p.quarter.startDate, "2026-07-01"); // Q3 starts in July
  assert.equal(p.day.label, "Today");
  assert.equal(p.quarter.label, "This quarter");
});

test("run flow is windowed per period; a run finished this month counts in month+quarter but not today", () => {
  const autoRuns = [
    { id: "ar_month", status: "done", createdAt: "2026-07-05T00:00:00Z", updatedAt: "2026-07-05T00:00:00Z" },
    { id: "ar_today", status: "done", createdAt: "2026-07-17T09:00:00Z", updatedAt: "2026-07-17T09:00:00Z" },
    { id: "ar_lastq", status: "failed", createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z" },
  ];
  const board = workBoard({ autoRuns, now: NOW });
  const r = workReport({ board, autoRuns, periods: calendarPeriods(NOW), now: NOW });
  assert.equal(r.periods.day.flow.completed, 1); // ar_today only
  assert.equal(r.periods.month.flow.completed, 2); // ar_month + ar_today
  assert.equal(r.periods.quarter.flow.completed, 2); // Q3 excludes the April run
  assert.equal(r.periods.quarter.flow.failed, 0); // ar_lastq was Q2
});

test("refusals sum from the durable daily rollup, windowed and by category", () => {
  const refusalDailyStats = [
    { date: "2026-07-17", total: 2, byCategory: { policy: 1, human: 1 } },
    { date: "2026-07-14", total: 1, byCategory: { policy: 1 } },
    { date: "2026-07-01", total: 3, byCategory: { state: 3 } },
  ];
  const board = workBoard({ now: NOW });
  const r = workReport({ board, refusalDailyStats, periods: calendarPeriods(NOW), now: NOW });
  assert.equal(r.periods.day.flow.refusals, 2); // 17th only
  assert.equal(r.periods.week.flow.refusals, 3); // 17th + 14th (week starts 07-13)
  assert.equal(r.periods.month.flow.refusals, 6); // + the 1st
  assert.deepEqual(r.periods.month.flow.refusalsByCategory, { policy: 2, human: 1, state: 3 });
  assert.equal(r.refusalDataSince, "2026-07-01");
});

test("refusalsPartial flags a window that starts before the rollup began", () => {
  // Rollup starts 2026-07-05: the quarter (07-01) and month (07-01) windows
  // predate it → lower-bound; the week (07-13) is fully covered.
  const refusalDailyStats = [{ date: "2026-07-05", total: 4, byCategory: { policy: 4 } }];
  const board = workBoard({ now: NOW });
  const r = workReport({ board, refusalDailyStats, periods: calendarPeriods(NOW), now: NOW });
  assert.equal(r.periods.quarter.flow.refusalsPartial, true);
  assert.equal(r.periods.month.flow.refusalsPartial, true);
  assert.equal(r.periods.week.flow.refusalsPartial, false); // 07-13 >= 07-05
  assert.equal(r.periods.day.flow.refusalsPartial, false);
});

test("a team-scoped viewer gets null refusals (no cross-team leak), runs still counted", () => {
  const autoRuns = [{ id: "ar", status: "done", createdAt: "2026-07-17T09:00:00Z", updatedAt: "2026-07-17T09:00:00Z" }];
  const refusalDailyStats = [{ date: "2026-07-17", total: 5, byCategory: { policy: 5 } }];
  const board = workBoard({ autoRuns, now: NOW });
  const r = workReport({ board, autoRuns, refusalDailyStats, refusalsAvailable: false, periods: calendarPeriods(NOW), now: NOW });
  assert.equal(r.refusalsAvailable, false);
  assert.equal(r.periods.day.flow.refusals, null);
  assert.equal(r.periods.day.flow.completed, 1); // runs still counted
  assert.match(r.periods.day.markdown, /not available at team scope/);
});

test("standing + attention are shared across periods and drawn from the board", () => {
  const autoRuns = [{ id: "ar_stuck", status: "blocked", createdAt: "2026-07-14T00:00:00Z", updatedAt: "2026-07-14T00:00:00Z" }];
  const board = workBoard({ autoRuns, now: NOW });
  const r = workReport({ board, autoRuns, periods: calendarPeriods(NOW), now: NOW });
  assert.equal(r.standing.waiting, board.states.waiting.count);
  assert.equal(r.attention.stuckRuns.length, 1);
  assert.equal(r.attention.stuckRuns[0].id, "autorun:ar_stuck");
});
