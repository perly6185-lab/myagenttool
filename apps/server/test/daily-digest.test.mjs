import assert from "node:assert/strict";
import { test } from "node:test";

import { workBoard } from "../src/read-models/work-board.mjs";
import { dailyDigest, renderDigestMarkdown } from "../src/read-models/daily-digest.mjs";

const WINDOW_START = Date.parse("2026-07-17T00:00:00Z");
const NOW = Date.parse("2026-07-17T12:00:00Z");
const YESTERDAY = "2026-07-16T09:00:00Z";
const TODAY_AM = "2026-07-17T09:00:00Z";

test("flow counts only auto-runs stamped within the window", () => {
  const autoRuns = [
    { id: "ar_open_today", status: "running", createdAt: TODAY_AM, updatedAt: TODAY_AM },
    { id: "ar_open_yest", status: "running", createdAt: YESTERDAY, updatedAt: YESTERDAY },
    { id: "ar_done_today", status: "done", createdAt: YESTERDAY, updatedAt: TODAY_AM },
    { id: "ar_fail_today", status: "failed", createdAt: TODAY_AM, updatedAt: TODAY_AM },
    { id: "ar_done_yest", status: "done", createdAt: YESTERDAY, updatedAt: YESTERDAY },
  ];
  const board = workBoard({ autoRuns, now: NOW });
  const digest = dailyDigest({ board, autoRuns, windowStart: WINDOW_START, now: NOW });
  // opened today: ar_open_today + ar_fail_today (both createdAt today) = 2
  assert.equal(digest.flow.opened, 2);
  assert.equal(digest.flow.completed, 1); // ar_done_today; ar_done_yest excluded
  assert.equal(digest.flow.failed, 1);
});

test("standing mirrors the board counts exactly", () => {
  const autoRuns = [
    { id: "a", status: "running", createdAt: TODAY_AM, updatedAt: TODAY_AM },
    { id: "b", status: "failed", createdAt: TODAY_AM, updatedAt: TODAY_AM },
  ];
  const board = workBoard({ autoRuns, now: NOW });
  const digest = dailyDigest({ board, autoRuns, windowStart: WINDOW_START, now: NOW });
  assert.equal(digest.standing.in_progress, board.states.in_progress.count);
  assert.equal(digest.standing.failed, board.states.failed.count);
  assert.equal(digest.standing.follow_up, board.states.follow_up.count);
});

test("refusals within the window are tallied by category", () => {
  const refusals = [
    { id: "r1", at: TODAY_AM, category: "policy", code: "over_budget" },
    { id: "r2", at: TODAY_AM, category: "policy", code: "not_granted" },
    { id: "r3", at: TODAY_AM, category: "human", code: "denied" },
    { id: "r_old", at: YESTERDAY, category: "human", code: "denied" },
  ];
  const board = workBoard({ refusals, now: NOW });
  const digest = dailyDigest({ board, refusals, windowStart: WINDOW_START, now: NOW });
  assert.equal(digest.flow.refusals, 3);
  assert.deepEqual(digest.flow.refusalsByCategory, { policy: 2, human: 1 });
});

test("attention surfaces decisions/runs older than 24h, oldest first, capped", () => {
  const autoRuns = [{ id: "ar_stuck", status: "blocked", createdAt: "2026-07-14T00:00:00Z", updatedAt: "2026-07-14T00:00:00Z" }];
  const pendingDecisions = [
    { id: "d_old", kind: "merge", title: "Old PR", section: "autoRuns", targetId: "x", createdAt: "2026-07-15T00:00:00Z", ref: {} },
    { id: "d_fresh", kind: "merge", title: "Fresh PR", section: "autoRuns", targetId: "y", createdAt: TODAY_AM, ref: {} },
  ];
  const board = workBoard({ autoRuns, pendingDecisions, now: NOW });
  const digest = dailyDigest({ board, autoRuns, windowStart: WINDOW_START, now: NOW });
  assert.equal(digest.attention.agingDecisions.length, 1);
  assert.equal(digest.attention.agingDecisions[0].id, "d_old"); // fresh one excluded
  assert.equal(digest.attention.stuckRuns.length, 1);
  assert.equal(digest.attention.stuckRuns[0].id, "autorun:ar_stuck");
  assert.ok(digest.attention.stuckRuns[0].ageHours >= 24);
});

test("markdown report renders flow, standing, and attention", () => {
  const autoRuns = [{ id: "ar", status: "done", createdAt: YESTERDAY, updatedAt: TODAY_AM }];
  const board = workBoard({ autoRuns, now: NOW });
  const digest = dailyDigest({ board, autoRuns, windowStart: WINDOW_START, now: NOW });
  const md = renderDigestMarkdown(digest);
  assert.match(md, /# Work digest — 2026-07-17/);
  assert.match(md, /Completed: 1/);
  assert.match(md, /已做完 Done: 1/);
  assert.equal(digest.markdown, md); // the digest carries the same rendered report
});
