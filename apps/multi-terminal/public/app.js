const view = (name) => document.querySelector(`[data-view="${name}"]`);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const label = { running: "运行中", waiting: "等待中", failed: "失败", attention: "需关注" };

async function load() {
  const response = await fetch("/api/overview");
  const data = await response.json();
  view("totals").innerHTML = Object.entries(data.totals).map(([key, count]) => `<article><b>${count}</b><span>${label[key]}</span></article>`).join("");
  view("terminals").innerHTML = data.terminals.map((terminal) => `<article class="card">
    <div class="row"><h3>${escapeHtml(terminal.name)}</h3><span class="status ${terminal.status}">${terminal.status === "online" ? "在线" : "不可用"}</span></div>
    <p>${Object.entries(terminal.counts).map(([key, count]) => `${label[key]} ${count}`).join(" · ")}</p>
    ${terminal.unavailableReason ? `<small>${escapeHtml(terminal.unavailableReason)}；任务不会迁移。</small>` : ""}
  </article>`).join("");
  const tasks = data.terminals.flatMap((terminal) => terminal.tasks).filter((task) => ["running", "waiting", "failed", "attention"].includes(task.state));
  view("tasks").innerHTML = tasks.length ? `<table><thead><tr><th>任务</th><th>所属终端</th><th>状态</th><th></th></tr></thead><tbody>${tasks.map((task) => `<tr>
    <td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.terminalName)}</td><td>${label[task.state] ?? escapeHtml(task.state)}</td>
    <td><a href="${escapeHtml(task.deepLink)}">在所属终端打开</a></td></tr>`).join("")}</tbody></table>` : "<p class=empty>暂无需要关注的任务。</p>";
  const alerts = data.terminals.flatMap((terminal) => terminal.alerts.map((alert) => ({ ...alert, terminalName: terminal.name })));
  view("alerts").innerHTML = alerts.length ? alerts.map((alert) => `<article class="card"><div class="row"><b>${escapeHtml(alert.message)}</b><span>${escapeHtml(alert.severity)}</span></div><small>${escapeHtml(alert.terminalName)} · ${escapeHtml(alert.status)}</small></article>`).join("") : "<p class=empty>暂无告警。</p>";
  const allTasks = data.terminals.flatMap((terminal) => terminal.tasks);
  const renderTrace = () => {
    const query = view("trace-query").value.trim().toLowerCase();
    const matches = allTasks.filter((task) => !query || `${task.title} ${task.terminalName} ${task.localResourceId}`.toLowerCase().includes(query));
    view("trace").innerHTML = matches.length ? matches.map((task) => `<article class="trace-row"><span><b>${escapeHtml(task.title)}</b><small>${escapeHtml(task.terminalName)} · ${escapeHtml(task.localResourceId)}</small></span><a href="${escapeHtml(task.deepLink)}">打开证据链</a></article>`).join("") : "<p class=empty>未找到匹配记录。</p>";
  };
  view("trace-query").addEventListener("input", renderTrace);
  renderTrace();
  view("recovery").innerHTML = data.terminals.map((terminal) => `<article class="card"><h3>${escapeHtml(terminal.name)}</h3>
    <b>${terminal.recovery.medianHours == null ? "—" : `${terminal.recovery.medianHours} 小时`}</b>
    <p>中位恢复耗时 · ${terminal.recovery.sampleCount} 个样本 · ${terminal.recovery.status === "insufficient_data" ? "数据不足" : terminal.recovery.status === "healthy" ? "健康" : "需关注"}</p>
    <div class="bars">${terminal.recovery.points.map((point) => `<i title="${escapeHtml(point.at)} · ${point.hours}h" style="height:${Math.min(100, Math.max(4, point.hours / 24 * 100))}%"></i>`).join("")}</div>
  </article>`).join("");
}
load().catch(() => { view("terminals").innerHTML = "<p class=error>无法读取组合视图，请检查本地组合服务。</p>"; });
