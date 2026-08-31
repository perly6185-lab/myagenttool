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
import { channelFailureCopy, channelResultCopy } from "./channel-user-copy.mjs";

export const CHANNEL_DELIVERY_RETRY_ACTION = "channel.delivery.retry";
export const MAX_DELIVERY_ATTEMPTS = 5;
export const MANUAL_RESEND_COOLDOWN_MS = 10 * 60 * 1000;
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
  notifyTaskEvent = null,
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
    const notificationLog = (state.channelNotificationLog ?? []).find((row) => row.deliveryId === delivery?.id) ?? null;
    if (notificationLog) {
      notificationLog.deliveryStatus = status;
      notificationLog.deliveryError = errorCode ? String(errorCode).slice(0, 120) : null;
      notificationLog.updatedAt = now();
      if (status === "delivered") notificationLog.deliveredAt = now();
    }
    const thread = threadForDelivery(delivery);
    if (!thread) return;
    thread.lastDeliveryId = delivery.id;
    thread.lastDeliveryStatus = status;
    thread.lastDeliveryError = errorCode ? String(errorCode).slice(0, 120) : null;
    thread.lastActivityAt = now();
    thread.updatedAt = now();
    const resultDelivery = delivery.taskContext?.deliveryKind === "result"
      || delivery.taskContext?.notificationEvent === "succeeded";
    if (status === "failed_terminal" && resultDelivery) {
      thread.nextAction = "在控制台重试消息投递";
      thread.lastProgressAt = now();
      thread.lastProgressSummary = "任务结果已生成，但消息投递失败";
    } else if (status === "sent_unconfirmed" && resultDelivery) {
      thread.nextAction = "如微信未显示结果，可在控制台再次发送";
      thread.lastProgressAt = now();
      thread.lastProgressSummary = "任务结果已被微信接口接受，但客户端展示尚未确认";
    } else if (status === "delivered" && resultDelivery) {
      thread.nextAction = "查看任务结果";
      thread.lastProgressAt = now();
      thread.lastProgressSummary = "任务结果已发送给你";
    }
  }

  /** Rebuild the thread's delivery snapshot after a process restart. */
  function recoverThreadDeliveryState() {
    const latestByThread = new Map();
    const timestamp = now();
    runTx(() => {
      for (const delivery of state.channelDeliveries ?? []) {
        const channel = findChannel(delivery.channelId);
        if (channel?.provider !== "wechat_ilink" || delivery.status !== "delivered" || delivery.userConfirmedAt) continue;
        // Older builds treated iLink's message_id as proof that WeChat rendered
        // the text. It is only an acceptance id, so migrate the durable state
        // without rewriting the original delivery chronology.
        const acceptedCandidate = delivery.providerAcceptedAt ?? delivery.updatedAt ?? delivery.createdAt ?? timestamp;
        const acceptedMs = Date.parse(acceptedCandidate);
        delivery.status = "sent_unconfirmed";
        delivery.providerAcceptedAt = Number.isFinite(acceptedMs) ? acceptedCandidate : timestamp;
        delivery.nextManualRetryAt = delivery.nextManualRetryAt
          ?? new Date(Date.parse(delivery.providerAcceptedAt) + MANUAL_RESEND_COOLDOWN_MS).toISOString();
      }
    });
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

  function deliveryRow({
    channel, conversation, invocationId, content, taskContext, mediaAssets, dedupeKey, sourceContext,
  }) {
    const timestamp = now();
    return {
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
        deliveryKind: ["result", "status_notification"].includes(taskContext.deliveryKind) ? taskContext.deliveryKind : null,
        notificationEvent: ["queued", "started", "progress", "waiting_user", "waiting_approval", "needs_attention", "succeeded", "failed", "cancelled", "human_takeover"].includes(taskContext.notificationEvent)
          ? taskContext.notificationEvent
          : null,
      } : null,
      // Immutable provenance for governed report deliveries: which confirmed
      // snapshot a chunk came from and where it sits in the chunk sequence.
      sourceContext: sourceContext?.kind === "work_item_report" ? {
        kind: "work_item_report",
        workItemId: sourceContext.workItemId ?? null,
        reportDraftId: sourceContext.reportDraftId ?? null,
        reportDeliveryId: sourceContext.reportDeliveryId ?? null,
        contentDigest: sourceContext.contentDigest ?? null,
        chunkIndex: sourceContext.chunkIndex ?? null,
        chunkCount: sourceContext.chunkCount ?? null,
      } : null,
      // Reply target: a provider whose reply address differs from the sender
      // identity (Teams, #1135) stamps `replyContext` on the conversation; the
      // sender receives it verbatim. Others reply to the sender's id as before.
      toUser: conversation.externalUserId,
      replyContext: conversation.replyContext ?? null,
      content: content.slice(0, MAX_CONTENT_CHARS),
      mediaAssets,
      dedupeKey,
      status: "queued",
      attempts: 0,
      nextAttemptAt: timestamp,
      providerReceiptId: null,
      providerClientId: null,
      providerAcceptedAt: null,
      nextManualRetryAt: null,
      lastResentAt: null,
      resendCount: 0,
      resendOfDeliveryId: null,
      userConfirmedAt: null,
      userConfirmedByEventId: null,
      userReportedMissingAt: null,
      lastErrorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  /** Queue a bounded set of chunks atomically before any provider send attempt. */
  function enqueueChannelDeliveryBatch({
    channelId,
    conversationId,
    invocationId = null,
    contents,
    taskContext = null,
    sourceContext = null,
  } = {}) {
    const channel = findChannel(String(channelId ?? ""));
    const conversation = findConversation(String(conversationId ?? ""));
    const chunks = Array.isArray(contents) ? contents.map((content) => String(content ?? "")) : [];
    if (!channel || !conversation || conversation.channelId !== channel.id
      || !chunks.length || chunks.length > 50
      || chunks.some((content) => !content.trim() || content.length > MAX_CONTENT_CHARS)) {
      return { ok: false, reason: "invalid_delivery" };
    }
    const deliveries = chunks.map((content, index) => deliveryRow({
      channel,
      conversation,
      invocationId,
      // Batch callers (notably immutable report previews) retain exact chunk
      // boundaries, so the content is stored verbatim rather than re-trimmed.
      content,
      taskContext,
      mediaAssets: [],
      dedupeKey: null,
      sourceContext: sourceContext?.kind === "work_item_report"
        ? { ...sourceContext, chunkIndex: index + 1, chunkCount: chunks.length }
        : null,
    }));
    runTx(() => {
      state.channelDeliveries.push(...deliveries);
      for (const delivery of deliveries) updateThreadDelivery(delivery, "queued");
      pruneDeliveryHistory();
    });
    return { ok: true, deliveryIds: deliveries.map((delivery) => delivery.id) };
  }

  /** Queue one outbound message to a conversation. Durable before any send attempt. */
  function enqueueChannelDelivery({ channelId, conversationId, invocationId = null, content, taskContext = null, mediaAssets = [], dedupeKey = null } = {}) {
    const channel = findChannel(String(channelId ?? ""));
    const conversation = findConversation(String(conversationId ?? ""));
    const text = String(content ?? "").trim();
    const normalizedMediaAssets = normalizeMediaAssets(mediaAssets);
    if (!channel || !conversation || conversation.channelId !== channel.id || (!text && !normalizedMediaAssets.length)) {
      return { ok: false, reason: "invalid_delivery" };
    }
    const normalizedDedupeKey = dedupeKey ? String(dedupeKey).trim().slice(0, 240) : null;
    if (normalizedDedupeKey) {
      const existing = (state.channelDeliveries ?? []).find((candidate) =>
        candidate.channelId === channel.id
        && candidate.conversationId === conversation.id
        && candidate.dedupeKey === normalizedDedupeKey
        && candidate.status !== "failed_terminal",
      );
      if (existing) return { ok: true, deliveryId: existing.id, deduplicated: true };
    }
    const delivery = deliveryRow({
      channel,
      conversation,
      invocationId,
      content: text,
      taskContext,
      mediaAssets: normalizedMediaAssets,
      dedupeKey: normalizedDedupeKey,
      sourceContext: null,
    });
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
      outcome = await send({ channelId: delivery.channelId, deliveryId: delivery.providerClientId || delivery.id, toUser: delivery.toUser, content: delivery.content, mediaAssets: delivery.mediaAssets ?? [], replyContext: delivery.replyContext ?? null });
    } catch (error) {
      outcome = { ok: false, retryable: true, errcode: error?.errcode ?? "transport_error" };
    }

    if (outcome?.ok) {
      const confirmed = outcome.confirmed !== false;
      const acceptedStatus = confirmed ? "delivered" : "sent_unconfirmed";
      runTx(() => {
        delivery.status = acceptedStatus;
        delivery.providerReceiptId = outcome.msgid || null;
        delivery.providerClientId = outcome.clientId || delivery.providerClientId || delivery.id;
        delivery.providerAcceptedAt = now();
        delivery.nextManualRetryAt = confirmed
          ? null
          : new Date(Date.parse(delivery.providerAcceptedAt) + MANUAL_RESEND_COOLDOWN_MS).toISOString();
        delivery.lastErrorCode = null;
        delivery.updatedAt = now();
        updateThreadDelivery(delivery, acceptedStatus);
        // Delivery evidence distinguishes provider acceptance from confirmed
        // user-visible delivery. iLink may issue a message_id while the client
        // remains empty, so that id must not turn this state into `delivered`.
        appendEvent({
          invocationId: delivery.invocationId,
          type: confirmed ? "channel_delivery_recorded" : "channel_delivery_unconfirmed",
          level: confirmed ? "info" : "warn",
          message: confirmed
            ? `Channel ${delivery.channelId}: delivery ${delivery.id} delivered.`
            : `Channel ${delivery.channelId}: delivery ${delivery.id} accepted without confirmed user delivery.`,
          data: {
            channelId: delivery.channelId,
            deliveryId: delivery.id,
            conversationId: delivery.conversationId,
            providerReceiptId: delivery.providerReceiptId,
            providerClientId: delivery.providerClientId,
            confirmed,
            attempts: delivery.attempts,
          },
        });
      });
      return { status: acceptedStatus };
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
        && findChannel(row.channelId)?.status === "enabled"
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
    // Consultation answers have their own completion hook so the user receives
    // the answer text, not a generic "task completed" notification. They are
    // deliberately not task-thread work.
    if (invocation?.options?.metadata?.channelConsultation) return null;
    const thread = (state.channelTaskThreads ?? []).find((candidate) =>
      (channelContext.threadId && candidate.id === channelContext.threadId)
      || (channelContext.workItemId && candidate.workItemId === channelContext.workItemId));
    const workItem = (state.workItems ?? []).find((row) =>
      row.id === (channelContext.workItemId ?? thread?.workItemId));
    const successful = thread?.status === "succeeded"
      || (!thread && ["succeeded", "completed"].includes(invocation.status));
    if (successful && workItem?.taskContextControl?.deliveryDestination === "task") {
      return { ok: true, suppressed: true, reason: "work_item_result_kept_in_task" };
    }
    const autoRunId = invocation?.options?.metadata?.autoRunId ?? channelContext.autoRunId ?? thread?.autoRunId ?? null;
    const autoRun = autoRunId ? (state.autoRuns ?? []).find((run) => run.id === autoRunId) ?? null : null;
    const invocationSummary = typeof invocation.result === "string"
      ? invocation.result
      : typeof invocation.result?.summary === "string"
        ? invocation.result.summary
        : typeof invocation.result?.output?.summary === "string"
          ? invocation.result.output.summary
          : typeof invocation.result?.output === "string"
            ? invocation.result.output
            : typeof invocation.result?.latestMessage === "string"
              ? invocation.result.latestMessage
              : null;
    const rawSummary = thread?.resultSummary
      ?? autoRun?.report
      ?? autoRun?.deliveryReport?.summary
      ?? invocationSummary;
    const summary = thread?.status === "failed"
      ? channelFailureCopy({ invocation, autoRun, summary: rawSummary })
      : thread?.status === "succeeded"
        ? channelResultCopy(rawSummary, { readOnly: thread?.operationIntent?.accessMode === "read_only" })
        : rawSummary;
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
                : thread?.status === "needs_attention" ? "需要关注"
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
    if (thread?.status === "waiting_user") lines.push("请直接回复需要补充的信息，或发送图片、语音、文件。");
    if (thread?.status === "waiting_approval" && thread.waitingFor === "delivery") lines.push("请在桌面端查看变更并确认应用；应用完成后我会再通知你。");
    if (thread?.status === "failed") lines.push("你可以回复“重试”再次执行，或回复“转人工”。");
    if (thread?.status === "needs_attention") {
      if (thread.attentionReason === "wechat_login_required") {
        lines.push("请在 MyAgentTool 的“网站登录”中重新扫码登录，完成后回复“继续”，系统会恢复原任务。");
      } else if (thread.attentionReason === "wechat_draft_outcome_unknown") {
        lines.push("为避免重复草稿，系统不会自动重试。请先到公众号草稿箱核对是否已经保存。");
      } else if (thread.attentionReason === "wechat_plugin_update_required") {
        lines.push("任务和文章版本已保留；需要更新公众号站点插件后再继续。");
      } else {
        lines.push("任务暂时没有新进展。回复“进度”查看，回复“继续”继续观察，或回复“转人工”。");
      }
    }
    if (thread?.status === "human_takeover") lines.push("请等待人工处理，我会在有进展时通知你。");
    const resultAssets = [
      invocation.result?.outputAssets,
      invocation.result?.output?.outputAssets,
      workItem?.outputAssets,
    ].find((assets) => Array.isArray(assets) && assets.length) ?? [];
    if (typeof notifyTaskEvent === "function") {
      const notified = notifyTaskEvent({
        channelId: channelContext.channelId,
        conversationId: channelContext.conversationId,
        threadId: thread?.id ?? channelContext.threadId ?? null,
        invocationId: invocation.id,
        event: thread?.status === "succeeded" ? "succeeded"
          : thread?.status === "failed" ? "failed"
            : thread?.status === "cancelled" ? "cancelled"
              : thread?.status === "waiting_user" ? "waiting_user"
                : thread?.status === "waiting_approval" ? "waiting_approval"
                  : thread?.status === "needs_attention" ? "needs_attention"
                    : thread?.status === "human_takeover" ? "human_takeover" : "progress",
        content: lines.join("\n"),
        mediaAssets: resultAssets.map((asset) => ({
          ...asset,
          projectId: asset?.projectId ?? channelContext.projectId ?? workItem?.projectId ?? null,
        })),
        dedupeKey: notificationKey ? `channel-task:${notificationKey}` : null,
      });
      if (notified?.ok || notified?.suppressed || notified?.batched) return notified;
    }
    let queued;
    try {
      queued = enqueueChannelDelivery({
        channelId: channelContext.channelId,
        conversationId: channelContext.conversationId,
        invocationId: invocation.id,
        taskContext: { ...(channelContext.taskContext ?? channelContext), deliveryKind: "result" },
        content: lines.join("\n"),
        dedupeKey: notificationKey ? `channel-task:${notificationKey}` : null,
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

  /**
   * Reconcile terminal channel invocations after boot.  A process can stop
   * after the invocation became terminal and the task thread was synced, but
   * before the completion delivery row was written.  The thread's notification
   * key plus delivery dedupe make this safe to run on every restart.
   */
  function recoverCompletedNotifications() {
    let checked = 0;
    let queued = 0;
    for (const invocation of state.invocations ?? []) {
      if (!invocation?.options?.metadata?.channel) continue;
      if (invocation?.options?.metadata?.channelConsultation) continue;
      if (!["succeeded", "completed", "failed", "cancelled", "timed_out"].includes(invocation.status)) continue;
      checked += 1;
      const result = notifyInvocationCompleted(invocation);
      if (result?.ok || result?.batched) queued += 1;
    }
    return { checked, queued };
  }

  function normalizedResultStatus(status) {
    if (status === "succeeded") return "completed";
    if (status === "cancelled") return "cancelled";
    if (status === "timed_out") return "timed out";
    return status === "failed" ? "failed — open the task trace for recovery" : String(status ?? "updated");
  }

  /**
   * Operator recovery lever (S7): re-queue one terminally-failed or
   * provider-accepted-but-unconfirmed delivery.
   * Owner-team scoped (foreign → 404) and approval-gated — a human explicitly
   * re-authorizes the send. Confirmed deliveries remain ineligible.
   */
  function retryChannelDelivery({ channelId, deliveryId, approvalToken, recoveryRequestId = null } = {}, actor = null) {
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
    if (!["failed_terminal", "sent_unconfirmed"].includes(delivery.status)) {
      return { ok: false, status: 409, body: { error: "delivery_not_retryable", status: delivery.status } };
    }
    if (delivery.status === "sent_unconfirmed" && Date.parse(delivery.nextManualRetryAt ?? "") > Date.parse(now())) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "delivery_retry_cooldown",
          reason: "微信已接受上一条消息，立即重发可能造成延迟重复。",
          retryAfter: delivery.nextManualRetryAt,
          deliveryId: delivery.id,
        },
      };
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
      // An explicit retry must use a fresh provider idempotency key; otherwise
      // iLink may dedupe the corrected payload against the prior silent drop.
      delivery.providerClientId = `${delivery.id}-retry-${Date.parse(now())}`;
      delivery.resendCount = Number(delivery.resendCount ?? 0) + 1;
      delivery.lastResentAt = now();
      delivery.lastManualRetryRequestId = recoveryRequestId == null
        ? null
        : String(recoveryRequestId).trim().slice(0, 200) || null;
      delivery.nextManualRetryAt = null;
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
    const thread = (state.channelTaskThreads ?? []).find((candidate) =>
      candidate.id === String(threadId ?? "")
      && candidate.channelId === String(channelId ?? "")
      && candidate.conversationId === String(conversationId ?? "")) ?? null;
    let source = (state.channelDeliveries ?? [])
      .filter((delivery) => delivery.channelId === String(channelId ?? "")
        && delivery.conversationId === String(conversationId ?? "")
        && delivery.taskContext?.threadId === String(threadId ?? "")
        && (delivery.invocationId || delivery.taskContext?.workItemId)
        && ["delivered", "sent_unconfirmed", "failed_terminal", "retrying", "queued"].includes(delivery.status)
        && (delivery.content || delivery.mediaAssets?.length))
      .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))[0] ?? null;
    if (!source && thread?.sourceEventIds?.length) {
      // Deliveries created before taskContext correlation was introduced are
      // still recoverable through their immutable source-event dedupe key.
      // Without this bridge, an old completed link task is visible in “我的任务”
      // but “重发结果” incorrectly reports that no result exists.
      const legacyReplyKeys = new Set(thread.sourceEventIds.map((eventId) => `channel-event:${eventId}:reply`));
      source = (state.channelDeliveries ?? [])
        .filter((delivery) => delivery.channelId === thread.channelId
          && delivery.conversationId === thread.conversationId
          && legacyReplyKeys.has(delivery.dedupeKey)
          && ["delivered", "sent_unconfirmed", "failed_terminal", "retrying", "queued"].includes(delivery.status)
          && (delivery.content || delivery.mediaAssets?.length))
        .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))[0] ?? null;
      if (source) {
        source = {
          ...source,
          taskContext: {
            channelId: thread.channelId,
            conversationId: thread.conversationId,
            threadId: thread.id,
            workItemId: thread.workItemId ?? null,
            deliveryKind: "result",
          },
        };
      }
    }
    if (!source) {
      if (thread?.exportedAsset?.path) {
        source = {
          channelId: thread.channelId,
          conversationId: thread.conversationId,
          invocationId: null,
          content: thread.resultSummary ?? "已重新发送任务结果。",
          mediaAssets: [thread.exportedAsset],
          taskContext: {
            channelId: thread.channelId,
            conversationId: thread.conversationId,
            threadId: thread.id,
            workItemId: thread.workItemId ?? null,
            deliveryKind: "result",
          },
        };
      }
    }
    if (!source) return { ok: false, reason: "no_result" };
    if (source.status === "sent_unconfirmed") {
      runTx(() => {
        const persisted = (state.channelDeliveries ?? []).find((delivery) => delivery.id === source.id);
        if (persisted) persisted.userReportedMissingAt = now();
      });
    }
    if (source.status === "sent_unconfirmed" && Date.parse(source.nextManualRetryAt ?? "") > Date.parse(now())) {
      return {
        ok: false,
        reason: "recently_accepted",
        deliveryId: source.id,
        retryAfter: source.nextManualRetryAt,
      };
    }
    const queued = enqueueChannelDelivery({
      channelId: source.channelId,
      conversationId: source.conversationId,
      invocationId: source.invocationId,
      content: source.content,
      mediaAssets: source.mediaAssets ?? [],
      taskContext: { ...source.taskContext, deliveryKind: "result" },
    });
    if (!queued.ok) return queued;
    runTx(() => {
      const copy = (state.channelDeliveries ?? []).find((delivery) => delivery.id === queued.deliveryId);
      if (copy) {
        copy.resendOfDeliveryId = source.id ?? null;
        copy.resendCount = Number(source.resendCount ?? 0) + 1;
        copy.lastResentAt = now();
      }
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

  /**
   * Treat an explicit reply from the same channel conversation as the delivery
   * receipt iLink cannot provide. The caller must resolve the discrete task;
   * this service validates the exact conversation and latest result again.
   */
  function acknowledgeChannelDelivery({ channelId, conversationId, threadId, sourceEventId = null } = {}) {
    const matching = (state.channelDeliveries ?? [])
      .filter((delivery) => delivery.channelId === String(channelId ?? "")
        && delivery.conversationId === String(conversationId ?? "")
        && delivery.taskContext?.threadId === String(threadId ?? "")
        && delivery.taskContext?.deliveryKind === "result")
      .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "")
        .localeCompare(String(left.updatedAt ?? left.createdAt ?? "")));
    const latest = matching[0] ?? null;
    const delivery = latest?.status === "sent_unconfirmed" ? latest : null;
    if (!delivery) {
      const confirmed = latest?.status === "delivered" && latest.userConfirmedAt ? latest : null;
      return confirmed
        ? { ok: true, deliveryId: confirmed.id, alreadyConfirmed: true, confirmedAt: confirmed.userConfirmedAt }
        : { ok: false, reason: "no_unconfirmed_result" };
    }
    const confirmedAt = now();
    runTx(() => {
      delivery.status = "delivered";
      delivery.userConfirmedAt = confirmedAt;
      delivery.userConfirmedByEventId = sourceEventId ? String(sourceEventId).slice(0, 200) : null;
      delivery.nextManualRetryAt = null;
      delivery.lastErrorCode = null;
      delivery.updatedAt = confirmedAt;
      updateThreadDelivery(delivery, "delivered");
      appendEvent({
        invocationId: delivery.invocationId,
        type: "channel_delivery_user_confirmed",
        level: "info",
        message: `Channel ${delivery.channelId}: delivery ${delivery.id} confirmed visible by the channel user.`,
        data: {
          channelId: delivery.channelId,
          conversationId: delivery.conversationId,
          deliveryId: delivery.id,
          threadId: delivery.taskContext?.threadId ?? null,
          sourceEventId: delivery.userConfirmedByEventId,
        },
      });
    });
    return { ok: true, deliveryId: delivery.id, alreadyConfirmed: false, confirmedAt };
  }

  return {
    enqueueChannelDelivery,
    enqueueChannelDeliveryBatch,
    sweepChannelDeliveries,
    notifyInvocationCompleted,
    recoverCompletedNotifications,
    attemptDelivery,
    retryChannelDelivery,
    resendChannelDelivery,
    acknowledgeChannelDelivery,
    recoverThreadDeliveryState,
  };
}
