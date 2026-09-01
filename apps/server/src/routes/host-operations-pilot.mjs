export async function handleHostOperationsPilotRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  actor,
  listHostOperationsPilotCampaigns,
  createHostOperationsPilotCampaign,
  updateHostOperationsPilotCampaign,
  getActiveHostOperationsPilotSession,
  startHostOperationsPilotSession,
  completeHostOperationsPilotSession,
  deleteHostOperationsPilotSession,
  getHostOperationsPilotEvidence,
}) {
  if (!url.pathname.startsWith("/api/host-operations-pilot")) return false;

  if (url.pathname === "/api/host-operations-pilot/campaigns" && ["GET", "POST"].includes(req.method)) {
    const result = req.method === "GET"
      ? listHostOperationsPilotCampaigns(actor)
      : createHostOperationsPilotCampaign(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const evidenceMatch = url.pathname.match(/^\/api\/host-operations-pilot\/campaigns\/([^/]+)\/evidence$/);
  if (evidenceMatch && req.method === "GET") {
    const result = getHostOperationsPilotEvidence({ campaignId: decodeURIComponent(evidenceMatch[1]) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const campaignMatch = url.pathname.match(/^\/api\/host-operations-pilot\/campaigns\/([^/]+)$/);
  if (campaignMatch && req.method === "PATCH") {
    const result = updateHostOperationsPilotCampaign({ campaignId: decodeURIComponent(campaignMatch[1]), ...(await readJson(req)) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/host-operations-pilot/sessions/active" && req.method === "GET") {
    const result = getActiveHostOperationsPilotSession({
      inviteCode: url.searchParams.get("code") ?? "",
      sshTargetId: url.searchParams.get("hostId") ?? "",
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/host-operations-pilot/sessions" && req.method === "POST") {
    const result = startHostOperationsPilotSession(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const sessionMatch = url.pathname.match(/^\/api\/host-operations-pilot\/sessions\/([^/]+)$/);
  if (sessionMatch && ["PATCH", "DELETE"].includes(req.method)) {
    const input = { sessionId: decodeURIComponent(sessionMatch[1]), ...(req.method === "PATCH" ? await readJson(req) : {}) };
    const result = req.method === "PATCH"
      ? completeHostOperationsPilotSession(input, actor)
      : deleteHostOperationsPilotSession(input, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  sendJson(res, 404, { error: "host_operations_pilot_route_not_found" });
  return true;
}
