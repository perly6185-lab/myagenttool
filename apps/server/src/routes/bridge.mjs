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
  markLifecycleActionStarted,
  completeLifecycleAction,
  nextBridgeLifecycleAction,
  markIntegrationProbeStarted,
  findIntegrationProbeRun,
  completeIntegrationProbeRun,
  findIntegrationArtifact,
  findInvocation,
  acknowledgeInvocation,
  appendEvent,
  completeInvocation,
  requireBridgeCredential,
}) {
  if (!url.pathname.startsWith("/api/bridge/")) {
    return false;
  }
  if (!requireBridgeCredential({ req, res, sendJson })) {
    return true;
  }

  function bridgeInvocationGate(invocation, operation, { allowedStatuses, allowedDeliveryStates } = {}) {
    if (!invocation) {
      return { allowed: false, status: 404, body: { error: "invocation_not_found" } };
    }
    const delivery = invocation.delivery ?? {};
    const evidence = {
      operation,
      deviceId: state.device.id,
      deliveryDeviceId: delivery.deviceId ?? null,
      deliveryState: delivery.state ?? null,
      invocationStatus: invocation.status ?? null,
    };
    if (delivery.deviceId !== state.device.id) {
      appendBridgeRefusalEvent(invocation, "bridge_invocation_not_owned", evidence);
      return { allowed: false, status: 403, body: { error: "bridge_invocation_not_owned" } };
    }
    if (
      (allowedStatuses && !allowedStatuses.includes(invocation.status)) ||
      (allowedDeliveryStates && !allowedDeliveryStates.includes(delivery.state))
    ) {
      appendBridgeRefusalEvent(invocation, "bridge_invocation_not_active", evidence);
      return { allowed: false, status: 409, body: { error: "bridge_invocation_not_active" } };
    }
    return { allowed: true };
  }

  function appendBridgeRefusalEvent(invocation, reason, evidence) {
    appendEvent({
      invocationId: invocation.id,
      type: "bridge_delivery_refused",
      level: "warn",
      message: `Desktop Bridge ${evidence.operation} refused: ${reason}.`,
      data: { ...evidence, reason },
    });
  }

  function bridgeLifecycleGate(lifecycleAction, operation) {
    if (!lifecycleAction) {
      return { allowed: false, status: 404, body: { error: "lifecycle_action_not_found" } };
    }
    const evidence = {
      operation,
      lifecycleActionId: lifecycleAction.id,
      deviceId: state.device.id,
      actionDeviceId: lifecycleAction.deviceId ?? null,
      lifecycleStatus: lifecycleAction.status ?? null,
    };
    if (lifecycleAction.deviceId !== state.device.id) {
      appendBridgeLifecycleRefusalEvent("bridge_lifecycle_not_owned", evidence);
      return { allowed: false, status: 403, body: { error: "bridge_lifecycle_not_owned" } };
    }
    if (lifecycleAction.status !== "running") {
      appendBridgeLifecycleRefusalEvent("bridge_lifecycle_not_active", evidence);
      return { allowed: false, status: 409, body: { error: "bridge_lifecycle_not_active" } };
    }
    return { allowed: true };
  }

  function appendBridgeLifecycleRefusalEvent(reason, evidence) {
    appendEvent({
      invocationId: null,
      type: "bridge_lifecycle_refused",
      level: "warn",
      message: `Desktop Bridge ${evidence.operation} refused: ${reason}.`,
      data: { ...evidence, reason },
    });
  }

  function bridgeOperationGate(operation, operationName, { deviceId, allowedStatuses = ["running"] } = {}) {
    if (!operation) {
      return { allowed: false, status: 404, body: { error: `${operationName}_not_found` } };
    }
    const evidence = {
      operation: operationName,
      operationId: operation.id,
      deviceId: state.device.id,
      operationDeviceId: deviceId ?? null,
      operationStatus: operation.status ?? null,
    };
    if (deviceId !== state.device.id) {
      appendBridgeOperationRefusalEvent(`${operationName}_not_owned`, evidence);
      return { allowed: false, status: 403, body: { error: `${operationName}_not_owned` } };
    }
    if (!allowedStatuses.includes(operation.status)) {
      appendBridgeOperationRefusalEvent(`${operationName}_not_active`, evidence);
      return { allowed: false, status: 409, body: { error: `${operationName}_not_active` } };
    }
    return { allowed: true };
  }

  function appendBridgeOperationRefusalEvent(reason, evidence) {
    appendEvent({
      invocationId: null,
      type: "bridge_operation_refused",
      level: "warn",
      message: `Desktop Bridge ${evidence.operation} refused: ${reason}.`,
      data: { ...evidence, reason },
    });
  }

  function healthCheckDeviceId(operation) {
    const agent = findAgent(operation?.agentId);
    return operation?.deviceId ?? (agent?.location?.type === "local_device" ? agent.location.deviceId : null);
  }

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
    const gate = bridgeOperationGate(operation, "health_check", { deviceId: healthCheckDeviceId(operation) });
    if (!gate.allowed) {
      sendJson(res, gate.status, gate.body);
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
    const gate = bridgeOperationGate(discoveryRun, "discovery_run", { deviceId: discoveryRun?.deviceId ?? null });
    if (!gate.allowed) {
      sendJson(res, gate.status, gate.body);
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
    markLifecycleActionStarted(lifecycleAction);

    sendJson(res, 200, {
      namespace,
      protocolVersion,
      lifecycleActionId: lifecycleAction.id,
      recipeId: lifecycleAction.recipeId,
      agentId: lifecycleAction.agentId,
      deviceId: lifecycleAction.deviceId,
      action: lifecycleAction.action,
      executionEnabled: lifecycleAction.executionEnabled,
      command: lifecycleAction.command,
      summary: lifecycleAction.summary,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/bridge/lifecycle-complete") {
    const body = await readJson(req);
    const lifecycleAction = state.lifecycleQueuedActions.find((item) => item.id === body.lifecycleActionId);
    const gate = bridgeLifecycleGate(lifecycleAction, "lifecycle-complete");
    if (!gate.allowed) {
      sendJson(res, gate.status, gate.body);
      return true;
    }

    try {
      completeLifecycleAction(lifecycleAction, body);
    } catch (error) {
      sendJson(res, 409, {
        error: "lifecycle_action_not_completable",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, 200, { ok: true, lifecycleAction });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/bridge/probe-complete") {
    const body = await readJson(req);
    const probeRun = findIntegrationProbeRun(body.probeRunId);
    const gate = bridgeOperationGate(probeRun, "probe_run", { deviceId: probeRun?.deviceId ?? null });
    if (!gate.allowed) {
      sendJson(res, gate.status, gate.body);
      return true;
    }
    completeIntegrationProbeRun(probeRun, body);
    sendJson(res, 200, { ok: true, probeRun, artifact: findIntegrationArtifact(probeRun.artifactId) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/bridge/cancel-status") {
    const invocation = findInvocation(url.searchParams.get("invocationId"));
    const gate = bridgeInvocationGate(invocation, "cancel-status", {
      allowedStatuses: ["running", "cancelling"],
      allowedDeliveryStates: ["acknowledged"],
    });
    if (!gate.allowed) {
      sendJson(res, gate.status, gate.body);
      return true;
    }
    sendJson(res, 200, {
      cancelRequested: invocation.cancellation.state === "requested",
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
    const gate = bridgeInvocationGate(invocation, "ack", {
      allowedStatuses: ["dispatching"],
      allowedDeliveryStates: ["dispatching"],
    });
    if (!gate.allowed) {
      sendJson(res, gate.status, gate.body);
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
    const gate = bridgeInvocationGate(invocation, "events", {
      allowedStatuses: ["running", "cancelling"],
      allowedDeliveryStates: ["acknowledged"],
    });
    if (!gate.allowed) {
      sendJson(res, gate.status, gate.body);
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
    const gate = bridgeInvocationGate(invocation, "complete", {
      allowedStatuses: ["running", "cancelling"],
      allowedDeliveryStates: ["acknowledged"],
    });
    if (!gate.allowed) {
      sendJson(res, gate.status, gate.body);
      return true;
    }

    completeInvocation(invocation, body);
    sendJson(res, 200, { ok: true, invocation });
    return true;
  }

  return false;
}
