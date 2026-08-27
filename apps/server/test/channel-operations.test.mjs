/*
 * S7 (#1090): the channel operations read-model rollup and the approval-gated,
 * owner-scoped failed-delivery retry lever.
 */

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { channelOperations, channelTaskOperations } from "../src/read-models/channels.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createChannelDeliveryService } from "../src/services/channel-delivery.mjs";
import { createChannelService } from "../src/services/channels.mjs";

const owner = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };
const foreign = { userId: "usr_b", teamId: "team_b", role: "owner", authenticated: true };

test("channelOperations rolls up readiness, health, counts, and last activity", () => {
  const rows = channelOperations({
    channels: [
      { id: "chn_1", provider: "wecom", name: "ops", status: "enabled", ownerTeamId: "team_local", readiness: { callback_token: true, encoding_aes_key: true, corp_secret: true }, capabilityAllowlist: ["git.status"] },
      { id: "chn_2", provider: "wecom", name: "idle", status: "registered", readiness: { callback_token: false } },
      { id: "chn_3", provider: "wecom", name: "sick", status: "enabled", readiness: { callback_token: true, encoding_aes_key: false, corp_secret: true } },
    ],
    channelIdentities: [{ channelId: "chn_1" }],
    channelEvents: [
      {
        id: "chev_link", channelId: "chn_1", receivedAt: "2026-07-15T00:00:00.000Z", injectionSuspicious: true,
        sharedContentStatus: "ready", sharedContentUrls: ["https://example.com/private/article"],
        sharedContentDetectedAt: "2026-07-15T00:00:00.000Z", sharedContentCompletedAt: "2026-07-15T00:00:01.000Z",
        sharedContentActiveTaskCount: 1, replyDeliveryId: "chdl_link_final",
      },
      {
        id: "chev_link_route", channelId: "chn_1", receivedAt: "2026-07-15T00:30:00.000Z",
        sharedContentRoute: {
          sourceEventId: "chev_link", target: "current_task_follow_up", status: "queued",
          reason: "confirmed_route_choice", activeTaskCount: 1, decidedAt: "2026-07-15T00:30:00.000Z",
        },
      },
      { channelId: "chn_1", receivedAt: "2026-07-15T01:00:00.000Z" },
    ],
    channelConversations: [{ channelId: "chn_1" }],
    channelDeliveries: [
      { id: "chdl_link_ack", channelId: "chn_1", status: "delivered", updatedAt: "2026-07-15T02:00:00.000Z", dedupeKey: "channel-shared-content:chev_link:reading" },
      { channelId: "chn_1", status: "failed_terminal", updatedAt: "2026-07-15T03:00:00.000Z" },
      { id: "chdl_link_final", channelId: "chn_1", status: "delivered", updatedAt: "2026-07-15T02:01:00.000Z" },
    ],
    channelTaskThreads: [
      { channelId: "chn_1", status: "queued", createdAt: "2026-07-15T04:00:00.000Z" },
      { channelId: "chn_1", status: "waiting_user", updatedAt: "2026-07-15T05:00:00.000Z", lastActivityAt: "2026-07-15T05:00:00.000Z" },
      { channelId: "chn_1", status: "failed", updatedAt: "2026-07-15T06:00:00.000Z" },
      { channelId: "chn_1", workKind: "knowledge_capture", status: "running", updatedAt: "2026-07-15T07:00:00.000Z" },
    ],
  });

  const ops = rows.find((r) => r.id === "chn_1");
  assert.equal(ops.ready, true);
  assert.equal(ops.health, "attention"); // enabled + a terminal failure
  assert.equal(ops.counts.identities, 1);
  assert.equal(ops.counts.events, 3);
  assert.equal(ops.counts.failedDeliveries, 1);
  assert.equal(ops.counts.injectionFlagged, 1);
  assert.equal(ops.lastActivityAt, "2026-07-15T06:00:00.000Z");
  assert.equal(ops.lastInboundAt, "2026-07-15T01:00:00.000Z");
  assert.equal(ops.lastOutboundAt, "2026-07-15T03:00:00.000Z");
  assert.equal(ops.lastDeliveredAt, "2026-07-15T02:01:00.000Z");
  assert.equal(ops.lastFailureAt, "2026-07-15T03:00:00.000Z");
  assert.deepEqual(ops.pipeline, { inbound: {}, outbound: { delivered: 2, failed_terminal: 1 } });
  assert.equal(ops.recentLinks[0].status, "ready");
  assert.deepEqual(ops.recentLinks[0].hosts, ["example.com"]);
  assert.equal(ops.recentLinks[0].acknowledgement.status, "delivered");
  assert.equal(ops.recentLinks[0].finalReply.status, "delivered");
  assert.equal(ops.recentLinks[0].activeTaskCount, 1);
  assert.deepEqual(ops.recentLinks[0].route, {
    target: "current_task_follow_up",
    status: "queued",
    reason: "confirmed_route_choice",
    activeTaskCount: 1,
    decidedAt: "2026-07-15T00:30:00.000Z",
  });
  assert.deepEqual(ops.taskSummary, {
    total: 3,
    active: 2,
    queued: 1,
    running: 0,
    waitingUpstream: 0,
    waitingApproval: 0,
    waitingUser: 1,
    needsAttention: 0,
    humanTakeover: 0,
    succeeded: 0,
    failed: 1,
    cancelled: 0,
  });

  assert.equal(rows.find((r) => r.id === "chn_2").health, "idle"); // not enabled
  assert.equal(rows.find((r) => r.id === "chn_3").health, "attention"); // enabled but not ready
});

