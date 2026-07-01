// Regression smoke for the automation scheduler (#185 + review fix #191):
// runDueAutomations firing/skipping, the in-flight guard, computeNextRun
// correctness (interval/daily/weekday-skip), and the null-schedule wedge fix.
import assert from "node:assert/strict";
import { runDueAutomations } from "../../apps/server/src/runtime/automation-scheduler.mjs";
import { computeNextRun, normalizeSchedule } from "../../apps/server/src/services/automation-schedule.mjs";

let passed = 0;
const ok = (msg) => { passed += 1; console.log(`  ok - ${msg}`); };

const past = new Date(Date.now() - 60_000).toISOString();
const future = new Date(Date.now() + 3600_000).toISOString();

function deps(state, invStatus = {}) {
  const created = [];
  return { created, d: {
    state, now: () => new Date().toISOString(),
    createInvocation: (prompt, agent, opts) => { const i = { id: `inv_${created.length}`, prompt, opts, status: "queued" }; created.push(i); return i; },
    startInvocationIfAllowed: () => {},
    findAgent: (id) => (id ? { id } : null), defaultAgent: () => ({ id: "agent_default" }),
    findInvocation: (id) => ({ id, status: invStatus[id] ?? "succeeded" }), persistStateSoon: () => {},
  } };
}

// A. Due + enabled fires and rolls forward.
{
  const state = { automations: [
    { id: "a1", enabled: true, nextRunAt: past, schedule: { kind: "interval", everyMinutes: 30 }, agentId: "ag", prompt: "go", projectId: "p1", runCount: 2 },
  ]};
  const { created, d } = deps(state);
  runDueAutomations(d);
  assert.equal(created.length, 1, "fired one");
  assert.equal(created[0].opts.metadata.scheduled, true);
  assert.equal(state.automations[0].runCount, 3);
  assert.ok(Date.parse(state.automations[0].nextRunAt) > Date.now(), "rolled forward");
  ok("due automation fires + rolls forward");
}

// B. Disabled / not-yet-due are skipped.
{
  const state = { automations: [
    { id: "off", enabled: false, nextRunAt: past, schedule: { kind: "interval", everyMinutes: 30 }, agentId: "ag", prompt: "x", projectId: "p" },
    { id: "later", enabled: true, nextRunAt: future, schedule: { kind: "interval", everyMinutes: 30 }, agentId: "ag", prompt: "x", projectId: "p" },
  ]};
  const { created, d } = deps(state);
  runDueAutomations(d);
  assert.equal(created.length, 0, "nothing fired");
  ok("disabled + not-yet-due skipped");
}

// C. In-flight guard prevents stacking.
{
  const state = { automations: [
    { id: "busy", enabled: true, nextRunAt: past, schedule: { kind: "interval", everyMinutes: 30 }, agentId: "ag", prompt: "x", projectId: "p", lastInvocationId: "prev" },
  ]};
  const { created, d } = deps(state, { prev: "running" });
  runDueAutomations(d);
  assert.equal(created.length, 0, "did not stack a run");
  assert.ok(Date.parse(state.automations[0].nextRunAt) > Date.now(), "still rolled forward");
  ok("in-flight guard prevents stacking");
}

// D. A malformed schedule must NOT wedge — it re-normalizes and keeps a real nextRunAt (#191).
{
  const state = { automations: [
    { id: "bad", enabled: true, nextRunAt: past, schedule: { kind: "garbage" }, agentId: "ag", prompt: "x", projectId: "p" },
  ]};
  const { d } = deps(state);
  runDueAutomations(d);
  assert.ok(state.automations[0].nextRunAt, "malformed schedule did not produce a null nextRunAt");
  assert.ok(Date.parse(state.automations[0].nextRunAt) > Date.now(), "rolled forward, not wedged");
  ok("malformed schedule re-normalized (no wedge)");
}

// E. computeNextRun correctness.
{
  const iv = computeNextRun({ kind: "interval", everyMinutes: 15 }, Date.parse("2026-07-01T10:00:00"));
  assert.equal(new Date(iv).getMinutes(), 15, "interval adds minutes");
  const daily = new Date(computeNextRun({ kind: "daily", time: "09:00" }, Date.parse("2026-07-01T12:00:00")));
  assert.equal(daily.getHours(), 9);
  assert.equal(daily.getDate(), 2, "passed-time daily rolls to next day");
  const wd = new Date(computeNextRun({ kind: "weekdays", time: "09:00" }, Date.parse("2026-07-03T12:00:00"))); // Fri
  assert.equal(wd.getDay(), 1, "weekdays skips Sat/Sun to Monday");
  assert.equal(normalizeSchedule({ kind: "interval", everyMinutes: 5 }).label, "Every 5 minutes");
  ok("computeNextRun: interval/daily/weekday-skip + labels");
}

console.log(`\nautomation-scheduler-smoke: ${passed} checks passed`);
