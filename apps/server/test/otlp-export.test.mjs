/*
 * ADR 0017 — zero-dependency OTLP/HTTP JSON trace export. The serializer is pure
 * and the exporter is best-effort (no-op when unconfigured, never throws).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOtlpTraceExporter, otlpSpanId, otlpTraceId, spansToOtlp } from "../src/services/otlp-export.mjs";

const T0 = "2026-07-17T00:00:00.000Z";
const T5 = "2026-07-17T00:00:05.000Z";

function roundSpan(overrides = {}) {
  return {
    id: "spn_2",
    traceId: "trc_1",
    parentSpanId: "spn_1",
    name: "round.0",
    status: "succeeded",
    startedAt: T0,
    endedAt: T5,
    attributes: {
      roundIndex: 0,
      provider: "anthropic",
      model: "claude-opus-4-8",
      "gen_ai.system": "anthropic",
      "gen_ai.request.model": "claude-opus-4-8",
      "gen_ai.usage.input_tokens": 120,
    },
    ...overrides,
  };
}

test("id mapping is deterministic and the OTLP-required width", () => {
  assert.equal(otlpTraceId("trc_1").length, 32, "trace id is 16 bytes (32 hex)");
  assert.equal(otlpSpanId("spn_2").length, 16, "span id is 8 bytes (16 hex)");
  assert.equal(otlpTraceId("trc_1"), otlpTraceId("trc_1"), "same input → same id across flushes");
  assert.notEqual(otlpSpanId("spn_2"), otlpSpanId("spn_3"));
});

test("spansToOtlp serializes a completed span to a valid ResourceSpans payload", () => {
  const payload = spansToOtlp([roundSpan()], { serviceName: "myagenttool" });
  const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
  assert.equal(span.traceId, otlpTraceId("trc_1"));
  assert.equal(span.spanId, otlpSpanId("spn_2"));
  assert.equal(span.parentSpanId, otlpSpanId("spn_1"), "parent link preserved");
  assert.equal(span.name, "round.0");
  assert.equal(span.startTimeUnixNano, String(Date.parse(T0) * 1_000_000));
  assert.equal(span.endTimeUnixNano, String(Date.parse(T5) * 1_000_000));
  assert.equal(span.status.code, 1, "succeeded → OK");
  const kv = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
  assert.deepEqual(kv["gen_ai.system"], { stringValue: "anthropic" });
  assert.deepEqual(kv["gen_ai.usage.input_tokens"], { intValue: "120" });
  assert.equal(payload.resourceSpans[0].resource.attributes[0].value.stringValue, "myagenttool");
});

test("open spans (no endedAt) are not exported; failed maps to ERROR", () => {
  const open = spansToOtlp([roundSpan({ endedAt: null })]);
  assert.equal(open.resourceSpans[0].scopeSpans[0].spans.length, 0);
  const failed = spansToOtlp([roundSpan({ status: "failed" })]);
  assert.equal(failed.resourceSpans[0].scopeSpans[0].spans[0].status.code, 2);
});

test("a would-be-secret attribute value is refused, never exported (ADR 0017 invariant 4)", () => {
  const span = roundSpan({ attributes: { model: "claude-opus-4-8", leaked: "token sk-ABCDEFGHIJKLMNOPQRST" } });
  const kv = Object.fromEntries(
    spansToOtlp([span]).resourceSpans[0].scopeSpans[0].spans[0].attributes.map((a) => [a.key, a.value]),
  );
  assert.equal(kv.model.stringValue, "claude-opus-4-8", "clean attribute kept");
  assert.equal(kv.leaked, undefined, "secret-shaped attribute dropped");
});

test("a clean but long attribute is exported (not mistaken for a secret)", () => {
  const long = "x".repeat(2000); // clean, just long — must NOT be dropped
  const span = roundSpan({ attributes: { model: "claude-opus-4-8", note: long } });
  const kv = Object.fromEntries(
    spansToOtlp([span]).resourceSpans[0].scopeSpans[0].spans[0].attributes.map((a) => [a.key, a.value]),
  );
  assert.equal(kv.note.stringValue, long, "clean long value kept in full");
  assert.equal(kv.model.stringValue, "claude-opus-4-8");
});

test("exporter is a no-op when no endpoint is configured", async () => {
  let called = false;
  const exporter = createOtlpTraceExporter({ getEndpoint: () => null, fetchImpl: () => { called = true; } });
  const result = await exporter.exportSpans([roundSpan()]);
  assert.equal(result.sent, false);
  assert.equal(called, false, "no network call without an endpoint");
});

test("exporter POSTs completed spans to the OTLP /v1/traces path", async () => {
  const calls = [];
  const exporter = createOtlpTraceExporter({
    getEndpoint: () => "https://collector.example.com",
    fetchImpl: async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { status: 200 }; },
  });
  const result = await exporter.exportSpans([roundSpan()]);
  assert.equal(result.sent, true);
  assert.equal(result.status, 200);
  assert.equal(result.count, 1);
  assert.equal(calls[0].url, "https://collector.example.com/v1/traces", "trailing slash normalized + traces path");
  assert.equal(calls[0].body.resourceSpans[0].scopeSpans[0].spans[0].name, "round.0");
});

test("exporter accepts only the numeric 2xx status range", async () => {
  for (const status of [200, 204, 299]) {
    const exporter = createOtlpTraceExporter({
      getEndpoint: () => "https://collector.example.com",
      fetchImpl: async () => ({ status }),
    });
    assert.deepEqual(await exporter.exportSpans([roundSpan()]), { sent: true, status, count: 1 });
  }
  for (const status of [199, 300]) {
    const exporter = createOtlpTraceExporter({
      getEndpoint: () => "https://collector.example.com",
      fetchImpl: async () => ({ status }),
    });
    assert.deepEqual(await exporter.exportSpans([roundSpan()]), {
      sent: false, status, count: 1, reason: "http_status",
    });
  }
});

test("exporter classifies non-2xx without reading or leaking the response body", async () => {
  let bodyRead = false;
  const exporter = createOtlpTraceExporter({
    getEndpoint: () => "https://collector.example.com",
    fetchImpl: async () => ({
      status: 503,
      text: async () => {
        bodyRead = true;
        return "collector failed with secret-token";
      },
    }),
  });
  const result = await exporter.exportSpans([roundSpan()]);
  assert.deepEqual(result, { sent: false, status: 503, count: 1, reason: "http_status" });
  assert.equal(bodyRead, false, "collector response body is never read");
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test("exporter classifies timeout without leaking the endpoint or thrown error", async () => {
  const exporter = createOtlpTraceExporter({
    getEndpoint: () => "https://user:secret@collector.example.com",
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("timeout at https://user:secret@collector.example.com")), { once: true });
    }),
  });
  const result = await exporter.exportSpans([roundSpan()]);
  assert.deepEqual(result, { sent: false, status: null, count: 1, reason: "timeout" });
  assert.doesNotMatch(JSON.stringify(result), /secret|collector\.example/);
});

test("exporter classifies network errors without leaking raw error details", async () => {
  const exporter = createOtlpTraceExporter({
    getEndpoint: () => "https://collector.example.com",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED https://collector.example.com/private-token");
    },
  });
  const result = await exporter.exportSpans([roundSpan()]);
  assert.deepEqual(result, { sent: false, status: null, count: 1, reason: "network_error" });
  assert.doesNotMatch(JSON.stringify(result), /private-token|ECONNREFUSED|collector\.example/);
});

test("exporter skips the POST when there are no completed spans", async () => {
  let called = false;
  const exporter = createOtlpTraceExporter({ getEndpoint: () => "https://c.example.com", fetchImpl: () => { called = true; } });
  const result = await exporter.exportSpans([roundSpan({ endedAt: null })]);
  assert.equal(result.sent, false);
  assert.equal(called, false);
});
