import assert from "node:assert/strict";
import { test } from "node:test";
import { createAlertDispatcher, normalizeAlertWebhookUrl } from "../src/services/auto-run-alerts.mjs";

test("normalizeAlertWebhookUrl: http(s) only; junk/blank → null", () => {
  assert.equal(normalizeAlertWebhookUrl("  https://x.co/h  "), "https://x.co/h");
  assert.equal(normalizeAlertWebhookUrl("http://x.co"), "http://x.co");
  assert.equal(normalizeAlertWebhookUrl("ftp://x.co"), null);
  assert.equal(normalizeAlertWebhookUrl("not a url"), null);
  assert.equal(normalizeAlertWebhookUrl(""), null);
  assert.equal(normalizeAlertWebhookUrl(null), null);
});

test("dispatch: no-op when no webhook configured", async () => {
  const d = createAlertDispatcher({ getWebhookUrl: () => null, fetchImpl: () => { throw new Error("should not fetch"); } });
  assert.deepEqual(await d.dispatch({ kind: "x" }), { sent: false, reason: "no webhook configured" });
});

test("dispatch: POSTs JSON to the live URL and reports status", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { status: 204 }; };
  const d = createAlertDispatcher({ getWebhookUrl: () => "https://hook.test/a", fetchImpl, now: () => "T" });
  const r = await d.dispatch({ kind: "budget_exceeded", severity: "high", message: "m", data: { projectId: "p1" } });
  assert.deepEqual(r, { sent: true, status: 204 });
  assert.equal(calls[0].url, "https://hook.test/a");
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.kind, "budget_exceeded");
  assert.equal(body.source, "myagenttool-autorun");
  assert.equal(body.data.projectId, "p1");
});

test("dispatch: never throws on fetch failure", async () => {
  const d = createAlertDispatcher({ getWebhookUrl: () => "https://hook.test/a", fetchImpl: async () => { throw new Error("boom"); } });
  const r = await d.dispatch({ kind: "x" });
  assert.equal(r.sent, false);
  assert.match(r.reason, /boom/);
});
