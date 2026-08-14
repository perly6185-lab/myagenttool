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

  const { processed } = await harness.service.sweepChannelDeliveries();
  assert.equal(processed, 1);
  const delivery = harness.state.channelDeliveries.at(-1);
  assert.equal(delivery.status, "delivered");
  assert.equal(delivery.providerReceiptId, "wx_msg_1");
  assert.equal(delivery.toUser, "wx_alice");
  assert.equal(harness.events.at(-1).type, "channel_delivery_recorded");
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
  assert.match(delivery.content, /Task task-1: completed/);
  assert.match(delivery.content, /clean tree/);
  assert.match(delivery.content, /Trace: task-1/);
  assert.equal(delivery.mediaAssets[0].projectId, "prj_media");
  assert.equal(delivery.mediaAssets[0].path, "result.pdf");
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
