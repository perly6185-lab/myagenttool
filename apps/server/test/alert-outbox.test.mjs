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
      return results.shift() ?? { sent: true, status: 204 };
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

test("failed delivery remains durable with retry metadata", async () => {
  const { state, service } = harness([{ sent: false, reason: "offline" }]);
  service.enqueue({ kind: "run_reaped" });
  await service.sweep();
  assert.equal(state.alertOutbox[0].status, "queued");
  assert.equal(state.alertOutbox[0].attempts, 1);
  assert.equal(state.alertOutbox[0].lastError, "offline");
  assert.ok(state.alertOutbox[0].nextAttemptAt);
});