test("channelOperations can use runtime readiness instead of stale state fields", () => {
  const rows = channelOperations({
    channels: [{ id: "chn_ilink", provider: "wechat_ilink", status: "enabled" }],
    readinessForChannel: () => ({ account: true, session: true, worker: true }),
  });
  assert.deepEqual(rows[0].readiness, { account: true, session: true, worker: true });
  assert.equal(rows[0].ready, true);
  assert.equal(rows[0].health, "ok");
});

test("channelOperations exposes delayed iLink visibility as actionable delivery health", () => {
  const rows = channelOperations({
    channels: [{ id: "chn_ilink", provider: "wechat_ilink", status: "enabled" }],
    channelDeliveries: [{
      id: "cdl_unconfirmed", channelId: "chn_ilink", status: "sent_unconfirmed",
      providerAcceptedAt: "2026-08-25T08:00:00.000Z", nextManualRetryAt: "2026-08-25T08:10:00.000Z",
      taskContext: { threadId: "thread_1", deliveryKind: "result" },
    }],
    readinessForChannel: () => ({ account: true, session: true, worker: true }),
    now: () => "2026-08-25T08:02:00.000Z",
  });

  assert.equal(rows[0].health, "attention");
  assert.equal(rows[0].counts.unconfirmedDeliveries, 1);
  assert.deepEqual(rows[0].deliveryHealth, {
    state: "outbound_delayed",
    unconfirmedCount: 1,
    delayedCount: 1,
    latestDeliveryId: "cdl_unconfirmed",
    latestAcceptedAt: "2026-08-25T08:00:00.000Z",
    retryAfter: "2026-08-25T08:10:00.000Z",
  });
});

test("channelOperations does not turn an old unconfirmed chat acknowledgement into a task-result alert", () => {
  const rows = channelOperations({
    channels: [{ id: "chn_ilink", provider: "wechat_ilink", status: "enabled" }],
    channelDeliveries: [{
      id: "cdl_chat", channelId: "chn_ilink", status: "sent_unconfirmed",
      providerAcceptedAt: "2026-08-25T08:00:00.000Z",
      taskContext: { deliveryKind: "status_notification" },
    }],
    readinessForChannel: () => ({ account: true, session: true, worker: true }),
    now: () => "2026-08-25T09:00:00.000Z",
  });

  assert.equal(rows[0].health, "ok");
  assert.equal(rows[0].counts.unconfirmedDeliveries, 1);
  assert.deepEqual(rows[0].deliveryHealth, {
    state: "healthy",
    unconfirmedCount: 0,
    delayedCount: 0,
    latestDeliveryId: null,
    latestAcceptedAt: null,
    retryAfter: null,
  });
});

