const view = (name) => document.querySelector(`[data-view="${name}"]`);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const copy = {
  zh: { running: "运行中", waiting: "等待中", failed: "失败", attention: "需关注", online: "在线", offline: "不可用", noMigrate: "任务不会迁移", consistent: "与基准配置一致", different: "配置存在差异，请进入所属终端检查", noTerminal: "没有在线终端可供比较", task: "任务", owner: "所属终端", state: "状态", openOwner: "在所属终端打开", noTask: "暂无需要关注的任务", noAlert: "暂无告警", openTrace: "打开证据链", noMatch: "未找到匹配记录", hours: "小时", median: "中位恢复耗时", samples: "个样本", insufficient: "数据不足", healthy: "健康", loadFailed: "无法读取组合视图，请检查本地组合服务", stale: "缓存数据", saved: "终端注册已保存", saveFailed: "无法保存终端注册" },
  en: { running: "Running", waiting: "Waiting", failed: "Failed", attention: "Attention", online: "Online", offline: "Unavailable", noMigrate: "Tasks are not migrated", consistent: "Matches baseline configuration", different: "Configuration differs; inspect the owning terminal", noTerminal: "No online terminal to compare", task: "Task", owner: "Owning terminal", state: "State", openOwner: "Open on owner", noTask: "No tasks need attention", noAlert: "No alerts", openTrace: "Open evidence chain", noMatch: "No matching records", hours: "hours", median: "Median recovery", samples: "samples", insufficient: "Insufficient data", healthy: "Healthy", loadFailed: "Could not load the composition view", stale: "Cached data", saved: "Terminal registration saved", saveFailed: "Could not save terminal registration" },
};
let locale = localStorage.getItem("multi-terminal-locale") === "en" ? "en" : "zh";
let currentData = null;
const t = (key) => copy[locale][key] ?? key;

function applyLocale() {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-zh][data-en]").forEach((node) => { node.textContent = node.dataset[locale]; });
  document.querySelectorAll("[data-placeholder-zh]").forEach((node) => { node.placeholder = node.dataset[`placeholder${locale === "zh" ? "Zh" : "En"}`]; });
  view("language").textContent = locale === "zh" ? "EN" : "中文";
  if (currentData) render(currentData);
}

async function load() {
  const response = await fetch("/api/overview");
  if (!response.ok) throw new Error("overview failed");
  currentData = await response.json();
  render(currentData);
}

