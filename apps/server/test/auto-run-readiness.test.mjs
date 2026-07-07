import assert from "node:assert/strict";
import { test } from "node:test";
import { computeAutoRunReadiness } from "../src/services/auto-run-readiness.mjs";

const healthyAgent = { id: "a1", name: "Claude", status: "active", lifecycle: { state: "enabled" }, health: { status: "healthy" }, location: { type: "local_device" } };
const base = {
  project: { id: "p1", defaultAgentId: "a1" },
  agent: healthyAgent,
  deviceLinked: true,
  budget: { exists: true, over: false, remainingUsd: 5 },
  verifyCommand: ["npm", "test"],
  settings: {},
  breaker: null,
  activeCount: 0,
};
const status = (r, key) => r.checks.find((c) => c.key === key)?.status;

test("all green → ready", () => {
  const r = computeAutoRunReadiness(base);
  assert.equal(r.ready, true);
  assert.equal(status(r, "agent"), "ok");
  assert.equal(status(r, "verify"), "ok");
  assert.equal(status(r, "budget"), "ok");
});

test("no default agent → blocked", () => {
  const r = computeAutoRunReadiness({ ...base, project: { id: "p1", defaultAgentId: null }, agent: null });
  assert.equal(r.ready, false);
  assert.equal(status(r, "agent"), "blocked");
});

test("CLI agent but bridge not linked → blocked", () => {
  const r = computeAutoRunReadiness({ ...base, deviceLinked: false });
  assert.equal(r.ready, false);
  assert.equal(status(r, "bridge"), "blocked");
});

test("no verify + no budget → warns (still ready)", () => {
  const r = computeAutoRunReadiness({ ...base, verifyCommand: null, budget: null });
  assert.equal(r.ready, true, "warnings don't block");
  assert.equal(status(r, "verify"), "warn");
  assert.equal(status(r, "budget"), "warn");
});

test("kill switch / breaker open / over budget / at capacity all block", () => {
  assert.equal(computeAutoRunReadiness({ ...base, settings: { autonomyKillSwitch: true } }).ready, false);
  assert.equal(computeAutoRunReadiness({ ...base, breaker: { openUntil: new Date(Date.now() + 60000).toISOString(), consecutiveFailures: 3 } }).ready, false);
  assert.equal(computeAutoRunReadiness({ ...base, budget: { exists: true, over: true, spentUsd: 12, limitUsd: 10 } }).ready, false);
  assert.equal(computeAutoRunReadiness({ ...base, settings: { globalMaxConcurrent: 2 }, activeCount: 2 }).ready, false);
});

test("unhealthy agent blocks; unknown health warns", () => {
  assert.equal(status(computeAutoRunReadiness({ ...base, agent: { ...healthyAgent, health: { status: "unhealthy" } } }), "agent"), "blocked");
  assert.equal(status(computeAutoRunReadiness({ ...base, agent: { ...healthyAgent, health: { status: "unknown" } } }), "agent"), "warn");
});