test("channelOperations exposes only a sanitized iLink runtime summary", () => {
  const rows = channelOperations({
    channels: [{ id: "chn_ilink", provider: "wechat_ilink", status: "enabled" }],
    readinessForChannel: () => ({ account: true, session: true, worker: false }),
    runtimeAccountForChannel: () => ({
      status: "error",
      botId: "bot_1",
      lastPollAt: "2026-08-19T12:00:00.000Z",
      lastMessageAt: "2026-08-19T11:59:00.000Z",
      lastError: "network_error",
      workerFailureCount: 2,
      nextRetryAt: "2026-08-19T12:00:30.000Z",
      botToken: "must-not-leak",
      cursor: "must-not-leak",
    }),
  });
  assert.deepEqual(rows[0].ilinkAccount, {
    status: "error",
    botId: "bot_1",
    lastPollAt: "2026-08-19T12:00:00.000Z",
    lastMessageAt: "2026-08-19T11:59:00.000Z",
    lastError: "network_error",
    pairingStatus: null,
    workerFailureCount: 2,
    nextRetryAt: "2026-08-19T12:00:30.000Z",
    connectedAt: null,
    updatedAt: null,
    pairingExpiresAt: null,
  });
  assert.equal("botToken" in rows[0].ilinkAccount, false);
  assert.equal("cursor" in rows[0].ilinkAccount, false);
});

test("channelTaskOperations joins Issue, auto-run, Invocation, result, delivery, and recovery actions", () => {
  const rows = channelTaskOperations({
    requests: [
      { id: "ctr_pending", channelId: "chn_1", status: "pending", issueNumber: 7, title: "pending" },
      { id: "ctr_failed", channelId: "chn_1", status: "routed", issueNumber: 8, title: "failed", autoRunId: "run_1" },
    ],
    autoRuns: [{ id: "run_1", status: "failed", invocationId: "inv_1", errorCode: "stuck", error: "Agent stopped" }],
    invocations: [{ id: "inv_1", status: "failed", result: { error: "Bridge disconnected" } }],
    deliveries: [{ invocationId: "inv_1", status: "failed_terminal" }],
  });
  assert.equal(rows[0].stage, "awaiting_route");
  assert.deepEqual(rows[0].actions, { retry: false, reroute: false, takeover: false });
  assert.equal(rows[1].stage, "run_failed");
  assert.equal(rows[1].invocationId, "inv_1");
  assert.equal(rows[1].resultSummary, "Bridge disconnected");
  assert.equal(rows[1].deliveryStatus, "failed_terminal");
  assert.deepEqual(rows[1].actions, { retry: true, reroute: true, takeover: true });
});

test("channelTaskOperations exposes safe WeChat draft reconciliation instead of retry", () => {
  const [row] = channelTaskOperations({
    requests: [{ id: "ctr_draft", channelId: "chn_1", status: "routed", issueNumber: 9, title: "保存公众号草稿", invocationId: "inv_draft" }],
    invocations: [{ id: "inv_draft", status: "succeeded", result: { output: JSON.stringify({ status: "unconfirmed", sideEffectState: "unknown", summary: "保存结果不确定" }) } }],
  });
  assert.equal(row.invocationId, "inv_draft");
  assert.equal(row.actions.retry, false);
  assert.equal(row.actions.reconcileSaved, true);
  assert.equal(row.actions.reconcileNotSaved, true);
});

