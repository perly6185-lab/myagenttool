/*
 * Canvas scene routes (#1352, Epic #1350). All handlers are owner-team scoped
 * inside the service (foreign team → 404, never 403); update/delete are
 * optimistic-concurrency gated on `expectedRevision`. See
 * docs/design/CANVAS_AGENT_INTEGRATION.md and TENANCY_ROUTE_MATRIX.md.
 */

export async function handleCanvasSceneRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  actor,
  listScenes,
  getScene,
  createScene,
  updateScene,
  deleteScene,
}) {
  if (!url.pathname.startsWith("/api/canvas/scenes")) return false;

  if (url.pathname === "/api/canvas/scenes") {
    if (req.method === "GET") {
      const result = listScenes(actor);
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      const result = createScene(
        { name: body?.name, projectId: body?.projectId ?? null, elements: body?.elements, files: body?.files },
        actor,
      );
      sendJson(res, result.status, result.body);
      return true;
    }
    return false;
  }

  const sceneMatch = url.pathname.match(/^\/api\/canvas\/scenes\/([^/]+)$/);
  if (sceneMatch) {
    const sceneId = decodeURIComponent(sceneMatch[1]);
    if (req.method === "GET") {
      const result = getScene({ sceneId }, actor);
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "PUT") {
      const body = await readJson(req);
      const result = updateScene(
        {
          sceneId,
          name: body?.name,
          elements: body?.elements,
          files: body?.files,
          expectedRevision: body?.expectedRevision,
        },
        actor,
      );
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "DELETE") {
      const body = await readJson(req);
      const result = deleteScene({ sceneId, expectedRevision: body?.expectedRevision }, actor);
      sendJson(res, result.status, result.body);
      return true;
    }
  }

  return false;
}
