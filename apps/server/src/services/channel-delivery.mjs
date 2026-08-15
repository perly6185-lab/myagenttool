/*
 * Channel outbound delivery (S5, #1090): durable ChannelDelivery records with
 * bounded, backoff-scheduled retries and first-class terminal failure. Inbound
 * callbacks were ACKed immediately (S3); everything a conversation should hear
 * back — staged command replies and invocation results — flows through here as
 * an asynchronous application message.
 *
 * The provider client is INJECTED (`sendMessage`), so this service never sees
 * CorpSecret or access tokens; delivery records carry only provider msgids and
 * errcodes (ADR 0012 rule 4).
 */

import { channelIdPrefixes } from "@myagenttool/protocol/channel";
import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

export const CHANNEL_DELIVERY_RETRY_ACTION = "channel.delivery.retry";
export const MAX_DELIVERY_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 10 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MS = 60 * 1000;
const MAX_CONTENT_CHARS = 2048;
const MAX_MEDIA_ASSETS = 5;
const MAX_CHANNEL_DELIVERIES = 10_000;
const TERMINAL_DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// A row claimed for sending is durably "sending"; if the process dies mid-send
// (before the outcome commits), the sweep — which only takes queued/retrying —
// would never resume it. Fold "sending" rows older than this back to retrying.
const STALE_SENDING_MS = 2 * 60 * 1000;

