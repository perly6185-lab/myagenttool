export async function handleArticleExtractorPluginRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  actor,
  listPlugins,
  planInstall,
  installPlugin,
  disablePlugin,
  activatePlugin,
}) {
  if (url.pathname === "/api/article-extractor-plugins" && req.method === "GET") {
    const result = listPlugins({}, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/article-extractor-plugins/install-plan" && req.method === "POST") {
    const result = planInstall(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/article-extractor-plugins" && req.method === "POST") {
    const result = await installPlugin(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const disableMatch = url.pathname.match(/^\/api\/article-extractor-plugins\/([^/]+)\/disable$/);
  if (disableMatch && req.method === "POST") {
    const result = disablePlugin({ ...(await readJson(req)), pluginId: decodeURIComponent(disableMatch[1]) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const activateMatch = url.pathname.match(/^\/api\/article-extractor-plugins\/([^/]+)\/versions\/([^/]+)\/activate$/);
  if (activateMatch && req.method === "POST") {
    const result = activatePlugin({
      ...(await readJson(req)),
      pluginId: decodeURIComponent(activateMatch[1]),
      version: decodeURIComponent(activateMatch[2]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  return false;
}