test("channelTaskOperations exposes bounded result verification for ordinary users", () => {
  const [row] = channelTaskOperations({
    requests: [{ id: "ctr_article", channelId: "chn_1", status: "completed", issueNumber: 10, title: "生成文章", workItemId: "wi_article" }],
    workItems: [{
      id: "wi_article",
      taskKind: "content_article",
      artifactContract: {
        requirements: [{ kind: "article_draft", minCount: 1, extensions: [".md"], quality: { minChars: 800, minSections: 3 } }],
      },
      outputAssets: [{ id: "asset_article", path: "outputs/article.md", family: "markdown", size: 10, contentMetrics: { charCount: 1200, sectionCount: 3 } }],
    }],
  });
  assert.equal(row.resultVerification.status, "passed");
  assert.equal(row.resultVerification.checks[0].kind, "article_draft");
  assert.equal(row.resultVerification.checks[0].actual.qualifiedCount, 1);
});

function makeRetryHarness() {
  let clockMs = 1_800_000_000_000;
  const { state } = createServerState({ defaultProjectPath: tmpdir(), now: () => new Date(clockMs).toISOString() });
  const now = () => new Date(clockMs).toISOString();
  const events = [];
  let counter = 0;
  const nextId = (p) => `${p}_${String(++counter).padStart(4, "0")}`;
  const channelService = createChannelService({ state, now, nextId, appendEvent: (e) => events.push(e), validateApprovalToken: () => ({ approved: true }) });
  const delivery = createChannelDeliveryService({
    state, now, nextId, appendEvent: (e) => events.push(e),
    validateApprovalToken: (token) => (token === "ok" ? { approved: true } : { approved: false, reason: token ? "bad" : "missing_token" }),
  });
  const { body } = channelService.registerChannel({ provider: "wecom", name: "ops" }, owner);
  const channelId = body.channel.id;
  channelService.enableChannel({ channelId, approvalToken: "ok" }, owner);
  const imported = channelService.importChannelEvent({ channelId, providerMessageId: "m1", externalUserId: "wx_a", content: "/status" });
  const queued = delivery.enqueueChannelDelivery({ channelId, conversationId: imported.conversationId, content: "hi" });
  const deliveryRecord = state.channelDeliveries.find((d) => d.id === queued.deliveryId);
  return { state, events, channelId, delivery, deliveryRecord, channelService };
}

test("retry: only failed_terminal is eligible; approval-gated; foreign team 404; success re-queues", () => {
  const h = makeRetryHarness();

  // Not failed yet → 409 not retryable.
  assert.equal(h.delivery.retryChannelDelivery({ channelId: h.channelId, deliveryId: h.deliveryRecord.id, approvalToken: "ok" }, owner).status, 409);

  h.deliveryRecord.status = "failed_terminal";
  h.deliveryRecord.attempts = 5;
  h.deliveryRecord.lastErrorCode = "45009";

  // Missing approval → 409 approval_required.
  const noApproval = h.delivery.retryChannelDelivery({ channelId: h.channelId, deliveryId: h.deliveryRecord.id }, owner);
  assert.equal(noApproval.status, 409);
  assert.equal(noApproval.body.error, "approval_required");

  // Foreign team → 404 opaque.
  assert.equal(h.delivery.retryChannelDelivery({ channelId: h.channelId, deliveryId: h.deliveryRecord.id, approvalToken: "ok" }, foreign).status, 404);

  // Owner + approval → re-queued.
  const ok = h.delivery.retryChannelDelivery({ channelId: h.channelId, deliveryId: h.deliveryRecord.id, approvalToken: "ok" }, owner);
  assert.equal(ok.status, 200);
  assert.equal(h.deliveryRecord.status, "queued");
  assert.equal(h.deliveryRecord.attempts, 0);
  assert.equal(h.deliveryRecord.lastErrorCode, null);
  assert.equal(h.events.at(-1).type, "channel_delivery_retry_requested");

  // Unknown delivery → 404.
  assert.equal(h.delivery.retryChannelDelivery({ channelId: h.channelId, deliveryId: "chdl_ghost", approvalToken: "ok" }, owner).status, 404);
});
