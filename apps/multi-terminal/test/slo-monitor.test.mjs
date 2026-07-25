import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SloMonitor, webhookNotifier } from "../src/slo-monitor.mjs";

test("SLO tracks availability, stale data, recovery, operations, and transition notifications", async () => {
  const notifications = [];
  const file = join(await mkdtemp(join(tmpdir(), "slo-monitor-")), "slo.json");
  const monitor = new SloMonitor(file, { notify: async (payload) => notifications.push(payload) });
  const overview = { terminals: [
    { status: "online", stale: false, recovery: { medianHours: 2 } },
    { status: "offline", stale: true, recovery: { medianHours: 30 } },
  ] };
  const breached = await monitor.evaluate(overview, [{ status: "failed" }, { status: "completed" }]);
  assert.equal(breached.status, "breached");
  assert.deepEqual(breached.breaches, ["availability", "stale_data", "operation_success"]);
  const healthy = await monitor.evaluate({ terminals: [{ status: "online", stale: false, recovery: { medianHours: 2 } }] }, [{ status: "completed" }]);
  assert.equal(healthy.status, "healthy");
  assert.deepEqual(notifications.map((row) => row.type), ["multi_terminal_slo_breached", "multi_terminal_slo_healthy"]);
  assert.equal(monitor.summary(7).trend.length, 2);
});

test("webhook notifier rejects insecure remote and credential-bearing URLs", () => {
  assert.throws(() => webhookNotifier("http://remote.example/hook"), /HTTPS/);
  assert.throws(() => webhookNotifier("https://user:pass@example.com/hook"), /credentials/);
});
