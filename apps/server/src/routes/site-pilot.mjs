export async function handleSitePilotRoutes({
  req, res, url, sendJson, readJson, actor,
  startSitePilotSession, getActiveSitePilotSession, updateSitePilotSession, deleteSitePilotSession, getSitePilotSummary,
  listSitePilotCampaigns, createSitePilotCampaign, updateSitePilotCampaign, deleteSitePilotCampaign,
  createSitePilotInvitation,
}) {
  if (!url.pathname.startsWith("/api/site-pilot")) return false;
  if (url.pathname === "/api/site-pilot/summary" && req.method === "GET") {
    const result = getSitePilotSummary(actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/site-pilot/campaigns" && ["GET", "POST"].includes(req.method)) {
    const result = req.method === "GET" ? listSitePilotCampaigns(actor) : createSitePilotCampaign(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const campaignMatch = url.pathname.match(/^\/api\/site-pilot\/campaigns\/([^/]+)$/);
  if (campaignMatch && ["PATCH", "DELETE"].includes(req.method)) {
    const input = { campaignId: decodeURIComponent(campaignMatch[1]), ...(req.method === "PATCH" ? await readJson(req) : {}) };
    const result = req.method === "PATCH" ? updateSitePilotCampaign(input, actor) : deleteSitePilotCampaign(input, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/site-pilot/sessions/active" && req.method === "GET") {
    const result = getActiveSitePilotSession({ invitationCode: url.searchParams.get("code") ?? "" }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const invitationMatch = url.pathname.match(/^\/api\/site-pilot\/campaigns\/([^/]+)\/invitations$/);
  if (invitationMatch && req.method === "POST") {
    const result = createSitePilotInvitation({ campaignId: decodeURIComponent(invitationMatch[1]), ...(await readJson(req)) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/site-pilot/sessions" && req.method === "POST") {
    const result = startSitePilotSession(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const match = url.pathname.match(/^\/api\/site-pilot\/sessions\/([^/]+)$/);
  if (!match || !["PATCH", "DELETE"].includes(req.method)) return false;
  const input = { sessionId: decodeURIComponent(match[1]), ...(req.method === "PATCH" ? await readJson(req) : {}) };
  const result = req.method === "PATCH" ? updateSitePilotSession(input, actor) : deleteSitePilotSession(input, actor);
  sendJson(res, result.status, result.body);
  return true;
}
