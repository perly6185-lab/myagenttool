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
  const ignored = harness.service.notifyInvocationCompleted({ id: "inv_x", status: "succeeded", options: { metadata: {} } });
  assert.equal(ignored, null);

  const queued = harness.service.notifyInvocationCompleted({
    id: "inv_1",
    status: "succeeded",
    result: { summary: "clean tree" },
    options: { metadata: { channel: { channelId: harness.channelId, conversationId: harness.conversationId, eventId: "chev_x" } } },
  });
  assert.equal(queued.ok, true);
  const delivery = harness.state.channelDeliveries.at(-1);
  assert.equal(delivery.invocationId, "inv_1");
  assert.match(delivery.content, /inv_1: succeeded/);
  assert.match(delivery.content, /clean tree/);
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
