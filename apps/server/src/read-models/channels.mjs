/*
 * Channel operations read-model (S7, #1090): a per-channel operational rollup
 * for the console — readiness, lifecycle, activity counts, delivery-failure
 * tally, and last activity. Pure over already-team-scoped inputs (the caller
 * passes the visibility-filtered channel collections from buildPublicState), so
 * no secret or cross-team data can reach it.
 */

import { parseWechatDraftInvocationResult } from "../services/wechat-draft-task-execution.mjs";
import { verifyWorkItemResult } from "../services/work-item-result-verification.mjs";

export function recentChannelLinkDiagnostics(events = [], deliveries = [], { limit = 5 } = {}) {
  const boundedLimit = Math.max(1, Math.min(20, Math.floor(Number(limit) || 5)));
  const deliveryById = new Map(deliveries.map((delivery) => [delivery?.id, delivery]));
  const deliveryByDedupeKey = new Map(deliveries
    .filter((delivery) => delivery?.dedupeKey)
    .map((delivery) => [delivery.dedupeKey, delivery]));
  const deliveryView = (delivery, fallbackStatus = "not_queued") => ({
    deliveryId: delivery?.id ?? null,
    status: delivery?.status ?? fallbackStatus,
    attempts: Number(delivery?.attempts ?? 0),
    lastErrorCode: delivery?.lastErrorCode ?? null,
    updatedAt: delivery?.updatedAt ?? delivery?.createdAt ?? null,
  });
  const hostsFor = (event) => [...new Set((Array.isArray(event?.sharedContentUrls) ? event.sharedContentUrls : [])
    .map((value) => {
      try { return new URL(String(value)).hostname.toLowerCase(); } catch { return null; }
    })
    .filter(Boolean))].slice(0, 3);
  const latestRouteBySourceEvent = new Map();
  for (const routeEvent of events) {
    const route = routeEvent?.sharedContentRoute;
    const sourceEventId = route?.sourceEventId;
    if (!sourceEventId) continue;
    const decidedAt = route.decidedAt ?? routeEvent.receivedAt ?? null;
    const previous = latestRouteBySourceEvent.get(sourceEventId);
    if (!previous || String(decidedAt ?? "").localeCompare(String(previous.decidedAt ?? "")) >= 0) {
      latestRouteBySourceEvent.set(sourceEventId, {
        target: String(route.target ?? "unknown").slice(0, 60),
        status: String(route.status ?? "decided").slice(0, 60),
        reason: route.reason ? String(route.reason).slice(0, 120) : null,
        activeTaskCount: Math.max(0, Number(route.activeTaskCount) || 0),
        decidedAt,
      });
    }
  }

  return events
    .filter((event) => event?.sharedContentStatus || Array.isArray(event?.sharedContentUrls))
    .map((event) => {
      const acknowledgement = (event.sharedContentAcknowledgement?.deliveryId
        ? deliveryById.get(event.sharedContentAcknowledgement.deliveryId)
        : null)
        ?? deliveryByDedupeKey.get(`channel-shared-content:${event.id}:reading`)
        ?? null;
      const finalReply = (event.replyDeliveryId ? deliveryById.get(event.replyDeliveryId) : null)
        ?? deliveryByDedupeKey.get(`channel-event:${event.id}:reply`)
        ?? null;
      return {
        eventId: event.id,
        conversationId: event.conversationId ?? null,
        hosts: hostsFor(event),
        status: event.sharedContentStatus ?? "detected",
        detectedAt: event.sharedContentDetectedAt ?? event.receivedAt ?? null,
        completedAt: event.sharedContentCompletedAt ?? null,
        activeTaskCount: Math.max(0, Number(event.sharedContentActiveTaskCount) || 0),
        acknowledgement: deliveryView(
          acknowledgement,
          event.sharedContentAcknowledgement?.status ?? "not_queued",
        ),
        finalReply: deliveryView(finalReply),
        route: latestRouteBySourceEvent.get(event.id) ?? null,
        failureCode: event.sharedContentFailures?.[0]?.reason
          ? String(event.sharedContentFailures[0].reason).slice(0, 120)
          : event.sharedContentFailureCode
            ? String(event.sharedContentFailureCode).slice(0, 120)
            : null,
      };
    })
    .sort((left, right) => String(right.detectedAt ?? "").localeCompare(String(left.detectedAt ?? ""))
      || String(right.eventId).localeCompare(String(left.eventId)))
    .slice(0, boundedLimit);
}

