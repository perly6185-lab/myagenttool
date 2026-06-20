const apiBase = "http://127.0.0.1:3001";

const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  deviceName: document.querySelector("#deviceName"),
  deviceStatus: document.querySelector("#deviceStatus"),
  devicePlatform: document.querySelector("#devicePlatform"),
  deviceLastSeen: document.querySelector("#deviceLastSeen"),
  agentName: document.querySelector("#agentName"),
  agentStatus: document.querySelector("#agentStatus"),
  agentCapability: document.querySelector("#agentCapability"),
  agentCost: document.querySelector("#agentCost"),
  deviceSelect: document.querySelector("#deviceSelect"),
  agentSelect: document.querySelector("#agentSelect"),
  taskInput: document.querySelector("#taskInput"),
  runButton: document.querySelector("#runButton"),
  cancelButton: document.querySelector("#cancelButton"),
  activityTitle: document.querySelector("#activityTitle"),
  taskState: document.querySelector("#taskState"),
  safetySummary: document.querySelector("#safetySummary"),
  dataSummary: document.querySelector("#dataSummary"),
  costSummary: document.querySelector("#costSummary"),
  cancellationSummary: document.querySelector("#cancellationSummary"),
  adapterName: document.querySelector("#adapterName"),
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
    els.runButton.disabled = false;
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
    els.cancelButton.disabled = false;
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
  const agent = agents.find((item) => item.id === (invocation?.agentId ?? selectedAgentId)) ?? state.agent ?? agents[0];

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
  els.agentCapability.textContent = agent?.capabilities?.[0]?.description ?? "No capability selected";
  els.agentCost.textContent = costText(agent?.economics);

  els.safetySummary.textContent = agent?.registrationNotes?.risk ?? "Review the selected agent before running.";
  els.dataSummary.textContent = agent?.registrationNotes?.data ?? "Task input and result are recorded.";
  els.costSummary.textContent = agent?.registrationNotes?.cost ?? costText(agent?.economics);
  els.cancellationSummary.textContent = agent?.registrationNotes?.cancellation ?? cancellationText(agent?.adapter);
  els.adapterName.textContent = adapterText(agent?.adapter);

  els.invocationId.textContent = invocation?.id ?? "No task yet";
  els.traceId.textContent = invocation?.traceId ?? "No trace yet";
  els.technicalState.textContent = invocation ? `${invocation.status} / ${invocation.delivery?.state ?? "no delivery"}` : "No task yet";
  els.auditDecision.textContent = audit ? readableAudit(audit) : "Nothing recorded yet";
  els.deliveryStatus.textContent = readableDelivery(invocation?.delivery?.state);
  els.cancelStatus.textContent = readableCancellation(invocation?.cancellation?.state);

  els.resultTitle.textContent = resultTitle(invocation?.status);
  els.resultSummary.textContent = resultSummary(invocation, audit);

  const visibleEvents = invocation
    ? state.events.filter((event) => event.invocationId === invocation.id).slice(0, 30)
    : state.events.slice(0, 30);
  renderTimeline(visibleEvents);
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
    ...agents.map((agent) => new Option(`${agent.name} - ${readableAgentStatus(agent.status)}`, agent.id))
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
  els.agentCapability.textContent = "-";
  els.deliveryStatus.textContent = "Not delivered";
  els.cancelStatus.textContent = "No task";
  els.auditDecision.textContent = "Nothing recorded";
  els.resultTitle.textContent = "Waiting for server";
  els.resultSummary.textContent = "Start the local demo server, then this workspace can show your computer and agent status.";
  els.runButton.disabled = true;
  els.cancelButton.disabled = true;
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
  const localAgent = state?.agents?.find((agent) => agent.id === selectedAgentId)?.location?.type === "local_device";
  els.runButton.textContent = localAgent && state?.device?.status !== "online" ? "Queue for this computer" : "Run on this computer";
  els.runButton.disabled = !hasServer || !hasTask || !hasAgent || isRunning;
  els.cancelButton.disabled = !invocation || !["queued", "dispatching", "running"].includes(invocation.status);
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

function shortTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