export function backoffMs(attempts, { rateLimited = false } = {}) {
  if (rateLimited) return RATE_LIMIT_BACKOFF_MS;
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

export function createChannelDeliveryService({
  state,
  now,
  nextId,
  appendEvent,
  refuse = null,
  persistStateSoon = () => {},
  store,
  // Single-provider back-compat: `sendMessage` binds every delivery. Multi-provider
  // (#1110): `resolveSender(provider)` returns the sender for a channel's provider,
  // so a WeCom and a Feishu delivery each route to their own client.
  sendMessage = null, // async ({ toUser, content }) => { ok, msgid } | { ok:false, retryable, errcode }
  resolveSender = null, // (provider) => sendMessage | null
  validateApprovalToken = null,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  let sweepInFlight = false;

  const findChannel = (channelId) => (state.channels ?? []).find((row) => row.id === channelId) ?? null;
  // Resolve the sender for one delivery by its channel's provider; falls back to
  // the single injected `sendMessage` when no per-provider resolver is wired.
  function senderFor(delivery) {
    if (typeof resolveSender === "function") {
      const channel = findChannel(delivery.channelId);
      const fn = resolveSender(channel?.provider);
      if (typeof fn === "function") return fn;
    }
    return typeof sendMessage === "function" ? sendMessage : null;
  }
  const anySenderConfigured = () =>
    typeof sendMessage === "function" || typeof resolveSender === "function";
  const findConversation = (conversationId) =>
    (state.channelConversations ?? []).find((row) => row.id === conversationId) ?? null;

  function threadForDelivery(delivery) {
    const threadId = delivery?.taskContext?.threadId;
    if (!threadId) return null;
    return (state.channelTaskThreads ?? []).find((thread) =>
      thread.id === threadId
      && thread.channelId === delivery.channelId
      && thread.conversationId === delivery.conversationId,
    ) ?? null;
  }

  function updateThreadDelivery(delivery, status, errorCode = null) {
    const thread = threadForDelivery(delivery);
    if (!thread) return;
    thread.lastDeliveryId = delivery.id;
    thread.lastDeliveryStatus = status;
    thread.lastDeliveryError = errorCode ? String(errorCode).slice(0, 120) : null;
    thread.lastActivityAt = now();
    thread.updatedAt = now();
    if (status === "failed_terminal") {
      thread.nextAction = "在控制台重试消息投递";
      thread.lastProgressAt = now();
      thread.lastProgressSummary = "任务结果已生成，但消息投递失败";
    } else if (status === "delivered") {
      thread.lastProgressAt = now();
      thread.lastProgressSummary = "任务结果已发送给你";
    }
  }

  /** Rebuild the thread's delivery snapshot after a process restart. */
  function recoverThreadDeliveryState() {
    const latestByThread = new Map();
    for (const delivery of state.channelDeliveries ?? []) {
      const threadId = delivery.taskContext?.threadId;
      if (!threadId) continue;
      const previous = latestByThread.get(threadId);
      const currentAt = String(delivery.updatedAt ?? delivery.createdAt ?? "");
      const previousAt = String(previous?.updatedAt ?? previous?.createdAt ?? "");
      if (!previous || currentAt.localeCompare(previousAt) > 0) latestByThread.set(threadId, delivery);
    }
    let recovered = 0;
    runTx(() => {
      for (const delivery of latestByThread.values()) {
        const thread = threadForDelivery(delivery);
        if (!thread) continue;
        updateThreadDelivery(delivery, delivery.status, delivery.lastErrorCode ?? null);
        recovered += 1;
      }
    });
    return { recovered };
  }

  function normalizeMediaAssets(value) {
    return (Array.isArray(value) ? value : []).slice(0, MAX_MEDIA_ASSETS).map((asset) => ({
      id: asset?.id ? String(asset.id).slice(0, 200) : null,
      projectId: asset?.projectId ? String(asset.projectId).slice(0, 200) : null,
      terminalId: asset?.terminalId ? String(asset.terminalId).slice(0, 200) : null,
      path: asset?.path ? String(asset.path).replaceAll("\\", "/").slice(0, 1_000) : null,
      name: asset?.name ? String(asset.name).slice(0, 200) : null,
      family: asset?.family ? String(asset.family).slice(0, 40) : null,
      mimeType: asset?.mimeType ? String(asset.mimeType).slice(0, 120) : null,
      size: Number.isFinite(Number(asset?.size)) ? Number(asset.size) : null,
      hash: asset?.hash ? String(asset.hash).slice(0, 120) : null,
    })).filter((asset) => asset.projectId && asset.path);
  }

  function pruneDeliveryHistory() {
    const rows = state.channelDeliveries ?? [];
    const activeStatuses = new Set(["queued", "retrying", "sending"]);
    const cutoff = Date.parse(now()) - TERMINAL_DELIVERY_RETENTION_MS;
    const hasExpiredHistory = Number.isFinite(cutoff) && rows.some((row) => {
      if (activeStatuses.has(row.status)) return false;
      const timestamp = Date.parse(row.updatedAt ?? row.createdAt ?? "");
      return Number.isFinite(timestamp) && timestamp < cutoff;
    });
    if (rows.length <= MAX_CHANNEL_DELIVERIES && !hasExpiredHistory) return;
    const active = rows.filter((row) => activeStatuses.has(row.status));
    const historical = rows
      .filter((row) => !activeStatuses.has(row.status))
      .filter((row) => {
        const timestamp = Date.parse(row.updatedAt ?? row.createdAt ?? "");
        return !Number.isFinite(cutoff) || !Number.isFinite(timestamp) || timestamp >= cutoff;
      })
      .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")));
    const keepHistorical = historical.slice(0, Math.max(0, MAX_CHANNEL_DELIVERIES - active.length));
    const retained = [...active, ...keepHistorical];
    if (retained.length < rows.length) state.channelDeliveries = retained;
  }

  /** Queue one outbound message to a conversation. Durable before any send attempt. */
  function enqueueChannelDelivery({ channelId, conversationId, invocationId = null, content, taskContext = null, mediaAssets = [] } = {}) {
    const channel = findChannel(String(channelId ?? ""));
    const conversation = findConversation(String(conversationId ?? ""));
    const text = String(content ?? "").trim();
    const normalizedMediaAssets = normalizeMediaAssets(mediaAssets);
    if (!channel || !conversation || conversation.channelId !== channel.id || (!text && !normalizedMediaAssets.length)) {
      return { ok: false, reason: "invalid_delivery" };
    }
    const delivery = {
      id: nextId(channelIdPrefixes.delivery),
      channelId: channel.id,
      conversationId: conversation.id,
      ownerTeamId: channel.ownerTeamId ?? LOCAL_TEAM_ID,
      invocationId: invocationId ? String(invocationId) : null,
      taskContext: taskContext?.channelId === channel.id && taskContext?.conversationId === conversation.id ? {
        messageId: taskContext.messageId ?? null,
        principalId: taskContext.principalId ?? null,
        terminalId: taskContext.terminalId ?? null,
        projectId: taskContext.projectId ?? null,
        workItemId: taskContext.workItemId ?? null,
        threadId: taskContext.threadId ?? null,
        traceId: taskContext.traceId ?? null,
      } : null,
      // Reply target: a provider whose reply address differs from the sender
      // identity (Teams, #1135) stamps `replyContext` on the conversation; the
      // sender receives it verbatim. Others reply to the sender's id as before.
      toUser: conversation.externalUserId,
      replyContext: conversation.replyContext ?? null,
      content: text.slice(0, MAX_CONTENT_CHARS),
      mediaAssets: normalizedMediaAssets,
      status: "queued",
      attempts: 0,
      nextAttemptAt: now(),
      providerReceiptId: null,
      lastErrorCode: null,
      createdAt: now(),
      updatedAt: now(),
    };
    runTx(() => {
      state.channelDeliveries.push(delivery);
      updateThreadDelivery(delivery, "queued");
      pruneDeliveryHistory();
    });
    return { ok: true, deliveryId: delivery.id };
  }

  async function attemptDelivery(delivery) {
    // Compare-and-set (code-review M1): only a queued/retrying row may be
    // claimed for sending, and the claim + increment happen atomically in one
    // synchronous tx body. Without this, two overlapping sweeps (the 15s
    // interval does not await the prior run) could both send the same delivery.
    let claimed = false;
    runTx(() => {
      if (delivery.status !== "queued" && delivery.status !== "retrying") return;
      delivery.status = "sending";
      delivery.attempts += 1;
      delivery.updatedAt = now();
      claimed = true;
    });
    if (!claimed) return { status: delivery.status, skipped: true };
    let outcome;
    const send = senderFor(delivery);
    try {
      if (typeof send !== "function") throw Object.assign(new Error("no_sender"), { errcode: "no_sender" });
      outcome = await send({ channelId: delivery.channelId, deliveryId: delivery.id, toUser: delivery.toUser, content: delivery.content, mediaAssets: delivery.mediaAssets ?? [], replyContext: delivery.replyContext ?? null });
    } catch (error) {
      outcome = { ok: false, retryable: true, errcode: error?.errcode ?? "transport_error" };
    }

    if (outcome?.ok) {
      runTx(() => {
        delivery.status = "delivered";
        delivery.providerReceiptId = outcome.msgid || null;
        delivery.lastErrorCode = null;
        delivery.updatedAt = now();
        updateThreadDelivery(delivery, "delivered");
        // Delivery evidence (parent AC #8): the receipt joins the audit spine.
        appendEvent({
          invocationId: delivery.invocationId,
          type: "channel_delivery_recorded",
          level: "info",
          message: `Channel ${delivery.channelId}: delivery ${delivery.id} delivered.`,
          data: {
            channelId: delivery.channelId,
            deliveryId: delivery.id,
            conversationId: delivery.conversationId,
            providerReceiptId: delivery.providerReceiptId,
            attempts: delivery.attempts,
          },
        });
      });
      return { status: "delivered" };
    }

    const errcode = String(outcome?.errcode ?? "unknown");
    const retryable = Boolean(outcome?.retryable);
    const exhausted = delivery.attempts >= MAX_DELIVERY_ATTEMPTS;
    if (retryable && !exhausted) {
      runTx(() => {
        delivery.status = "retrying";
        delivery.lastErrorCode = errcode;
        delivery.nextAttemptAt = new Date(Date.parse(now()) + backoffMs(delivery.attempts, { rateLimited: errcode === "45009" })).toISOString();
        delivery.updatedAt = now();
        updateThreadDelivery(delivery, "retrying", errcode);
      });
      return { status: "retrying" };
    }

    runTx(() => {
      delivery.status = "failed_terminal";
      delivery.lastErrorCode = errcode;
      delivery.updatedAt = now();
      updateThreadDelivery(delivery, "failed_terminal", errcode);
    });
    // Terminal failure is a first-class veto, not a silent drop: the message
    // could not be delivered, and the owner can see exactly why and retry (S7).
    refuse?.({
      subject: { kind: "channel_delivery", id: delivery.id },
      requester: { kind: "channel_conversation", id: delivery.conversationId },
      category: "state",
      code: "undeliverable",
      decidedBy: { kind: "server", id: delivery.channelId },
      summary: `Channel delivery ${delivery.id} failed terminally (errcode ${errcode}, ${delivery.attempts} attempts).`,
      evidence: { channelId: delivery.channelId, deliveryId: delivery.id, errcode, attempts: delivery.attempts },
      remedy: "Fix the provider-side condition, then retry the delivery from the console.",
      event: {
        invocationId: delivery.invocationId,
        type: "channel_delivery_failed",
        level: "error",
        message: `Channel ${delivery.channelId}: delivery ${delivery.id} failed terminally (${errcode}).`,
        data: { channelId: delivery.channelId, deliveryId: delivery.id, errcode, attempts: delivery.attempts },
      },
    });
    return { status: "failed_terminal" };
  }

  /**
   * Process everything due. Serialized (one in-flight send at a time) — WeCom
   * rate limits are per-app, and ordering within a conversation matters more
   * than throughput. Restart-safe: `queued`/`retrying` rows resume here.
   */
  async function sweepChannelDeliveries() {
    if (!anySenderConfigured()) return { processed: 0 };
    // Re-entrancy guard (code-review M1): the 15s interval fires regardless of
    // whether the prior async sweep finished; a second concurrent sweep would
    // race the same rows. The per-row CAS in attemptDelivery is the real fix;
    // this avoids the wasted work of overlapping passes.
    if (sweepInFlight) return { processed: 0, skipped: true };
    sweepInFlight = true;
    try {
      return await runSweep();
    } finally {
      sweepInFlight = false;
    }
  }

  async function runSweep() {
    const nowMs = Date.parse(now());
    // Recover deliveries stranded in "sending" by a crash/restart mid-send. The
    // send is at-least-once (this row already consumed an attempt; a resend of a
    // possibly-delivered message is deduped provider-side, e.g. WeCom's 600s
    // duplicate check). Without this the message is lost silently and forever.
    for (const row of state.channelDeliveries ?? []) {
      if (row.status === "sending" && (!row.updatedAt || nowMs - Date.parse(row.updatedAt) > STALE_SENDING_MS)) {
        runTx(() => {
          row.status = "retrying";
          row.lastErrorCode = "stranded_sending";
          row.nextAttemptAt = now();
          row.updatedAt = now();
          updateThreadDelivery(row, "retrying", "stranded_sending");
        });
      }
    }
    const due = (state.channelDeliveries ?? []).filter(
      (row) =>
        (row.status === "queued" || row.status === "retrying")
        && (!row.nextAttemptAt || Date.parse(row.nextAttemptAt) <= nowMs),
    );
    let processed = 0;
    for (const delivery of due) {
      await attemptDelivery(delivery);
      processed += 1;
    }
    return { processed };
  }

  /**
   * Notify the originating conversation of a completed invocation. Called from
   * the completion hook; a non-channel invocation is a no-op.
   */
  function notifyInvocationCompleted(invocation) {
    const channelContext = invocation?.options?.metadata?.channel;
    if (!channelContext?.conversationId) return null;
    const summary = typeof invocation.result === "string"
      ? invocation.result
      : invocation.result?.summary ?? invocation.result?.output ?? null;
    const thread = (state.channelTaskThreads ?? []).find((candidate) =>
      (channelContext.threadId && candidate.id === channelContext.threadId)
      || (channelContext.workItemId && candidate.workItemId === channelContext.workItemId));
    const notificationKey = thread ? `${thread.id}:${invocation.id}:${invocation.status}` : null;
    if (thread && thread.lastNotificationKey === notificationKey) return null;
    if (thread) {
      runTx(() => {
        thread.lastNotificationKey = notificationKey;
        thread.lastNotifiedAt = now();
      });
    }
    const statusLabel = thread?.status === "succeeded" ? "已完成"
      : thread?.status === "failed" ? "失败"
        : thread?.status === "cancelled" ? "已取消"
          : thread?.status === "waiting_user" ? "等待你补充信息"
              : thread?.status === "waiting_approval" ? "等待确认"
                : thread?.status === "running" ? "继续执行中"
                  : thread?.status === "queued" ? "排队中"
                : thread?.status === "human_takeover" ? "人工处理中"
                : ({
                  succeeded: "已完成",
                  completed: "已完成",
                  failed: "失败",
                  cancelled: "已取消",
                  timed_out: "处理超时",
                }[invocation.status] ?? normalizedResultStatus(invocation.status));
    const lines = [`任务${statusLabel}`];
    if (summary) lines.push(String(summary).slice(0, 1500));
    if (thread?.status === "failed") lines.push("你可以回复“重试”再次执行，或回复“转人工”。");
    if (thread?.status === "human_takeover") lines.push("请等待人工处理，我会在有进展时通知你。");
    const workItem = (state.workItems ?? []).find((row) => row.id === channelContext.workItemId);
    const resultAssets = [
      invocation.result?.outputAssets,
      invocation.result?.output?.outputAssets,
      workItem?.outputAssets,
    ].find((assets) => Array.isArray(assets) && assets.length) ?? [];
    let queued;
    try {
      queued = enqueueChannelDelivery({
        channelId: channelContext.channelId,
        conversationId: channelContext.conversationId,
        invocationId: invocation.id,
        taskContext: channelContext.taskContext ?? channelContext,
        content: lines.join("\n"),
        mediaAssets: resultAssets.map((asset) => ({
          ...asset,
          projectId: asset?.projectId ?? channelContext.projectId ?? workItem?.projectId ?? null,
        })),
      });
    } catch {
      queued = { ok: false, reason: "delivery_enqueue_failed" };
    }
    if (!queued?.ok && thread) {
      // The key is an in-flight claim for dedupe. Release it when enqueue did
      // not create a durable row, so a later completion/reconciliation callback
      // can retry instead of silently losing the notification.
      runTx(() => {
        if (thread.lastNotificationKey === notificationKey) {
          thread.lastNotificationKey = null;
          thread.lastNotificationAttemptFailedAt = now();
        }
      });
    }
    return queued;
  }

  function normalizedResultStatus(status) {
    if (status === "succeeded") return "completed";
    if (status === "cancelled") return "cancelled";
    if (status === "timed_out") return "timed out";
    return status === "failed" ? "failed — open the task trace for recovery" : String(status ?? "updated");
  }

  /**
   * Operator recovery lever (S7): re-queue one terminally-failed delivery.
   * Owner-team scoped (foreign → 404) and approval-gated — a human explicitly
   * re-authorizes the send. Only `failed_terminal` rows are eligible.
   */
  function retryChannelDelivery({ channelId, deliveryId, approvalToken } = {}, actor = null) {
    const channel = findChannel(String(channelId ?? ""));
    if (!channel || (actor?.teamId && (channel.ownerTeamId ?? LOCAL_TEAM_ID) !== actor.teamId)) {
      return { ok: false, status: 404, body: { error: "channel_not_found" } };
    }
    const delivery = (state.channelDeliveries ?? []).find(
      (row) => row.id === String(deliveryId ?? "") && row.channelId === channel.id,
    );
    if (!delivery) {
      return { ok: false, status: 404, body: { error: "delivery_not_found" } };
    }
    if (delivery.status !== "failed_terminal") {
      return { ok: false, status: 409, body: { error: "delivery_not_retryable", status: delivery.status } };
    }
    const approval = typeof validateApprovalToken === "function"
      ? validateApprovalToken(approvalToken, { action: CHANNEL_DELIVERY_RETRY_ACTION, targetId: delivery.id, actor })
      : { approved: false, reason: "approval_validator_unavailable" };
    if (!approval.approved) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "approval_required",
          reason: approval.reason === "missing_token"
            ? "Retrying a failed delivery requires an explicit approvalToken."
            : `approvalToken rejected: ${approval.reason}.`,
          action: CHANNEL_DELIVERY_RETRY_ACTION,
          targetId: delivery.id,
        },
      };
    }
    runTx(() => {
      delivery.status = "queued";
      delivery.attempts = 0;
      delivery.lastErrorCode = null;
      delivery.nextAttemptAt = now();
      delivery.updatedAt = now();
      updateThreadDelivery(delivery, "queued");
      appendEvent({
        invocationId: delivery.invocationId,
        type: "channel_delivery_retry_requested",
        level: "info",
        message: `Channel ${channel.id}: delivery ${delivery.id} re-queued by operator.`,
        data: { channelId: channel.id, deliveryId: delivery.id },
      });
    });
    return { ok: true, status: 200, body: { deliveryId: delivery.id, status: delivery.status } };
  }

  /**
   * Re-send the latest task result when the channel user explicitly asks for it.
   * This creates a new durable delivery, preserving media and correlation, so
   * it does not bypass the normal outbound retry/audit pipeline.
   */
  function resendChannelDelivery({ channelId, conversationId, threadId } = {}) {
    const source = (state.channelDeliveries ?? [])
      .filter((delivery) => delivery.channelId === String(channelId ?? "")
        && delivery.conversationId === String(conversationId ?? "")
        && delivery.taskContext?.threadId === String(threadId ?? "")
        && (delivery.invocationId || delivery.taskContext?.workItemId)
        && ["delivered", "failed_terminal", "retrying", "queued"].includes(delivery.status)
        && (delivery.content || delivery.mediaAssets?.length))
      .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))[0] ?? null;
    if (!source) return { ok: false, reason: "no_result" };
    const queued = enqueueChannelDelivery({
      channelId: source.channelId,
      conversationId: source.conversationId,
      invocationId: source.invocationId,
      content: source.content,
      mediaAssets: source.mediaAssets ?? [],
      taskContext: source.taskContext,
    });
    if (!queued.ok) return queued;
    runTx(() => {
      appendEvent({
        invocationId: source.invocationId,
        type: "channel_delivery_resend_requested",
        level: "info",
        message: `Channel ${source.channelId}: task result resend queued.`,
        data: { channelId: source.channelId, conversationId: source.conversationId, threadId, sourceDeliveryId: source.id, deliveryId: queued.deliveryId },
      });
    });
    return { ...queued, sourceDeliveryId: source.id };
  }

  return { enqueueChannelDelivery, sweepChannelDeliveries, notifyInvocationCompleted, attemptDelivery, retryChannelDelivery, resendChannelDelivery, recoverThreadDeliveryState };
}
