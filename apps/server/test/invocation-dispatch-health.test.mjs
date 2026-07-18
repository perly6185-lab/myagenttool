/*
 * Layer-A dispatch observability read-model — WHY queued invocations aren't
 * running, device capacity, and dispatch latency. Shares the bridge's own
 * eligibility predicates (dispatch-eligibility.mjs), so "why blocked" matches the
 * real dispatch decision.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeInvocationDispatchHealth } from "../src/read-models/invocation-dispatch-health.mjs";

const now = () => "2026-07-18T00:10:00.000Z"; // 10 min after t0 below
const t0 = "2026-07-18T00:00:00.000Z";

const AGENTS = {
  ok: { id: "agt_ok", name: "OK", location: { type: "local_device", deviceId: "dev_1" }, adapter: { type: "cli" }, health: { status: "healthy" } },
  disabled: { id: "agt_dis", name: "Disabled", status: "disabled", location: { type: "local_device", deviceId: "dev_1" }, adapter: { type: "cli" } },
  unhealthy: { id: "agt_un", name: "Unhealthy", location: { type: "local_device", deviceId: "dev_1" }, adapter: { type: "cli" }, health: { status: "unhealthy" } },
  otherDevice: { id: "agt_od", name: "Other", location: { type: "local_device", deviceId: "dev_2" }, adapter: { type: "cli" }, health: { status: "healthy" } },
};
const findAgent = (id) => Object.values(AGENTS).find((a) => a.id === id) ?? null;

function queued(id, agentId, { deliveryState = "queued", createdAt = t0, meta = {} } = {}) {
  return { id, agentId, status: "queued", createdAt, options: { metadata: meta }, delivery: { state: deliveryState, dispatchAttempts: deliveryState === "redelivering" ? 1 : 0 } };
}
function running(id, agentId, meta = {}) {
  return { id, agentId, status: "running", createdAt: t0, options: { metadata: meta }, delivery: { state: "acknowledged", dispatchAttempts: 1, acknowledgedAt: t0 } };
}

test("classifies each queued invocation's blocking reason from the shared predicates", () => {
  const state = {
    device: { id: "dev_1", maxConcurrency: 5 },
    invocations: [
      queued("q_ok", "agt_ok"),
      queued("q_missing", "agt_ghost"),
      queued("q_disabled", "agt_dis"),
      queued("q_unhealthy", "agt_un"),
      queued("q_wrongdev", "agt_od"),
    ],
  };
  const health = computeInvocationDispatchHealth(state, { findAgent, now });
  const reasons = Object.fromEntries(health.queue.items.map((i) => [i.invocationId, i.blockedReason]));
  assert.deepEqual(reasons, {
    q_ok: "dispatchable",
    q_missing: "agent_missing",
    q_disabled: "agent_disabled",
    q_unhealthy: "agent_unhealthy",
    q_wrongdev: "wrong_device",
  });
  assert.equal(health.queue.depth, 5);
  assert.equal(health.queue.byReason.agent_missing, 1);
});

test("a busy dir blocks a same-dir queued item; capacity + waiting_concurrency reflect the device cap", () => {
  const state = {
    device: { id: "dev_1", maxConcurrency: 1 },
    invocations: [
      running("run_1", "agt_ok", { worktreePath: "/wt/a" }),
      queued("q_samedir", "agt_ok", { meta: { worktreePath: "/wt/a" } }),
      queued("q_otherdir", "agt_ok", { meta: { worktreePath: "/wt/b" } }),
    ],
  };
  const health = computeInvocationDispatchHealth(state, { findAgent, now });
  // maxConcurrency 1 and one running bridge-executed → at capacity.
  assert.equal(health.capacity.inFlight, 1);
  assert.equal(health.capacity.atCapacity, true);
  assert.equal(health.capacity.utilization, 1);
  const reasons = Object.fromEntries(health.queue.items.map((i) => [i.invocationId, i.blockedReason]));
  assert.equal(reasons.q_samedir, "dir_busy", "same worktree as the running job → dir_busy (not concurrency)");
  assert.equal(reasons.q_otherdir, "waiting_concurrency", "otherwise dispatchable, but the device is at its cap");
});

test("queue items sort longest-waiting first, with queuedForMs from createdAt", () => {
  const state = {
    device: { id: "dev_1", maxConcurrency: 5 },
    invocations: [
      queued("q_new", "agt_ok", { createdAt: "2026-07-18T00:09:00.000Z" }), // 1 min
      queued("q_old", "agt_ok", { createdAt: "2026-07-18T00:00:00.000Z" }), // 10 min
    ],
  };
  const health = computeInvocationDispatchHealth(state, { findAgent, now });
  assert.deepEqual(health.queue.items.map((i) => i.invocationId), ["q_old", "q_new"], "longest-waiting first");
  assert.equal(health.queue.items[0].queuedForMs, 600_000);
  assert.equal(health.queue.items[1].queuedForMs, 60_000);
});

test("stats are indeterminate below the sample floor; exhausted still counts", () => {
  const state = {
    device: { id: "dev_1", maxConcurrency: 5 },
    invocations: [
      running("r1", "agt_ok"),
      { id: "ex1", agentId: "agt_ok", status: "failed", createdAt: t0, delivery: { state: "exhausted", dispatchAttempts: 5 }, result: { errorCode: "dispatch_timeout" } },
    ],
  };
  const health = computeInvocationDispatchHealth(state, { findAgent, now });
  assert.equal(health.stats.sampleSize, 1, "one acknowledged dispatch");
  assert.equal(health.stats.indeterminate, true);
  assert.equal(health.stats.medianMsToDispatch, null);
  assert.equal(health.stats.redeliveryRate, null);
  assert.equal(health.stats.exhaustedCount, 1, "exhausted count is reported even when latency is indeterminate");
});

test("stats compute median dispatch latency + redelivery rate once past the sample floor", () => {
  const invocations = [];
  // 10 settled dispatches: 3 redelivered (attempts>1); latencies 1..10 min.
  for (let i = 1; i <= 10; i += 1) {
    invocations.push({
      id: `s${i}`, agentId: "agt_ok", status: "running", createdAt: t0,
      delivery: { state: "acknowledged", dispatchAttempts: i <= 3 ? 2 : 1, acknowledgedAt: new Date(Date.parse(t0) + i * 60_000).toISOString() },
    });
  }
  const state = { device: { id: "dev_1", maxConcurrency: 5 }, invocations };
  const health = computeInvocationDispatchHealth(state, { findAgent, now });
  assert.equal(health.stats.sampleSize, 10);
  assert.equal(health.stats.indeterminate, false);
  assert.equal(health.stats.medianMsToDispatch, 330_000, "median of 1..10 min = 5.5 min");
  assert.equal(health.stats.redeliveryRate, 0.3, "3/10 redelivered");
});

test("tenancy: queue + stats are filtered by visibleInvocation; capacity stays device-global", () => {
  const state = {
    device: { id: "dev_1", maxConcurrency: 1 },
    invocations: [
      running("run_other", "agt_ok", { worktreePath: "/wt/x" }), // other team, but occupies the device
      Object.assign(queued("q_mine", "agt_ok", { meta: { worktreePath: "/wt/y" } }), { team: "mine" }),
      Object.assign(queued("q_theirs", "agt_ok", { meta: { worktreePath: "/wt/z" } }), { team: "theirs" }),
    ],
  };
  const health = computeInvocationDispatchHealth(state, { findAgent, now, visibleInvocation: (inv) => inv.team === "mine" });
  assert.deepEqual(health.queue.items.map((i) => i.invocationId), ["q_mine"], "only my team's queued work is listed");
  // The device is still globally at capacity (the other team's run counts).
  assert.equal(health.capacity.inFlight, 1);
  assert.equal(health.capacity.atCapacity, true);
  assert.equal(health.queue.items[0].blockedReason, "waiting_concurrency", "blocked by the global cap the other team consumes");
});

test("unifies failover, claim expiry, and human intervention without leaking foreign projects", () => {
  const state = {
    device: { id: "dev_1", maxConcurrency: 3 },
    invocations: [Object.assign(queued("q_mine", "agt_ok"), { team: "mine" }), Object.assign(queued("q_other", "agt_ok"), { team: "other" })],
    autoRuns: [
      { id: "run_mine", status: "failed", invocationId: "q_mine", errorCode: "stuck", failoverHistory: [{ attempt: 1, fromInvocationId: "old_mine", toInvocationId: "q_mine", at: "2026-07-18T00:05:00Z" }], failoverOutcome: { status: "exhausted", reason: "stuck" } },
      { id: "run_other", status: "failed", invocationId: "q_other", failoverHistory: [{ attempt: 1, toInvocationId: "q_other", at: "2026-07-18T00:06:00Z" }], failoverOutcome: { status: "recovered" } },
    ],
    issueClaims: [
      { projectId: "mine", status: "active", leaseExpiresAt: "2026-07-18T01:00:00Z" },
      { projectId: "mine", status: "expired", outcome: "lease_expired" },
      { projectId: "other", status: "expired", outcome: "lease_expired" },
    ],
  };
  const health = computeInvocationDispatchHealth(state, { findAgent, now, visibleInvocation: (item) => item.team === "mine", visibleProject: (id) => id === "mine" });
  assert.deepEqual(health.reliability.claims, { active: 1, expired: 1, nextExpiryAt: "2026-07-18T01:00:00Z" });
  assert.equal(health.reliability.failover.attempts, 1);
  assert.equal(health.reliability.failover.exhausted, 1);
  assert.equal(health.reliability.failover.recovered, 0);
  assert.deepEqual(health.reliability.intervention.items.map((item) => item.autoRunId), ["run_mine"]);
});
