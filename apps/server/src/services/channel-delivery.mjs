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

  /** Queue one outbound message to a conversation. Durable before any send attempt. */
  function enqueueChannelDelivery({ channelId, conversationId, invocationId = null, content } = {}) {
    const channel = findChannel(String(channelId ?? ""));
    const conversation = findConversation(String(conversationId ?? ""));
    const text = String(content ?? "").trim();
    if (!channel || !conversation || conversation.channelId !== channel.id || !text) {
      return { ok: false, reason: "invalid_delivery" };
    }
    const delivery = {
      id: nextId(channelIdPrefixes.delivery),
      channelId: channel.id,
      conversationId: conversation.id,
      ownerTeamId: channel.ownerTeamId ?? LOCAL_TEAM_ID,
      invocationId: invocationId ? String(invocationId) : null,
      // Reply target: a provider whose reply address differs from the sender
      // identity (Teams, #1135) stamps `replyContext` on the conversation; the
      // sender receives it verbatim. Others reply to the sender's id as before.
      toUser: conversation.externalUserId,
      replyContext: conversation.replyContext ?? null,
      content: text.slice(0, MAX_CONTENT_CHARS),
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
      outcome = await send({ toUser: delivery.toUser, content: delivery.content, replyContext: delivery.replyContext ?? null });
    } catch (error) {
      outcome = { ok: false, retryable: true, errcode: error?.errcode ?? "transport_error" };
    }

    if (outcome?.ok) {
      runTx(() => {
        delivery.status = "delivered";
        delivery.providerReceiptId = outcome.msgid || null;
        delivery.lastErrorCode = null;
        delivery.updatedAt = now();
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
      });
      return { status: "retrying" };
    }

    runTx(() => {
      delivery.status = "failed_terminal";
      delivery.lastErrorCode = errcode;
      delivery.updatedAt = now();
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
    const lines = [`${invocation.id}: ${invocation.status}`];
    if (summary) lines.push(String(summary).slice(0, 1500));
    return enqueueChannelDelivery({
      channelId: channelContext.channelId,
      conversationId: channelContext.conversationId,
      invocationId: invocation.id,
      content: lines.join("\n"),
    });
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

  return { enqueueChannelDelivery, sweepChannelDeliveries, notifyInvocationCompleted, attemptDelivery, retryChannelDelivery };
}
