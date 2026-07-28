export async function handlePlanningProjectRoutes({
  req, res, url, sendJson, readJson, actor,
  listProjects, getProject, createProject, updateProject, setArchived,
  addItem, removeItem, reorderItems, updateItems,
  suggestPlan,
  executeRecommendedAction,
  decideRecommendedAction,
}) {
  if (!url.pathname.startsWith("/api/planning-projects")) return false;
  if (url.pathname === "/api/planning-projects") {
    const result = req.method === "GET"
      ? listProjects(Object.fromEntries(url.searchParams), actor)
      : req.method === "POST"
        ? createProject(await readJson(req), actor)
        : null;
    if (!result) return false;
    sendJson(res, result.status, result.body);
    return true;
  }
  const itemsMatch = url.pathname.match(/^\/api\/planning-projects\/([^/]+)\/items$/);
  if (itemsMatch && ["PATCH", "PUT"].includes(req.method)) {
    const body = await readJson(req);
    const planningProjectId = decodeURIComponent(itemsMatch[1]);
    const result = req.method === "PUT"
      ? reorderItems({ planningProjectId, ...body }, actor)
      : updateItems({ planningProjectId, ...body }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const itemMatch = url.pathname.match(/^\/api\/planning-projects\/([^/]+)\/items\/([^/]+)$/);
  if (itemMatch && ["PUT", "DELETE"].includes(req.method)) {
    const input = { planningProjectId: decodeURIComponent(itemMatch[1]), workItemId: decodeURIComponent(itemMatch[2]) };
    const result = req.method === "PUT" ? addItem(input, actor) : removeItem(input, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const transitionMatch = url.pathname.match(/^\/api\/planning-projects\/([^/]+)\/(archive|restore)$/);
  if (transitionMatch && req.method === "POST") {
    const body = await readJson(req);
    const result = setArchived({
      planningProjectId: decodeURIComponent(transitionMatch[1]),
      expectedRevision: body?.expectedRevision,
      archived: transitionMatch[2] === "archive",
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const assistMatch = url.pathname.match(/^\/api\/planning-projects\/([^/]+)\/assist\/plan$/);
  if (assistMatch && req.method === "POST") {
    const result = suggestPlan({
      planningProjectId: decodeURIComponent(assistMatch[1]),
      ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const actionMatch = url.pathname.match(/^\/api\/planning-projects\/([^/]+)\/recommended-actions\/([^/]+)\/execute$/);
  if (actionMatch && req.method === "POST") {
    const result = executeRecommendedAction({
      planningProjectId: decodeURIComponent(actionMatch[1]),
      code: decodeURIComponent(actionMatch[2]),
      ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const decisionMatch = url.pathname.match(/^\/api\/planning-projects\/([^/]+)\/recommended-action-approvals\/([^/]+)\/(approve|deny)$/);
  if (decisionMatch && req.method === "POST") {
    const body = await readJson(req);
    const result = decideRecommendedAction({
      planningProjectId: decodeURIComponent(decisionMatch[1]),
      approvalRequestId: decodeURIComponent(decisionMatch[2]),
      decision: decisionMatch[3] === "approve" ? "approved" : "denied",
      confirmed: body?.confirmed,
      note: body?.note,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const projectMatch = url.pathname.match(/^\/api\/planning-projects\/([^/]+)$/);
  if (!projectMatch) return false;
  const planningProjectId = decodeURIComponent(projectMatch[1]);
  const result = req.method === "GET"
    ? getProject({ planningProjectId }, actor)
    : req.method === "PATCH"
      ? updateProject({ planningProjectId, ...(await readJson(req)) }, actor)
      : null;
  if (!result) return false;
  sendJson(res, result.status, result.body);
  return true;
}
