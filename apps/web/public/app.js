const apiBase = "http://127.0.0.1:3001";

const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  deviceName: document.querySelector("#deviceName"),
  deviceStatus: document.querySelector("#deviceStatus"),
  devicePlatform: document.querySelector("#devicePlatform"),
  deviceLastSeen: document.querySelector("#deviceLastSeen"),
  agentName: document.querySelector("#agentName"),
  agentStatus: document.querySelector("#agentStatus"),
  agentHealth: document.querySelector("#agentHealth"),
  agentCapability: document.querySelector("#agentCapability"),
  agentCost: document.querySelector("#agentCost"),
  agentNextAction: document.querySelector("#agentNextAction"),
  deviceSelect: document.querySelector("#deviceSelect"),
  agentSelect: document.querySelector("#agentSelect"),
  taskInput: document.querySelector("#taskInput"),
  runButton: document.querySelector("#runButton"),
  cancelButton: document.querySelector("#cancelButton"),
  healthCheckButton: document.querySelector("#healthCheckButton"),
  toggleAgentButton: document.querySelector("#toggleAgentButton"),
  runBlockReason: document.querySelector("#runBlockReason"),
  discoverButton: document.querySelector("#discoverButton"),
  discoverySummary: document.querySelector("#discoverySummary"),
  candidateList: document.querySelector("#candidateList"),
  activityTitle: document.querySelector("#activityTitle"),
  taskState: document.querySelector("#taskState"),
  safetySummary: document.querySelector("#safetySummary"),
  dataSummary: document.querySelector("#dataSummary"),
  costSummary: document.querySelector("#costSummary"),
  cancellationSummary: document.querySelector("#cancellationSummary"),
  adapterName: document.querySelector("#adapterName"),
  agentLifecycle: document.querySelector("#agentLifecycle"),
  invocationId: document.querySelector("#invocationId"),
  traceId: document.querySelector("#traceId"),
  technicalState: document.querySelector("#technicalState"),
  auditDecision: document.querySelector("#auditDecision"),
  deliveryStatus: document.querySelector("#deliveryStatus"),
  cancelStatus: document.querySelector("#cancelStatus"),
  eventList: document.querySelector("#eventList"),
  resultTitle: document.querySelector("#resultTitle"),
  resultSummary: document.querySelector("#resultSummary")
};

let currentInvocationId = null;
let selectedAgentId = null;

