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
  invocationId: document.querySelector("#invocationId"),
  invocationStatus: document.querySelector("#invocationStatus"),
  deliveryStatus: document.querySelector("#deliveryStatus"),
  cancelStatus: document.querySelector("#cancelStatus"),
  eventList: document.querySelector("#eventList"),
  resultBox: document.querySelector("#resultBox")
};

let currentInvocationId = null;

els.runButton.addEventListener("click", async () => {
  const task = els.taskInput.value.trim();
  if (!task) {
    return;
  }
  const response = await fetch(`${apiBase}/api/invocations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task })
  });
  const data = await response.json();
  currentInvocationId = data.invocation.id;
  await refresh();
});

els.cancelButton.addEventListener("click", async () => {
  if (!currentInvocationId) {
    return;
  }
  await fetch(`${apiBase}/api/invocations/${currentInvocationId}/cancel`, {
    method: "POST"
  });
  await refresh();
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
  }
}

function render(state) {
  const invocation = state.invocations[0] ?? null;
  if (invocation) {
    currentInvocationId = invocation.id;
  }

  els.deviceName.textContent = state.device.name;
  els.deviceStatus.textContent = state.device.status;
  els.devicePlatform.textContent = `${state.device.platform} / ${state.device.architecture}`;
  els.agentName.textContent = state.agent.name;
  els.agentStatus.textContent = state.agent.status;
  els.agentCost.textContent = `${state.agent.economics.model} (${state.agent.economics.unknownCostPolicy})`;

  els.invocationId.textContent = invocation?.id ?? "-";
  els.invocationStatus.textContent = invocation?.status ?? "-";
  els.deliveryStatus.textContent = invocation?.delivery?.state ?? "-";
  els.cancelStatus.textContent = invocation?.cancellation?.state ?? "-";

  els.eventList.replaceChildren(
    ...state.events.slice(0, 30).map((event) => {
      const item = document.createElement("li");
      item.innerHTML = `<span>${event.createdAt}</span><strong>${event.type}</strong><p>${event.message ?? ""}</p>`;
      return item;
    })
  );

  const audit = invocation
    ? state.auditSummaries.find((item) => item.invocationId === invocation.id)
    : null;
  els.resultBox.textContent = JSON.stringify(
    {
      result: invocation?.result ?? null,
      audit: audit ?? null
    },
    null,
    2
  );
}
