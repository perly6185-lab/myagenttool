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
} = {}) {
  const byChannel = (rows, channelId) => rows.filter((row) => row?.channelId === channelId);

  return channels.map((channel) => {
    const events = byChannel(channelEvents, channel.id);
    const deliveries = byChannel(channelDeliveries, channel.id);
    const failed = deliveries.filter((row) => row.status === "failed_terminal");
    const readinessValues = Object.values(channel.readiness ?? {});
    const ready = readinessValues.length > 0 && readinessValues.every(Boolean);
    const lastActivityAt = [
      ...events.map((row) => row.receivedAt),
      ...deliveries.map((row) => row.updatedAt),
    ]
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

    // Degrade-only health (mirrors the application health probe): a channel is
    // "attention" when enabled-but-not-ready or carrying terminal failures.
    let health = "ok";
    if (channel.status !== "enabled") health = "idle";
    else if (!ready || failed.length > 0) health = "attention";

    return {
      id: channel.id,
      provider: channel.provider,
      name: channel.name,
      status: channel.status,
      ownerTeamId: channel.ownerTeamId ?? null,
      readiness: channel.readiness ?? {},
      ready,
      health,
      capabilityAllowlist: channel.capabilityAllowlist ?? [],
      statusCapability: channel.statusCapability ?? null,
      // The project /task files issues into (null = /task disabled for this channel).
      taskProjectId: channel.taskProjectId ?? null,
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
      lastActivityAt,
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
