/*
 * Channel Registry routes (S2, #1090/ADR 0012). All mutating routes are
 * owner-team scoped inside the service (foreign team → 404, never 403);
 * enable is approval-gated. Recorded in TENANCY_ROUTE_MATRIX.md.
 */

export async function handleChannelRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  actor,
  registerChannel,
  setChannelTaskProject,
  setChannelApprovalPolicy,
  routeChannelTask,
  dismissChannelTask,
  retryChannelTask,
  rerouteChannelTask,
  takeoverChannelTask,
  replyChannelTask,
  listChannels,
  listChannelInteractions,
  enableChannel,
  disableChannel,
  channelHealth,
  channelDiagnostics,
  mapChannelIdentity,
  removeChannelIdentity,
  listChannelIdentities,
  setChannelAllowlist,
  retryChannelDelivery,
  beginIlinkLogin,
  pollIlinkLogin,
  activateIlinkChannel,
  disconnectIlinkChannel,
  onIlinkChannelStateChanged,
  getChannelNotificationPolicy,
  listChannelNotificationPolicies,
  setChannelNotificationPolicy,
}) {
  if (!url.pathname.startsWith("/api/channels") && !url.pathname.startsWith("/api/channel-tasks/")) return false;

  if (req.method === "GET" && url.pathname === "/api/channels") {
    const result = listChannels(actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const diagnostics = url.pathname.match(/^\/api\/channels\/([^/]+)\/diagnostics$/);
  if (diagnostics && req.method === "GET" && typeof channelDiagnostics === "function") {
    const result = channelDiagnostics({ channelId: decodeURIComponent(diagnostics[1]) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const interactions = url.pathname.match(/^\/api\/channels\/([^/]+)\/interactions$/);
  if (interactions && req.method === "GET" && typeof listChannelInteractions === "function") {
    const result = listChannelInteractions({
      channelId: decodeURIComponent(interactions[1]),
      conversationId: url.searchParams.get("conversationId"),
      direction: url.searchParams.get("direction") ?? "all",
      type: url.searchParams.get("type") ?? "all",
      status: url.searchParams.get("status") ?? "all",
      query: url.searchParams.get("q") ?? "",
      cursor: url.searchParams.get("cursor"),
      limit: url.searchParams.get("limit") ?? 50,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const notificationPolicy = url.pathname.match(/^\/api\/channels\/([^/]+)\/notification-policy$/);
  if (notificationPolicy && req.method === "GET" && typeof getChannelNotificationPolicy === "function") {
    const channelId = decodeURIComponent(notificationPolicy[1]);
    const conversationId = url.searchParams.get("conversationId");
    const threadId = url.searchParams.get("threadId");
    const result = conversationId
      ? getChannelNotificationPolicy({ channelId, conversationId, threadId: threadId || null }, actor)
      : (typeof listChannelNotificationPolicies === "function" ? listChannelNotificationPolicies({ channelId }, actor) : { policies: [] });
    sendJson(res, 200, result);
    return true;
  }
  if (notificationPolicy && req.method === "PUT" && typeof setChannelNotificationPolicy === "function") {
    const body = await readJson(req);
    const result = setChannelNotificationPolicy({
      channelId: decodeURIComponent(notificationPolicy[1]),
      conversationId: body?.conversationId,
      threadId: body?.threadId ?? null,
      patch: body?.patch ?? body,
      actorId: actor?.userId ?? null,
    });
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/channels") {
    const body = await readJson(req);
    const result = registerChannel({ provider: body?.provider, name: body?.name }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const ilink = url.pathname.match(/^\/api\/channels\/([^/]+)\/ilink\/(login|activate|disconnect)$/);
  if (ilink) {
    const channelId = decodeURIComponent(ilink[1]);
    const action = ilink[2];
    if (action === "login" && req.method === "POST" && typeof beginIlinkLogin === "function") {
      const result = await beginIlinkLogin({ channelId, actor });
      sendJson(res, result.status, result.body);
      return true;
    }
    if (action === "login" && req.method === "GET" && typeof pollIlinkLogin === "function") {
      const result = await pollIlinkLogin({ channelId, actor, verifyCode: url.searchParams.get("verify_code") ?? undefined });
      sendJson(res, result.status, result.body);
      return true;
    }
    if (action === "activate" && req.method === "POST" && typeof activateIlinkChannel === "function") {
      const body = await readJson(req);
      const result = await activateIlinkChannel({ channelId, approvalToken: body?.approvalToken, actor });
      sendJson(res, result.status, result.body);
      return true;
    }
    if (action === "disconnect" && req.method === "POST" && typeof disconnectIlinkChannel === "function") {
      const result = await disconnectIlinkChannel({ channelId, actor });
      sendJson(res, result.status, result.body);
      return true;
    }
  }

  const deliveryRetry = url.pathname.match(/^\/api\/channels\/([^/]+)\/deliveries\/([^/]+)\/retry$/);
  if (deliveryRetry && req.method === "POST") {
    const body = await readJson(req);
    const result = retryChannelDelivery(
      {
        channelId: decodeURIComponent(deliveryRetry[1]),
        deliveryId: decodeURIComponent(deliveryRetry[2]),
        approvalToken: body?.approvalToken,
      },
      actor,
    );
    sendJson(res, result.status, result.body);
    return true;
  }

  const allowlist = url.pathname.match(/^\/api\/channels\/([^/]+)\/allowlist$/);
  if (allowlist && req.method === "POST") {
    const body = await readJson(req);
    const result = setChannelAllowlist(
      {
        channelId: decodeURIComponent(allowlist[1]),
        capabilities: body?.capabilities,
        statusCapability: body?.statusCapability ?? null,
        approvalToken: body?.approvalToken,
      },
      actor,
    );
    sendJson(res, result.status, result.body);
    return true;
  }

  // Capture-then-promote: route a pending /task request into a tracked auto-run,
  // or dismiss it (close the issue). Actor-gated same-team inside the action.
  const channelTask = url.pathname.match(/^\/api\/channel-tasks\/([^/]+)\/(route|dismiss|retry|reroute|takeover)$/);
  if (channelTask && req.method === "POST") {
    const id = decodeURIComponent(channelTask[1]);
    const actions = { route: routeChannelTask, dismiss: dismissChannelTask, retry: retryChannelTask, reroute: rerouteChannelTask, takeover: takeoverChannelTask };
    const action = actions[channelTask[2]];
    const result = typeof action === "function" ? await action(id, actor) : { status: 501, body: { error: "unavailable" } };
    sendJson(res, result.status, result.body);
    return true;
  }

  const channelTaskReply = url.pathname.match(/^\/api\/channel-tasks\/([^/]+)\/reply$/);
  if (channelTaskReply && req.method === "POST") {
    const body = await readJson(req);
    const result = typeof replyChannelTask === "function"
      ? await replyChannelTask(decodeURIComponent(channelTaskReply[1]), body?.content, actor)
      : { status: 501, body: { error: "unavailable" } };
    sendJson(res, result.status, result.body);
    return true;
  }

  const taskProject = url.pathname.match(/^\/api\/channels\/([^/]+)\/task-project$/);
  if (taskProject && req.method === "POST") {
    const body = await readJson(req);
    const result = setChannelTaskProject(
      { channelId: decodeURIComponent(taskProject[1]), projectId: body?.projectId ?? null, terminalId: body?.terminalId ?? null, autoRoute: body?.autoRoute, dailyLimit: body?.dailyLimit, operationMode: body?.operationMode, approvalToken: body?.approvalToken },
      actor,
    );
    sendJson(res, result.status, result.body);
    return true;
  }

  const approvalPolicy = url.pathname.match(/^\/api\/channels\/([^/]+)\/approval-policy$/);
  if (approvalPolicy && req.method === "POST") {
    const body = await readJson(req);
    const result = setChannelApprovalPolicy(
      { channelId: decodeURIComponent(approvalPolicy[1]), allowSelfApprove: body?.allowSelfApprove, approvalToken: body?.approvalToken },
      actor,
    );
    sendJson(res, result.status, result.body);
    return true;
  }

  const lifecycle = url.pathname.match(/^\/api\/channels\/([^/]+)\/(enable|disable|health)$/);
  if (lifecycle) {
    const channelId = decodeURIComponent(lifecycle[1]);
    if (req.method === "POST" && lifecycle[2] === "enable") {
      const body = await readJson(req);
      const result = enableChannel({ channelId, approvalToken: body?.approvalToken }, actor);
      if (result?.ok) onIlinkChannelStateChanged?.(channelId);
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "POST" && lifecycle[2] === "disable") {
      const result = disableChannel({ channelId }, actor);
      if (result?.ok) onIlinkChannelStateChanged?.(channelId);
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "GET" && lifecycle[2] === "health") {
      const result = channelHealth({ channelId }, actor);
      sendJson(res, result.status, result.body);
      return true;
    }
  }

  const identities = url.pathname.match(/^\/api\/channels\/([^/]+)\/identities(?:\/([^/]+))?$/);
  if (identities) {
    const channelId = decodeURIComponent(identities[1]);
    const identityId = identities[2] ? decodeURIComponent(identities[2]) : null;
    if (req.method === "GET" && !identityId) {
      const result = listChannelIdentities({ channelId }, actor);
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "POST" && !identityId) {
      const body = await readJson(req);
      const result = mapChannelIdentity(
        { channelId, externalUserId: body?.externalUserId, userId: body?.userId },
        actor,
      );
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "DELETE" && identityId) {
      const result = removeChannelIdentity({ channelId, identityId }, actor);
      sendJson(res, result.status, result.body);
      return true;
    }
  }

  return false;
}
