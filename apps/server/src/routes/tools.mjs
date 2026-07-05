import { denyForeignProject } from "../runtime/auth.mjs";

export async function handleToolRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  actor,
  listTools,
  getTool,
  createToolInvocation,
}) {
  if (req.method === "GET" && url.pathname === "/api/tools") {
    sendJson(res, 200, { tools: listTools(actor) });
    return true;
  }

  const toolMatch = url.pathname.match(/^\/api\/tools\/([^/]+)$/);
  if (req.method === "GET" && toolMatch) {
    const tool = getTool(decodeURIComponent(toolMatch[1]), actor);
    if (!tool) {
      sendJson(res, 404, { error: "tool_not_found" });
      return true;
    }
    sendJson(res, 200, { tool });
    return true;
  }

  const invokeMatch = url.pathname.match(/^\/api\/tools\/([^/]+)\/invocations$/);
  if (req.method === "POST" && invokeMatch) {
    const body = await readJson(req);
    const projectId = body && typeof body === "object" && !Array.isArray(body) ? body.projectId : null;
    if (denyForeignProject({ res, sendJson, state, actor, projectId, notFound: { error: "project_not_found" } })) {
      return true;
    }
    const result = createToolInvocation(decodeURIComponent(invokeMatch[1]), body, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  return false;
}
