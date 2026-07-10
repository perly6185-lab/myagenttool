import { denyForeignProject, teamOf } from "../runtime/auth.mjs";
import { publicApplicationResultArtifact } from "../services/application-result-artifacts.mjs";
import { publicApplicationRenderResult } from "../services/application-render-results.mjs";
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
  getApplicationResultArtifact,
  getApplicationRenderResult,
  getApplicationResultRetention,
  runApplicationResultRetention,
  updateApplicationResultArtifactGovernance,
  updateApplicationResultRetention,
  updateApplicationRenderResultGovernance,
  grantApplicationWrapperPolicyConsent,
  getApplicationOrchestrationRunRecovery,
  listApplicationOrchestrationRecoveryAgentCandidates,
  getApplicationOrchestrationRun,
  listApplicationCapabilities,
  listApplicationEvents,
  listApplicationResultArtifacts,
  listApplicationRenderResults,
  listApplications,
  listApplicationOrchestrationRunEvents,
  probeApplication,
  probeApplicationMcpCandidate,
  recordApplicationSmokeEvidence,
  latestApplicationResultArtifact,
  latestApplicationRenderResult,
  registerApplication,
  recordApplicationEditorRenderResult,
  requestApplicationOrchestrationRecoveryAction,
  requestApplicationWebEditorStart,
  requestApplicationWebEditorStop,
  revokeApplicationWrapperPolicyConsent,
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
      const validationErrors = error && typeof error === "object" && Array.isArray(error.validationErrors)
        ? error.validationErrors
        : null;
      sendJson(res, validationErrors ? 422 : 400, {
        error: validationErrors ? "invalid_application_descriptor" : "invalid_application",
        message: error instanceof Error ? error.message : String(error),
        ...(validationErrors ? { validation: { errors: validationErrors } } : {}),
      });
    }
    return true;
  }

  const mcpCandidateProbeMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/mcp-candidates\/([^/]+)\/probe$/);
  if (mcpCandidateProbeMatch && req.method === "POST") {
    const applicationId = decodeURIComponent(mcpCandidateProbeMatch[1]);
    const candidateId = decodeURIComponent(mcpCandidateProbeMatch[2]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const result = await probeApplicationMcpCandidate(applicationId, candidateId, await readJson(req), actor);
    sendJson(res, result.status, result.ok
      ? {
          application: publicApplicationSnapshot(result.application),
          candidate: result.candidate,
          liveProbe: result.liveProbe,
          capabilities: listApplicationCapabilities(applicationId) ?? [],
        }
      : result.body);
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

  const wrapperPolicyConsentMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/wrapper-commands\/([^/]+)\/policy-consent$/);
  if (wrapperPolicyConsentMatch && (req.method === "POST" || req.method === "DELETE")) {
    const applicationId = decodeURIComponent(wrapperPolicyConsentMatch[1]);
    const commandId = decodeURIComponent(wrapperPolicyConsentMatch[2]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const result = req.method === "DELETE"
      ? revokeApplicationWrapperPolicyConsent(applicationId, commandId, await readJson(req), actor)
      : grantApplicationWrapperPolicyConsent(applicationId, commandId, await readJson(req), actor);
    sendJson(res, result.status, result.ok
      ? {
          application: publicApplicationSnapshot(result.application),
          commandId: result.commandId,
          consent: result.consent,
          capabilities: listApplicationCapabilities(applicationId) ?? [],
        }
      : result.body);
    return true;
  }

  const smokeEvidenceMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/smoke-evidence$/);
  if (smokeEvidenceMatch && req.method === "POST") {
    const applicationId = decodeURIComponent(smokeEvidenceMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const result = recordApplicationSmokeEvidence(applicationId, await readJson(req), actor);
    sendJson(res, result.status, result.ok
      ? {
          application: publicApplicationSnapshot(result.application),
          evidence: result.evidence,
        }
      : result.body);
    return true;
  }

  const webEditorMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/web-editor\/(start|stop)$/);
  if (webEditorMatch && req.method === "POST") {
    const applicationId = decodeURIComponent(webEditorMatch[1]);
    const action = webEditorMatch[2];
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const result = action === "start"
      ? requestApplicationWebEditorStart(applicationId, actor)
      : requestApplicationWebEditorStop(applicationId, actor);
    sendJson(res, result.status, result.ok
      ? {
          application: publicApplicationSnapshot(result.application),
          editor: result.editor ?? publicApplicationSnapshot(result.application).webEditor,
          action: result.action ?? null,
        }
      : result.body);
    return true;
  }

  const webEditorResultMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/web-editor\/results$/);
  if (webEditorResultMatch && req.method === "POST") {
    const applicationId = decodeURIComponent(webEditorResultMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const application = findApplication(applicationId);
    const result = recordApplicationEditorRenderResult({
      application,
      input: await readJson(req),
      actor,
    });
    sendJson(res, result.status, result.ok
      ? {
          application: publicApplicationSnapshot(application),
          result: publicApplicationRenderResult(result.record),
          latestResult: application.latestResult ?? null,
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

  const eventsMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/events$/);
  if (eventsMatch && req.method === "GET") {
    const applicationId = decodeURIComponent(eventsMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const events = listApplicationEvents(applicationId, url.searchParams);
    if (!events) {
      sendJson(res, 404, { error: "application_not_found" });
      return true;
    }
    sendJson(res, 200, { applicationId, events });
    return true;
  }

  const resultsMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/results$/);
  if (resultsMatch && req.method === "GET") {
    const applicationId = decodeURIComponent(resultsMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const resultType = applicationResultTypeFilter(url.searchParams);
    const renderResults = resultType !== "artifact" && typeof listApplicationRenderResults === "function"
      ? listApplicationRenderResults(applicationId, url.searchParams).map(publicApplicationRenderResult)
      : [];
    const artifactResults = resultType !== "render" && typeof listApplicationResultArtifacts === "function"
      ? listApplicationResultArtifacts(applicationId, url.searchParams).map(publicApplicationResultArtifact)
      : [];
    const results = [...renderResults, ...artifactResults]
      .sort((left, right) => Date.parse(right.createdAt ?? right.generatedAt ?? "") - Date.parse(left.createdAt ?? left.generatedAt ?? ""))
      .slice(0, applicationResultsLimit(url.searchParams));
    sendJson(res, 200, {
      applicationId,
      results,
      count: results.length,
    });
    return true;
  }

  const latestResultMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/results\/latest$/);
  if (latestResultMatch && req.method === "GET") {
    const applicationId = decodeURIComponent(latestResultMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const render = typeof latestApplicationRenderResult === "function" ? latestApplicationRenderResult(applicationId) : null;
    const artifact = typeof latestApplicationResultArtifact === "function" ? latestApplicationResultArtifact(applicationId) : null;
    const record = latestApplicationResultRecord(render, artifact);
    if (!record) {
      sendJson(res, 404, { error: "application_result_not_found" });
      return true;
    }
    sendJson(res, 200, {
      applicationId,
      result: publicApplicationResultDetail(record),
    });
    return true;
  }

  const resultRetentionMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/result-retention$/);
  if (resultRetentionMatch && (req.method === "GET" || req.method === "PATCH")) {
    const applicationId = decodeURIComponent(resultRetentionMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    if (req.method === "GET") {
      const retention = typeof getApplicationResultRetention === "function" ? getApplicationResultRetention(applicationId) : null;
      if (!retention) {
        sendJson(res, 404, { error: "application_not_found" });
        return true;
      }
      sendJson(res, 200, { applicationId, retention });
      return true;
    }
    const application = typeof updateApplicationResultRetention === "function"
      ? updateApplicationResultRetention(applicationId, await readJson(req), actor)
      : null;
    if (!application) {
      sendJson(res, 404, { error: "application_not_found" });
      return true;
    }
    sendJson(res, 200, {
      application: publicApplicationSnapshot(application),
      retention: application.resultRetention ?? null,
    });
    return true;
  }

  const runRetentionMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/results\/retention\/run$/);
  if (runRetentionMatch && req.method === "POST") {
    const applicationId = decodeURIComponent(runRetentionMatch[1]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const result = typeof runApplicationResultRetention === "function"
      ? runApplicationResultRetention(applicationId, actor, { reason: "manual" })
      : { ok: false, status: 404, body: { error: "application_not_found" } };
    sendJson(res, result.status, result.ok
      ? {
          application: publicApplicationSnapshot(result.body.application),
          retention: result.body.retention,
          summary: result.body.summary,
        }
      : result.body);
    return true;
  }

  const resultMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/results\/([^/]+)$/);
  if (resultMatch && (req.method === "GET" || req.method === "PATCH")) {
    const applicationId = decodeURIComponent(resultMatch[1]);
    const resultId = decodeURIComponent(resultMatch[2]);
    if (denyForeignApplication({ res, sendJson, state, actor, applicationId, findApplication })) return true;
    const renderRecord = typeof getApplicationRenderResult === "function" ? getApplicationRenderResult(applicationId, resultId) : null;
    const artifactRecord = renderRecord ? null : typeof getApplicationResultArtifact === "function" ? getApplicationResultArtifact(applicationId, resultId) : null;
    const record = renderRecord ?? artifactRecord;
    if (!record) {
      sendJson(res, 404, { error: "application_result_not_found" });
      return true;
    }
    if (req.method === "PATCH") {
      const body = await readJson(req);
      const updated = renderRecord
        ? (typeof updateApplicationRenderResultGovernance === "function"
            ? updateApplicationRenderResultGovernance(applicationId, resultId, body, actor)
            : renderRecord)
        : (typeof updateApplicationResultArtifactGovernance === "function"
            ? updateApplicationResultArtifactGovernance(applicationId, resultId, body, actor)
            : artifactRecord);
      sendJson(res, 200, {
        applicationId,
        result: publicApplicationResultDetail(updated),
      });
      return true;
    }
    sendJson(res, 200, {
      applicationId,
      result: publicApplicationResultDetail(record),
    });
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

function publicApplicationResultDetail(record) {
  if (!record) return null;
  if (isApplicationResultArtifact(record)) {
    return {
      ...publicApplicationResultArtifact(record),
      payload: record.payload ?? null,
      text: record.text ?? null,
    };
  }
  return {
    ...publicApplicationRenderResult(record),
    html: record.html ?? "",
  };
}

function latestApplicationResultRecord(render, artifact) {
  if (!render) return artifact ?? null;
  if (!artifact) return render;
  const renderTs = Date.parse(render.createdAt ?? render.generatedAt ?? "");
  const artifactTs = Date.parse(artifact.createdAt ?? artifact.generatedAt ?? "");
  return artifactTs > renderTs ? artifact : render;
}

function applicationResultsLimit(searchParams) {
  const parsed = Number(searchParams?.get?.("limit") ?? 20);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 100) : 20;
}

function applicationResultTypeFilter(searchParams) {
  const raw = String(searchParams?.get?.("resultType") ?? searchParams?.get?.("type") ?? "").trim().toLowerCase();
  if (["render", "rendered", "html"].includes(raw)) return "render";
  if (["artifact", "artifacts", "json"].includes(raw)) return "artifact";
  return "all";
}

function isApplicationResultArtifact(record) {
  return record?.resultRef?.type === "application_result_artifact"
    || record?.outputCollection === "applicationResultArtifacts"
    || Object.prototype.hasOwnProperty.call(record ?? {}, "payload")
    || Object.prototype.hasOwnProperty.call(record ?? {}, "text")
    || Object.prototype.hasOwnProperty.call(record ?? {}, "dataShape");
}
