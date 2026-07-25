import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAlertDispatcher,
  normalizeAlertWebhookUrl,
  normalizeExternalAlertWebhookUrl,
  validateExternalWebhookTarget,
  resolveOwnedAlertWebhookUrl,
} from "../src/services/auto-run-alerts.mjs";

test("normalizeAlertWebhookUrl: http(s) only; junk/blank → null", () => {
  assert.equal(normalizeAlertWebhookUrl("  https://x.co/h  "), "https://x.co/h");
  assert.equal(normalizeAlertWebhookUrl("http://x.co"), "http://x.co");
  assert.equal(normalizeAlertWebhookUrl("ftp://x.co"), null);
  assert.equal(normalizeAlertWebhookUrl("not a url"), null);
  assert.equal(normalizeAlertWebhookUrl(""), null);
  assert.equal(normalizeAlertWebhookUrl(null), null);
});

test("normalizeExternalAlertWebhookUrl: team targets require public-looking HTTPS", () => {
  assert.equal(normalizeExternalAlertWebhookUrl("https://hooks.example.test/team"), "https://hooks.example.test/team");
  assert.equal(normalizeExternalAlertWebhookUrl("http://hooks.example.test/team"), null);
  assert.equal(normalizeExternalAlertWebhookUrl("https://user:secret@hooks.example.test/team"), null);
  assert.equal(normalizeExternalAlertWebhookUrl("https://localhost/hook"), null);
  assert.equal(normalizeExternalAlertWebhookUrl("https://127.0.0.1/hook"), null);
  assert.equal(normalizeExternalAlertWebhookUrl("https://169.254.169.254/latest/meta-data"), null);
  assert.equal(normalizeExternalAlertWebhookUrl("https://192.168.1.20/hook"), null);
  assert.equal(normalizeExternalAlertWebhookUrl("https://service.internal/hook"), null);
  assert.equal(normalizeExternalAlertWebhookUrl("https://[::1]/hook"), null);
});

test("dispatch: no-op when no webhook configured", async () => {
  const d = createAlertDispatcher({ getWebhookUrl: () => null, fetchImpl: () => { throw new Error("should not fetch"); } });
  assert.deepEqual(await d.dispatch({ kind: "x" }), { delivery: "skipped", sent: false, reason: "no webhook configured" });
});

test("dispatch: POSTs JSON to the live URL and reports status", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { status: 204 }; };
  const d = createAlertDispatcher({ getWebhookUrl: () => "https://hook.test/a", fetchImpl, now: () => "T" });
  const r = await d.dispatch({ kind: "budget_exceeded", severity: "high", message: "m", data: { projectId: "p1" } });
  assert.deepEqual(r, { delivery: "sent", sent: true, status: 204 });
  assert.equal(calls[0].url, "https://hook.test/a");
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.kind, "budget_exceeded");
  assert.equal(body.source, "myagenttool-autorun");
  assert.equal(body.data.projectId, "p1");
});

test("dispatch: passes alert ownership to the webhook resolver", async () => {
  let resolved;
  const d = createAlertDispatcher({
    getWebhookUrl: (alert) => {
      resolved = alert;
      return "https://hook.test/team";
    },
    fetchImpl: async () => ({ status: 200 }),
  });
  await d.dispatch({ kind: "routing", severity: "warning", message: "m", data: { teamId: "team_a" } });
  assert.deepEqual(resolved, {
    kind: "routing", severity: "warning", message: "m", data: { teamId: "team_a" },
  });
});

test("team-owned alerts use the team's target without leaking the local fallback", () => {
  const state = {
    autoRunSettings: { alertWebhookUrl: "https://hook.test/local" },
    teams: [
      { id: "team_a", alertWebhookUrl: "https://hook.test/a" },
      { id: "team_b" },
    ],
  };
  assert.equal(resolveOwnedAlertWebhookUrl(state, { data: { teamId: "team_a" } }), "https://hook.test/a");
  assert.equal(resolveOwnedAlertWebhookUrl(state, { data: { teamId: "team_b" } }), null);
  assert.equal(resolveOwnedAlertWebhookUrl(state, { data: { teamId: "team_local" } }), "https://hook.test/local");
  assert.equal(resolveOwnedAlertWebhookUrl(state, { data: {} }), "https://hook.test/local");
});

test("dispatch: never throws on fetch failure", async () => {
  const d = createAlertDispatcher({ getWebhookUrl: () => "https://hook.test/a", fetchImpl: async () => { throw new Error("boom"); } });
  const r = await d.dispatch({ kind: "x" });
  assert.equal(r.sent, false);
  assert.equal(r.delivery, "retryable");
  assert.match(r.reason, /boom/);
});

test("dispatch: retries transient HTTP failures but skips permanent failures", async () => {
  const transient = createAlertDispatcher({
    getWebhookUrl: () => "https://hook.test/a",
    fetchImpl: async () => ({ status: 503 }),
  });
  assert.deepEqual(await transient.dispatch({ kind: "x" }), {
    delivery: "retryable", sent: false, status: 503, reason: "HTTP 503",
  });
  const permanent = createAlertDispatcher({
    getWebhookUrl: () => "https://hook.test/a",
    fetchImpl: async () => ({ status: 400 }),
  });
  assert.deepEqual(await permanent.dispatch({ kind: "x" }), {
    delivery: "skipped", sent: false, status: 400, reason: "HTTP 400",
  });
});

test("dispatch: validates DNS and every redirect target for team webhooks", async () => {
  const calls = [];
  const dispatcher = createAlertDispatcher({
    getWebhookUrl: () => "https://public.example/hook",
    shouldValidateTarget: () => true,
    resolveHostname: async (hostname) => [{
      address: hostname === "public.example" ? "93.184.216.34" : "127.0.0.1",
    }],
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        status: 302,
        headers: { get: () => "https://internal.example/admin" },
      };
    },
  });
  const result = await dispatcher.dispatch({ kind: "x", data: { teamId: "team_a" } });
  assert.equal(result.delivery, "skipped");
  assert.match(result.reason, /non-public/);
  assert.deepEqual(calls, ["https://public.example/hook"], "the unsafe redirect is never fetched");
});

test("validateExternalWebhookTarget rejects a public hostname resolving privately", async () => {
  const result = await validateExternalWebhookTarget("https://public.example/hook", {
    resolveHostname: async () => [{ address: "169.254.169.254" }],
  });
  assert.deepEqual(result, { ok: false, reason: "webhook target resolved to a non-public address" });
});

test("validateExternalWebhookTarget rejects mixed public/private DNS answers", async () => {
  const result = await validateExternalWebhookTarget("https://public.example/hook", {
    resolveHostname: async () => [
      { address: "93.184.216.34" },
      { address: "::ffff:127.0.0.1" },
    ],
  });
  assert.deepEqual(result, { ok: false, reason: "webhook target resolved to a non-public address" });
});

test("dispatch validates a relative redirect before following it", async () => {
  const calls = [];
  const dispatcher = createAlertDispatcher({
    getWebhookUrl: () => "https://public.example/start",
    shouldValidateTarget: () => true,
    resolveHostname: async () => [{ address: "93.184.216.34" }],
    fetchImpl: async (url) => {
      calls.push(url);
      return calls.length === 1
        ? { status: 307, headers: { get: () => "/final" } }
        : { status: 204 };
    },
  });
  assert.deepEqual(await dispatcher.dispatch({ kind: "x", data: { teamId: "team_a" } }), {
    delivery: "sent", sent: true, status: 204,
  });
  assert.deepEqual(calls, [
    "https://public.example/start",
    "https://public.example/final",
  ]);
});
