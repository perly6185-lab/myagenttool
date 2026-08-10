import { actorCanAccessProject } from "../runtime/auth.mjs";
import { revealFileInFileManager } from "../services/asset-reveal.mjs";
import { basename, dirname } from "node:path";
import { OfficecliPreviewError, renderOfficecliPreview } from "../services/officecli-preview.mjs";

export async function handleTaskMaterialRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  actor,
  createTaskMaterialDraft,
  getTaskMaterialDraft,
  uploadTaskMaterialFile,
  removeTaskMaterialFile,
  readTaskMaterialContent,
  previewTaskMaterialCleanup,
  executeTaskMaterialCleanup,
}) {
  if (url.pathname === "/api/task-materials/storage" && req.method === "GET") {
    const result = previewTaskMaterialCleanup(actor);
    sendJson(res, 200, result);
    return true;
  }

  if (url.pathname === "/api/task-materials/storage/cleanup" && req.method === "POST") {
    const result = executeTaskMaterialCleanup(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const contentMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/materials\/([^/]+)\/content$/);
  if (contentMatch && req.method === "GET") {
    const result = readTaskMaterialContent({
      workItemId: decodeURIComponent(contentMatch[1]),
      assetId: decodeURIComponent(contentMatch[2]),
    }, actor);
    if (result.status !== 200) {
      sendJson(res, result.status, { error: result.error });
      return true;
    }
    const rawType = String(result.asset.mimeType ?? "application/octet-stream").toLowerCase();
    const unsafeInline = rawType.includes("html") || rawType.includes("javascript") || rawType.includes("svg") || rawType.includes("xml");
    const previewable = rawType.startsWith("text/") || rawType.startsWith("image/") || rawType === "application/pdf" || rawType === "application/json";
    const download = url.searchParams.get("download") === "1" || !previewable;
    const contentType = unsafeInline ? "text/plain; charset=utf-8" : rawType;
    const encodedName = encodeURIComponent(result.asset.originalName || "reference-file");
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": result.bytes.length,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    });
    res.end(result.bytes);
    return true;
  }

  const revealMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/materials\/([^/]+)\/reveal$/);
  if (revealMatch && req.method === "POST") {
    const result = readTaskMaterialContent({
      workItemId: decodeURIComponent(revealMatch[1]),
      assetId: decodeURIComponent(revealMatch[2]),
    }, actor);
    if (result.status !== 200) {
      sendJson(res, result.status, { error: result.error });
      return true;
    }
    try {
      await revealFileInFileManager({ target: result.localPath });
      sendJson(res, 200, { revealed: true, name: result.asset.originalName ?? null });
    } catch {
      sendJson(res, 500, { error: "task_material_reveal_failed", message: "The reference file could not be located in the local file manager." });
    }
    return true;
  }

  const officePreviewMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/materials\/([^/]+)\/office-preview$/);
  if (officePreviewMatch && req.method === "GET") {
    const result = readTaskMaterialContent({
      workItemId: decodeURIComponent(officePreviewMatch[1]),
      assetId: decodeURIComponent(officePreviewMatch[2]),
    }, actor);
    if (result.status !== 200) {
      sendJson(res, result.status, { error: result.error });
      return true;
    }
    try {
      const preview = await renderOfficecliPreview({
        projectPath: dirname(result.localPath),
        relativeFile: basename(result.localPath),
      });
      sendJson(res, 200, { ...preview, path: result.asset.originalName ?? preview.path });
    } catch (error) {
      const code = error instanceof OfficecliPreviewError ? error.code : "preview_failed";
      const status = code === "not_found" ? 404 : code === "officecli_unavailable" ? 503 : 400;
      sendJson(res, status, { error: code, message: error instanceof OfficecliPreviewError ? error.message : "Reference file preview is unavailable." });
    }
    return true;
  }

  const rootMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/task-material-drafts$/);
  if (rootMatch && req.method === "POST") {
    const projectId = decodeURIComponent(rootMatch[1]);
    if (!actorCanAccessProject(state, actor, projectId)) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    const result = createTaskMaterialDraft({ projectId, ...(await readJson(req)) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const draftMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/task-material-drafts\/([^/]+)$/);
  if (draftMatch && req.method === "GET") {
    const projectId = decodeURIComponent(draftMatch[1]);
    if (!actorCanAccessProject(state, actor, projectId)) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    const result = getTaskMaterialDraft({ projectId, draftId: decodeURIComponent(draftMatch[2]) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const fileMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/task-material-drafts\/([^/]+)\/files\/([^/]+)$/);
  if (!fileMatch) return false;
  const projectId = decodeURIComponent(fileMatch[1]);
  if (!actorCanAccessProject(state, actor, projectId)) {
    sendJson(res, 404, { error: "project_not_found" });
    return true;
  }
  const input = {
    projectId,
    draftId: decodeURIComponent(fileMatch[2]),
    fileId: decodeURIComponent(fileMatch[3]),
  };
  if (req.method === "PUT") {
    const result = await uploadTaskMaterialFile({
      ...input,
      name: url.searchParams.get("name") ?? "reference-file",
      contentType: req.headers["content-type"] ?? null,
    }, req, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (req.method === "DELETE") {
    const result = removeTaskMaterialFile({
      ...input,
      assetId: input.fileId,
      expectedRevision: Number(url.searchParams.get("revision")),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  return false;
}
