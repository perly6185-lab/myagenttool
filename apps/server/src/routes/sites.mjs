export async function handleSiteRoutes({
  req, res, url, sendJson, readJson, actor,
  resolveSitePilotWorkspace,
  listSites, getSite, createSite, updateSite,
  listEntries, getEntry, createEntry, updateEntry, previewSite,
  listAssets, uploadAsset, updateAsset, deleteAsset, getAssetContent,
  createPublicationPlan, getPublicationPlan, confirmPublicationPlan, listPublications,
  createRollbackPlan, confirmRollbackPlan,
  listDeploymentProviders, configureDeploymentTarget, verifyDeploymentTarget,
  configureDomainTlsBinding,
}) {
  const siteRequest = url.pathname === "/api/site-deployment-providers" || url.pathname.startsWith("/api/sites");
  if (!siteRequest) return false;
  const pilotCode = String(url.searchParams.get("pilotCode") ?? "").trim();
  if (pilotCode) {
    const workspace = await resolveSitePilotWorkspace({ invitationCode: pilotCode }, actor);
    if (!workspace.ok) {
      sendJson(res, workspace.status, workspace.body);
      return true;
    }
    actor = workspace.body.actor;
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-site-pilot-workspace", "isolated");
    if (actor.pilotScenario === "status_understanding" && req.method !== "GET") {
      sendJson(res, 403, { error: "site_pilot_workspace_read_only" });
      return true;
    }
  }
  if (url.pathname === "/api/site-deployment-providers" && req.method === "GET") {
    const result = listDeploymentProviders(actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (!url.pathname.startsWith("/api/sites")) return false;
  if (url.pathname === "/api/sites") {
    const result = req.method === "GET"
      ? listSites(actor)
      : req.method === "POST"
        ? createSite(await readJson(req), actor)
        : null;
    if (!result) return false;
    sendJson(res, result.status, result.body);
    return true;
  }

  const assetContentMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/assets\/([^/]+)\/content$/);
  if (assetContentMatch && req.method === "GET") {
    const result = getAssetContent({
      siteId: decodeURIComponent(assetContentMatch[1]),
      assetId: decodeURIComponent(assetContentMatch[2]),
      variant: url.searchParams.get("variant"),
    }, actor);
    if (!result.ok) sendJson(res, result.status, result.body);
    else {
      res.writeHead(200, {
        "content-type": result.body.asset.mimeType,
        "content-length": result.body.bytes.length,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      });
      res.end(result.body.bytes);
    }
    return true;
  }

  const assetsMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/assets$/);
  if (assetsMatch && ["GET", "PUT"].includes(req.method)) {
    const siteId = decodeURIComponent(assetsMatch[1]);
    const result = req.method === "GET"
      ? listAssets({ siteId, professional: url.searchParams.get("professional") === "1" }, actor)
      : await uploadAsset({
        siteId,
        name: url.searchParams.get("name") ?? "image",
        clientFileId: url.searchParams.get("clientFileId"),
        contentType: req.headers["content-type"] ?? "",
      }, req, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const assetMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/assets\/([^/]+)$/);
  if (assetMatch && ["PATCH", "DELETE"].includes(req.method)) {
    const input = { siteId: decodeURIComponent(assetMatch[1]), assetId: decodeURIComponent(assetMatch[2]), ...(await readJson(req)) };
    const result = req.method === "PATCH" ? updateAsset(input, actor) : deleteAsset(input, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const entriesMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/entries$/);
  if (entriesMatch && ["GET", "POST"].includes(req.method)) {
    const siteId = decodeURIComponent(entriesMatch[1]);
    const result = req.method === "GET"
      ? listEntries({ siteId, includeArchived: url.searchParams.get("includeArchived") === "1" }, actor)
      : createEntry({ siteId, ...(await readJson(req)) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const entryMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/entries\/([^/]+)$/);
  if (entryMatch && ["GET", "PATCH"].includes(req.method)) {
    const input = { siteId: decodeURIComponent(entryMatch[1]), entryId: decodeURIComponent(entryMatch[2]) };
    const result = req.method === "GET"
      ? getEntry(input, actor)
      : updateEntry({ ...input, ...(await readJson(req)) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const previewMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/preview$/);
  if (previewMatch && req.method === "GET") {
    const result = previewSite({ siteId: decodeURIComponent(previewMatch[1]), path: url.searchParams.get("path") ?? "index.html" }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const publicationPlansMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/publication-plans$/);
  if (publicationPlansMatch && req.method === "POST") {
    const result = createPublicationPlan({ siteId: decodeURIComponent(publicationPlansMatch[1]), ...(await readJson(req)) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const publicationConfirmMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/publication-plans\/([^/]+)\/confirm$/);
  if (publicationConfirmMatch && req.method === "POST") {
    const result = await confirmPublicationPlan({
      siteId: decodeURIComponent(publicationConfirmMatch[1]),
      planId: decodeURIComponent(publicationConfirmMatch[2]),
      ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const publicationPlanMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/publication-plans\/([^/]+)$/);
  if (publicationPlanMatch && req.method === "GET") {
    const result = getPublicationPlan({ siteId: decodeURIComponent(publicationPlanMatch[1]), planId: decodeURIComponent(publicationPlanMatch[2]) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const publicationsMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/publications$/);
  if (publicationsMatch && req.method === "GET") {
    const result = listPublications({ siteId: decodeURIComponent(publicationsMatch[1]), professional: url.searchParams.get("professional") === "1" }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const rollbackPlansMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/rollback-plans$/);
  if (rollbackPlansMatch && req.method === "POST") {
    const result = createRollbackPlan({ siteId: decodeURIComponent(rollbackPlansMatch[1]), ...(await readJson(req)) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const rollbackConfirmMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/rollback-plans\/([^/]+)\/confirm$/);
  if (rollbackConfirmMatch && req.method === "POST") {
    const result = await confirmRollbackPlan({
      siteId: decodeURIComponent(rollbackConfirmMatch[1]),
      planId: decodeURIComponent(rollbackConfirmMatch[2]),
      ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const targetMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/deployment-target$/);
  if (targetMatch && req.method === "PUT") {
    const result = configureDeploymentTarget({ siteId: decodeURIComponent(targetMatch[1]), ...(await readJson(req)) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const targetVerifyMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/deployment-target\/verify$/);
  if (targetVerifyMatch && req.method === "POST") {
    const result = await verifyDeploymentTarget({ siteId: decodeURIComponent(targetVerifyMatch[1]) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const domainTlsMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/domain-tls-binding$/);
  if (domainTlsMatch && req.method === "PUT") {
    const result = configureDomainTlsBinding({ siteId: decodeURIComponent(domainTlsMatch[1]), ...(await readJson(req)) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const siteMatch = url.pathname.match(/^\/api\/sites\/([^/]+)$/);
  if (!siteMatch) return false;
  const siteId = decodeURIComponent(siteMatch[1]);
  const result = req.method === "GET"
    ? getSite({ siteId, professional: url.searchParams.get("professional") === "1" }, actor)
    : req.method === "PATCH"
      ? updateSite({ siteId, ...(await readJson(req)) }, actor)
      : null;
  if (!result) return false;
  sendJson(res, result.status, result.body);
  return true;
}
