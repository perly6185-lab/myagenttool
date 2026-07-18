import { refusalCodesByCategory } from "@myagenttool/protocol";

// Classify a desktop-reported local-execution refusal into the closed taxonomy.
// The precise reason stays verbatim in evidence; if the bridge already declared a
// sub-code, honor it — else default to the command allowlist (the most common
// local-execution refusal). Most of these are policy rules; `binary_unavailable`
// (#802) is an environment STATE (the device lacks the binary), so the category is
// derived from the code below rather than hardcoded.
const LOCAL_EXECUTION_REFUSAL_CODES = new Set([
  "command_not_allowlisted",
  "cwd_outside_approved_root",
  "file_policy_exceeded",
  "network_policy_exceeded",
  "binary_unavailable",
]);

// code → its (single) category, from the closed taxonomy map.
const CODE_CATEGORY = new Map(
  Object.entries(refusalCodesByCategory).flatMap(([category, codes]) => codes.map((code) => [code, category])),
);
export function localExecutionRefusalCategory(code) {
  return CODE_CATEGORY.get(code) ?? "policy";
}
export function localExecutionRefusalCode(evidence = {}) {
  // Prefer the precise sub-code the desktop gate declared (#758 Tier-3), then a
  // legacy evidence.code, else the command allowlist (the most common reason).
  if (LOCAL_EXECUTION_REFUSAL_CODES.has(evidence.refusalCode)) {
    return evidence.refusalCode;
  }
  if (LOCAL_EXECUTION_REFUSAL_CODES.has(evidence.code)) {
    return evidence.code;
  }
  return "command_not_allowlisted";
}

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
  cancellationSignal,
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
  nextBridgeApplicationInstall,
  findApplicationInstallRun,
  recordApplicationInstallProgress,
  completeApplicationInstall,
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
  refuse,
  recordAgentFileAccess,
  recordRequestContext,
  recordRoundEvent,
  completeInvocation,
  requireBridgeCredential,
}) {
  if (!url.pathname.startsWith("/api/bridge/")) {
    return false;
  }
  // The authenticated bridge's OWN device. Every ownership gate and liveness
  // stamp below keys on this device rather than on `state.device` (the primary
  // alias) — otherwise each gate compares the primary device to itself, which is
  // how they stayed vacuously true while a single device existed. Keyed here,
  // they mean what they say: a bridge cannot ack, log to, or complete work that
  // was dispatched to a different machine.
  const device = requireBridgeCredential({ req, res, sendJson });
  if (!device) {
    return true;
  }

  // #1251: one source of truth for each aux queue's "hand out the next item"
  // step (select + markStarted + response payload). Both the dedicated
  // per-queue endpoints AND the multiplexed /api/bridge/aux-next call these, so
  // the payload shape and the mark-started side effect cannot drift apart.
  // Each returns { kind, payload } when it has work, or null. markStarted runs
  // ONLY on a hit, so trying builders in order until the first hit leaves the
  // skipped-over queues untouched.
  function buildHealthNext() {
    const operation = nextBridgeHealthCheck();
    if (!operation) return null;
    markHealthCheckStarted(operation);
    return {
      kind: "health",
      payload: {
        namespace,
        protocolVersion,
        checkId: operation.id,
        agentId: operation.agentId,
        adapter: findAgent(operation.agentId)?.adapter ?? null,
      },
    };
  }
  function buildDiscoveryNext() {
    const discoveryRun = nextBridgeDiscoveryRun();
    if (!discoveryRun) return null;
    markDiscoveryStarted(discoveryRun);
    return {
      kind: "discovery",
      payload: {
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
      },
    };
  }
  function buildProbeNext() {
    const probeRun = nextBridgeProbeRun();
    if (!probeRun) return null;
    markIntegrationProbeStarted(probeRun);
    return {
      kind: "probe",
      payload: {
        namespace,
        protocolVersion,
        probeRunId: probeRun.id,
        artifactId: probeRun.artifactId,
        deviceId: probeRun.deviceId,
        adapter: probeRun.adapter,
      },
    };
  }
  function buildLifecycleNext() {
    const lifecycleAction = nextBridgeLifecycleAction();
    if (!lifecycleAction) return null;
    markLifecycleActionStarted(lifecycleAction);
    return {
      kind: "lifecycle",
      payload: {
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
      },
    };
  }
  function buildApplicationInstallNext() {
    const run = nextBridgeApplicationInstall(device.id);
    if (!run) return null;
    return {
      kind: "application_install",
      payload: { namespace, protocolVersion, runId: run.id, deviceId: run.deviceId, plan: run.plan },
    };
  }
  // Priority order — MUST match the order the bridge used to poll the dedicated
  // endpoints, so multiplexing does not reshuffle which queue wins a tick.
  const AUX_BUILDERS = [buildHealthNext, buildDiscoveryNext, buildProbeNext, buildLifecycleNext, buildApplicationInstallNext];

  function bridgeInvocationGate(invocation, operation, { allowedStatuses, allowedDeliveryStates } = {}) {
    if (!invocation) {
      return { allowed: false, status: 404, body: { error: "invocation_not_found" } };
    }
    const delivery = invocation.delivery ?? {};
    const evidence = {
      operation,
      deviceId: device.id,
      deliveryDeviceId: delivery.deviceId ?? null,
      deliveryState: delivery.state ?? null,
      invocationStatus: invocation.status ?? null,
    };
    if (delivery.deviceId !== device.id) {
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
    refuse({
      subject: { kind: "invocation", id: invocation.id },
      requester: { kind: "local_user", id: evidence.deliveryDeviceId ?? state.device.id },
      category: "state",
      code: "subject_not_actionable",
      decidedBy: { kind: "policy_engine", id: "bridge_gate" },
      summary: `Bridge ${evidence.operation} refused: ${reason}.`,
      evidence: { ...evidence, reason },
      remedy: "The delivery must be owned by this device and in an actionable state.",
      retryAfter: null,
      appealTo: null,
      event: {
        invocationId: invocation.id,
        type: "bridge_delivery_refused",
        level: "warn",
        message: `Desktop Bridge ${evidence.operation} refused: ${reason}.`,
        data: { ...evidence, reason },
      },
    });
  }

  function bridgeLifecycleGate(lifecycleAction, operation) {
    if (!lifecycleAction) {
      return { allowed: false, status: 404, body: { error: "lifecycle_action_not_found" } };
    }
    const evidence = {
      operation,
      lifecycleActionId: lifecycleAction.id,
      deviceId: device.id,
      actionDeviceId: lifecycleAction.deviceId ?? null,
      lifecycleStatus: lifecycleAction.status ?? null,
    };
    if (lifecycleAction.deviceId !== device.id) {
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
    refuse({
      subject: { kind: "lifecycle_action", id: evidence.lifecycleActionId },
      requester: { kind: "local_user", id: evidence.actionDeviceId ?? state.device.id },
      category: "state",
      code: "subject_not_actionable",
      decidedBy: { kind: "policy_engine", id: "bridge_gate" },
      summary: `Bridge ${evidence.operation} refused: ${reason}.`,
      evidence: { ...evidence, reason },
      remedy: "The lifecycle action must be owned by this device and running.",
      retryAfter: null,
      appealTo: null,
      event: {
        invocationId: null,
        type: "bridge_lifecycle_refused",
        level: "warn",
        message: `Desktop Bridge ${evidence.operation} refused: ${reason}.`,
        data: { ...evidence, reason },
      },
    });
  }

  function bridgeOperationGate(operation, operationName, { deviceId, allowedStatuses = ["running"] } = {}) {
    if (!operation) {
      return { allowed: false, status: 404, body: { error: `${operationName}_not_found` } };
    }
    const evidence = {
      operation: operationName,
      operationId: operation.id,
      deviceId: device.id,
      operationDeviceId: deviceId ?? null,
      operationStatus: operation.status ?? null,
    };
    if (deviceId !== device.id) {
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
    refuse({
      subject: { kind: "lifecycle_action", id: evidence.operationId },
      requester: { kind: "local_user", id: evidence.operationDeviceId ?? state.device.id },
      category: "state",
      code: "subject_not_actionable",
      decidedBy: { kind: "policy_engine", id: "bridge_gate" },
      summary: `Bridge ${evidence.operation} refused: ${reason}.`,
      evidence: { ...evidence, reason },
      remedy: "The operation must be owned by this device and in an allowed status.",
      retryAfter: null,
      appealTo: null,
      event: {
        invocationId: null,
        type: "bridge_operation_refused",
        level: "warn",
        message: `Desktop Bridge ${evidence.operation} refused: ${reason}.`,
        data: { ...evidence, reason },
      },
    });
  }

  function healthCheckDeviceId(operation) {
    const agent = findAgent(operation?.agentId);
    return operation?.deviceId ?? (agent?.location?.type === "local_device" ? agent.location.deviceId : null);
  }

  if (req.method === "GET" && url.pathname === "/api/bridge/next") {
    device.lastSeenAt = now();
    if (device.unlinkState !== "linked") {
      sendJson(res, 204, null);
      return true;
    }
    redeliverExpiredDispatches();
    const invocation = nextDispatchableInvocation();

    if (!invocation) {
      sendJson(res, 204, null);
      return true;
    }

    const agent = findAgent(invocation.agentId);
    markDispatched(invocation);

    sendJson(res, 200, {
      namespace,
      protocolVersion,
      invocationId: invocation.id,
      agentId: invocation.agentId,
      agentName: agent?.name ?? null,
      adapter: agent?.adapter ?? null,
      input: invocation.input,
      options: invocation.options,
      project: projectForInvocation(invocation),
    });
    return true;
  }

  // Multiplexed aux poll (#1251): one request returns the first available aux
  // work item across all queues, in the same priority order the dedicated
  // endpoints are polled (health > discovery > probe > lifecycle > install), so
  // a bridge no longer walks five endpoints per idle tick. The payload matches
  // the dedicated endpoint plus a `kind` discriminator.
  if (req.method === "GET" && url.pathname === "/api/bridge/aux-next") {
    device.lastSeenAt = now();
    if (device.unlinkState !== "linked") {
      sendJson(res, 204, null);
      return true;
    }
    for (const build of AUX_BUILDERS) {
      const item = build();
      if (item) {
        sendJson(res, 200, { ...item.payload, kind: item.kind });
        return true;
      }
    }
    sendJson(res, 204, null);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/bridge/health-next") {
    device.lastSeenAt = now();
    if (device.unlinkState !== "linked") {
      sendJson(res, 204, null);
      return true;
    }
    const item = buildHealthNext();
    if (!item) {
      sendJson(res, 204, null);
      return true;
    }
    sendJson(res, 200, item.payload);
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
    device.lastSeenAt = now();
    if (device.unlinkState !== "linked") {
      sendJson(res, 204, null);
      return true;
    }
    const item = buildDiscoveryNext();
    if (!item) {
      sendJson(res, 204, null);
      return true;
    }
    sendJson(res, 200, item.payload);
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
    device.lastSeenAt = now();
    if (device.unlinkState !== "linked") {
      sendJson(res, 204, null);
      return true;
    }
    const item = buildProbeNext();
    if (!item) {
      sendJson(res, 204, null);
      return true;
    }
    sendJson(res, 200, item.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/bridge/lifecycle-next") {
    device.lastSeenAt = now();
    if (device.unlinkState !== "linked") {
      sendJson(res, 204, null);
      return true;
    }
    const item = buildLifecycleNext();
    if (!item) {
      sendJson(res, 204, null);
      return true;
    }
    sendJson(res, 200, item.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/bridge/application-install-next") {
    device.lastSeenAt = now();
    if (device.unlinkState !== "linked") {
      sendJson(res, 204, null);
      return true;
    }
    const item = buildApplicationInstallNext();
    if (!item) {
      sendJson(res, 204, null);
      return true;
    }
    sendJson(res, 200, item.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/bridge/application-install-cancel-status") {
    const run = findApplicationInstallRun(url.searchParams.get("runId"));
    if (!run || run.deviceId !== device.id || !["running", "cancelling"].includes(run.status)) {
      sendJson(res, 404, { error: "application_install_run_not_found" });
      return true;
    }
    sendJson(res, 200, { cancelRequested: Boolean(run.cancelRequestedAt) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/bridge/application-install-progress") {
    const body = await readJson(req);
    const run = findApplicationInstallRun(body?.runId);
    if (!run || run.deviceId !== device.id) {
      sendJson(res, 404, { error: "application_install_run_not_found" });
      return true;
    }
    recordApplicationInstallProgress(run, body);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/bridge/application-install-complete") {
    const body = await readJson(req);
    const run = findApplicationInstallRun(body?.runId);
    if (!run || run.deviceId !== device.id) {
      sendJson(res, 404, { error: "application_install_run_not_found" });
      return true;
    }
    try {
      completeApplicationInstall(run, body);
    } catch (error) {
      sendJson(res, 409, { error: "application_install_not_completable", message: error instanceof Error ? error.message : String(error) });
      return true;
    }
    sendJson(res, 200, { ok: true, run });
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

  // #1251/#1302: device-wide cancellation poll. One call replaces the per-run
  // /api/bridge/cancel-status polls — the bridge runs a single shared watcher
  // instead of one 250ms GET per in-flight run. Returns the ids of THIS device's
  // acknowledged, in-flight invocations whose cancellation was requested — the
  // same ownership + actionable-state predicate as cancel-status, applied
  // set-wise (an unowned or terminal invocation simply never appears).
  //
  // With ?wait=1 (#1302 long-poll): if nothing is cancel-requested yet, hold the
  // response open until cancelInvocation notifies this device or a max-wait
  // timeout, then recompute and return. The bridge re-issues immediately, so an
  // idle device makes ~one call per max-wait window instead of 4/second, and a
  // cancellation is delivered near-instantly instead of up to 250ms later.
  if (req.method === "GET" && url.pathname === "/api/bridge/cancellations") {
    const requestedIds = () => state.invocations
      .filter((invocation) => {
        const delivery = invocation.delivery ?? {};
        return delivery.deviceId === device.id
          && delivery.state === "acknowledged"
          && ["running", "cancelling"].includes(invocation.status)
          && invocation.cancellation?.state === "requested";
      })
      .map((invocation) => invocation.id);

    const wantsWait = url.searchParams.get("wait") === "1" && cancellationSignal;
    const current = requestedIds();
    if (current.length > 0 || !wantsWait) {
      sendJson(res, 200, { invocationIds: current });
      return true;
    }

    // Long-poll: park until this device is notified or the wait times out. Cancel
    // the waiter on client disconnect so a dropped poll never leaks a held
    // resolver, and skip the write once the socket is gone.
    const waiter = cancellationSignal.wait(device.id);
    let clientGone = false;
    const onClose = () => { clientGone = true; waiter.cancel(); };
    res.on("close", onClose);
    try {
      await waiter.promise;
    } finally {
      res.off("close", onClose);
    }
    if (clientGone) return true;
    sendJson(res, 200, { invocationIds: requestedIds() });
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
    if (body.type === "local_execution_refused") {
      // The desktop executor refused at its local-execution policy — the last
      // gate before spawn, in the only process allowed to spawn. Land it in the
      // same store as every server refusal. The exact sub-code lives in the
      // verbatim evidence; server-side we classify it to the policy bucket.
      const evidence = body.data && typeof body.data === "object" ? body.data : {};
      const refusalCode = localExecutionRefusalCode(evidence);
      const refusalCategory = localExecutionRefusalCategory(refusalCode);
      refuse({
        subject: { kind: "capability_call", id: invocation.id },
        requester: { kind: "local_user", id: invocation.requestedBy ?? state.device.id },
        category: refusalCategory,
        code: refusalCode,
        decidedBy: { kind: "policy_engine", id: "local_execution_policy" },
        summary: body.message || "Local execution policy refused the command.",
        evidence,
        remedy: refusalCode === "binary_unavailable"
          ? "Install the required binary on the device that owns this project, or route the run to a device that has it."
          : "Adjust the command, cwd, or file/network policy to satisfy the device's local-execution allowlist.",
        retryAfter: null,
        appealTo: "device_owner",
        event: {
          invocationId: invocation.id,
          type: "local_execution_refused",
          level: body.level ?? "error",
          message: body.message ?? "",
          data: body.data,
        },
      });
    } else {
      appendEvent({
        invocationId: invocation.id,
        type: body.type ?? "log",
        level: body.level ?? "info",
        message: body.message ?? "",
        data: body.data,
      });
    }
    // File ledger: the bridge piggybacks file accesses on the agent_output event's
    // data; accumulate them onto the invocation (deduped/capped) so a run's read +
    // written files are observable. Never let a malformed payload break the event.
    if (Array.isArray(body.data?.fileAccess) && body.data.fileAccess.length && typeof recordAgentFileAccess === "function") {
      recordAgentFileAccess(invocation, body.data.fileAccess);
    }
    // Per-round telemetry (#808): fold round_started / round_completed /
    // tool_invocation_created into first-class per-round records + child spans.
    if (
      (body.type === "round_started" || body.type === "round_completed" || body.type === "tool_invocation_created") &&
      typeof recordRoundEvent === "function"
    ) {
      recordRoundEvent(invocation, body);
    }
    // Request context: the wrapper relays the CLI's stream-json init (model,
    // permission mode, tool/MCP/skill/agent inventory) once per run. Re-clamped
    // server-side; first report wins. A malformed payload degrades to no-op.
    if (body.type === "request_context" && typeof recordRequestContext === "function") {
      recordRequestContext(invocation, body.data);
    }
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

  // The refusal verb (docs/design/BRIDGE_LIVENESS_AND_REFUSAL.md): a bridge that
  // KNOWS it cannot run a leased delivery (agent binary missing, workspace gone,
  // unsupported adapter) says so honestly instead of failing after ack or letting
  // the lease lapse into a fake timeout. Pre-ack only — an acked run reports
  // through complete. Terminal, not requeue: on a single-device queue a bounce
  // would just loop; the failure + its recovery model is the right lane.
  if (req.method === "POST" && url.pathname === "/api/bridge/refuse") {
    const body = await readJson(req);
    const invocation = findInvocation(body.invocationId);
    if (!invocation) {
      sendJson(res, 404, { error: "invocation_not_found" });
      return true;
    }
    const gate = bridgeInvocationGate(invocation, "refuse", {
      allowedStatuses: ["dispatching"],
      allowedDeliveryStates: ["dispatching"],
    });
    if (!gate.allowed) {
      sendJson(res, gate.status, gate.body);
      return true;
    }
    const reason = String(body.reason ?? "").trim() || "The bridge refused this delivery.";
    // errorCode steers recovery classification — only the known category
    // vocabulary is honored (mirrors the categorized map); unknown codes drop.
    const knownErrorCodes = ["cancelled", "validation_failed", "agent_unavailable", "device_unlinked", "dispatch_timeout", "policy_blocked", "runtime_error"];
    const errorCode = knownErrorCodes.includes(String(body.errorCode ?? "").trim()) ? String(body.errorCode).trim() : null;
    invocation.delivery.state = "refused";
    // The executor is a decider too: the bridge declined to deliver. Record it as
    // a first-class refusal (the device cannot deliver this work right now).
    refuse({
      subject: { kind: "invocation", id: invocation.id },
      requester: { kind: "control_plane", id: state.device.id },
      category: "state",
      code: "undeliverable",
      decidedBy: { kind: "arbiter", id: invocation.delivery.deviceId ?? state.device.id },
      summary: `Desktop Bridge refused the delivery: ${reason}`,
      evidence: { reason, errorCode, dispatchAttempts: invocation.delivery.dispatchAttempts },
      remedy: "Resolve the cause the bridge reported (missing agent, workspace, or unsupported adapter), then re-dispatch.",
      retryAfter: null,
      appealTo: "device_owner",
      event: {
        invocationId: invocation.id,
        type: "delivery_refused",
        level: "warn",
        message: `Desktop Bridge refused the delivery: ${reason}`,
        data: { reason, errorCode, dispatchAttempts: invocation.delivery.dispatchAttempts },
      },
    });
    completeInvocation(invocation, {
      status: "failed",
      result: { summary: reason, ...(errorCode ? { errorCode } : {}) },
    });
    sendJson(res, 200, { ok: true, invocation });
    return true;
  }

  return false;
}
