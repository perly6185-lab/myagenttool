/*
 * Local business-object registry used by Channel execution previews.
 * Values are team-scoped and account identifiers are write-only: only a
 * masked suffix is retained and returned.
 */

export async function handleChannelObjectRoutes({
  req, res, url, sendJson, readJson, actor,
  listChannelObjects, upsertChannelObject, setChannelObjectStatus,
  previewChannelObjectImport, confirmChannelObjectImport, listChannelObjectImports, listChannelObjectFileSources,
  listChannelMutationBindings, upsertChannelMutationBinding, setChannelMutationBindingStatus,
  listChannelObjectConnectors, listChannelObjectConnectorConfigs, upsertChannelObjectConnectorConfig,
  setChannelObjectConnectorConfigStatus, testChannelObjectConnectorConfig,
  previewChannelObjectConnectorSync, confirmChannelObjectConnectorSync,
  syncChannelObjectConnector, retryChannelObjectConnectorSync, listChannelObjectSyncs,
}) {
  if (url.pathname === "/api/channel-objects/connectors" && req.method === "GET") {
    const result = listChannelObjectConnectors({ projectId: url.searchParams.get("projectId") }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects/connector-configs" && req.method === "GET") {
    const result = listChannelObjectConnectorConfigs({ projectId: url.searchParams.get("projectId") }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects/connector-configs" && req.method === "POST") {
    const result = upsertChannelObjectConnectorConfig(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const connectorConfigStatus = url.pathname.match(/^\/api\/channel-objects\/connector-configs\/([^/]+)\/status$/);
  if (connectorConfigStatus && (req.method === "PATCH" || req.method === "POST")) {
    const result = setChannelObjectConnectorConfigStatus(decodeURIComponent(connectorConfigStatus[1]), await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const connectorConfigTest = url.pathname.match(/^\/api\/channel-objects\/connector-configs\/([^/]+)\/test$/);
  if (connectorConfigTest && req.method === "POST") {
    const result = await testChannelObjectConnectorConfig(decodeURIComponent(connectorConfigTest[1]), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects/sync/preview" && req.method === "POST") {
    const result = await previewChannelObjectConnectorSync(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects/sync/confirm" && req.method === "POST") {
    const result = confirmChannelObjectConnectorSync(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects/syncs" && req.method === "GET") {
    const result = listChannelObjectSyncs({ projectId: url.searchParams.get("projectId") }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects/sync" && req.method === "POST") {
    const result = await syncChannelObjectConnector(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const syncRetry = url.pathname.match(/^\/api\/channel-objects\/syncs\/([^/]+)\/retry$/);
  if (syncRetry && req.method === "POST") {
    const result = await retryChannelObjectConnectorSync(decodeURIComponent(syncRetry[1]), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects/imports" && req.method === "GET") {
    const result = listChannelObjectImports({ projectId: url.searchParams.get("projectId") }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects/file-sources" && req.method === "GET") {
    const result = listChannelObjectFileSources({ projectId: url.searchParams.get("projectId"), kind: url.searchParams.get("kind") }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects/mutation-bindings" && req.method === "GET") {
    const result = listChannelMutationBindings({
      projectId: url.searchParams.get("projectId"),
      fileSourceId: url.searchParams.get("fileSourceId"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects/mutation-bindings" && req.method === "POST") {
    const result = upsertChannelMutationBinding(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const mutationBindingStatus = url.pathname.match(/^\/api\/channel-objects\/mutation-bindings\/([^/]+)\/status$/);
  if (mutationBindingStatus && (req.method === "PATCH" || req.method === "POST")) {
    const result = setChannelMutationBindingStatus(
      decodeURIComponent(mutationBindingStatus[1]),
      await readJson(req),
      actor,
    );
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects/import/preview" && req.method === "POST") {
    const result = await previewChannelObjectImport(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects/import/confirm" && req.method === "POST") {
    const result = confirmChannelObjectImport(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects" && req.method === "GET") {
    const result = listChannelObjects({
      kind: url.searchParams.get("kind"),
      projectId: url.searchParams.get("projectId"),
      status: url.searchParams.get("status"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/channel-objects" && req.method === "POST") {
    const result = upsertChannelObject(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const statusAction = url.pathname.match(/^\/api\/channel-objects\/([^/]+)\/status$/);
  if (statusAction && (req.method === "PATCH" || req.method === "POST")) {
    const result = setChannelObjectStatus(decodeURIComponent(statusAction[1]), await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  return false;
}