export function channelOperations({
  channels = [],
  channelIdentities = [],
  channelEvents = [],
  channelConversations = [],
  channelDeliveries = [],
  channelTaskThreads = [],
  readinessForChannel = null,
  runtimeAccountForChannel = null,
  now = () => new Date().toISOString(),
} = {}) {
  const byChannel = (rows, channelId) => rows.filter((row) => row?.channelId === channelId);

  return channels.map((channel) => {
    const events = byChannel(channelEvents, channel.id);
    const deliveries = byChannel(channelDeliveries, channel.id);
    const taskThreads = byChannel(channelTaskThreads, channel.id);
    const failed = deliveries.filter((row) => row.status === "failed_terminal");
    const unconfirmed = deliveries.filter((row) => row.status === "sent_unconfirmed");
    const resultDeliveryIds = new Set(taskThreads.map((thread) => thread.lastDeliveryId).filter(Boolean));
    const legacyResultKeys = new Set(taskThreads
      .filter((thread) => ["succeeded", "failed"].includes(thread.status))
      .flatMap((thread) => (thread.sourceEventIds ?? []).map((eventId) => `channel-event:${eventId}:reply`)));
    const actionableUnconfirmed = unconfirmed.filter((row) =>
      row.taskContext?.deliveryKind === "result"
      || row.taskContext?.notificationEvent === "succeeded"
      || row.sourceContext?.kind === "work_item_report"
      || resultDeliveryIds.has(row.id)
      || legacyResultKeys.has(row.dedupeKey));
    const nowMs = Date.parse(now());
    const delayedUnconfirmed = actionableUnconfirmed.filter((row) => {
      const acceptedAt = Date.parse(row.providerAcceptedAt ?? row.updatedAt ?? row.createdAt ?? "");
      return Number.isFinite(nowMs) && Number.isFinite(acceptedAt) && nowMs - acceptedAt >= 60_000;
    });
    const latestUnconfirmed = actionableUnconfirmed
      .slice()
      .sort((left, right) => String(right.providerAcceptedAt ?? right.updatedAt ?? right.createdAt ?? "")
        .localeCompare(String(left.providerAcceptedAt ?? left.updatedAt ?? left.createdAt ?? "")))[0] ?? null;
    const taskSummary = {
      total: taskThreads.length,
      queued: taskThreads.filter((row) => row.status === "queued").length,
      running: taskThreads.filter((row) => row.status === "running").length,
      waitingUpstream: taskThreads.filter((row) => row.status === "waiting_upstream").length,
      waitingApproval: taskThreads.filter((row) => ["awaiting_confirmation", "waiting_approval"].includes(row.status)).length,
      waitingUser: taskThreads.filter((row) => row.status === "waiting_user").length,
      needsAttention: taskThreads.filter((row) => row.status === "needs_attention").length,
      humanTakeover: taskThreads.filter((row) => row.status === "human_takeover").length,
      succeeded: taskThreads.filter((row) => row.status === "succeeded").length,
      failed: taskThreads.filter((row) => row.status === "failed").length,
      cancelled: taskThreads.filter((row) => row.status === "cancelled").length,
    };
    taskSummary.active = taskSummary.queued
      + taskSummary.running
      + taskSummary.waitingUpstream
      + taskSummary.waitingApproval
      + taskSummary.waitingUser
      + taskSummary.needsAttention
      + taskSummary.humanTakeover;
    const readiness = typeof readinessForChannel === "function" ? readinessForChannel(channel) : (channel.readiness ?? {});
    const runtimeAccount = typeof runtimeAccountForChannel === "function"
      ? runtimeAccountForChannel(channel)
      : null;
    const readinessValues = Object.values(readiness);
    const ready = readinessValues.length > 0 && readinessValues.every(Boolean);
    const lastActivityAt = [
      ...events.map((row) => row.receivedAt),
      ...deliveries.map((row) => row.updatedAt),
      ...taskThreads.map((row) => row.lastActivityAt ?? row.updatedAt ?? row.createdAt),
    ]
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    const lastInboundAt = events.map((row) => row.receivedAt).filter(Boolean).sort().at(-1) ?? null;
    const lastOutboundAt = deliveries.map((row) => row.createdAt ?? row.updatedAt).filter(Boolean).sort().at(-1) ?? null;
    const lastDeliveredAt = deliveries.filter((row) => row.status === "delivered").map((row) => row.updatedAt ?? row.createdAt).filter(Boolean).sort().at(-1) ?? null;
    const lastFailure = deliveries
      .filter((row) => row.status === "failed_terminal")
      .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))[0] ?? null;

    // Degrade-only health (mirrors the application health probe): a channel is
    // "attention" when enabled-but-not-ready or carrying terminal failures.
    let health = "ok";
    if (channel.status !== "enabled") health = "idle";
    else if (!ready || failed.length > 0 || delayedUnconfirmed.length > 0 || taskSummary.failed > 0) health = "attention";

    return {
      id: channel.id,
      provider: channel.provider,
      name: channel.name,
      status: channel.status,
      ownerTeamId: channel.ownerTeamId ?? null,
      readiness,
      ready,
      health,
      // Keep the provider runtime summary explicitly allowlisted. The runtime
      // callback already returns a public view, but this prevents credentials,
      // cursors, or future private fields from reaching the browser.
      ilinkAccount: runtimeAccount ? {
        status: runtimeAccount.status ?? null,
        botId: runtimeAccount.botId ?? null,
        lastPollAt: runtimeAccount.lastPollAt ?? null,
        lastMessageAt: runtimeAccount.lastMessageAt ?? null,
        lastError: runtimeAccount.lastError ?? null,
        pairingStatus: runtimeAccount.pairingStatus ?? null,
        workerFailureCount: Number(runtimeAccount.workerFailureCount ?? 0),
        nextRetryAt: runtimeAccount.nextRetryAt ?? null,
        connectedAt: runtimeAccount.connectedAt ?? null,
        updatedAt: runtimeAccount.updatedAt ?? null,
        pairingExpiresAt: runtimeAccount.pairingExpiresAt ?? null,
      } : null,
      capabilityAllowlist: channel.capabilityAllowlist ?? [],
      statusCapability: channel.statusCapability ?? null,
      // The project /task files issues into (null = /task disabled for this channel).
      taskProjectId: channel.taskProjectId ?? null,
      taskTerminalId: channel.taskTerminalId ?? null,
      operationMode: channel.operationMode === "team" ? "team" : "personal",
      taskAutoRoute: Boolean(channel.taskAutoRoute),
      taskDailyLimit: Number.isInteger(channel.taskDailyLimit) ? channel.taskDailyLimit : 50,
      taskDayDate: channel.taskDayDate ?? null,
      taskDayCount: channel.taskDayCount ?? 0,
      allowSelfApprove: Boolean(channel.allowSelfApprove),
      counts: {
        identities: byChannel(channelIdentities, channel.id).length,
        conversations: byChannel(channelConversations, channel.id).length,
        events: events.length,
        deliveries: deliveries.length,
        failedDeliveries: failed.length,
        unconfirmedDeliveries: unconfirmed.length,
        injectionFlagged: events.filter((row) => row.injectionSuspicious).length,
      },
      taskSummary,
      lastActivityAt,
      lastInboundAt,
      lastOutboundAt,
      lastDeliveredAt,
      lastFailureAt: lastFailure?.updatedAt ?? lastFailure?.createdAt ?? null,
      lastFailureCode: lastFailure?.lastErrorCode ?? null,
      deliveryHealth: {
        state: delayedUnconfirmed.length > 0
          ? "outbound_delayed"
          : actionableUnconfirmed.length > 0
            ? "awaiting_visibility"
            : failed.length > 0
              ? "outbound_failed"
              : "healthy",
        unconfirmedCount: actionableUnconfirmed.length,
        delayedCount: delayedUnconfirmed.length,
        latestDeliveryId: latestUnconfirmed?.id ?? null,
        latestAcceptedAt: latestUnconfirmed?.providerAcceptedAt ?? latestUnconfirmed?.updatedAt ?? latestUnconfirmed?.createdAt ?? null,
        retryAfter: latestUnconfirmed?.nextManualRetryAt ?? null,
      },
      pipeline: {
        inbound: Object.fromEntries([...new Set(events.map((row) => row.status).filter(Boolean))].map((status) => [status, events.filter((row) => row.status === status).length])),
        outbound: Object.fromEntries([...new Set(deliveries.map((row) => row.status).filter(Boolean))].map((status) => [status, deliveries.filter((row) => row.status === status).length])),
      },
      recentLinks: recentChannelLinkDiagnostics(events, deliveries),
    };
  });
}

