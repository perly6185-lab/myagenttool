/*
 * S5 (#1090): outbound delivery — the WeCom client's token cache and errcode
 * handling (fake transport, every branch), and the delivery service's durable
 * retry/terminal lifecycle with evidence and refuse()-recorded exhaustion.
 */

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { createWecomClient } from "../src/gateway/wecom-client.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import {
  MAX_DELIVERY_ATTEMPTS,
  backoffMs,
  createChannelDeliveryService,
} from "../src/services/channel-delivery.mjs";
import { createChannelService } from "../src/services/channels.mjs";

const SECRET = "corp-secret-value-must-never-leak";
const owner = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

function makeClient({ responses }) {
  const calls = [];
  let clock = 1_800_000_000_000;
  const client = createWecomClient({
    corpId: "ww_corp",
    corpSecret: SECRET,
    agentId: "1000002",
    now: () => clock,
    httpJson: async (url, options) => {
      calls.push({ url, options });
      const next = responses.shift();
      if (typeof next === "function") return next({ url, options });
      return next;
    },
  });
  return { client, calls, advance: (ms) => { clock += ms; } };
}

test("wecom client caches the access token, single-flights refresh, and refreshes on expiry", async () => {
  const { client, calls, advance } = makeClient({
    responses: [
      { errcode: 0, access_token: "tokenA", expires_in: 7200 },
      { errcode: 0, errmsg: "ok", msgid: "m1" },
      { errcode: 0, errmsg: "ok", msgid: "m2" },
      { errcode: 0, access_token: "tokenB", expires_in: 7200 },
      { errcode: 0, errmsg: "ok", msgid: "m3" },
    ],
  });
  const [first, second] = await Promise.all([
    client.sendApplicationMessage({ toUser: "u", content: "one" }),
    client.sendApplicationMessage({ toUser: "u", content: "two" }),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  // One gettoken for two concurrent sends (single-flight), then one send each.
  assert.equal(calls.filter((c) => c.url.includes("gettoken")).length, 1);

  advance(7200 * 1000);
  const third = await client.sendApplicationMessage({ toUser: "u", content: "three" });
  assert.equal(third.msgid, "m3");
  assert.equal(calls.filter((c) => c.url.includes("gettoken")).length, 2);
});

test("wecom client: expired token (42001) refreshes and retries exactly once; rate limit is retryable; unknown is terminal", async () => {
  const { client, calls } = makeClient({
    responses: [
      { errcode: 0, access_token: "stale", expires_in: 7200 },
      { errcode: 42001, errmsg: "expired" },
      { errcode: 0, access_token: "fresh", expires_in: 7200 },
      { errcode: 0, errmsg: "ok", msgid: "m-retried" },
      { errcode: 45009, errmsg: "rate limit" },
      { errcode: 81013, errmsg: "user not in scope" },
    ],
  });
  const retried = await client.sendApplicationMessage({ toUser: "u", content: "x" });
  assert.deepEqual(retried, { ok: true, msgid: "m-retried" });
  assert.equal(calls.filter((c) => c.url.includes("gettoken")).length, 2);

  const rateLimited = await client.sendApplicationMessage({ toUser: "u", content: "x" });
  assert.equal(rateLimited.ok, false);
  assert.equal(rateLimited.retryable, true);
  assert.equal(rateLimited.errcode, 45009);

  const terminal = await client.sendApplicationMessage({ toUser: "u", content: "x" });
  assert.equal(terminal.ok, false);
  assert.equal(terminal.retryable, false);
});

test("wecom client truncates content by UTF-8 BYTES (2048), not chars — a long Chinese message stays deliverable", async () => {
  const { client, calls } = makeClient({ responses: [{ errcode: 0, access_token: "T", expires_in: 7200 }, { errcode: 0, msgid: "m1" }] });
  const chinese = "报".repeat(1000); // 1000 chars = 3000 UTF-8 bytes (> 2048)
  const r = await client.sendApplicationMessage({ toUser: "u", content: chinese });
  assert.equal(r.ok, true);
  const sentContent = calls.at(-1).options.body.text.content;
  assert.ok(Buffer.byteLength(sentContent, "utf8") <= 2048, "payload must fit WeCom's 2048-byte cap");
  assert.ok(sentContent.length < chinese.length, "was truncated");
  // Truncation is on a code-point boundary — no broken half-characters.
  assert.equal(sentContent, "报".repeat(Math.floor(2048 / 3)));
});

function makeDeliveryHarness({ sendMessage } = {}) {
  let clockMs = 1_800_000_000_000;
  const { state } = createServerState({ defaultProjectPath: tmpdir(), now: () => new Date(clockMs).toISOString() });
  const events = [];
  const refusals = [];
  let counter = 0;
  const nextId = (prefix) => `${prefix}_${String(++counter).padStart(4, "0")}`;
  const now = () => new Date(clockMs).toISOString();
  const channelService = createChannelService({
    state, now, nextId,
    appendEvent: (event) => events.push(event),
    validateApprovalToken: () => ({ approved: true }),
  });
  const sent = [];
  const service = createChannelDeliveryService({
    state, now, nextId,
    appendEvent: (event) => events.push(event),
    refuse: (refusal) => {
      refusals.push(refusal);
      if (refusal.event) events.push(refusal.event);
    },
    sendMessage: sendMessage ?? (async (args) => {
      sent.push(args);
      return { ok: true, msgid: `wx_msg_${sent.length}` };
    }),
  });

  const { body } = channelService.registerChannel({ provider: "wecom", name: "ops" }, owner);
  const channelId = body.channel.id;
  channelService.enableChannel({ channelId, approvalToken: "ok" }, owner);
  const imported = channelService.importChannelEvent({
    channelId, providerMessageId: "70001", externalUserId: "wx_alice", content: "/status",
  });

  return {
    state, events, refusals, sent, service, channelId,
    conversationId: imported.conversationId,
    advance: (ms) => { clockMs += ms; },
  };
}

test("a queued delivery sends, records the provider receipt, and leaves evidence", async () => {
  const harness = makeDeliveryHarness();
  const queued = harness.service.enqueueChannelDelivery({
    channelId: harness.channelId, conversationId: harness.conversationId, content: "inv_0001: succeeded",
  });
  assert.equal(queued.ok, true);
  harness.state.channelNotificationLog.push({ id: "cnl_delivery", deliveryId: queued.deliveryId, deliveryStatus: "queued" });

  const { processed } = await harness.service.sweepChannelDeliveries();
  assert.equal(processed, 1);
  const delivery = harness.state.channelDeliveries.at(-1);
  assert.equal(delivery.status, "delivered");
  assert.equal(delivery.providerReceiptId, "wx_msg_1");
  assert.equal(delivery.toUser, "wx_alice");
  assert.equal(harness.events.at(-1).type, "channel_delivery_recorded");
  assert.equal(harness.state.channelNotificationLog[0].deliveryStatus, "delivered");
  assert.ok(harness.state.channelNotificationLog[0].deliveredAt);
});

test("a disabled channel pauses outbound delivery and resumes after re-enable", async () => {
  const harness = makeDeliveryHarness();
  harness.state.channels.find((channel) => channel.id === harness.channelId).status = "disabled";
  const queued = harness.service.enqueueChannelDelivery({
    channelId: harness.channelId, conversationId: harness.conversationId, content: "wait for reconnect",
  });
  assert.equal(queued.ok, true);
  assert.equal((await harness.service.sweepChannelDeliveries()).processed, 0);
  assert.equal(harness.state.channelDeliveries.at(-1).status, "queued");
  assert.equal(harness.sent.length, 0);

  harness.state.channels.find((channel) => channel.id === harness.channelId).status = "enabled";
  assert.equal((await harness.service.sweepChannelDeliveries()).processed, 1);
  assert.equal(harness.state.channelDeliveries.at(-1).status, "delivered");
});

test("delivery sender receives the durable delivery id for provider deduplication", async () => {
  const harness = makeDeliveryHarness();
  let sentArgs;
  const service = createChannelDeliveryService({
    state: harness.state,
    now: () => new Date(1_800_000_000_000).toISOString(),
    nextId: (prefix) => prefix + "_stable",
    appendEvent: () => {},
    sendMessage: async (args) => {
      sentArgs = args;
      return { ok: true, msgid: "stable_receipt" };
    },
  });
  service.enqueueChannelDelivery({
    channelId: harness.channelId,
    conversationId: harness.conversationId,
    content: "dedupe me",
  });
  await service.sweepChannelDeliveries();
  assert.equal(sentArgs.deliveryId, "chdl_stable");
});

test("a media-only delivery preserves bounded asset references and passes them to the provider", async () => {
  const harness = makeDeliveryHarness();
  const queued = harness.service.enqueueChannelDelivery({
    channelId: harness.channelId,
    conversationId: harness.conversationId,
    mediaAssets: [{ projectId: "prj_media", terminalId: "term_1", path: "deliveries/result.png", family: "image", size: 12, hash: "sha256:abc" }],
  });
  assert.equal(queued.ok, true);
  assert.equal(harness.state.channelDeliveries.at(-1).content, "");
  assert.equal(harness.state.channelDeliveries.at(-1).mediaAssets[0].hash, "sha256:abc");
  await harness.service.sweepChannelDeliveries();
  assert.equal(harness.sent[0].mediaAssets[0].path, "deliveries/result.png");
});

test("delivery preserves bounded task and trace correlation without attachment payloads", () => {
  const harness = makeDeliveryHarness();
  const queued = harness.service.enqueueChannelDelivery({
    channelId: harness.channelId,
    conversationId: harness.conversationId,
    content: "done",
    taskContext: {
      channelId: harness.channelId,
      conversationId: harness.conversationId,
      messageId: "event-1",
      principalId: "user-1",
      terminalId: "terminal-1",
      projectId: "project-1",
      workItemId: "task-1",
      traceId: "trace-1",
      attachmentAssets: [{ secret: "must-not-copy" }],
    },
  });
  const delivery = harness.state.channelDeliveries.find((candidate) => candidate.id === queued.deliveryId);
  assert.equal(delivery.taskContext.traceId, "trace-1");
  assert.equal(delivery.taskContext.terminalId, "terminal-1");
  assert.equal(JSON.stringify(delivery).includes("must-not-copy"), false);
});

test("task thread keeps delivery failure state and can resend the latest result", async () => {
  const harness = makeDeliveryHarness({ sendMessage: async () => ({ ok: false, retryable: false, errcode: "user_not_found" }) });
  const conversation = harness.state.channelConversations.find((row) => row.id === harness.conversationId);
  harness.state.channelTaskThreads.push({
    id: "cth_delivery", channelId: harness.channelId, conversationId: conversation.id,
    status: "succeeded", summary: "已完成", workItemId: "wi_delivery",
  });
  const original = harness.service.enqueueChannelDelivery({
    channelId: harness.channelId,
    conversationId: harness.conversationId,
    invocationId: "inv_delivery",
    content: "任务已完成\n结果内容",
    taskContext: { channelId: harness.channelId, conversationId: harness.conversationId, threadId: "cth_delivery", workItemId: "wi_delivery", deliveryKind: "result" },
  });
  await harness.service.sweepChannelDeliveries();
  const thread = harness.state.channelTaskThreads[0];
  assert.equal(harness.state.channelDeliveries.find((row) => row.id === original.deliveryId).status, "failed_terminal");
  assert.equal(thread.lastDeliveryStatus, "failed_terminal");
  assert.equal(thread.nextAction, "在控制台重试消息投递");

  const resent = harness.service.resendChannelDelivery({ channelId: harness.channelId, conversationId: harness.conversationId, threadId: "cth_delivery" });
  assert.equal(resent.ok, true);
  assert.equal(harness.state.channelDeliveries.at(-1).status, "queued");
  assert.equal(harness.state.channelDeliveries.at(-1).content, "任务已完成\n结果内容");
});

test("exported channel result can be resent even when its original delivery row is absent", () => {
  const harness = makeDeliveryHarness();
  const conversation = harness.state.channelConversations.find((candidate) => candidate.id === harness.conversationId);
  const asset = {
    id: "asset_channel_result",
    projectId: harness.state.channels.find((candidate) => candidate.id === harness.channelId).taskProjectId ?? "project-local",
    path: "channel-results/result.csv",
    name: "result.csv",
    family: "text",
    mimeType: "text/csv",
    size: 32,
    hash: "sha256:" + "a".repeat(64),
  };
  harness.state.channelTaskThreads.push({
    id: "cth_exported", channelId: harness.channelId, conversationId: conversation.id,
    status: "succeeded", summary: "查询订单", workItemId: "wi_exported",
    resultSummary: "已生成查询结果：result.csv", exportedAsset: asset,
  });
  const resent = harness.service.resendChannelDelivery({ channelId: harness.channelId, conversationId: harness.conversationId, threadId: "cth_exported" });
  assert.equal(resent.ok, true);
  assert.equal(harness.state.channelDeliveries.at(-1).mediaAssets[0].id, asset.id);
  assert.equal(harness.state.channelDeliveries.at(-1).mediaAssets[0].path, asset.path);
});

test("delivery recovery rebuilds the task snapshot after restart", () => {
  const harness = makeDeliveryHarness();
  harness.state.channelTaskThreads.push({
    id: "cth_restart_delivery", channelId: harness.channelId, conversationId: harness.conversationId,
    status: "succeeded", summary: "已完成", nextAction: "查看任务结果",
  });
  harness.state.channelDeliveries.push({
    id: "cdl_restart_delivery", channelId: harness.channelId, conversationId: harness.conversationId,
    status: "failed_terminal", attempts: 5, lastErrorCode: "network_error", content: "任务结果",
    mediaAssets: [], createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:01.000Z",
    taskContext: { channelId: harness.channelId, conversationId: harness.conversationId, threadId: "cth_restart_delivery", workItemId: "wi_restart", deliveryKind: "result" },
  });
  const restarted = createChannelDeliveryService({
    state: harness.state, now: () => "2026-08-14T00:00:02.000Z", nextId: () => "unused",
    appendEvent: () => {}, sendMessage: async () => ({ ok: true }),
  });
  assert.deepEqual(restarted.recoverThreadDeliveryState(), { recovered: 1 });
  assert.equal(harness.state.channelTaskThreads[0].lastDeliveryStatus, "failed_terminal");
  assert.equal(harness.state.channelTaskThreads[0].lastDeliveryError, "network_error");
  assert.equal(harness.state.channelTaskThreads[0].nextAction, "在控制台重试消息投递");
});

test("a delivered status notification never masquerades as a delivered task result", async () => {
  const harness = makeDeliveryHarness({ sendMessage: async () => ({ ok: true }) });
  harness.state.channelTaskThreads.push({
    id: "cth_status_notice", channelId: harness.channelId, conversationId: harness.conversationId,
    status: "queued", summary: "排队任务", lastProgressSummary: "任务仍在排队",
  });
  harness.service.enqueueChannelDelivery({
    channelId: harness.channelId,
    conversationId: harness.conversationId,
    content: "任务暂时没有新进展",
    taskContext: {
      channelId: harness.channelId,
      conversationId: harness.conversationId,
      threadId: "cth_status_notice",
      notificationEvent: "needs_attention",
      deliveryKind: "status_notification",
    },
  });
  await harness.service.sweepChannelDeliveries();
  const thread = harness.state.channelTaskThreads[0];
  assert.equal(thread.lastDeliveryStatus, "delivered");
  assert.equal(thread.lastProgressSummary, "任务仍在排队");
});

test("retryable failures back off and exhaust into failed_terminal with an undeliverable refusal", async () => {
  const harness = makeDeliveryHarness({
    sendMessage: async () => ({ ok: false, retryable: true, errcode: 45009 }),
  });
  harness.service.enqueueChannelDelivery({
    channelId: harness.channelId, conversationId: harness.conversationId, content: "hello",
  });

  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    await harness.service.sweepChannelDeliveries();
    harness.advance(backoffMs(attempt, { rateLimited: true }) + 1000);
  }
  const delivery = harness.state.channelDeliveries.at(-1);
  assert.equal(delivery.status, "failed_terminal");
  assert.equal(delivery.attempts, MAX_DELIVERY_ATTEMPTS);
  assert.equal(delivery.lastErrorCode, "45009");
  const refusal = harness.refusals.at(-1);
  assert.equal(refusal.category, "state");
  assert.equal(refusal.code, "undeliverable");
  assert.equal(harness.events.at(-1).type, "channel_delivery_failed");

  // Terminal rows never re-enter the sweep.
  const { processed } = await harness.service.sweepChannelDeliveries();
  assert.equal(processed, 0);
});

test("a delivery stranded in 'sending' by a crash is reaped back to retrying and re-sent", async () => {
  const harness = makeDeliveryHarness();
  harness.service.enqueueChannelDelivery({ channelId: harness.channelId, conversationId: harness.conversationId, content: "hi" });
  const row = harness.state.channelDeliveries.at(-1);
  // Simulate a process that died mid-send: durably claimed "sending", never committed an outcome.
  row.status = "sending";
  row.updatedAt = harness.state ? new Date(1_800_000_000_000).toISOString() : row.updatedAt;
  harness.advance(3 * 60 * 1000); // past STALE_SENDING_MS
  const { processed } = await harness.service.sweepChannelDeliveries();
  assert.equal(processed, 1, "reaped row is re-processed");
  assert.equal(row.status, "delivered");
  assert.equal(harness.sent.length, 1, "the stranded message is actually re-sent");
});

test("inbound event content is capped in length (flood bound)", () => {
  const { state } = createServerState({ defaultProjectPath: tmpdir(), now: () => new Date(1_800_000_000_000).toISOString() });
  let n = 0;
  const svc = createChannelService({
    state, now: () => new Date(1_800_000_000_000).toISOString(), nextId: (p) => `${p}_${++n}`,
    appendEvent: () => {}, validateApprovalToken: () => ({ approved: true }),
  });
  const { body } = svc.registerChannel({ provider: "wecom", name: "ops" }, owner);
  svc.enableChannel({ channelId: body.channel.id, approvalToken: "ok" }, owner);
  svc.importChannelEvent({ channelId: body.channel.id, providerMessageId: "m1", externalUserId: "wx_a", content: "x".repeat(10_000) });
  const event = state.channelEvents.at(-1);
  assert.equal(event.content.length, 4000, "content is capped at MAX_EVENT_CONTENT_CHARS");
});

test("a delivery scheduled for later is not due until its backoff elapses; non-retryable fails immediately", async () => {
  let failFirst = true;
  const harness = makeDeliveryHarness({
    sendMessage: async () => {
      if (failFirst) {
        failFirst = false;
        return { ok: false, retryable: true, errcode: -1 };
      }
      return { ok: true, msgid: "wx_ok" };
    },
  });
  harness.service.enqueueChannelDelivery({
    channelId: harness.channelId, conversationId: harness.conversationId, content: "x",
  });
  await harness.service.sweepChannelDeliveries();
  assert.equal(harness.state.channelDeliveries.at(-1).status, "retrying");

  // Not due yet: sweep is a no-op.
  const early = await harness.service.sweepChannelDeliveries();
  assert.equal(early.processed, 0);

  harness.advance(backoffMs(1) + 1000);
  await harness.service.sweepChannelDeliveries();
  assert.equal(harness.state.channelDeliveries.at(-1).status, "delivered");

  const terminalHarness = makeDeliveryHarness({
    sendMessage: async () => ({ ok: false, retryable: false, errcode: 81013 }),
  });
  terminalHarness.service.enqueueChannelDelivery({
    channelId: terminalHarness.channelId, conversationId: terminalHarness.conversationId, content: "x",
  });
  await terminalHarness.service.sweepChannelDeliveries();
  assert.equal(terminalHarness.state.channelDeliveries.at(-1).status, "failed_terminal");
  assert.equal(terminalHarness.state.channelDeliveries.at(-1).attempts, 1);
});

test("notifyInvocationCompleted queues a result message only for channel-originated invocations", () => {
  const harness = makeDeliveryHarness();
  harness.state.workItems.push({ id: "task-1", projectId: "prj_media", outputAssets: [{ id: "asset-1", path: "result.pdf", family: "pdf", size: 20 }] });
  const ignored = harness.service.notifyInvocationCompleted({ id: "inv_x", status: "succeeded", options: { metadata: {} } });
  assert.equal(ignored, null);

  const queued = harness.service.notifyInvocationCompleted({
    id: "inv_1",
    status: "succeeded",
    result: { summary: "clean tree" },
    options: { metadata: { channel: {
      channelId: harness.channelId, conversationId: harness.conversationId,
      messageId: "chev_x", workItemId: "task-1", traceId: "task-1",
    } } },
  });
  assert.equal(queued.ok, true);
  const delivery = harness.state.channelDeliveries.at(-1);
  assert.equal(delivery.invocationId, "inv_1");
  assert.match(delivery.content, /任务已完成/);
  assert.match(delivery.content, /clean tree/);
  assert.doesNotMatch(delivery.content, /task-1|Trace:/);
  assert.equal(delivery.mediaAssets[0].projectId, "prj_media");
  assert.equal(delivery.mediaAssets[0].path, "result.pdf");
});

test("restart reconciliation re-enqueues a terminal task result when the completion row was missing", () => {
  const harness = makeDeliveryHarness();
  const thread = {
    id: "cth_restart_done",
    channelId: harness.channelId,
    conversationId: harness.conversationId,
    status: "succeeded",
    summary: "重启恢复任务",
    lastNotificationKey: null,
  };
  const invocation = {
    id: "inv_restart_done",
    status: "succeeded",
    result: { summary: "已完成" },
    options: { metadata: { channel: { channelId: harness.channelId, conversationId: harness.conversationId, threadId: thread.id } } },
  };
  harness.state.channelTaskThreads.push(thread);
  harness.state.invocations.push(invocation);
  const first = harness.service.recoverCompletedNotifications();
  assert.deepEqual(first, { checked: 1, queued: 1 });
  assert.equal(harness.state.channelDeliveries.length, 1);
  const second = harness.service.recoverCompletedNotifications();
  assert.deepEqual(second, { checked: 1, queued: 0 });
  assert.equal(harness.state.channelDeliveries.length, 1);
});

test("outbound delivery dedupe keys survive repeated enqueue attempts", () => {
  const harness = makeDeliveryHarness();
  const first = harness.service.enqueueChannelDelivery({
    channelId: harness.channelId,
    conversationId: harness.conversationId,
    content: "咨询答案",
    dedupeKey: "channel-consultation:ce_1:inv_1:answer",
  });
  const second = harness.service.enqueueChannelDelivery({
    channelId: harness.channelId,
    conversationId: harness.conversationId,
    content: "咨询答案",
    dedupeKey: "channel-consultation:ce_1:inv_1:answer",
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.deduplicated, true);
  assert.equal(second.deliveryId, first.deliveryId);
  assert.equal(harness.state.channelDeliveries.length, 1);
  assert.equal(harness.state.channelDeliveries[0].dedupeKey, "channel-consultation:ce_1:inv_1:answer");
});

test("thread notifications are idempotent for the same completed invocation", () => {
  const harness = makeDeliveryHarness();
  harness.state.channelTaskThreads.push({
    id: "cth_1", shortRef: "T-0001", channelId: harness.channelId,
    conversationId: harness.conversationId, workItemId: "task-1", status: "succeeded",
  });
  const invocation = {
    id: "inv_thread", status: "succeeded", result: { summary: "done" },
    options: { metadata: { channel: {
      channelId: harness.channelId, conversationId: harness.conversationId,
      threadId: "cth_1", workItemId: "task-1", traceId: "task-1",
    } } },
  };
  const first = harness.service.notifyInvocationCompleted(invocation);
  const second = harness.service.notifyInvocationCompleted(invocation);
  assert.equal(first.ok, true);
  assert.equal(second, null);
  assert.equal(harness.state.channelDeliveries.length, 1);
  assert.match(harness.state.channelDeliveries[0].content, /任务已完成/);
  assert.doesNotMatch(harness.state.channelDeliveries[0].content, /T-0001/);
});

test("completion delivery prefers the reconciled task result over raw invocation output", () => {
  const harness = makeDeliveryHarness();
  harness.state.channelTaskThreads.push({
    id: "cth_final_summary", channelId: harness.channelId, conversationId: harness.conversationId,
    workItemId: "task-final", status: "waiting_approval", waitingFor: "delivery",
    resultSummary: "结果已通过复核，但尚未应用到原项目。",
  });
  const queued = harness.service.notifyInvocationCompleted({
    id: "inv_final_summary", status: "succeeded", result: { summary: "raw model output" },
    options: { metadata: { autoRunId: "aur_final_summary", channel: {
      channelId: harness.channelId, conversationId: harness.conversationId,
      threadId: "cth_final_summary", workItemId: "task-final",
    } } },
  });
  assert.equal(queued.ok, true);
  const content = harness.state.channelDeliveries.at(-1).content;
  assert.match(content, /尚未应用到原项目/);
  assert.doesNotMatch(content, /raw model output/);
  assert.match(content, /桌面端查看变更/);
});

test("failed notification enqueue releases the dedupe claim for a later retry", () => {
  const harness = makeDeliveryHarness();
  harness.state.channelTaskThreads.push({
    id: "cth_bad", shortRef: "T-BAD", channelId: harness.channelId,
    conversationId: harness.conversationId, status: "succeeded",
  });
  const invocation = {
    id: "inv_bad", status: "succeeded", result: { summary: "done" },
    options: { metadata: { channel: {
      channelId: "ch_missing", conversationId: harness.conversationId,
      threadId: "cth_bad", traceId: "trace_bad",
    } } },
  };
  const first = harness.service.notifyInvocationCompleted(invocation);
  const second = harness.service.notifyInvocationCompleted(invocation);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(harness.state.channelTaskThreads[0].lastNotificationKey, null);
});

test("failed task notification includes a plain-language next step", () => {
  const harness = makeDeliveryHarness();
  harness.state.channelTaskThreads.push({
    id: "cth_failed", shortRef: "T-FAIL", channelId: harness.channelId,
    conversationId: harness.conversationId, status: "failed",
  });
  const queued = harness.service.notifyInvocationCompleted({
    id: "inv_failed", status: "failed", result: { summary: "执行遇到错误" },
    options: { metadata: { channel: {
      channelId: harness.channelId, conversationId: harness.conversationId,
      threadId: "cth_failed", traceId: "trace_failed",
    } } },
  });
  assert.equal(queued.ok, true);
  assert.match(harness.state.channelDeliveries.at(-1).content, /回复“重试”/);
  assert.match(harness.state.channelDeliveries.at(-1).content, /回复“转人工”/);
  assert.doesNotMatch(harness.state.channelDeliveries.at(-1).content, /T-FAIL|Trace:/);
});

test("no secret or token material ever lands in state, events, or refusals", async () => {
  const harness = makeDeliveryHarness({
    sendMessage: async () => ({ ok: false, retryable: false, errcode: 81013 }),
  });
  harness.service.enqueueChannelDelivery({
    channelId: harness.channelId, conversationId: harness.conversationId, content: "x",
  });
  await harness.service.sweepChannelDeliveries();
  for (const surface of [harness.state, harness.events, harness.refusals]) {
    assert.ok(!JSON.stringify(surface).includes(SECRET));
    assert.ok(!JSON.stringify(surface).includes("access_token"));
  }
});

test("#1110: resolveSender routes each delivery to its channel's provider client", async () => {
  const clockMs = 1_800_000_000_000;
  const now = () => new Date(clockMs).toISOString();
  const { state } = createServerState({ defaultProjectPath: tmpdir(), now });
  let counter = 0;
  const nextId = (p) => `${p}_${String(++counter).padStart(4, "0")}`;
  const owner = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };
  const channels = createChannelService({ state, now, nextId, appendEvent: () => {}, validateApprovalToken: () => ({ approved: true }) });

  const wecom = channels.registerChannel({ provider: "wecom", name: "w" }, owner).body.channel.id;
  const feishu = channels.registerChannel({ provider: "feishu", name: "f" }, owner).body.channel.id;
  channels.enableChannel({ channelId: wecom, approvalToken: "ok" }, owner);
  channels.enableChannel({ channelId: feishu, approvalToken: "ok" }, owner);
  const wImp = channels.importChannelEvent({ channelId: wecom, providerMessageId: "w1", externalUserId: "wx", content: "/status" });
  const fImp = channels.importChannelEvent({ channelId: feishu, providerMessageId: "f1", externalUserId: "ou_1", content: "/status" });

  const seen = { wecom: 0, feishu: 0 };
  const service = createChannelDeliveryService({
    state, now, nextId, appendEvent: () => {},
    resolveSender: (provider) => async () => {
      seen[provider] += 1;
      return { ok: true, msgid: `${provider}_msg` };
    },
  });
  service.enqueueChannelDelivery({ channelId: wecom, conversationId: wImp.conversationId, content: "to-wecom" });
  service.enqueueChannelDelivery({ channelId: feishu, conversationId: fImp.conversationId, content: "to-feishu" });
  await service.sweepChannelDeliveries();

  assert.equal(seen.wecom, 1, "wecom delivery used the wecom sender");
  assert.equal(seen.feishu, 1, "feishu delivery used the feishu sender");
  const receipts = state.channelDeliveries.map((d) => d.providerReceiptId).sort();
  assert.deepEqual(receipts, ["feishu_msg", "wecom_msg"]);
});

test("#1135: a delivery carries the conversation's replyContext to the sender", async () => {
  const clockMs = 1_800_000_000_000;
  const now = () => new Date(clockMs).toISOString();
  const { state } = createServerState({ defaultProjectPath: tmpdir(), now });
  let counter = 0;
  const nextId = (p) => `${p}_${String(++counter).padStart(4, "0")}`;
  const owner = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };
  const channels = createChannelService({ state, now, nextId, appendEvent: () => {}, validateApprovalToken: () => ({ approved: true }) });
  const cid = channels.registerChannel({ provider: "teams", name: "t" }, owner).body.channel.id;
  channels.enableChannel({ channelId: cid, approvalToken: "ok" }, owner);
  const rc = { serviceUrl: "https://smba.example/", conversationId: "conv_1" };
  const imp = channels.importChannelEvent({ channelId: cid, providerMessageId: "act_1", externalUserId: "29:u", content: "/status", replyContext: rc });

  let seenReplyContext = null;
  const svc = createChannelDeliveryService({
    state, now, nextId, appendEvent: () => {},
    resolveSender: () => async ({ replyContext }) => { seenReplyContext = replyContext; return { ok: true, msgid: "m" }; },
  });
  svc.enqueueChannelDelivery({ channelId: cid, conversationId: imp.conversationId, content: "hi" });
  await svc.sweepChannelDeliveries();
  assert.deepEqual(seenReplyContext, rc, "the sender receives the conversation's replyContext");
});
