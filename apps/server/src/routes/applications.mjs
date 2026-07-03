import { denyForeignProject, teamOf } from "../runtime/auth.mjs";

export async function handleApplicationRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  actor,
  findApplication,
  listApplicationCapabilities,
  listApplications,
  probeApplication,
  registerApplication,
  transitionApplication,
  createCapabilityInvocation,
}) {
  if (req.method === "GET" && url.pathname === "/api/applications") {
    sendJson(res, 200, { applications: visibleApplications(state, actor, listApplications()) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/applications/register") {
    const body = await readJson(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      sendJson(res, 400, { error: "invalid_application", message: "Request body must be an object." });
      return true;
    }
    // A caller-supplied projectId must belong to the actor's team — otherwise an
    // application could be attached to (and surfaced in) another team's project.
    if (body.projectId && denyForeignProject({ res, sendJson, state, actor, projectId: body.projectId, notFound: { error: "project_not_found" } })) {
      return true;
    }
    try {
      const application = registerApplication(body, actor);
      sendJson(res, 201, {
        application,
        capabilities: listApplicationCapabilities(application.id) ?? [],
      });
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_application",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const orchestrationGenerateMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/orchestrations\/generate$/);
  if (orchestrationGenerateMatch && req.method === "POST") {
    const applicationId = decodeURIComponent(orchestrationGenerateMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const capability = (listApplicationCapabilities(applicationId) ?? [])
      .find((item) => item.name.endsWith(".generate_orchestration"));
    if (!capability) {
      sendJson(res, 404, { error: "application_not_found" });
      return true;
    }
    const result = createCapabilityInvocation(capability.name, await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const orchestrationListMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/orchestrations$/);
  if (orchestrationListMatch && req.method === "GET") {
    const applicationId = decodeURIComponent(orchestrationListMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const application = findApplication(applicationId);
    if (!application) {
      sendJson(res, 404, { error: "application_not_found" });
      return true;
    }
    sendJson(res, 200, {
      applicationId,
      orchestrations: application.orchestrations ?? [],
    });
    return true;
  }

  const capabilitiesMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/capabilities$/);
  if (capabilitiesMatch && req.method === "GET") {
    const applicationId = decodeURIComponent(capabilitiesMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const capabilities = listApplicationCapabilities(applicationId);
    if (!capabilities) {
      sendJson(res, 404, { error: "application_not_found" });
      return true;
    }
    sendJson(res, 200, { applicationId, capabilities });
    return true;
  }

  const actionMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/(probe|online|offline|archive|refresh)$/);
  if (actionMatch && req.method === "POST") {
    const applicationId = decodeURIComponent(actionMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    if (["archive", "offline", "online", "refresh"].includes(actionMatch[2])) {
      const capability = (listApplicationCapabilities(applicationId) ?? [])
        .find((item) => item.name.endsWith(`.${actionMatch[2]}`));
      if (!capability) {
        sendJson(res, 404, { error: "application_not_found" });
        return true;
      }
      const result = createCapabilityInvocation(capability.name, await readJson(req), actor);
      sendJson(res, result.status, result.body);
      return true;
    }
    try {
      const application = actionMatch[2] === "probe"
        ? probeApplication(applicationId, actor)
        : transitionApplication(applicationId, actionMatch[2], actor);
      if (!application) {
        sendJson(res, 404, { error: "application_not_found" });
        return true;
      }
      sendJson(res, 200, {
        application,
        capabilities: listApplicationCapabilities(application.id) ?? [],
      });
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_application_lifecycle",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const applicationMatch = url.pathname.match(/^\/api\/applications\/([^/]+)$/);
  if (applicationMatch && req.method === "GET") {
    const applicationId = decodeURIComponent(applicationMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const application = findApplication(applicationId);
    if (!application) {
      sendJson(res, 404, { error: "application_not_found" });
      return true;
    }
    sendJson(res, 200, {
      application,
      capabilities: listApplicationCapabilities(application.id) ?? [],
    });
    return true;
  }

  return false;
}

function visibleApplications(state, actor, applications) {
  if (!actor?.teamId) return applications;
  const projectTeam = new Map((state.projects ?? []).map((project) => [project.id, teamOf(project)]));
  return applications.filter((application) => {
    if (application.projectId) return projectTeam.get(application.projectId) === actor.teamId;
    return (application.ownerTeamId ?? "team_local") === actor.teamId;
  });
}

function denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication }) {
  const application = findApplication(applicationId);
  if (!application) return false;
  if (application.projectId) {
    return denyForeignProject({
      res,
      sendJson,
      state,
      actor,
      projectId: application.projectId,
      notFound: { error: "application_not_found" },
    });
  }
  if (actor?.teamId && (application.ownerTeamId ?? "team_local") !== actor.teamId) {
    sendJson(res, 404, { error: "application_not_found" });
    return true;
  }
  return false;
}
