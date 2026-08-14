export async function handleLocalContentRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  actor,
  rebuildLocalContentCatalog,
  searchLocalContent,
  getLocalContentCatalogStats,
}) {
  if (req.method === "GET" && url.pathname === "/api/local-content") {
    const result = await searchLocalContent({
      query: url.searchParams.get("q") ?? "",
      kinds: url.searchParams.getAll("kind").flatMap((value) => value.split(",")),
      projectId: url.searchParams.get("projectId"),
      limit: url.searchParams.get("limit"),
      offset: url.searchParams.get("offset"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/local-content/stats") {
    const result = await getLocalContentCatalogStats(actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/local-content/rebuild") {
    const body = await readJson(req);
    const result = await rebuildLocalContentCatalog(body, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  return false;
}
