import test from "node:test";
import assert from "node:assert/strict";
import { SafeRecovery } from "../src/safe-recovery.mjs";

test("automatic recovery allows only idempotent owner-local retry", async () => {
  const calls = [];
  const recovery = new SafeRecovery({
    enabled: true,
    service: { proxyAction: async (row) => { calls.push(row); return { ok: true, terminalId: row.terminalId }; } },
  });
  assert.equal((await recovery.handle({ recommendedAction: "replay", terminalId: "a" })).executed, false);
  const result = await recovery.handle({
    id: "alt_1", recommendedAction: "retry", terminalId: "owner",
    resourceType: "application-runs", localResourceId: "run_1",
    applicationId: "app_1", routineId: "routine_1",
  });
  assert.equal(result.executed, true);
  assert.equal(result.migrated, false);
  assert.equal(calls[0].terminalId, "owner");
  assert.equal(Object.hasOwn(calls[0].body, "targetTerminalId"), false);
});
