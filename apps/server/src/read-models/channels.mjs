/*
 * Channel operations read-model (S7, #1090): a per-channel operational rollup
 * for the console — readiness, lifecycle, activity counts, delivery-failure
 * tally, and last activity. Pure over already-team-scoped inputs (the caller
 * passes the visibility-filtered channel collections from buildPublicState), so
 * no secret or cross-team data can reach it.
 */

export function channelOperations({
  channels = [],
  channelIdentities = [],
  channelEvents = [],
  channelConversations = [],
  channelDeliveries = [],
  channelTaskThreads = [],
  readinessForChannel = null,
} = {}) {
  const byChannel = (rows, channelId) => rows.filter((row) => row?.channelId === channelId);

  return channels.map((channel) => {
    const events = byChannel(channelEvents, channel.id);
    const deliveries = byChannel(channelDeliveries, channel.id);
    const taskThreads = byChannel(channelTaskThreads, channel.id);
    const failed = deliveries.filter((row) => row.status === "failed_terminal");
    const taskSummary = {
      total: taskThreads.length,
      queued: taskThreads.filter((row) => row.status === "queued").length,
      running: taskThreads.filter((row) => row.status === "running").length,
      waitingApproval: taskThreads.filter((row) => ["awaiting_confirmation", "waiting_approval"].includes(row.status)).length,
      waitingUser: taskThreads.filter((row) => row.status === "waiting_user").length,
      humanTakeover: taskThreads.filter((row) => row.status === "human_takeover").length,
      succeeded: taskThreads.filter((row) => row.status === "succeeded").length,
      failed: taskThreads.filter((row) => row.status === "failed").length,
      cancelled: taskThreads.filter((row) => row.status === "cancelled").length,
    };
    taskSummary.active = taskSummary.queued
      + taskSummary.running
      + taskSummary.waitingApproval
      + taskSummary.waitingUser
      + taskSummary.humanTakeover;
    const readiness = typeof readinessForChannel === "function" ? readinessForChannel(channel) : (channel.readiness ?? {});
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
    else if (!ready || failed.length > 0 || taskSummary.failed > 0) health = "attention";

    return {
      id: channel.id,
      provider: channel.provider,
      name: channel.name,
      status: channel.status,
      ownerTeamId: channel.ownerTeamId ?? null,
      readiness,
      ready,
      health,
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
        injectionFlagged: events.filter((row) => row.injectionSuspicious).length,
      },
      taskSummary,
      lastActivityAt,
      lastInboundAt,
      lastOutboundAt,
      lastDeliveredAt,
      lastFailureAt: lastFailure?.updatedAt ?? lastFailure?.createdAt ?? null,
      lastFailureCode: lastFailure?.lastErrorCode ?? null,
      pipeline: {
        inbound: Object.fromEntries([...new Set(events.map((row) => row.status).filter(Boolean))].map((status) => [status, events.filter((row) => row.status === status).length])),
        outbound: Object.fromEntries([...new Set(deliveries.map((row) => row.status).filter(Boolean))].map((status) => [status, deliveries.filter((row) => row.status === status).length])),
      },
    };
  });
}

export function channelTaskOperations({ requests = [], autoRuns = [], invocations = [], deliveries = [] } = {}) {
  const runById = new Map(autoRuns.map((item) => [item.id, item]));
  const invocationById = new Map(invocations.map((item) => [item.id, item]));
  return requests.map((request) => {
    const autoRun = request.autoRunId ? runById.get(request.autoRunId) ?? null : null;
    const invocation = autoRun?.invocationId ? invocationById.get(autoRun.invocationId) ?? null : null;
    const delivery = invocation ? deliveries.find((item) => item.invocationId === invocation.id) ?? null : null;
    const runStatus = autoRun?.status ?? null;
    const stage = request.status === "pending" ? "awaiting_route"
      : request.status === "dismissed" ? "dismissed"
        : request.status === "human_takeover" ? "human_takeover"
          : runStatus ? `run_${runStatus}` : request.status;
    const failed = ["failed", "blocked"].includes(runStatus);
    const active = ["materializing", "running", "waiting_capacity", "verifying", "publishing", "awaiting_approval"].includes(runStatus);
    return {
      ...request,
      stage,
      runStatus,
      invocationId: invocation?.id ?? null,
      invocationStatus: invocation?.status ?? null,
      resultSummary: invocation?.result?.summary ?? invocation?.result?.error ?? autoRun?.error ?? null,
      deliveryStatus: delivery?.status ?? null,
      actions: {
        retry: failed,
        reroute: failed && ["dispatch_timeout", "orphaned", "stuck"].includes(autoRun?.errorCode),
        takeover: request.status === "routed" && (active || failed),
      },
    };
  });
}
