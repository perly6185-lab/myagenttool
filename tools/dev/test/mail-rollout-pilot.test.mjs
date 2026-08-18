import assert from "node:assert/strict";
import test from "node:test";

import { createMailPilot, recordMailPilotDay, summarizeMailPilot } from "../src/mail-rollout-pilot.mjs";

test("seven real consecutive records and all fault drills clear the pilot gates", () => {
  let pilot = createMailPilot({ accountAlias: "test-account-a", startedAt: "2026-08-01T00:00:00.000Z" });
  const phases = ["readonly", "readonly", "manual", "manual", "automatic", "automatic", "automatic"];
  const scenarios = [["offline"], ["credential_expired"], ["restart"], ["conflict"], [], [], []];
  for (let day = 0; day < 7; day += 1) pilot = recordMailPilotDay(pilot, {
    at: `2026-08-0${day + 1}T12:00:00.000Z`, phase: phases[day], scenarios: scenarios[day], syncRuns: 3, moveBatches: day >= 2 ? 1 : 0,
  });
  const report = summarizeMailPilot(pilot);
  assert.equal(report.passed, true);
  assert.equal(report.daysRecorded, 7);
  assert.equal(report.totals.syncRuns, 21);
});

test("missing days and any unsafe write fail closed", () => {
  let pilot = createMailPilot({ accountAlias: "test-account-b", startedAt: "2026-08-01T00:00:00.000Z" });
  pilot = recordMailPilotDay(pilot, { at: "2026-08-01T12:00:00.000Z", phase: "readonly", duplicateMoves: 1 });
  pilot = recordMailPilotDay(pilot, { at: "2026-08-03T12:00:00.000Z", phase: "manual" });
  const report = summarizeMailPilot(pilot);
  assert.equal(report.passed, false);
  assert.equal(report.gates.sevenConsecutiveDays, false);
  assert.equal(report.gates.noDuplicateMoves, false);
});

test("pilot phases cannot move backward or overwrite a day", () => {
  let pilot = createMailPilot({ accountAlias: "test-account-c", startedAt: "2026-08-01T00:00:00.000Z" });
  pilot = recordMailPilotDay(pilot, { at: "2026-08-01T12:00:00.000Z", phase: "manual" });
  assert.throws(() => recordMailPilotDay(pilot, { at: "2026-08-02T12:00:00.000Z", phase: "readonly" }), /cannot move backward/);
  assert.throws(() => recordMailPilotDay(pilot, { at: "2026-08-01T13:00:00.000Z", phase: "manual" }), /already recorded/);
});

test("pilot natural days follow the configured rollout timezone", () => {
  let pilot = createMailPilot({ accountAlias: "test-account-d", startedAt: "2026-08-01T00:00:00.000Z", timeZone: "Asia/Shanghai" });
  pilot = recordMailPilotDay(pilot, { at: "2026-08-01T16:30:00.000Z", phase: "readonly" }, { now: "2026-08-03T00:00:00.000Z" });
  assert.equal(pilot.records[0].day, "2026-08-02");
});

test("pilot records cannot predate start, use the current day, or prefill a future day", () => {
  const pilot = createMailPilot({ accountAlias: "test-account-e", startedAt: "2026-08-10T02:00:00.000Z", timeZone: "Asia/Shanghai" });
  assert.throws(() => recordMailPilotDay(pilot, { at: "2026-08-09T12:00:00.000Z", phase: "readonly" }, { now: "2026-08-18T12:00:00.000Z" }), /predate/);
  assert.throws(() => recordMailPilotDay(pilot, { at: "2026-08-18T01:00:00.000Z", phase: "readonly" }, { now: "2026-08-18T12:00:00.000Z" }), /completed natural day/);
  assert.throws(() => recordMailPilotDay(pilot, { at: "2027-01-01T12:00:00.000Z", phase: "readonly" }, { now: "2026-08-18T12:00:00.000Z" }), /cannot be prefilled/);
});

test("summary rejects edited records outside the real pilot window", () => {
  const pilot = createMailPilot({ accountAlias: "test-account-f", startedAt: "2026-08-18T00:00:00.000Z" });
  pilot.records = Array.from({ length: 7 }, (_, index) => ({
    day: `2027-01-0${index + 1}`,
    observedAt: `2027-01-0${index + 1}T12:00:00.000Z`,
    recordedAt: "2026-08-18T12:00:00.000Z",
    phase: index < 2 ? "readonly" : index < 4 ? "manual" : "automatic",
    scenarios: index < 4 ? [["offline"], ["credential_expired"], ["restart"], ["conflict"]][index] : [],
    metrics: { syncRuns: 1, moveBatches: 0, duplicateMoves: 0, crossTenantWrites: 0, unreconciledJobs: 0, recoveryFailures: 0 },
  }));
  assert.equal(summarizeMailPilot(pilot, { now: "2026-08-18T12:00:00.000Z" }).passed, false);
});
