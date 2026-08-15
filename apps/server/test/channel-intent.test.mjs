import assert from "node:assert/strict";
import { test } from "node:test";

import {
  channelIntentRequiresClarification,
  normalizeChannelIntentResult,
} from "../src/services/channel-intent.mjs";
import {
  createChannelIntentAdapter,
  sanitizeChannelIntentInvocationResult,
  resolveChannelIntentConfig,
} from "../src/services/channel-intent-adapter.mjs";

test("channel intent adapter is closed, bounded, and conversation-local", () => {
  const fallback = { intent: "new_task", confidence: 0.78, source: "deterministic" };
  const normalized = normalizeChannelIntentResult({
    intent: "query",
    confidence: 4,
    ref: "T-ABCD",
    reason: "x".repeat(500),
  }, { fallback, activeRefs: new Set(["T-ABCD"]) });
  assert.deepEqual(normalized, {
    intent: "query",
    confidence: 1,
    ref: "T-ABCD",
    source: "custom",
  });

  const invalidRef = normalizeChannelIntentResult({ intent: "select", confidence: 0.9, ref: "T-FOREIGN" }, {
    fallback,
    activeRefs: new Set(["T-LOCAL"]),
  });
  assert.equal(invalidRef.ref, null);
  assert.equal(channelIntentRequiresClarification({ intent: "unknown", confidence: 1 }), true);
});

test("channel intent adapter reuses the authorized Bridge Agent and bounds its prompt", async () => {
  let created;
  const invocation = { id: "inv_classifier", status: "queued", result: null };
  const adapter = createChannelIntentAdapter({
    config: {
      enabled: true,
      providerId: "desktop_bridge",
      agentId: "agt_codex_cli",
      timeoutMs: 1_000,
    },
    state: { device: { unlinkState: "linked" } },
    findAgent: (id) => ({ id, status: "ready", adapter: { type: "cli", command: "codex" } }),
    createInvocation: (task, agent, options) => {
      created = { task, agent, options };
      setTimeout(() => {
        invocation.status = "succeeded";
        invocation.result = { output: { intent: "supplement", confidence: 0.91, ref: "T-LOCAL" } };
      }, 5);
      return invocation;
    },
  });

  const result = await adapter.classify({
    text: `补充说明 ${"x".repeat(20_000)}`,
    activeThreads: [{ ref: "T-LOCAL", status: "waiting_user", summary: "等待文件" }],
  });
  assert.equal(created.agent.id, "agt_codex_cli");
  assert.equal(created.options.metadata.channelIntentClassifier, true);
  assert.equal(created.options.preApproved, true);
  assert.ok(created.task.length < 9_000);
  assert.deepEqual(result, { intent: "supplement", confidence: 0.91, ref: "T-LOCAL", source: "custom" });
});

test("channel intent is opt-in and uses the Bridge when enabled", () => {
  const config = resolveChannelIntentConfig({
    MYAGENTTOOL_CHANNEL_INTENT_AGENT_ID: "agt_claude_acceptEdits",
    MYAGENTTOOL_CHANNEL_INTENT_TIMEOUT_MS: "999999",
  });
  assert.equal(config.enabled, false);
  assert.equal(config.agentId, "agt_claude_acceptEdits");
  assert.equal(config.timeoutMs, 30_000);
  assert.equal(resolveChannelIntentConfig({ MYAGENTTOOL_CHANNEL_INTENT_ENABLED: "1" }).enabled, true);
  assert.equal(resolveChannelIntentConfig({ MYAGENTTOOL_CHANNEL_INTENT_ENABLED: "0" }).enabled, false);
});

test("Bridge classifier results are sanitized before durable invocation output", () => {
  assert.deepEqual(sanitizeChannelIntentInvocationResult({ output: "模型解释... {\"intent\":\"query\",\"confidence\":0.8,\"ref\":null}" }), {
    output: { intent: "query", confidence: 0.8, ref: null, source: "custom" },
  });
});

test("Bridge intent classification has one bounded preflight slot and falls back when busy", async () => {
  const firstInvocation = { id: "inv_classifier_busy", status: "queued", result: null };
  let creates = 0;
  const adapter = createChannelIntentAdapter({
    config: { enabled: true, providerId: "desktop_bridge", agentId: "agt_codex_cli", timeoutMs: 2_000 },
    state: { device: { unlinkState: "linked" } },
    findAgent: () => ({ id: "agt_codex_cli", status: "ready", adapter: { type: "cli" } }),
    createInvocation: () => { creates += 1; return firstInvocation; },
    cancelInvocation: (invocation) => { invocation.status = "cancelled"; },
  });
  const first = adapter.classify({ text: "第一个消息" });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => adapter.classify({ text: "第二个消息" }), /channel_intent_bridge_busy/);
  firstInvocation.status = "succeeded";
  firstInvocation.result = { output: { intent: "new_task", confidence: 0.9, ref: null } };
  await first;
  assert.equal(creates, 1);
});

test("Bridge intent adapter reports bounded health metrics without user text", async () => {
  const metrics = [];
  const invocation = { id: "inv_classifier_metric", status: "succeeded", result: { output: { intent: "query", confidence: 0.9, ref: null } } };
  const adapter = createChannelIntentAdapter({
    config: { enabled: true, providerId: "desktop_bridge", agentId: "agt_codex_cli", timeoutMs: 2_000 },
    state: { device: { unlinkState: "linked" } },
    findAgent: () => ({ id: "agt_codex_cli", status: "ready" }),
    createInvocation: () => invocation,
    onMetric: (metric) => metrics.push(metric),
  });
  const result = await adapter.classify({ text: "不要把这段原文写进指标" });
  assert.equal(result.intent, "query");
  assert.deepEqual(metrics.map(({ status }) => status), ["succeeded"]);
  assert.equal(metrics[0].reason, null);
  assert.equal(typeof metrics[0].latencyMs, "number");
  assert.equal(JSON.stringify(metrics).includes("不要把"), false);
});

test("Bridge intent adapter opens a circuit after repeated failures and reports fallback state", async () => {
  const metrics = [];
  let creates = 0;
  const adapter = createChannelIntentAdapter({
    config: { enabled: true, providerId: "desktop_bridge", agentId: "agt_codex_cli", timeoutMs: 2_000, failureThreshold: 2, cooldownMs: 10_000 },
    state: { device: { unlinkState: "linked" } },
    findAgent: () => ({ id: "agt_codex_cli", status: "ready" }),
    createInvocation: () => { creates += 1; return { id: `inv_fail_${creates}`, status: "failed", result: null }; },
    onMetric: (metric) => metrics.push(metric),
  });
  await assert.rejects(() => adapter.classify({ text: "a" }), /invocation_failed/);
  await assert.rejects(() => adapter.classify({ text: "b" }), /invocation_failed/);
  await assert.rejects(() => adapter.classify({ text: "c" }), /circuit_open/);
  assert.equal(creates, 2);
  assert.equal(metrics.at(-1).status, "circuit_open");
  assert.equal(metrics.at(-1).circuitOpen, true);
});
