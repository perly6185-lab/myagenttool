import { revealFileInFileManager } from "../services/asset-reveal.mjs";

export async function handleLocalContentRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  actor,
  rebuildLocalContentCatalog,
  searchLocalContent,
  browseLocalContentDirectories,
  describeLocalContentRetrieval,
  retrieveLocalContentDirectories,
  retrieveLocalContentSummaries,
  readRetrievedLocalContent,
  getLocalContentCatalogStats,
  previewLocalContent,
  previewLocalContentAsset,
  refreshLocalContent,
  archiveLocalContent,
  getLocalContentHealth,
  resolveLocalContentOriginal,
  resolveLocalContentContainer,
  listWorkResources,
  getWorkResource,
  previewWorkResource,
  refreshWorkResource,
  revealLocalContentOriginal = revealFileInFileManager,
}) {
  if (req.method === "GET" && url.pathname === "/api/resources") {
    const result = typeof listWorkResources === "function"
      ? await listWorkResources({
        query: url.searchParams.get("q") ?? "",
        resourceKind: url.searchParams.get("resourceKind"),
        businessRole: url.searchParams.get("businessRole"),
        locality: url.searchParams.get("locality"),
        projectId: url.searchParams.get("projectId"),
        availability: url.searchParams.get("availability"),
        limit: url.searchParams.get("limit"),
        offset: url.searchParams.get("offset"),
      }, actor)
      : { status: 503, body: { error: "work_resource_directory_unavailable" } };
    sendJson(res, result.status, result.body);
    return true;
  }

  const resourcePreviewMatch = url.pathname.match(/^\/api\/resources\/([^/]+)\/preview$/);
  if (req.method === "GET" && resourcePreviewMatch) {
    const result = typeof previewWorkResource === "function"
      ? await previewWorkResource({ resourceId: decodeURIComponent(resourcePreviewMatch[1]) }, actor)
      : { status: 503, body: { error: "work_resource_directory_unavailable" } };
    sendJson(res, result.status, result.body);
    return true;
  }

  const resourceRefreshMatch = url.pathname.match(/^\/api\/resources\/([^/]+)\/refresh$/);
  if (req.method === "POST" && resourceRefreshMatch) {
    const result = typeof refreshWorkResource === "function"
      ? await refreshWorkResource({ resourceId: decodeURIComponent(resourceRefreshMatch[1]) }, actor)
      : { status: 503, body: { error: "work_resource_directory_unavailable" } };
    sendJson(res, result.status, result.body);
    return true;
  }

  const resourceMatch = url.pathname.match(/^\/api\/resources\/([^/]+)$/);
  if (req.method === "GET" && resourceMatch) {
    const result = typeof getWorkResource === "function"
      ? await getWorkResource({ resourceId: decodeURIComponent(resourceMatch[1]) }, actor)
      : { status: 503, body: { error: "work_resource_directory_unavailable" } };
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/local-content/retrieval/contracts") {
    const result = typeof describeLocalContentRetrieval === "function"
      ? describeLocalContentRetrieval()
      : { status: 503, body: { error: "local_content_retrieval_unavailable" } };
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/local-content/directories") {
    const result = await browseLocalContentDirectories({
      dimension: url.searchParams.get("dimension"),
      query: url.searchParams.get("q") ?? "",
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const retrievalMatch = url.pathname.match(/^\/api\/local-content\/retrieval\/(directories|summaries|read)$/);
  if (req.method === "POST" && retrievalMatch) {
    const operation = retrievalMatch[1];
    const handler = operation === "directories"
      ? retrieveLocalContentDirectories
      : operation === "summaries"
        ? retrieveLocalContentSummaries
        : readRetrievedLocalContent;
    if (typeof handler !== "function") {
      sendJson(res, 503, { error: "local_content_retrieval_unavailable" });
      return true;
    }
    const result = await handler(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/local-content") {
    const result = await searchLocalContent({
      query: url.searchParams.get("q") ?? "",
      kinds: url.searchParams.getAll("kind").flatMap((value) => value.split(",")),
      projectId: url.searchParams.get("projectId"),
      workItemId: url.searchParams.get("workItemId"),
      sourceType: url.searchParams.get("sourceType"),
      yearMonth: url.searchParams.get("yearMonth"),
      availability: url.searchParams.get("availability"),
      indexStatus: url.searchParams.get("indexStatus"),
      mailAccountId: url.searchParams.get("mailAccountId"),
      mailFolderId: url.searchParams.get("mailFolderId"),
      limit: url.searchParams.get("limit"),
      offset: url.searchParams.get("offset"),
      cursor: url.searchParams.get("cursor"),
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

  if (req.method === "POST" && url.pathname === "/api/local-content/health") {
    const result = await getLocalContentHealth(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const refreshMatch = url.pathname.match(/^\/api\/local-content\/([^/]+)\/refresh$/);
  if (req.method === "POST" && refreshMatch) {
    const result = await refreshLocalContent({ contentId: decodeURIComponent(refreshMatch[1]) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const archiveMatch = url.pathname.match(/^\/api\/local-content\/([^/]+)\/archive$/);
  if (req.method === "POST" && archiveMatch) {
    const result = await archiveLocalContent({ contentId: decodeURIComponent(archiveMatch[1]) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const previewMatch = url.pathname.match(/^\/api\/local-content\/([^/]+)\/preview$/);
  if (req.method === "GET" && previewMatch) {
    const result = await previewLocalContent({ contentId: decodeURIComponent(previewMatch[1]) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const assetMatch = url.pathname.match(/^\/api\/local-content\/([^/]+)\/asset$/);
  if (req.method === "GET" && assetMatch) {
    const result = await previewLocalContentAsset({
      contentId: decodeURIComponent(assetMatch[1]),
      relativePath: url.searchParams.get("path"),
    }, actor);
    if (result.status !== 200) {
      sendJson(res, result.status, { error: result.error });
      return true;
    }
    const encodedName = encodeURIComponent(result.originalName || "article-image");
    res.writeHead(200, {
      "Content-Type": result.mimeType,
      "Content-Length": result.bytes.length,
      "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    });
    res.end(result.bytes);
    return true;
  }

  const revealMatch = url.pathname.match(/^\/api\/local-content\/([^/]+)\/reveal$/);
  if (req.method === "POST" && revealMatch) {
    const result = await resolveLocalContentOriginal({ contentId: decodeURIComponent(revealMatch[1]) }, actor);
    if (!result.ok) {
      sendJson(res, result.status, { error: result.error });
      return true;
    }
    if (result.sourceType !== "file" || !result.localPath) {
      sendJson(res, 409, { error: "local_content_original_not_file" });
      return true;
    }
    try {
      await revealLocalContentOriginal({ target: result.localPath });
      sendJson(res, 200, { revealed: true, name: result.originalName ?? null });
    } catch {
      sendJson(res, 500, { error: "local_content_reveal_failed", message: "The original could not be located in the local file manager." });
    }
    return true;
  }

  const containerMatch = url.pathname.match(/^\/api\/local-content\/([^/]+)\/reveal-container$/);
  if (req.method === "POST" && containerMatch) {
    const result = await resolveLocalContentContainer({ contentId: decodeURIComponent(containerMatch[1]) }, actor);
    if (!result.ok) {
      sendJson(res, result.status, { error: result.error });
      return true;
    }
    try {
      await revealLocalContentOriginal({ target: result.localPath });
      sendJson(res, 200, { revealed: true, name: result.originalName ?? null });
    } catch {
      sendJson(res, 500, { error: "local_content_reveal_failed", message: "The original container could not be located in the local file manager." });
    }
    return true;
  }

  return false;
}
