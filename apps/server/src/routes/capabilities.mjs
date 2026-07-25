import { denyForeignProject } from "../runtime/auth.mjs";

export async function handleCapabilityRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  actor,
  listCapabilities,
  getCapability,
  createCapabilityInvocation,
  resolveCapability,
}) {
  if (req.method === "GET" && url.pathname === "/api/capabilities") {
    sendJson(res, 200, { capabilities: filterCapabilities(listCapabilities(actor), url.searchParams) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/capability-resolutions") {
    const body = await readJson(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      sendJson(res, 400, { error: "invalid_capability_resolution" });
      return true;
    }
    const resolution = resolveCapability(body, actor);
    sendJson(res, resolution.state === "refusal" ? 400 : 200, { resolution });
    return true;
  }

  const capabilityMatch = url.pathname.match(/^\/api\/capabilities\/([^/]+)$/);
  if (req.method === "GET" && capabilityMatch) {
    const capability = getCapability(decodeURIComponent(capabilityMatch[1]), actor);
    if (!capability) {
      sendJson(res, 404, { error: "capability_not_found" });
      return true;
    }
    sendJson(res, 200, { capability });
    return true;
  }

  const invokeMatch = url.pathname.match(/^\/api\/capabilities\/([^/]+)\/invocations$/);
  if (req.method === "POST" && invokeMatch) {
    const body = await readJson(req);
    const projectId = body && typeof body === "object" && !Array.isArray(body) ? body.projectId : null;
    if (denyForeignProject({ res, sendJson, state, actor, projectId, notFound: { error: "project_not_found" } })) {
      return true;
    }
    const result = createCapabilityInvocation(decodeURIComponent(invokeMatch[1]), body, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  return false;
}

export function filterCapabilities(capabilities, searchParams) {
  const providerType = searchParams.get("providerType");
  const kind = searchParams.get("kind");
  const status = searchParams.get("status");
  const interfaceFamily = searchParams.get("interfaceFamily");
  const operation = searchParams.get("operation");
  return capabilities.filter((capability) => {
    if (providerType && capability.provider?.type !== providerType) return false;
    if (kind && capability.kind !== kind) return false;
    if (status && capability.status !== status) return false;
    if (interfaceFamily && capability.metadata?.interface?.family !== interfaceFamily) return false;
    if (operation && capability.metadata?.interface?.operation !== operation) return false;
    return true;
  });
}
