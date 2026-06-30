export async function handleIntegrationRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  createDiscoveryRun,
  createIntegrationArtifact,
  findIntegrationArtifact,
  generateIntegrationArtifacts,
  createIntegrationProbeRun,
  registerIntegrationArtifact,
  transitionIntegrationArtifact,
  updateIntegrationRetentionSettings,
  draftIntegrationWithPlatformAgent,
  findDiscoveryRun,
  registerDiscoveredCandidate,
}) {
  if (req.method === "POST" && url.pathname === "/api/discovery") {
    const body = await readJson(req);
    const discoveryRun = createDiscoveryRun(body);
    sendJson(res, 202, { discoveryRun });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integration-artifacts") {
    const body = await readJson(req);
    let artifact;
    try {
      artifact = createIntegrationArtifact(body);
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_integration_artifact",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, artifact.reviewState === "draft" ? 201 : 202, { artifact });
    return true;
  }

  const artifactMatch = url.pathname.match(/^\/api\/integration-artifacts\/([^/]+)\/(generate|approve|reject|archive|review|probe|register)$/);
  if (req.method === "POST" && artifactMatch) {
    const artifact = findIntegrationArtifact(decodeURIComponent(artifactMatch[1]));
    if (!artifact) {
      sendJson(res, 404, { error: "integration_artifact_not_found" });
      return true;
    }

    const action = artifactMatch[2];
    if (action === "generate") {
      const artifacts = generateIntegrationArtifacts(artifact);
      sendJson(res, 201, { sourceArtifact: artifact, artifacts });
      return true;
    }
    if (action === "probe") {
      let probeRun;
      try {
        probeRun = createIntegrationProbeRun(artifact);
      } catch (error) {
        sendJson(res, 409, {
          error: "probe_not_available",
          message: error instanceof Error ? error.message : String(error),
        });
        return true;
      }
      sendJson(res, 202, { artifact, probeRun });
      return true;
    }
    if (action === "register") {
      let agent;
      try {
        agent = registerIntegrationArtifact(artifact);
      } catch (error) {
        sendJson(res, 409, {
          error: "integration_artifact_not_registerable",
          message: error instanceof Error ? error.message : String(error),
        });
        return true;
      }
      sendJson(res, 201, { artifact, agent });
      return true;
    }

    const updated = transitionIntegrationArtifact(artifact, action);
    sendJson(res, 200, { artifact: updated });
    return true;
  }

  if (req.method === "PATCH" && url.pathname === "/api/integration-retention") {
    const body = await readJson(req);
    const retentionSettings = updateIntegrationRetentionSettings(body);
    sendJson(res, 200, { retentionSettings });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integration-builder/draft") {
    const body = await readJson(req);
    let result;
    try {
      result = draftIntegrationWithPlatformAgent(body);
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_integration_builder_request",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, 201, result);
    return true;
  }

  const discoveryRegisterMatch = url.pathname.match(/^\/api\/discovery\/([^/]+)\/candidates\/([^/]+)\/register$/);
  if (req.method === "POST" && discoveryRegisterMatch) {
    const discoveryRun = findDiscoveryRun(decodeURIComponent(discoveryRegisterMatch[1]));
    if (!discoveryRun) {
      sendJson(res, 404, { error: "discovery_run_not_found" });
      return true;
    }

    const candidate = discoveryRun.candidates.find((item) => item.id === decodeURIComponent(discoveryRegisterMatch[2]));
    if (!candidate) {
      sendJson(res, 404, { error: "discovery_candidate_not_found" });
      return true;
    }

    const agent = registerDiscoveredCandidate(discoveryRun, candidate);
    sendJson(res, 201, { agent, discoveryRun, candidate });
    return true;
  }

  return false;
}
