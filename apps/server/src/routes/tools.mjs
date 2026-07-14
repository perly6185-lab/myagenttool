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
  rollbackClaudeApply,
}) {
  // Governed rollback of an applied Claude patch authorization (#914 follow-up):
  // bound to the authorization artifact (like the codex-exec promote gate), and
  // approval-gated inside the service — a fresh single-use grant per rollback.
  const rollbackMatch = url.pathname.match(/^\/api\/claude-apply\/authorizations\/([^/]+)\/rollback$/);
  if (req.method === "POST" && rollbackMatch && typeof rollbackClaudeApply === "function") {
    const body = await readJson(req);
    const result = rollbackClaudeApply(decodeURIComponent(rollbackMatch[1]), body ?? {}, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/tools") {
    sendJson(res, 200, { tools: listTools() });
    return true;
  }

  const toolMatch = url.pathname.match(/^\/api\/tools\/([^/]+)$/);
  if (req.method === "GET" && toolMatch) {
    const tool = getTool(decodeURIComponent(toolMatch[1]));
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
