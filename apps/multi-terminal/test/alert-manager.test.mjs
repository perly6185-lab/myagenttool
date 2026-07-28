import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AlertManager } from "../src/alert-manager.mjs";

test("alerts deduplicate, acknowledge, silence, resolve, and notify recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "alerts-"));
  const notifications = [];
  const manager = new AlertManager(join(root, "alerts.json"), { now: () => "2026-07-25T00:00:00.000Z", notify: async (row) => notifications.push(row.type) });
  await manager.load();
  const first = await manager.ingest({ terminalId: "studio", code: "offline", severity: "critical", message: "offline" });
  await manager.ingest({ terminalId: "studio", code: "offline", severity: "critical", message: "offline" });
  assert.equal(manager.list()[0].occurrences, 2);
  assert.equal((await manager.update(first.id, "acknowledge")).status, "acknowledged");
  assert.equal((await manager.update(first.id, "silence", { minutes: 5 })).status, "silenced");
  assert.equal((await manager.update(first.id, "resolve")).status, "resolved");
  assert.deepEqual(notifications, ["alert_opened", "alert_recovered"]);
  assert.equal((await readFile(join(root, "alerts.json"), "utf8")).includes("secret"), false);
});
