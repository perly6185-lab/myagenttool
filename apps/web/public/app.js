const apiBase = "http://127.0.0.1:3001";

const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  deviceName: document.querySelector("#deviceName"),
  deviceStatus: document.querySelector("#deviceStatus"),
  devicePlatform: document.querySelector("#devicePlatform"),
  agentName: document.querySelector("#agentName"),
  agentStatus: document.querySelector("#agentStatus"),
  agentCost: document.querySelector("#agentCost"),
  taskInput: document.querySelector("#taskInput"),
  runButton: document.querySelector("#runButton"),
  cancelButton: document.querySelector("#cancelButton"),
  activityTitle: document.querySelector("#activityTitle"),
  taskState: document.querySelector("#taskState"),
  safetySummary: document.querySelector("#safetySummary"),
  dataSummary: document.querySelector("#dataSummary"),
  costSummary: document.querySelector("#costSummary"),
  invocationId: document.querySelector("#invocationId"),
  deliveryStatus: document.querySelector("#deliveryStatus"),
  cancelStatus: document.querySelector("#cancelStatus"),
  eventList: document.querySelector("#eventList"),
  resultTitle: document.querySelector("#resultTitle"),
  resultSummary: document.querySelector("#resultSummary")
};

let currentInvocationId = null;

els.runButton.addEventListener("click", async () => {
  const task = els.taskInput.value.trim();
  if (!task) return;

  els.runButton.disabled = true;
  try {
    const response = await fetch(`${apiBase}/api/invocations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task })
    });
    const data = await response.json();
    currentInvocationId = data.invocation.id;
    await refresh();
  } finally {
    els.runButton.disabled = false;
  }
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

async function refresh() {
  try {
    const response = await fetch(`${apiBase}/api/state`);
    const state = await response.json();
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
  const invocation = state.invocations[0] ?? null;
  const audit = invocation
    ? state.auditSummaries.find((item) => item.invocationId === invocation.id)
    : null;

  if (invocation) currentInvocationId = invocation.id;

  const readableTaskState = readableStatus(invocation?.status);
  els.taskState.textContent = readableTaskState;
  els.taskState.dataset.state = invocation?.status ?? "waiting";
  els.activityTitle.textContent = activityTitle(invocation?.status);

  els.deviceName.textContent = state.device.name;
  els.deviceStatus.textContent = readableDeviceStatus(state.device.status);
  els.devicePlatform.textContent = `${state.device.platform} / ${state.device.architecture}`;

  els.agentName.textContent = state.agent.name;
  els.agentStatus.textContent = readableAgentStatus(state.agent.status);
  els.agentCost.textContent = costText(state.agent.economics);

  els.safetySummary.textContent = "Demo command only";
  els.dataSummary.textContent = "No user files touched";
  els.costSummary.textContent = costText(state.agent.economics);

  els.invocationId.textContent = invocation?.id ?? "No task yet";
  els.deliveryStatus.textContent = readableDelivery(invocation?.delivery?.state);
  els.cancelStatus.textContent = readableCancellation(invocation?.cancellation?.state);

  els.resultTitle.textContent = resultTitle(invocation?.status);
  els.resultSummary.textContent = resultSummary(invocation, audit);

  renderTimeline(state.events.slice(0, 30));
  updateActions(state, invocation);
}

function renderOffline() {
  els.taskState.textContent = "Offline";
  els.taskState.dataset.state = "failed";
  els.activityTitle.textContent = "Connect the local demo server";
  els.deviceStatus.textContent = "Offline";
  els.agentStatus.textContent = "Unavailable";
  els.deliveryStatus.textContent = "Not delivered";
  els.cancelStatus.textContent = "No task";
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
  const hasOnlineDevice = state.device.status === "online";
  const isRunning = ["queued", "running", "cancelling"].includes(invocation?.status);
  els.runButton.disabled = !hasOnlineDevice || isRunning;
  els.cancelButton.disabled = !invocation || !["queued", "running"].includes(invocation.status);
}

function readableStatus(status) {
  const map = {
    queued: "Queued",
    running: "Running",
    cancelling: "Stopping",
    succeeded: "Done",
    failed: "Failed",
    canceled: "Canceled"
  };
  return map[status] ?? "Waiting";
}

function activityTitle(status) {
  const map = {
    queued: "Task is waiting for the local agent",
    running: "The local agent is working",
    cancelling: "Stop request sent",
    succeeded: "Task finished",
    failed: "Task could not finish",
    canceled: "Task was canceled"
  };
  return map[status] ?? "Ready to run";
}

function readableDeviceStatus(status) {
  if (status === "online") return "Online and ready";
  if (status === "offline") return "Offline";
  return status ?? "-";
}

function readableAgentStatus(status) {
  if (status === "enabled") return "Ready";
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
    queued: "Waiting",
    delivered: "Sent to computer",
    acknowledged: "Received by computer",
    failed: "Delivery failed"
  };
  return map[state] ?? "Not delivered";
}

function readableCancellation(state) {
  const map = {
    none: "No stop request",
    requested: "Stop requested",
    delivered: "Stop sent",
    acknowledged: "Stop acknowledged",
    failed: "Stop failed"
  };
  return map[state] ?? "No stop request";
}

function resultTitle(status) {
  if (status === "succeeded") return "Answer returned";
  if (status === "failed") return "Needs attention";
  if (status === "running") return "Working locally";
  if (status === "queued") return "Waiting";
  return "No result yet";
}

function resultSummary(invocation, audit) {
  if (!invocation) return "Run a task to see the answer here.";
  if (invocation.result?.summary) return invocation.result.summary;
  if (invocation.status === "running") return "The agent is still working on your computer.";
  if (invocation.status === "queued") return "The task is queued for the local bridge.";
  if (audit?.decision) return `Audit recorded: ${audit.decision}.`;
  return "No final answer has been returned yet.";
}

function readableEventType(type) {
  const map = {
    invocation_created: "Task created",
    delivery_queued: "Waiting for computer",
    delivery_acknowledged: "Computer received task",
    process_started: "Agent started",
    process_log: "Agent update",
    invocation_succeeded: "Task completed",
    invocation_failed: "Task failed",
    cancel_requested: "Stop requested",
    cancel_delivered: "Stop sent"
  };
  return map[type] ?? type.replaceAll("_", " ");
}

function shortTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
