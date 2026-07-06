import { denyForeignProject, teamOf } from "../runtime/auth.mjs";
import { publicApplicationSnapshot } from "../services/applications.mjs";

export async function handleApplicationRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  actor,
  confirmApplicationMcpCandidate,
  findApplication,
  getApplicationDescriptors,
  getApplicationOrchestrationRunRecovery,
  listApplicationOrchestrationRecoveryAgentCandidates,
  getApplicationOrchestrationRun,
  listApplicationCapabilities,
  listApplications,
  listApplicationOrchestrationRunEvents,
  probeApplication,
  registerApplication,
  requestApplicationOrchestrationRecoveryAction,
  transitionApplication,
  updateApplicationDescriptors,
  createCapabilityInvocation,
  listApplicationOrchestrationRuns,
  runApplicationOrchestration,
}) {
  if (req.method === "GET" && url.pathname === "/api/applications") {
    sendJson(res, 200, { applications: visibleApplications(state, actor, listApplications()).map(publicApplicationSnapshot) });
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
        application: publicApplicationSnapshot(application),
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

  const mcpCandidateConfirmMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/mcp-candidates\/([^/]+)\/confirm$/);
  if (mcpCandidateConfirmMatch && req.method === "POST") {
    const applicationId = decodeURIComponent(mcpCandidateConfirmMatch[1]);
    const candidateId = decodeURIComponent(mcpCandidateConfirmMatch[2]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const result = confirmApplicationMcpCandidate(applicationId, candidateId, await readJson(req), actor);
    sendJson(res, result.status, result.ok
      ? {
          application: publicApplicationSnapshot(result.application),
          candidate: result.candidate,
          capabilities: listApplicationCapabilities(applicationId) ?? [],
        }
      : result.body);
    return true;
  }

  const orchestrationGenerateMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/orchestrations\/generate$/);
  if (orchestrationGenerateMatch && req.method === "POST") {
    const applicationId = decodeURIComponent(orchestrationGenerateMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const body = await readJson(req);
    if (denyForeignProjectFromBody({ res, sendJson, state, actor, body })) return true;
    const capability = (listApplicationCapabilities(applicationId) ?? [])
      .find((item) => item.name.endsWith(".generate_orchestration"));
    if (!capability) {
      sendJson(res, 404, { error: "application_not_found" });
      return true;
    }
    const result = createCapabilityInvocation(capability.name, body, actor);
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

  const orchestrationRunMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/orchestrations\/([^/]+)\/run$/);
  if (orchestrationRunMatch && req.method === "POST") {
    const applicationId = decodeURIComponent(orchestrationRunMatch[1]);
    const routineId = decodeURIComponent(orchestrationRunMatch[2]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const result = runApplicationOrchestration(applicationId, routineId, await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const orchestrationRunsMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/orchestrations\/([^/]+)\/runs$/);
  if (orchestrationRunsMatch && req.method === "GET") {
    const applicationId = decodeURIComponent(orchestrationRunsMatch[1]);
    const routineId = decodeURIComponent(orchestrationRunsMatch[2]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const result = listApplicationOrchestrationRuns(applicationId, routineId, url.searchParams);
    sendJson(res, result.status, result.body);
    return true;
  }

  const orchestrationRunDetailMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/orchestrations\/([^/]+)\/runs\/([^/]+)$/);
  if (orchestrationRunDetailMatch && req.method === "GET") {
    const applicationId = decodeURIComponent(orchestrationRunDetailMatch[1]);
    const routineId = decodeURIComponent(orchestrationRunDetailMatch[2]);
    const invocationId = decodeURIComponent(orchestrationRunDetailMatch[3]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const result = getApplicationOrchestrationRun(applicationId, routineId, invocationId);
    sendJson(res, result.status, result.body);
    return true;
  }

  const orchestrationRunEventsMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/orchestrations\/([^/]+)\/runs\/([^/]+)\/events$/);
  if (orchestrationRunEventsMatch && req.method === "GET") {
    const applicationId = decodeURIComponent(orchestrationRunEventsMatch[1]);
    const routineId = decodeURIComponent(orchestrationRunEventsMatch[2]);
    const invocationId = decodeURIComponent(orchestrationRunEventsMatch[3]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const result = listApplicationOrchestrationRunEvents(applicationId, routineId, invocationId);
    sendJson(res, result.status, result.body);
    return true;
  }

  const orchestrationRunRecoveryMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/orchestrations\/([^/]+)\/runs\/([^/]+)\/recovery$/);
  if (orchestrationRunRecoveryMatch && req.method === "GET") {
    const applicationId = decodeURIComponent(orchestrationRunRecoveryMatch[1]);
    const routineId = decodeURIComponent(orchestrationRunRecoveryMatch[2]);
    const invocationId = decodeURIComponent(orchestrationRunRecoveryMatch[3]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const result = getApplicationOrchestrationRunRecovery(applicationId, routineId, invocationId);
    sendJson(res, result.status, result.body);
    return true;
  }

  const orchestrationRunRecoveryAgentCandidatesMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/orchestrations\/([^/]+)\/runs\/([^/]+)\/recovery\/agent-candidates$/);
  if (orchestrationRunRecoveryAgentCandidatesMatch && req.method === "GET") {
    const applicationId = decodeURIComponent(orchestrationRunRecoveryAgentCandidatesMatch[1]);
    const routineId = decodeURIComponent(orchestrationRunRecoveryAgentCandidatesMatch[2]);
    const invocationId = decodeURIComponent(orchestrationRunRecoveryAgentCandidatesMatch[3]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const result = listApplicationOrchestrationRecoveryAgentCandidates(applicationId, routineId, invocationId);
    sendJson(res, result.status, result.body);
    return true;
  }

  const orchestrationRunRecoveryActionMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/orchestrations\/([^/]+)\/runs\/([^/]+)\/recovery\/actions$/);
  if (orchestrationRunRecoveryActionMatch && req.method === "POST") {
    const applicationId = decodeURIComponent(orchestrationRunRecoveryActionMatch[1]);
    const routineId = decodeURIComponent(orchestrationRunRecoveryActionMatch[2]);
    const invocationId = decodeURIComponent(orchestrationRunRecoveryActionMatch[3]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const result = requestApplicationOrchestrationRecoveryAction(applicationId, routineId, invocationId, await readJson(req), actor);
    sendJson(res, result.status, result.body);
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

  const descriptorsMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/descriptors$/);
  if (descriptorsMatch && (req.method === "GET" || req.method === "PATCH")) {
    const applicationId = decodeURIComponent(descriptorsMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    if (req.method === "GET") {
      const descriptors = getApplicationDescriptors(applicationId, actor);
      if (!descriptors) {
        sendJson(res, 404, { error: "application_not_found" });
        return true;
      }
      sendJson(res, 200, descriptors);
      return true;
    }
    const body = await readJson(req);
    try {
      const application = updateApplicationDescriptors(applicationId, body, actor);
      if (!application) {
        sendJson(res, 404, { error: "application_not_found" });
        return true;
      }
      sendJson(res, 200, {
        application: publicApplicationSnapshot(application),
        capabilities: listApplicationCapabilities(application.id) ?? [],
        descriptors: getApplicationDescriptors(application.id, actor)?.descriptors ?? null,
      });
    } catch (error) {
      const validationErrors = error && typeof error === "object" && Array.isArray(error.validationErrors)
        ? error.validationErrors
        : null;
      sendJson(res, validationErrors ? 422 : 400, {
        error: "invalid_application_descriptor",
        message: error instanceof Error ? error.message : String(error),
        ...(validationErrors ? { validation: { errors: validationErrors } } : {}),
      });
    }
    return true;
  }

  const actionMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/(probe|online|offline|archive|refresh)$/);
  if (actionMatch && req.method === "POST") {
    const applicationId = decodeURIComponent(actionMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    if (["archive", "offline", "online", "refresh"].includes(actionMatch[2])) {
      const body = await readJson(req);
      if (denyForeignProjectFromBody({ res, sendJson, state, actor, body })) return true;
      const capability = (listApplicationCapabilities(applicationId) ?? [])
        .find((item) => item.name.endsWith(`.${actionMatch[2]}`));
      if (!capability) {
        sendJson(res, 404, { error: "application_not_found" });
        return true;
      }
      const result = createCapabilityInvocation(capability.name, body, actor);
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
        application: publicApplicationSnapshot(application),
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
      application: publicApplicationSnapshot(application),
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

function denyForeignProjectFromBody({ res, sendJson, state, actor, body }) {
  const projectId = body && typeof body === "object" && !Array.isArray(body) ? body.projectId : null;
  return denyForeignProject({ res, sendJson, state, actor, projectId, notFound: { error: "project_not_found" } });
}
