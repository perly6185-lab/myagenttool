import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RecoveryHistory } from "../src/recovery-history.mjs";

test("recovery history persists bounded observations, windows them, and raises an objective alert", async () => {
  let current = "2026-07-01T10:00:00.000Z";
  const dir = await mkdtemp(join(tmpdir(), "recovery-history-"));
  const file = join(dir, "history.json");
  const history = new RecoveryHistory(file, { now: () => current });
  await history.observe([{ id: "studio", status: "online", recovery: { medianHours: 30, sampleCount: 8 } }]);
  await history.observe([{ id: "studio", status: "online", recovery: { medianHours: 31, sampleCount: 9 } }]);
  assert.equal(history.summary("studio", 7).points.length, 1, "same-minute polling does not inflate samples");
  assert.equal(history.summary("studio", 7).alert.code, "recovery_objective_missed");

  const restored = new RecoveryHistory(file, { now: () => current });
  await restored.load();
  assert.equal(restored.summary("studio", 30).latestMedianHours, 30);
  current = "2026-10-15T10:00:00.000Z";
  assert.equal(restored.summary("studio", 90).points.length, 0);
});
