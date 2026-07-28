import assert from "node:assert/strict";
import { test } from "node:test";

import { createAlertOutboxService } from "../src/services/alert-outbox.mjs";

function harness(results = []) {
  const state = { alertOutbox: [] };
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 6, 24, 0, tick++)).toISOString();
  const sent = [];
  const service = createAlertOutboxService({
    state,
    now,
    nextId: () => `aob_${state.alertOutbox.length + 1}`,
    persistStateSoon: () => {},
    dispatch: async (alert) => {
      sent.push(alert);
      return results.shift() ?? { delivery: "sent", sent: true, status: 204 };
    },
  });
  return { state, sent, service };
}

test("alert outbox persists first, then marks a successful delivery", async () => {
  const { state, sent, service } = harness();
  service.enqueue({ kind: "budget_exceeded", data: { autoRunId: "aur_1" } });
  assert.equal(state.alertOutbox[0].status, "queued");
  const result = await service.sweep();
  assert.deepEqual(result, { attempted: 1, sent: 1 });
  assert.equal(sent.length, 1);
  assert.equal(state.alertOutbox[0].status, "sent");
  assert.ok(state.alertOutbox[0].sentAt);
});

test("retryable delivery remains durable with retry metadata", async () => {
  const { state, service } = harness([{ delivery: "retryable", sent: false, reason: "offline" }]);
  service.enqueue({ kind: "run_reaped" });
  await service.sweep();
  assert.equal(state.alertOutbox[0].status, "queued");
  assert.equal(state.alertOutbox[0].attempts, 1);
  assert.equal(state.alertOutbox[0].lastError, "offline");
  assert.ok(state.alertOutbox[0].nextAttemptAt);
});

test("skipped delivery is terminal and is not retried", async () => {
  const { state, sent, service } = harness([
    { delivery: "skipped", sent: false, reason: "no webhook configured" },
  ]);
  service.enqueue({ kind: "run_reaped" });
  assert.deepEqual(await service.sweep(), { attempted: 1, sent: 0 });
  assert.equal(state.alertOutbox[0].status, "skipped");
  assert.equal(state.alertOutbox[0].nextAttemptAt, null);
  assert.equal(state.alertOutbox[0].lastError, "no webhook configured");
  assert.deepEqual(await service.sweep(), { attempted: 0, sent: 0 });
  assert.equal(sent.length, 1);
});

test("manual retry requeues a terminal delivery and clears failure metadata", async () => {
  const { state, service } = harness();
  service.enqueue({ kind: "run_reaped" });
  Object.assign(state.alertOutbox[0], {
    status: "failed", attempts: 4, sentAt: "2026-07-24T00:00:00.000Z", lastError: "offline",
  });
  const retried = service.retry(state.alertOutbox[0].id);
  assert.equal(retried.status, "queued");
  assert.equal(retried.attempts, 0);
  assert.equal(retried.sentAt, null);
  assert.equal(retried.lastError, null);
  assert.ok(retried.nextAttemptAt);
});

test("manual retry refuses queued and successfully delivered alerts", () => {
  const { state, service } = harness();
  const queued = service.enqueue({ kind: "run_reaped" });
  assert.equal(service.retry(queued.id), null);
  queued.status = "sent";
  queued.sentAt = "2026-07-24T00:00:00.000Z";
  assert.equal(service.retry(queued.id), null);
  assert.equal(state.alertOutbox[0].status, "sent");
});