export function channelTaskOperations({ requests = [], autoRuns = [], invocations = [], deliveries = [], workItems = [] } = {}) {
  const runById = new Map(autoRuns.map((item) => [item.id, item]));
  const invocationById = new Map(invocations.map((item) => [item.id, item]));
  const workItemById = new Map(workItems.map((item) => [item.id, item]));
  return requests.map((request) => {
    const autoRun = request.autoRunId ? runById.get(request.autoRunId) ?? null : null;
    const requestInvocationId = autoRun?.invocationId ?? request.invocationId ?? null;
    const invocation = requestInvocationId ? invocationById.get(requestInvocationId) ?? null : null;
    const delivery = invocation ? deliveries.find((item) => item.invocationId === invocation.id) ?? null : null;
    const runStatus = autoRun?.status ?? null;
    const stage = request.status === "pending" ? "awaiting_route"
      : request.status === "dismissed" ? "dismissed"
        : request.status === "human_takeover" ? "human_takeover"
          : runStatus ? `run_${runStatus}` : request.status;
    const failed = ["failed", "blocked"].includes(runStatus);
    const active = ["materializing", "running", "waiting_capacity", "verifying", "publishing", "awaiting_approval"].includes(runStatus);
    const wechatDraftResult = parseWechatDraftInvocationResult(invocation);
    const wechatDraftNeedsReconciliation = wechatDraftResult?.status === "unconfirmed"
      || wechatDraftResult?.sideEffectState === "unknown";
    const wechatDraftNeedsLogin = wechatDraftResult?.status === "session_expired"
      && wechatDraftResult?.sideEffectState === "not_started";
    const workItem = request.workItemId ? workItemById.get(request.workItemId) ?? null : null;
    const resultVerification = (workItem?.resultVerificationContract || workItem?.artifactContract?.requirements?.length)
      ? (workItem.resultVerification ?? verifyWorkItemResult(workItem))
      : null;
    return {
      ...request,
      stage,
      runStatus,
      invocationId: invocation?.id ?? null,
      invocationStatus: invocation?.status ?? null,
      resultSummary: invocation?.result?.summary ?? invocation?.result?.error ?? autoRun?.error ?? null,
      ...(resultVerification ? {
        resultVerification: {
          status: resultVerification.status,
          summary: resultVerification.summary,
          checks: (resultVerification.checks ?? []).slice(0, 20).map((check) => ({
            kind: check.kind,
            status: check.status,
            summary: check.summary,
            expected: check.expected ?? null,
            actual: check.actual ?? null,
          })),
          verificationChecks: (resultVerification.verificationChecks ?? []).slice(0, 20).map((check) => ({
            kind: check.kind,
            status: check.status,
            summary: check.summary,
          })),
          repair: resultVerification.repair ? {
            required: resultVerification.repair.required,
            mode: resultVerification.repair.mode,
            reasons: (resultVerification.repair.reasons ?? []).slice(0, 10),
            suggestedRequest: resultVerification.repair.suggestedRequest,
          } : null,
        },
      } : {}),
      deliveryStatus: delivery?.status ?? null,
      actions: {
        retry: failed && !wechatDraftNeedsReconciliation,
        reroute: failed && ["dispatch_timeout", "orphaned", "stuck"].includes(autoRun?.errorCode),
        takeover: request.status === "routed" && (active || failed),
        ...(wechatDraftNeedsReconciliation ? { reconcileSaved: true, reconcileNotSaved: true } : {}),
        ...(wechatDraftNeedsLogin ? { connectLogin: true } : {}),
      },
    };
  });
}
