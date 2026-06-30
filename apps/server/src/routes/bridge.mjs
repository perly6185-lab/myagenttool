export async function handleBridgeRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  namespace,
  protocolVersion,
  now,
  redeliverExpiredDispatches,
  nextDispatchableInvocation,
  markDispatched,
  findAgent,
  projectForInvocation,
  nextBridgeHealthCheck,
  markHealthCheckStarted,
  completeHealthCheck,
  nextBridgeDiscoveryRun,
  markDiscoveryStarted,
  normalizeStringArray,
  findDiscoveryRun,
  completeDiscoveryRun,
  nextBridgeProbeRun,
  markLifecycleActionObserved,
  nextBridgeLifecycleAction,
  markIntegrationProbeStarted,
  findIntegrationProbeRun,
  completeIntegrationProbeRun,
  findIntegrationArtifact,
  findInvocation,
  acknowledgeInvocation,
  appendEvent,
  completeInvocation,
}) {
  if (req.method === "GET" && url.pathname === "/api/bridge/next") {
    state.device.lastSeenAt = now();
    if (state.device.unlinkState !== "linked") {
      sendJson(res, 204, null);
      return true;
    }
    redeliverExpiredDispatches();
    const invocation = nextDispatchableInvocation();

    if (!invocation) {
      sendJson(res, 204, null);
      return true;
    }

    markDispatched(invocation);

    sendJson(res, 200, {
      namespace,
      protocolVersion,
      invocationId: invocation.id,
      agentId: invocation.agentId,
      adapter: findAgent(invocation.agentId)?.adapter ?? null,
      input: invocation.input,
      options: invocation.options,
      project: projectForInvocation(invocation),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/bridge/health-next") {
    state.device.lastSeenAt = now();
    if (state.device.unlinkState !== "linked") {
      sendJson(res, 204, null);
      return true;
    }

    const operation = nextBridgeHealthCheck();
    if (!operation) {
      sendJson(res, 204, null);
      return true;
    }

    markHealthCheckStarted(operation);
    sendJson(res, 200, {
      namespace,
      protocolVersion,
      checkId: operation.id,
      agentId: operation.agentId,
      adapter: findAgent(operation.agentId)?.adapter ?? null,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/bridge/health-complete") {
    const body = await readJson(req);
    const operation = state.healthChecks.find((item) => item.id === body.checkId && item.agentId === body.agentId);
    if (!operation) {
      sendJson(res, 404, { error: "health_check_not_found" });
      return true;
    }

    completeHealthCheck(operation, {
      status: body.status,
      message: body.message,
      nextAction: body.nextAction,
    });
    sendJson(res, 200, { ok: true, operation, agent: findAgent(operation.agentId) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/bridge/discovery-next") {
    state.device.lastSeenAt = now();
    if (state.device.unlinkState !== "linked") {
      sendJson(res, 204, null);
      return true;
    }

    const discoveryRun = nextBridgeDiscoveryRun();
    if (!discoveryRun) {
      sendJson(res, 204, null);
      return true;
    }

    markDiscoveryStarted(discoveryRun);
    sendJson(res, 200, {
      namespace,
      protocolVersion,
      discoveryRunId: discoveryRun.id,
      deviceId: discoveryRun.deviceId,
      scope: discoveryRun.scope,
      knownCommands: ["demo-agent"],
      knownLocalEndpoints: [
        {
          name: "Smoke HTTP Agent",
          baseUrl: "http://127.0.0.1:3212",
          requestPath: "/invoke",
          healthPath: "/health",
        },
      ],
      userProvidedPaths: normalizeStringArray(discoveryRun.options?.userProvidedPaths),
      userProvidedEndpoints: normalizeStringArray(discoveryRun.options?.userProvidedEndpoints),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/bridge/discovery-complete") {
    const body = await readJson(req);
    const discoveryRun = findDiscoveryRun(body.discoveryRunId);
    if (!discoveryRun) {
      sendJson(res, 404, { error: "discovery_run_not_found" });
      return true;
    }

    completeDiscoveryRun(discoveryRun, body);
    sendJson(res, 200, { ok: true, discoveryRun });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/bridge/probe-next") {
    state.device.lastSeenAt = now();
    if (state.device.unlinkState !== "linked") {
      sendJson(res, 204, null);
      return true;
    }

    const probeRun = nextBridgeProbeRun();
    if (!probeRun) {
      sendJson(res, 204, null);
      return true;
    }

    markIntegrationProbeStarted(probeRun);
    sendJson(res, 200, {
      namespace,
      protocolVersion,
      probeRunId: probeRun.id,
      artifactId: probeRun.artifactId,
      deviceId: probeRun.deviceId,
      adapter: probeRun.adapter,
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/bridge/lifecycle-next") {
    state.device.lastSeenAt = now();
    if (state.device.unlinkState !== "linked") {
      sendJson(res, 204, null);
      return true;
    }

    const lifecycleAction = nextBridgeLifecycleAction();
    if (!lifecycleAction) {
      sendJson(res, 204, null);
      return true;
    }
    markLifecycleActionObserved(lifecycleAction);

    sendJson(res, 200, {
      namespace,
      protocolVersion,
      lifecycleActionId: lifecycleAction.id,
      recipeId: lifecycleAction.recipeId,
      agentId: lifecycleAction.agentId,
      deviceId: lifecycleAction.deviceId,
      action: lifecycleAction.action,
      executionEnabled: false,
      command: null,
      summary: lifecycleAction.summary,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/bridge/probe-complete") {
    const body = await readJson(req);
    const probeRun = findIntegrationProbeRun(body.probeRunId);
    if (!probeRun) {
      sendJson(res, 404, { error: "probe_run_not_found" });
      return true;
    }
    completeIntegrationProbeRun(probeRun, body);
    sendJson(res, 200, { ok: true, probeRun, artifact: findIntegrationArtifact(probeRun.artifactId) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/bridge/cancel-status") {
    const invocation = findInvocation(url.searchParams.get("invocationId"));
    sendJson(res, 200, {
      cancelRequested: invocation?.cancellation.state === "requested",
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/bridge/ack") {
    const body = await readJson(req);
    const invocation = findInvocation(body.invocationId);
    if (!invocation) {
      sendJson(res, 404, { error: "invocation_not_found" });
      return true;
    }

    acknowledgeInvocation(invocation);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/bridge/events") {
    const body = await readJson(req);
    const invocation = findInvocation(body.invocationId);
    if (!invocation) {
      sendJson(res, 404, { error: "invocation_not_found" });
      return true;
    }
    appendEvent({
      invocationId: invocation.id,
      type: body.type ?? "log",
      level: body.level ?? "info",
      message: body.message ?? "",
      data: body.data,
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/bridge/complete") {
    const body = await readJson(req);
    const invocation = findInvocation(body.invocationId);
    if (!invocation) {
      sendJson(res, 404, { error: "invocation_not_found" });
      return true;
    }

    completeInvocation(invocation, body);
    sendJson(res, 200, { ok: true, invocation });
    return true;
  }

  return false;
}
