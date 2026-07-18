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
  routeChannelTask,
  dismissChannelTask,
  listChannels,
  enableChannel,
  disableChannel,
  channelHealth,
  mapChannelIdentity,
  removeChannelIdentity,
  listChannelIdentities,
  setChannelAllowlist,
  retryChannelDelivery,
}) {
  if (!url.pathname.startsWith("/api/channels")) return false;

  if (req.method === "GET" && url.pathname === "/api/channels") {
    const result = listChannels(actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/channels") {
    const body = await readJson(req);
    const result = registerChannel({ provider: body?.provider, name: body?.name }, actor);
    sendJson(res, result.status, result.body);
    return true;
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
  const channelTask = url.pathname.match(/^\/api\/channel-tasks\/([^/]+)\/(route|dismiss)$/);
  if (channelTask && req.method === "POST") {
    const id = decodeURIComponent(channelTask[1]);
    const action = channelTask[2] === "route" ? routeChannelTask : dismissChannelTask;
    const result = typeof action === "function" ? await action(id, actor) : { status: 501, body: { error: "unavailable" } };
    sendJson(res, result.status, result.body);
    return true;
  }

  const taskProject = url.pathname.match(/^\/api\/channels\/([^/]+)\/task-project$/);
  if (taskProject && req.method === "POST") {
    const body = await readJson(req);
    const result = setChannelTaskProject(
      { channelId: decodeURIComponent(taskProject[1]), projectId: body?.projectId ?? null, approvalToken: body?.approvalToken },
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
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "POST" && lifecycle[2] === "disable") {
      const result = disableChannel({ channelId }, actor);
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
