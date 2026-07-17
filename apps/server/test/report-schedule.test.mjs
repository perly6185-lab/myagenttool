import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeReportNextRun,
  chunkContent,
  createReportScheduleRuntime,
  createDefaultReportSchedule,
} from "../src/services/report-schedule.mjs";

// A minimal state with one auto-run so the assembled report is non-empty.
function stateWithRun() {
  return {
    reportSchedule: { ...createDefaultReportSchedule(), enabled: true, channelId: "ch_1", conversationId: "cv_1" },
    autoRuns: [{ id: "ar_1", status: "done", createdAt: "2026-07-17T09:00:00Z", updatedAt: "2026-07-17T09:00:00Z" }],
    refusalDailyStats: [],
  };
}

test("computeReportNextRun: daily rolls to the next day when the time has passed", () => {
  // 2026-07-17T10:00 local, daily at 09:00 → next is 07-18 09:00 local.
  const next = computeReportNextRun("2026-07-17T10:00:00", { cadence: "daily", time: "09:00" });
  const d = new Date(next);
  assert.equal(d.getDate(), 18);
  assert.equal(d.getHours(), 9);
});

test("computeReportNextRun: daily stays same day when the time is still ahead", () => {
  const next = computeReportNextRun("2026-07-17T06:00:00", { cadence: "daily", time: "09:00" });
  assert.equal(new Date(next).getDate(), 17);
});

test("computeReportNextRun: weekly lands on the configured weekday", () => {
  // From Fri 2026-07-17, weekly on Monday (1) → 2026-07-20.
  const next = computeReportNextRun("2026-07-17T12:00:00", { cadence: "weekly", weekday: 1, time: "09:00" });
  const d = new Date(next);
  assert.equal(d.getDay(), 1);
  assert.equal(d.getDate(), 20);
});

test("chunkContent splits long bodies on line boundaries, keeps short ones whole", () => {
  assert.deepEqual(chunkContent("short"), ["short"]);
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i} ${"x".repeat(50)}`).join("\n");
  const chunks = chunkContent(lines, 200);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 200));
  assert.equal(chunks.join("\n"), lines); // lossless
});

test("sweep posts once when due, dedupes the same period, and rolls nextRunAt forward", () => {
  const enqueued = [];
  const state = stateWithRun();
  state.reportSchedule.nextRunAt = "2026-07-17T09:00:00Z"; // due
  const rt = createReportScheduleRuntime({
    state,
    now: () => "2026-07-17T12:00:00Z",
    enqueueChannelDelivery: (d) => enqueued.push(d),
  });
  const first = rt.sweepReportSchedule();
  assert.equal(first.posted, true);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].channelId, "ch_1");
  assert.match(enqueued[0].content, /Work report/);
  assert.ok(state.reportSchedule.nextRunAt > "2026-07-17T12:00:00Z"); // rolled forward
  // Force it due again at the same clock → same period already posted → skip.
  state.reportSchedule.nextRunAt = "2026-07-17T09:00:00Z";
  const second = rt.sweepReportSchedule();
  assert.equal(second.posted, false);
  assert.equal(second.reason, "already_posted");
  assert.equal(enqueued.length, 1);
});

test("sweep is a no-op when disabled or unconfigured", () => {
  const enqueued = [];
  const state = stateWithRun();
  state.reportSchedule.enabled = false;
  const rt = createReportScheduleRuntime({ state, now: () => "2026-07-17T12:00:00Z", enqueueChannelDelivery: (d) => enqueued.push(d) });
  assert.equal(rt.sweepReportSchedule().reason, "disabled");
  assert.equal(enqueued.length, 0);
});

test("postReportNow ignores dedupe + schedule (for setup/testing)", () => {
  const enqueued = [];
  const state = stateWithRun();
  state.reportSchedule.lastPostedStartDate = "2099-01-01"; // would dedupe a scheduled post
  const rt = createReportScheduleRuntime({ state, now: () => "2026-07-17T12:00:00Z", enqueueChannelDelivery: (d) => enqueued.push(d) });
  const r = rt.postReportNow();
  assert.equal(r.posted, true);
  assert.equal(enqueued.length, 1);
});

test("setReportSchedule normalizes + arms nextRunAt only when enabled", () => {
  const state = {};
  const rt = createReportScheduleRuntime({ state, now: () => "2026-07-17T12:00:00Z", enqueueChannelDelivery: () => {} });
  const off = rt.setReportSchedule({ enabled: false, cadence: "weekly", time: "25:99" });
  assert.equal(off.nextRunAt, null);
  assert.equal(off.time, "09:00"); // invalid time rejected → default kept
  const on = rt.setReportSchedule({ enabled: true, channelId: "ch_1", conversationId: "cv_1", periodKey: "week", time: "08:30" });
  assert.equal(on.periodKey, "week");
  assert.equal(on.time, "08:30");
  assert.ok(on.nextRunAt);
});
