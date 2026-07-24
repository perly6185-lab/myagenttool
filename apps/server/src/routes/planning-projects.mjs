export async function handlePlanningProjectRoutes({
  req, res, url, sendJson, readJson, actor,
  listProjects, getProject, createProject, updateProject, setArchived, addItem, removeItem,
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