function render(data) {
  const labels = { running: t("running"), waiting: t("waiting"), failed: t("failed"), attention: t("attention") };
  const filter = view("terminal-filter").value;
  const terminals = data.terminals.filter((terminal) => filter === "all" || terminal.status === filter);
  view("totals").innerHTML = Object.entries(data.totals).map(([key, count]) => `<article><b>${count}</b><span>${labels[key]}</span></article>`).join("");
  view("terminals").innerHTML = terminals.map((terminal) => `<article class="card">
    <div class="row"><h3>${escapeHtml(terminal.name)}</h3><span class="status ${terminal.status}">${terminal.status === "online" ? t("online") : t("offline")}</span></div>
    <p>${Object.entries(terminal.counts).map(([key, count]) => `${labels[key]} ${count}`).join(" · ")}</p>
    ${terminal.stale ? `<small class="warning">${t("stale")} · ${escapeHtml(terminal.observedAt ?? "—")}</small>` : ""}
    ${terminal.unavailableReason ? `<small>${escapeHtml(terminal.unavailableReason)}；${t("noMigrate")}。</small>` : ""}
  </article>`).join("");
  view("consistency").innerHTML = data.configurationConsistency.terminals.length
    ? data.configurationConsistency.terminals.map((row) => `<article class="card"><b>${escapeHtml(row.terminalId)}</b><p>${row.status === "consistent" ? t("consistent") : t("different")}</p></article>`).join("")
    : `<p class=empty>${t("noTerminal")}。</p>`;
  const tasks = terminals.flatMap((terminal) => terminal.tasks).filter((task) => ["running", "waiting", "failed", "attention"].includes(task.state));
  view("tasks").innerHTML = tasks.length ? `<table><thead><tr><th>${t("task")}</th><th>${t("owner")}</th><th>${t("state")}</th><th></th></tr></thead><tbody>${tasks.map((task) => `<tr>
    <td>${escapeHtml(task.title)}${task.assetFamilies.length ? `<small>${task.assetFamilies.map(escapeHtml).join(" → ")}</small>` : ""}</td><td>${escapeHtml(task.terminalName)}</td><td>${labels[task.state] ?? escapeHtml(task.state)}</td>
    <td><a href="${escapeHtml(task.deepLink)}">${t("openOwner")}</a></td></tr>`).join("")}</tbody></table>` : `<p class=empty>${t("noTask")}。</p>`;
  const alerts = terminals.flatMap((terminal) => terminal.alerts.map((alert) => ({ ...alert, terminalName: terminal.name })));
  view("alerts").innerHTML = alerts.length ? alerts.map((alert) => `<article class="card"><div class="row"><b>${escapeHtml(alert.message)}</b><span>${escapeHtml(alert.severity)}</span></div><small>${escapeHtml(alert.terminalName)} · ${escapeHtml(alert.status)}</small></article>`).join("") : `<p class=empty>${t("noAlert")}。</p>`;
  renderTrace(terminals.flatMap((terminal) => terminal.tasks));
  view("recovery").innerHTML = terminals.map((terminal) => `<article class="card"><h3>${escapeHtml(terminal.name)}</h3>
    <b>${terminal.recovery.medianHours == null ? "—" : `${terminal.recovery.medianHours} ${t("hours")}`}</b>
    <p>${t("median")} · ${terminal.recovery.sampleCount} ${t("samples")} · ${terminal.recovery.status === "insufficient_data" ? t("insufficient") : terminal.recovery.status === "healthy" ? t("healthy") : t("attention")}</p>
    <div class="bars" aria-label="${t("median")}">${terminal.recovery.points.map((point) => `<i title="${escapeHtml(point.at)} · ${point.hours}h" style="height:${Math.min(100, Math.max(4, point.hours / 24 * 100))}%"></i>`).join("")}</div>
  </article>`).join("");
}

function renderTrace(tasks) {
  const query = view("trace-query").value.trim().toLowerCase();
  const matches = tasks.filter((task) => !query || `${task.title} ${task.terminalName} ${task.localResourceId} ${task.traceId ?? ""} ${task.assetFamilies.join(" ")}`.toLowerCase().includes(query));
  view("trace").innerHTML = matches.length ? matches.map((task) => `<article class="trace-row"><span><b>${escapeHtml(task.title)}</b><small>${escapeHtml(task.terminalName)} · ${escapeHtml(task.localResourceId)}${task.traceId ? ` · ${escapeHtml(task.traceId)}` : ""}${task.assetFamilies.length ? ` · ${task.assetFamilies.map(escapeHtml).join(" → ")}` : ""}</small></span><a href="${escapeHtml(task.deepLink)}">${t("openTrace")}</a></article>`).join("") : `<p class=empty>${t("noMatch")}。</p>`;
}

view("language").addEventListener("click", () => { locale = locale === "zh" ? "en" : "zh"; localStorage.setItem("multi-terminal-locale", locale); applyLocale(); });
view("terminal-filter").addEventListener("change", () => currentData && render(currentData));
view("trace-query").addEventListener("input", () => currentData && render(currentData));
view("registration").addEventListener("submit", async (event) => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(event.currentTarget));
  const adminToken = fields.adminToken;
  delete fields.adminToken;
  const response = await fetch("/api/terminals", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` }, body: JSON.stringify(fields) });
  view("registration-status").textContent = response.ok ? t("saved") : t("saveFailed");
  if (response.ok) await load();
});
const events = new EventSource("/api/events");
events.addEventListener("overview", () => void load());
events.onerror = () => { view("connection").hidden = false; };
events.onopen = () => { view("connection").hidden = true; };
applyLocale();
load().catch(() => { view("terminals").innerHTML = `<p class=error>${t("loadFailed")}。</p>`; });
