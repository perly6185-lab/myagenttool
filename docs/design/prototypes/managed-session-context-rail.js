const states = {
  ready: {
    executionTitle: "Status",
    statusTitle: "Ready to run",
    statusBody: "Review safety, data, cost, and cancellation before starting.",
    activity: ["No activity yet."],
    result: "<p>Run a task to see results.</p>",
    sessionStatus: "succeeded",
    sessionDot: "Latest",
    lastSeen: "5m ago",
    turnCount: "3",
    filesChanged: "3",
    attention: "No approvals.",
    approvalVisible: false,
    runDisabled: false
  },
  running: {
    executionTitle: "Status",
    statusTitle: "Running with Codex CLI",
    statusBody: "Continuing the latest Managed Codex session with workspace-write sandbox.",
    activity: ["10:32 Read package scripts", "10:33 Running pnpm test"],
    result: "<p>Task is still running.</p>",
    sessionStatus: "running",
    sessionDot: "Running",
    lastSeen: "now",
    turnCount: "4",
    filesChanged: "pending",
    attention: "No approvals.",
    approvalVisible: false,
    runDisabled: true
  },
  approval: {
    executionTitle: "Approval Needed",
    statusTitle: "Waiting for approval",
    statusBody: "A local test command needs confirmation before Codex continues.",
    activity: ["Waiting for approval"],
    result: "<p>Approve or deny the request to continue.</p>",
    sessionStatus: "waiting",
    sessionDot: "Approval",
    lastSeen: "now",
    turnCount: "4",
    filesChanged: "pending",
    attention: "1 pending request.",
    approvalVisible: true,
    runDisabled: true
  },
  succeeded: {
    executionTitle: "Result",
    statusTitle: "Completed",
    statusBody: "Codex completed the task and produced a reviewable change summary.",
    activity: ["10:32 Read package scripts", "10:33 Ran tests", "10:35 Summarized changed files"],
    result: "<p><strong>Summary:</strong> tests fixed.</p><p><strong>Files changed:</strong> 3</p><div class=\"button-row\"><button class=\"secondary-action\" type=\"button\">Review diff</button><button class=\"secondary-action\" type=\"button\">Open result</button></div>",
    sessionStatus: "succeeded",
    sessionDot: "Succeeded",
    lastSeen: "1m ago",
    turnCount: "4",
    filesChanged: "3",
    attention: "No approvals.",
    approvalVisible: false,
    runDisabled: false
  }
};

const tabs = [...document.querySelectorAll(".state-tab")];
const executionTitle = document.querySelector("[data-execution-title]");
const statusCard = document.querySelector("[data-status-card]");
const approvalCard = document.querySelector("[data-approval-card]");
const activityList = document.querySelector("[data-activity-list]");
const resultBody = document.querySelector("[data-result-body]");
const sessionDot = document.querySelector("[data-session-dot]");
const sessionStatus = document.querySelector("[data-session-status]");
const lastSeen = document.querySelector("[data-last-seen]");
const turnCount = document.querySelector("[data-turn-count]");
const filesChanged = document.querySelector("[data-files-changed]");
const attentionText = document.querySelector("[data-attention-text]");
const runButton = document.querySelector("[data-run-button]");
const openSessionButton = document.querySelector("[data-open-session-button]");
const sessionDetail = document.querySelector("[data-session-detail]");

for (const tab of tabs) {
  tab.addEventListener("click", () => applyState(tab.dataset.state));
}

openSessionButton.addEventListener("click", toggleSessionDetail);

function applyState(name) {
  const state = states[name] ?? states.ready;
  for (const tab of tabs) {
    tab.classList.toggle("is-active", tab.dataset.state === name);
  }

  executionTitle.textContent = state.executionTitle;
  statusCard.querySelector("h3").textContent = state.statusTitle;
  statusCard.querySelector("p").textContent = state.statusBody;
  approvalCard.hidden = !state.approvalVisible;
  activityList.innerHTML = state.activity.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  resultBody.innerHTML = state.result;
  sessionDot.textContent = state.sessionDot;
  sessionStatus.textContent = state.sessionStatus;
  lastSeen.textContent = state.lastSeen;
  turnCount.textContent = state.turnCount;
  filesChanged.textContent = state.filesChanged;
  attentionText.textContent = state.attention;
  runButton.disabled = state.runDisabled;
  runButton.textContent = state.runDisabled ? "Run disabled" : "Run";
}

function toggleSessionDetail() {
  const willOpen = sessionDetail.hidden;
  sessionDetail.hidden = !willOpen;
  openSessionButton.setAttribute("aria-expanded", String(willOpen));
  openSessionButton.textContent = willOpen ? "Close session" : "Open session";
  if (willOpen) {
    sessionDetail.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
