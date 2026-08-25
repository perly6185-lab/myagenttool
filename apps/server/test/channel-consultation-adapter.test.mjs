import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createChannelConsultationAdapter,
  resolveChannelConsultationConfig,
} from "../src/services/channel-consultation-adapter.mjs";

test("consultation config is enabled by default and remains bounded", () => {
  const config = resolveChannelConsultationConfig({
    MYAGENTTOOL_CHANNEL_CONSULTATION_TIMEOUT_MS: "999999",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.timeoutMs, 180_000);
  assert.equal(config.agentId, "agt_codex_cli");
});

test("consultation adapter creates a pre-approved answer-only invocation", () => {
  const state = { device: { unlinkState: "linked" } };
  let captured = null;
  const adapter = createChannelConsultationAdapter({
    config: { enabled: true, providerId: "desktop_bridge", agentId: "agt_codex_cli", timeoutMs: 60_000 },
    state,
    findAgent: (id) => ({ id, status: "ready" }),
    createInvocation: (prompt, agent, options) => {
      captured = { prompt, agent, options };
      return { id: "inv_consult_1", status: "queued", options };
    },
    now: () => "2026-08-16T00:00:00.000Z",
  });

  const invocation = adapter.enqueue({
    text: "为什么发布会失败？",
    channelId: "ch_1",
    conversationId: "cv_1",
    eventId: "ce_1",
    history: [{ content: "刚刚发布了一次", receivedAt: "2026-08-16T00:00:00.000Z" }],
  });

  assert.equal(invocation.id, "inv_consult_1");
  assert.equal(captured.agent.id, "agt_codex_cli");
  assert.equal(captured.options.preApproved, true);
  assert.equal(captured.options.approvalMode, "auto");
  assert.equal(captured.options.metadata.channelConsultation, true);
  assert.deepEqual(captured.options.metadata.channel, {
    channelId: "ch_1",
    conversationId: "cv_1",
    eventId: "ce_1",
  });
  assert.match(captured.prompt, /只回答用户的问题/);
  assert.match(captured.prompt, /为什么发布会失败/);
  assert.match(captured.prompt, /刚刚发布了一次/);
});

test("consultation adapter fails closed when the local Bridge is unavailable", () => {
  const adapter = createChannelConsultationAdapter({
    config: { enabled: true, providerId: "desktop_bridge", agentId: "agt_codex_cli", timeoutMs: 60_000 },
    state: { device: { unlinkState: "unlinked" } },
    findAgent: () => ({ id: "agt_codex_cli", status: "ready" }),
    createInvocation: () => { throw new Error("must not create"); },
  });

  assert.throws(() => adapter.enqueue({ text: "你好", eventId: "ce_2" }), /bridge_unavailable/);
});

test("a consultation retry gets a distinct idempotency key and durable retry metadata", () => {
  let captured = null;
  const adapter = createChannelConsultationAdapter({
    config: { enabled: true, providerId: "desktop_bridge", agentId: "agt_codex_cli", timeoutMs: 60_000 },
    state: { device: { unlinkState: "linked" }, invocations: [] },
    findAgent: (id) => ({ id, status: "ready" }),
    createInvocation: (_prompt, _agent, options) => {
      captured = options;
      return { id: "inv_consult_retry", status: "queued", options };
    },
  });

  adapter.enqueue({
    text: "重新分析资料",
    eventId: "ce_retry",
    attempt: 2,
    retryReason: "answer_missing",
    retryOfInvocationId: "inv_consult_first",
  });

  assert.equal(captured.idempotencyKey, "channel-consultation:ce_retry:attempt:2");
  assert.equal(captured.metadata.channelConsultationAttempt, 2);
  assert.equal(captured.metadata.channelConsultationRetryReason, "answer_missing");
  assert.equal(captured.metadata.channelConsultationRetryOfInvocationId, "inv_consult_first");
});
