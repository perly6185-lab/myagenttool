/**
 * #1302 long-poll — cancelInvocation notifies the device's cancellation signal
 * the instant a RUNNING run is asked to cancel, so a held /api/bridge/cancellations
 * long-poll wakes immediately. Hermetic over createInvocationCancellationRuntime
 * with fake deps.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createInvocationCancellationRuntime } from "../src/services/invocations/cancellation.mjs";

function makeRuntime(notified) {
  return createInvocationCancellationRuntime({
    state: { invocations: [], auditSummaries: [] },
    now: () => new Date().toISOString(),
    appendEvent: () => {},
    findAgent: () => ({ adapter: { type: "cli" } }),
    findApprovalRequest: () => null,
    abortDirectHttpRun: () => false,
    createAuditSummary: () => ({}),
    recordAgentUsage: () => {},
    isTerminal: (status) => ["succeeded", "failed", "cancelled", "timed_out"].includes(status),
    notifyCancellation: (deviceId) => notified.push(deviceId),
  });
}

test("cancelling a running invocation notifies its delivery device", () => {
  const notified = [];
  const { cancelInvocation } = makeRuntime(notified);
  const invocation = {
    id: "inv_1",
    status: "running",
    agentId: "agt_1",
    delivery: { deviceId: "dev_abc" },
    cancellation: {},
  };
  cancelInvocation(invocation);
  assert.equal(invocation.status, "cancelling");
  assert.equal(invocation.cancellation.state, "requested");
  assert.deepEqual(notified, ["dev_abc"], "the device is notified exactly once");
});

test("a queued invocation resolves server-side and does NOT notify a bridge", () => {
  const notified = [];
  const { cancelInvocation } = makeRuntime(notified);
  const invocation = {
    id: "inv_q",
    status: "queued",
    agentId: "agt_1",
    delivery: { deviceId: "dev_abc" },
    cancellation: {},
  };
  cancelInvocation(invocation);
  assert.equal(invocation.status, "cancelled");
  assert.deepEqual(notified, [], "a pre-dispatch cancel needs no bridge wakeup");
});

test("a terminal invocation is a no-op and does not notify", () => {
  const notified = [];
  const { cancelInvocation } = makeRuntime(notified);
  const invocation = { id: "inv_done", status: "succeeded", cancellation: {} };
  cancelInvocation(invocation);
  assert.deepEqual(notified, []);
});
