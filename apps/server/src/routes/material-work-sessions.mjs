export async function handleMaterialWorkSessionRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  actor,
  createMaterialWorkSession,
  getMaterialWorkSession,
  addMaterialWorkSessionMessage,
  cancelMaterialWorkSession,
}) {
  if (req.method === "POST" && url.pathname === "/api/material-work-sessions") {
    if (typeof createMaterialWorkSession !== "function") {
      sendJson(res, 503, { error: "material_work_session_service_unavailable" });
      return true;
    }
    const body = await readJson(req);
    const result = await createMaterialWorkSession({
      userGoal: body?.userGoal,
      scope: body?.scope,
      entryPoint: body?.entryPoint,
      idempotencyKey: body?.idempotencyKey,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const messageMatch = url.pathname.match(/^\/api\/material-work-sessions\/([^/]+)\/messages$/);
  if (req.method === "POST" && messageMatch) {
    if (typeof addMaterialWorkSessionMessage !== "function") {
      sendJson(res, 503, { error: "material_work_session_service_unavailable" });
      return true;
    }
    const body = await readJson(req);
    const result = await addMaterialWorkSessionMessage({
      sessionId: decodeURIComponent(messageMatch[1]),
      content: body?.content,
      expectedRevision: body?.expectedRevision,
      idempotencyKey: body?.idempotencyKey,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const cancelMatch = url.pathname.match(/^\/api\/material-work-sessions\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancelMatch) {
    if (typeof cancelMaterialWorkSession !== "function") {
      sendJson(res, 503, { error: "material_work_session_service_unavailable" });
      return true;
    }
    const body = await readJson(req);
    const result = cancelMaterialWorkSession({
      sessionId: decodeURIComponent(cancelMatch[1]),
      expectedRevision: body?.expectedRevision,
      idempotencyKey: body?.idempotencyKey,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const sessionMatch = url.pathname.match(/^\/api\/material-work-sessions\/([^/]+)$/);
  if (req.method === "GET" && sessionMatch) {
    if (typeof getMaterialWorkSession !== "function") {
      sendJson(res, 503, { error: "material_work_session_service_unavailable" });
      return true;
    }
    const result = getMaterialWorkSession({ sessionId: decodeURIComponent(sessionMatch[1]) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  return false;
}
