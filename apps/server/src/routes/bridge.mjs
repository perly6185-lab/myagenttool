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
    device.lastSeenAt = now();
    if (device.unlinkState !== "linked") {
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
    device.lastSeenAt = now();
    if (device.unlinkState !== "linked") {
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
    device.lastSeenAt = now();
    if (device.unlinkState !== "linked") {
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
    device.lastSeenAt = now();
    if (device.unlinkState !== "linked") {
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

  if (req.method === "GET" && url.pathname === "/api/bridge/application-install-next") {
    device.lastSeenAt = now();
    if (device.unlinkState !== "linked") {
      sendJson(res, 204, null);
      return true;
    }
    const run = nextBridgeApplicationInstall(device.id);
    if (!run) {
      sendJson(res, 204, null);
      return true;
    }
    sendJson(res, 200, { namespace, protocolVersion, runId: run.id, deviceId: run.deviceId, plan: run.plan });
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
