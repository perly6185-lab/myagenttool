import test from "node:test";
import assert from "node:assert/strict";

import { createInvocationDirectHttpRuntime } from "../src/services/invocations/direct-http.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function invocation(id, agentId) {
  return {
    id,
    agentId,
    status: "running",
    input: { task: `task ${id}` },
    options: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function agent(id) {
  return {
    id,
    name: id,
    adapter: {
      type: "http",
      baseUrl: "https://agent.example",
      requestPath: "/invoke",
      timeoutSeconds: 30,
    },
    location: { type: "remote_http" },
  };
}

test("remote HTTP runs honor global and per-agent concurrency without starving other agents", async () => {
  const requests = [];
  const events = [];
  const agents = new Map([agent("agent-a"), agent("agent-b")].map((item) => [item.id, item]));
  const runtime = createInvocationDirectHttpRuntime({
    appendEvent: (event) => events.push(event),
    completeInvocation: (item, result) => {
      item.status = result.status;
    },
    findAgent: (id) => agents.get(id),
    isTerminal: (status) => ["succeeded", "failed", "cancelled", "timed_out"].includes(status),
    maxConcurrency: 2,
    perAgentMaxConcurrency: 1,
    fetchImpl: (_url, options) => new Promise((resolve) => requests.push({ resolve, options })),
  });

  const first = invocation("one", "agent-a");
  const sameAgent = invocation("two", "agent-a");
  const otherAgent = invocation("three", "agent-b");

  runtime.startInvocationIfAllowed(first);
  runtime.startInvocationIfAllowed(sameAgent);
  runtime.startInvocationIfAllowed(otherAgent);
  await tick();

  assert.equal(requests.length, 2);
  assert.equal(sameAgent.status, "queued");
  assert.ok(events.some((event) => event.invocationId === sameAgent.id && event.type === "remote_http_queued"));

  requests[0].resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ summary: "done" }),
  });
  await tick();
  await tick();

  assert.equal(requests.length, 3);
  assert.equal(sameAgent.status, "running");

  for (const request of requests.slice(1)) {
    request.resolve({ ok: true, status: 200, text: async () => "{}" });
  }
  await tick();
});

test("starting the same remote invocation twice is idempotent", async () => {
  let requests = 0;
  let resolveRequest;
  const itemAgent = agent("agent-a");
  const runtime = createInvocationDirectHttpRuntime({
    appendEvent: () => {},
    completeInvocation: (item, result) => {
      item.status = result.status;
    },
    findAgent: () => itemAgent,
    isTerminal: (status) => status === "succeeded",
    fetchImpl: () => {
      requests += 1;
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    },
    maxConcurrency: 1,
    perAgentMaxConcurrency: 1,
  });
  const item = invocation("one", itemAgent.id);

  runtime.startInvocationIfAllowed(item);
  runtime.startInvocationIfAllowed(item);
  await tick();

  assert.equal(requests, 1);
  resolveRequest({ ok: true, status: 200, text: async () => "{}" });
  await tick();
});