els.runButton.addEventListener("click", async () => {
  const task = els.taskInput.value.trim();
  if (!task) return;

  els.runButton.disabled = true;
  try {
    const response = await fetch(`${apiBase}/api/invocations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, agentId: selectedAgentId })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message ?? data.error ?? "Unable to start task.");
    }
    currentInvocationId = data.invocation.id;
    await refresh();
  } catch (error) {
    els.resultTitle.textContent = "Could not start";
    els.resultSummary.textContent = error instanceof Error ? error.message : "Unable to start the task.";
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.taskInput.addEventListener("input", () => updateActions(lastState, currentInvocation()));
els.agentSelect.addEventListener("change", () => {
  selectedAgentId = els.agentSelect.value || null;
  render(lastState);
});

els.cancelButton.addEventListener("click", async () => {
  if (!currentInvocationId) return;

  els.cancelButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/invocations/${currentInvocationId}/cancel`, {
      method: "POST"
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.healthCheckButton.addEventListener("click", async () => {
  if (!selectedAgentId) return;

  els.healthCheckButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/agents/${encodeURIComponent(selectedAgentId)}/health-check`, {
      method: "POST"
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.toggleAgentButton.addEventListener("click", async () => {
  const agent = selectedAgent(lastState);
  if (!agent) return;

  const action = agent.status === "disabled" ? "enable" : "disable";
  els.toggleAgentButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/agents/${encodeURIComponent(agent.id)}/${action}`, {
      method: "POST"
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.discoverButton.addEventListener("click", async () => {
  els.discoverButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/discovery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: [
          "known_command_allowlist",
          "known_local_endpoint",
          "user_provided_path",
          "user_provided_endpoint",
          "bridge_managed_config"
        ],
        userProvidedPaths: ["demo-agent"],
        userProvidedEndpoints: ["http://127.0.0.1:3212"]
      })
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

els.candidateList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-discovery-run-id][data-candidate-id]");
  if (!button) return;

  button.disabled = true;
  try {
    const runId = encodeURIComponent(button.dataset.discoveryRunId);
    const candidateId = encodeURIComponent(button.dataset.candidateId);
    await fetch(`${apiBase}/api/discovery/${runId}/candidates/${candidateId}/register`, {
      method: "POST"
    });
    await refresh();
  } finally {
    updateActions(lastState, currentInvocation());
  }
});

setInterval(refresh, 700);
refresh();

let lastState = null;

async function refresh() {
  try {
    const response = await fetch(`${apiBase}/api/state`);
    const state = await response.json();
    lastState = state;
    els.connectionStatus.textContent = "Connected";
    els.connectionStatus.dataset.state = "ok";
    render(state);
  } catch {
    els.connectionStatus.textContent = "Server offline";
    els.connectionStatus.dataset.state = "bad";
    renderOffline();
  }
}

function render(state) {
  const agents = state.agents?.length ? state.agents : [state.agent].filter(Boolean);
  if (!selectedAgentId || !agents.some((agent) => agent.id === selectedAgentId)) {
    selectedAgentId = state.agent?.id ?? agents[0]?.id ?? null;
  }

  renderSelectors(state, agents);

  const invocation = currentInvocation() ?? state.invocations[0] ?? null;
  const audit = invocation
    ? state.auditSummaries.find((item) => item.invocationId === invocation.id)
    : null;
  const agent = agents.find((item) => item.id === selectedAgentId) ?? state.agent ?? agents[0];
  const lifecycleAudit = state.lifecycleAuditRecords?.find((item) => item.agentId === agent?.id) ?? null;
  const discoveryRun = state.discoveryRuns?.[0] ?? null;

  if (invocation) currentInvocationId = invocation.id;

  const readableTaskState = readableStatus(invocation?.status);
  els.taskState.textContent = readableTaskState;
  els.taskState.dataset.state = invocation?.status ?? "waiting";
  els.activityTitle.textContent = activityTitle(invocation?.status);

  els.deviceName.textContent = state.device.name;
  els.deviceStatus.textContent = readableDeviceStatus(state.device.status);
  els.devicePlatform.textContent = `${state.device.platform} / ${state.device.architecture}`;
  els.deviceLastSeen.textContent = state.device.lastSeenAt ? shortTime(state.device.lastSeenAt) : "Not seen yet";

  els.agentName.textContent = agent?.name ?? "No agent registered";
  els.agentStatus.textContent = readableAgentStatus(agent?.status);
  els.agentHealth.textContent = readableHealth(agent?.health);
  els.agentCapability.textContent = agent?.capabilities?.[0]?.description ?? "No capability selected";
  els.agentCost.textContent = costText(agent?.economics);
  els.agentNextAction.textContent = agent?.health?.nextAction ?? agentNextAction(agent, state);

  els.safetySummary.textContent = agent?.registrationNotes?.risk ?? "Review the selected agent before running.";
  els.dataSummary.textContent = agent?.registrationNotes?.data ?? "Task input and result are recorded.";
  els.costSummary.textContent = agent?.registrationNotes?.cost ?? costText(agent?.economics);
  els.cancellationSummary.textContent = agent?.registrationNotes?.cancellation ?? cancellationText(agent?.adapter);
  els.adapterName.textContent = adapterText(agent?.adapter);
  els.agentLifecycle.textContent = lifecycleText(agent);

  els.invocationId.textContent = invocation?.id ?? "No task yet";
  els.traceId.textContent = invocation?.traceId ?? "No trace yet";
  els.technicalState.textContent = invocation ? `${invocation.status} / ${invocation.delivery?.state ?? "no delivery"}` : "No task yet";
  els.auditDecision.textContent = audit ? readableAudit(audit) : lifecycleAudit ? readableLifecycleAudit(lifecycleAudit) : "Nothing recorded yet";
  els.deliveryStatus.textContent = readableDelivery(invocation?.delivery?.state);
  els.cancelStatus.textContent = readableCancellation(invocation?.cancellation?.state);
  els.toggleAgentButton.textContent = agent?.status === "disabled" ? "Enable agent" : "Disable agent";

  els.resultTitle.textContent = resultTitle(invocation?.status);
  els.resultSummary.textContent = resultSummary(invocation, audit);

  const visibleEvents = invocation
    ? state.events.filter((event) => event.invocationId === invocation.id || event.data?.agentId === agent?.id).slice(0, 30)
    : state.events.slice(0, 30);
  renderTimeline(visibleEvents);
  renderDiscovery(discoveryRun);
  updateActions(state, invocation);
}

function currentInvocation() {
  if (!lastState || !currentInvocationId) {
    return null;
  }
  return lastState.invocations.find((item) => item.id === currentInvocationId) ?? null;
}

function renderSelectors(state, agents) {
  const deviceLabel = `${state.device.name} - ${readableDeviceStatus(state.device.status)}`;
  if (els.deviceSelect.options.length !== 1 || els.deviceSelect.value !== state.device.id) {
    els.deviceSelect.replaceChildren(new Option(deviceLabel, state.device.id));
  } else {
    els.deviceSelect.options[0].textContent = deviceLabel;
  }
  els.deviceSelect.disabled = true;

  const previous = els.agentSelect.value || selectedAgentId;
  els.agentSelect.replaceChildren(
    ...agents.map((agent) => new Option(`${agent.name} - ${readableAgentStatus(agent.status)} - ${readableHealthLabel(agent.health)}`, agent.id))
  );
  els.agentSelect.value = agents.some((agent) => agent.id === previous) ? previous : selectedAgentId ?? "";
  selectedAgentId = els.agentSelect.value || selectedAgentId;
}

function renderOffline() {
  els.taskState.textContent = "Offline";
  els.taskState.dataset.state = "failed";
  els.activityTitle.textContent = "Connect the local demo server";
  els.deviceStatus.textContent = "Offline";
  els.deviceLastSeen.textContent = "-";
  els.agentStatus.textContent = "Unavailable";
  els.agentHealth.textContent = "-";
  els.agentCapability.textContent = "-";
  els.agentNextAction.textContent = "-";
  els.agentLifecycle.textContent = "-";
  els.deliveryStatus.textContent = "Not delivered";
  els.cancelStatus.textContent = "No task";
  els.auditDecision.textContent = "Nothing recorded";
  els.resultTitle.textContent = "Waiting for server";
  els.resultSummary.textContent = "Start the local demo server, then this workspace can show your computer and agent status.";
  els.runButton.disabled = true;
  els.cancelButton.disabled = true;
  els.healthCheckButton.disabled = true;
  els.toggleAgentButton.disabled = true;
  els.discoverButton.disabled = true;
  els.runBlockReason.textContent = "Server is offline.";
  els.discoverySummary.textContent = "Server is offline.";
  els.candidateList.replaceChildren();
  renderTimeline([]);
}

function renderTimeline(events) {
  if (events.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timeline-empty";
    empty.innerHTML = "<strong>No activity yet</strong><span>Run a task to watch local progress here.</span>";
    els.eventList.replaceChildren(empty);
    return;
  }

  els.eventList.replaceChildren(
    ...events.map((event) => {
      const item = document.createElement("article");
      item.className = "timeline-item";

      const time = document.createElement("time");
      time.className = "timeline-time";
      time.dateTime = event.createdAt;
      time.textContent = shortTime(event.createdAt);

      const copy = document.createElement("div");
      copy.className = "timeline-copy";

      const title = document.createElement("strong");
      title.textContent = readableEventType(event.type);

      const message = document.createElement("p");
      message.textContent = event.message ?? "Activity recorded.";

      copy.append(title, message);
      item.append(time, copy);
      return item;
    })
  );
}

function updateActions(state, invocation) {
  const hasServer = Boolean(state);
  const hasTask = els.taskInput.value.trim().length > 0;
  const hasAgent = Boolean(selectedAgentId);
  const isRunning = ["queued", "dispatching", "running", "cancelling"].includes(invocation?.status);
  const agent = selectedAgent(state);
  const localAgent = agent?.location?.type === "local_device";
  const disabled = agent?.status === "disabled";
  const unhealthy = agent?.health?.status === "unhealthy";
  els.runButton.textContent = localAgent && state?.device?.status !== "online" ? "Queue for this computer" : "Run on this computer";
  els.runButton.disabled = !hasServer || !hasTask || !hasAgent || isRunning || disabled || unhealthy;
  els.cancelButton.disabled = !invocation || !["queued", "dispatching", "running"].includes(invocation.status);
  els.healthCheckButton.disabled = !hasServer || !hasAgent || agent?.health?.status === "checking";
  els.toggleAgentButton.disabled = !hasServer || !hasAgent;
  els.discoverButton.disabled = !hasServer || state?.device?.status !== "online" || state?.discoveryRuns?.[0]?.status === "queued" || state?.discoveryRuns?.[0]?.status === "running";
  els.runBlockReason.textContent = runBlockReason({ hasServer, hasTask, hasAgent, isRunning, disabled, unhealthy, agent });
}

function renderDiscovery(discoveryRun) {
  if (!discoveryRun) {
    els.discoverySummary.textContent = "Discovery is conservative and only checks known or user-provided sources.";
    els.candidateList.replaceChildren();
    return;
  }

  els.discoverySummary.textContent = discoverySummary(discoveryRun);
  if (!discoveryRun.candidates?.length) {
    const empty = document.createElement("div");
    empty.className = "timeline-empty";
    empty.innerHTML = "<strong>No candidates yet</strong><span>Run discovery while Desktop Bridge is online.</span>";
    els.candidateList.replaceChildren(empty);
    return;
  }

  els.candidateList.replaceChildren(
    ...discoveryRun.candidates.map((candidate) => {
      const card = document.createElement("article");
      card.className = "candidate-card";

      const title = document.createElement("h3");
      title.textContent = candidate.name;

      const description = document.createElement("p");
      description.textContent = candidate.description;

      const meta = document.createElement("div");
      meta.className = "candidate-meta";
      meta.replaceChildren(
        metaSpan(`Adapter: ${readableAdapterType(candidate.adapter?.type)}`),
        metaSpan(`Source: ${readableDiscoverySource(candidate.source)}`),
        metaSpan(`Confidence: ${candidate.confidence}`),
        metaSpan(`Risk: ${candidate.riskLevel}`),
        metaSpan(candidate.healthProbeAvailable ? "Health probe available" : "No health probe")
      );

      const risk = document.createElement("p");
      risk.textContent = candidate.riskHints?.join(" ") ?? "Review this candidate before registering.";

      const action = document.createElement("button");
      action.type = "button";
      action.className = "secondary";
      action.dataset.discoveryRunId = discoveryRun.id;
      action.dataset.candidateId = candidate.id;
      action.textContent = candidate.registration?.status === "registered" ? "Registered disabled" : "Register disabled";
      action.disabled = candidate.registration?.status === "registered";

      card.append(title, description, meta, risk, action);
      return card;
    })
  );
}

function metaSpan(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function discoverySummary(discoveryRun) {
  if (discoveryRun.status === "queued") return "Discovery is queued for Desktop Bridge. It will only check known or user-provided sources.";
  if (discoveryRun.status === "running") return "Desktop Bridge is checking conservative discovery sources.";
  if (discoveryRun.status === "failed") return discoveryRun.message;
  return `${discoveryRun.message} Candidates are not auto-enabled.`;
}

function readableDiscoverySource(source) {
  const map = {
    known_command_allowlist: "known command allowlist",
    user_provided_path: "user-provided path",
    known_local_endpoint: "known local endpoint",
    user_provided_endpoint: "user-provided endpoint",
    bridge_managed_config: "bridge-managed config"
  };
  return map[source] ?? source;
}

function readableAdapterType(type) {
  if (type === "cli") return "CLI";
  if (type === "http") return "HTTP";
  return type ?? "Unknown";
}

function readableStatus(status) {
  const map = {
    queued: "Queued",
    dispatching: "Sending",
    running: "Running",
    cancelling: "Stopping",
    succeeded: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
    timed_out: "Timed out",
    expired: "Expired"
  };
  return map[status] ?? "Waiting";
}

function activityTitle(status) {
  const map = {
    queued: "Task is waiting for the local agent",
    dispatching: "Task is being sent to the computer",
    running: "The local agent is working",
    cancelling: "Stop request sent",
    succeeded: "Task finished",
    failed: "Task could not finish",
    cancelled: "Task was cancelled",
    timed_out: "Task timed out",
    expired: "Task expired"
  };
  return map[status] ?? "Ready to run";
}

function readableDeviceStatus(status) {
  if (status === "online") return "Online and ready";
  if (status === "offline") return "Offline";
  return status ?? "-";
}

function readableAgentStatus(status) {
  if (status === "available") return "Ready";
  if (status === "unavailable") return "Waiting for computer";
  if (status === "disabled") return "Disabled";
  return status ?? "-";
}

function readableHealth(health) {
  if (!health) return "Not checked";
  const checkedAt = health.checkedAt ? ` at ${shortTime(health.checkedAt)}` : "";
  if (health.status === "healthy") return `Healthy${checkedAt} - ${health.message}`;
  if (health.status === "unhealthy") return `Needs attention${checkedAt} - ${health.message}`;
  if (health.status === "checking") return "Checking health";
  return "Not checked";
}

function readableHealthLabel(health) {
  if (health?.status === "healthy") return "Healthy";
  if (health?.status === "unhealthy") return "Needs attention";
  if (health?.status === "checking") return "Checking health";
  return "Not checked";
}

function agentNextAction(agent, state) {
  if (!agent) return "-";
  if (agent.status === "disabled") return "Enable the agent before running a task.";
  if (agent.health?.status === "unhealthy") return agent.health.nextAction ?? "Run another health check after fixing the agent.";
  if (agent.health?.status === "unknown" || !agent.health) return "Run a health check when setup changes.";
  if (agent.location?.type === "local_device" && state?.device?.status !== "online") return "Start Desktop Bridge to run local work.";
  return "Ready for tasks.";
}

function lifecycleText(agent) {
  if (!agent) return "-";
  return `${agent.lifecycle?.state ?? "unknown"} / ${agent.lifecycle?.installState ?? "unknown"}`;
}

function selectedAgent(state) {
  return state?.agents?.find((agent) => agent.id === selectedAgentId) ?? state?.agent ?? null;
}

function runBlockReason({ hasServer, hasTask, hasAgent, isRunning, disabled, unhealthy, agent }) {
  if (!hasServer) return "Server is offline.";
  if (!hasTask) return "Enter a task before running.";
  if (!hasAgent) return "Select an agent before running.";
  if (disabled) return `${agent?.name ?? "This agent"} is disabled. Enable it before running a new task.`;
  if (unhealthy) return `${agent?.name ?? "This agent"} is unhealthy. Run a health check after fixing it.`;
  if (isRunning) return "Wait for the current task to finish or cancel it.";
  return "";
}

function costText(economics) {
  if (!economics) return "Unknown";
  if (economics.model === "unknown") return "No billing in demo";
  return `${economics.model} (${economics.unknownCostPolicy})`;
}

function readableDelivery(state) {
  const map = {
    not_required: "Runs without computer delivery",
    queued: "Waiting",
    dispatching: "Sending to computer",
    delivered: "Sent to computer",
    acknowledged: "Received by computer",
    redelivering: "Trying again",
    delivery_failed: "Delivery failed",
    expired: "Expired"
  };
  return map[state] ?? "Not delivered";
}

function readableCancellation(state) {
  const map = {
    none: "No stop request",
    requested: "Stop requested",
    queued_cancelled: "Cancelled before running",
    dispatched: "Stop sent",
    acknowledged: "Stop acknowledged",
    applied: "Stopped",
    failed: "Stop failed",
    not_supported: "Stop not supported"
  };
  return map[state] ?? "No stop request";
}

function resultTitle(status) {
  if (status === "succeeded") return "Answer returned";
  if (status === "failed") return "Needs attention";
  if (status === "cancelled") return "Stopped";
  if (status === "timed_out") return "Timed out";
  if (status === "expired") return "Expired";
  if (status === "running") return "Working locally";
  if (status === "queued") return "Waiting";
  return "No result yet";
}

function resultSummary(invocation, audit) {
  if (!invocation) return "Run a task to see the answer here.";
  if (invocation.result?.summary) return invocation.result.summary;
  if (invocation.status === "running") return "The agent is still working on your computer.";
  if (invocation.status === "queued") return "The task is queued for the local bridge.";
  if (invocation.status === "dispatching") return "The task is being sent to your computer.";
  if (invocation.status === "cancelled") return "The task was stopped before it completed.";
  if (invocation.status === "failed") return audit?.errorSummary ?? "The task could not finish.";
  if (invocation.status === "timed_out") return "The task ran longer than its timeout.";
  if (audit?.permissionDecision) return `Audit recorded: ${readableAudit(audit)}.`;
  return "No final answer has been returned yet.";
}

function readableEventType(type) {
  const map = {
    invocation_created: "Task created",
    invocation_authorized: "Task allowed",
    delivery_queued: "Waiting for computer",
    delivery_dispatched: "Sent to computer",
    delivery_redelivered: "Delivery retried",
    delivery_acknowledged: "Computer received task",
    invocation_started: "Agent started",
    log: "Agent update",
    agent_output: "Agent output",
    trace_created: "Trace started",
    span_completed: "Trace completed",
    heartbeat: "Computer connected",
    lifecycle_requested: "Agent action requested",
    lifecycle_started: "Agent action started",
    lifecycle_completed: "Agent action completed",
    lifecycle_failed: "Agent action failed",
    invocation_succeeded: "Task completed",
    invocation_failed: "Task failed",
    invocation_timed_out: "Task timed out",
    cancel_requested: "Stop requested",
    cancel_dispatched: "Stop sent",
    cancel_applied: "Stop completed",
    cancel_failed: "Stop failed"
  };
  return map[type] ?? type.replaceAll("_", " ");
}

function adapterText(adapter) {
  if (!adapter) return "-";
  if (adapter.type === "cli") return `CLI command: ${adapter.command}`;
  if (adapter.type === "http") return `HTTP endpoint: ${adapter.baseUrl}`;
  return adapter.type;
}

function cancellationText(adapter) {
  if (!adapter) return "No agent selected";
  if (adapter.cancellation === "supported") return "Can request stop";
  if (adapter.cancellation === "unsupported") return "Stop is not supported";
  return "Stop behavior is unknown";
}

function readableAudit(audit) {
  if (!audit) return "Nothing recorded";
  if (audit.permissionDecision === "allowed") return "Allowed and recorded";
  if (audit.permissionDecision === "denied") return "Denied and recorded";
  return "Recorded";
}

function readableLifecycleAudit(audit) {
  if (!audit) return "Nothing recorded";
  if (audit.status === "succeeded") return `${audit.operation.replaceAll("_", " ")} completed`;
  if (audit.status === "failed") return `${audit.operation.replaceAll("_", " ")} needs attention`;
  return `${audit.operation.replaceAll("_", " ")} ${audit.status}`;
}

function shortTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
