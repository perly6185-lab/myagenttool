/*
 * Hermetic OTLP observability probe (#1205).
 *
 * This deliberately crosses the real state/composer/HTTP-server boundary and
 * sends a completed invocation trace to a local fake collector. It proves the
 * delivery semantics that the serializer unit tests cannot: a non-2xx response
 * rolls the optimistic export mark back, the next flush retries the same trace,
 * and a successful batch is not sent again.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("real invocation telemetry retries a failed OTLP batch and does not resend after a 2xx acknowledgment", async () => {
  const originalAuth = process.env.MYAGENT_REQUIRE_AUTH;
  const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  process.env.MYAGENT_REQUIRE_AUTH = "0";

  const tempRoot = mkdtempSync(join(tmpdir(), "myagenttool-otlp-observability-"));
  const projectDir = join(tempRoot, "project");
  mkdirSync(projectDir, { recursive: true });

  const collectorRequests = [];
  let collectorStatus = 503;
  const collector = http.createServer(async (req, res) => {
    const text = await readRequestBody(req);
    collectorRequests.push({
      method: req.method,
      path: req.url,
      contentType: req.headers["content-type"],
      body: text ? JSON.parse(text) : null,
      responseStatus: collectorStatus,
    });
    res.writeHead(collectorStatus, { "content-type": "application/json" });
    res.end("{}");
  });

  let apiServer = null;
  try {
    await listenRandomPort(collector);
    const collectorAddress = collector.address();
    assert.ok(collectorAddress && typeof collectorAddress === "object");
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${collectorAddress.port}`;

    const { createServerState } = await import("../../src/runtime/state-factory.mjs");
    const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
    const { createHttpServer } = await import("../../src/runtime/http-server.mjs");

    const now = () => new Date().toISOString();
    const { defaultProject, state } = createServerState({ defaultProjectPath: projectDir, now });
    const { httpDependencies } = createServerRuntimeServices({
      namespace: "test",
      protocolVersion: "0.0.0",
      state,
      defaultProject,
      defaultProjectPath: projectDir,
      persistenceEnabled: false,
      stateStorePath: join(tempRoot, "state.json"),
      stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000,
      now,
    });

    apiServer = createHttpServer({
      host: "127.0.0.1",
      port: 0,
      namespace: "test",
      protocolVersion: "0.0.0",
      ...httpDependencies,
    });
    await listenRandomPort(apiServer);
    const apiAddress = apiServer.address();
    assert.ok(apiAddress && typeof apiAddress === "object");
    const apiBase = `http://127.0.0.1:${apiAddress.port}`;

    const healthBefore = await call(apiBase, "/health");
    assert.equal(healthBefore.status, 200);
    assert.equal(healthBefore.body.status, "ok");

    // Create through the real HTTP route, then report the same round events a
    // bridge would send. Completing through the composed service closes the
    // invocation root span and its child round span before export.
    const created = await call(apiBase, "/api/invocations", {
      method: "POST",
      body: { task: "Exercise the hermetic OTLP observability probe." },
    });
    assert.equal(created.status, 201);
    const invocation = state.invocations.find((item) => item.id === created.body.invocation.id);
    assert.ok(invocation, "the HTTP route created a real invocation in server state");

    httpDependencies.recordRoundEvent(invocation, {
      type: "round_started",
      data: {
        roundIndex: 0,
        provider: "openai",
        model: "gpt-observability-probe",
        startedAt: "2026-07-17T00:00:00.000Z",
      },
    });
    httpDependencies.recordRoundEvent(invocation, {
      type: "round_completed",
      data: {
        roundIndex: 0,
        status: "succeeded",
        provider: "openai",
        model: "gpt-observability-probe",
        startedAt: "2026-07-17T00:00:00.000Z",
        endedAt: "2026-07-17T00:00:01.000Z",
        inputTokens: 17,
        outputTokens: 5,
      },
    });
    httpDependencies.completeInvocation(invocation, {
      status: "succeeded",
      summary: "Observability probe completed.",
      result: { touchedUserFiles: false },
    });

    const rootSpan = state.spans.find((span) => span.id === invocation.rootSpanId);
    const round = state.invocationRounds.find((item) => item.invocationId === invocation.id && item.roundIndex === 0);
    const childSpan = state.spans.find((span) => span.id === round?.spanId);
    assert.equal(invocation.status, "succeeded");
    assert.equal(rootSpan?.status, "succeeded");
    assert.equal(childSpan?.status, "succeeded");
    assert.equal(childSpan?.parentSpanId, rootSpan?.id);

    // First delivery fails. The optimistic mark must be rolled back so this
    // exact batch remains eligible for the next slow-tick flush.
    const firstFlush = httpDependencies.flushTraceExport();
    assert.equal(firstFlush.exported, 2);
    await waitFor(() => collectorRequests.length === 1, "collector's 503 response");
    await waitFor(
      () => [rootSpan, childSpan].every((span) => span?.otlpExportedAt == null),
      "failed export marks to roll back",
    );

    const healthAfterFailure = await call(apiBase, "/health");
    assert.equal(healthAfterFailure.status, 200, "telemetry delivery failure must not affect serving health");
    assert.equal(healthAfterFailure.body.status, "ok");

    // A healthy collector receives the retry. Both spans get a durable success
    // mark, and the next flush sees no pending work.
    collectorStatus = 200;
    const secondFlush = httpDependencies.flushTraceExport();
    assert.equal(secondFlush.exported, 2);
    await waitFor(() => collectorRequests.length === 2, "collector's successful retry");
    await waitFor(
      () => [rootSpan, childSpan].every((span) => typeof span?.otlpExportedAt === "string"),
      "successful export marks",
    );

    const successfulRequest = collectorRequests[1];
    assert.equal(successfulRequest.method, "POST");
    assert.equal(successfulRequest.path, "/v1/traces");
    assert.match(successfulRequest.contentType ?? "", /^application\/json\b/);

    const exportedSpans = successfulRequest.body.resourceSpans[0].scopeSpans[0].spans;
    assert.equal(exportedSpans.length, 2);
    const exportedRoot = exportedSpans.find((span) => span.name === "m0.remote_invocation");
    const exportedChild = exportedSpans.find((span) => span.name === "round.0");
    assert.ok(exportedRoot, "the invocation root span was exported");
    assert.ok(exportedChild, "the model round child span was exported");
    assert.match(exportedRoot.traceId, /^[0-9a-f]{32}$/);
    assert.match(exportedRoot.spanId, /^[0-9a-f]{16}$/);
    assert.equal(exportedChild.traceId, exportedRoot.traceId);
    assert.equal(exportedChild.parentSpanId, exportedRoot.spanId, "the OTLP parent link preserves the trace tree");
    assert.equal(exportedRoot.status.code, 1);
    assert.equal(exportedChild.status.code, 1);

    const childAttributes = Object.fromEntries(
      exportedChild.attributes.map((attribute) => [attribute.key, attribute.value]),
    );
    assert.deepEqual(childAttributes["gen_ai.system"], { stringValue: "openai" });
    assert.deepEqual(childAttributes["gen_ai.request.model"], { stringValue: "gpt-observability-probe" });
    assert.deepEqual(childAttributes["gen_ai.operation.name"], { stringValue: "chat" });
    assert.deepEqual(childAttributes["gen_ai.usage.input_tokens"], { intValue: "17" });
    assert.deepEqual(childAttributes["gen_ai.usage.output_tokens"], { intValue: "5" });

    const firstAttemptSpans = collectorRequests[0].body.resourceSpans[0].scopeSpans[0].spans;
    assert.deepEqual(
      firstAttemptSpans.map((span) => [span.traceId, span.spanId]),
      exportedSpans.map((span) => [span.traceId, span.spanId]),
      "the retry sends the same trace and span identities",
    );

    const thirdFlush = httpDependencies.flushTraceExport();
    assert.equal(thirdFlush.exported, 0);
    assert.equal(collectorRequests.length, 2, "a successful batch is not exported twice");
  } finally {
    await Promise.all([closeServer(apiServer), closeServer(collector)]);
    restoreEnv("MYAGENT_REQUIRE_AUTH", originalAuth);
    restoreEnv("OTEL_EXPORTER_OTLP_ENDPOINT", originalEndpoint);
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

async function call(base, path, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function listenRandomPort(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
  });
}

async function waitFor(check, label) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
