import { summarizeWebPerformance } from "./web-performance.mjs";
import { ensureEventStreamMetrics, eventStreamSummary } from "./event-stream-metrics.mjs";
import { summarizeAutoRuns } from "./auto-run-metrics.mjs";
import { summarizeOrchestrationRecovery } from "./application-recovery-metrics.mjs";

export function reconcileOperationalHealth(state, { teamId, now }) {
  const teamProjectIds = new Set((state.projects ?? [])
    .filter((project) => !project.ownerTeamId || project.ownerTeamId === teamId)
    .map((project) => project.id));
  const web = summarizeWebPerformance((state.webPerformanceMetrics ?? []).filter((row) => row.teamId === teamId), { limit: 500 });
  const stream = eventStreamSummary(ensureEventStreamMetrics(state, teamId));
  const routing = summarizeAutoRuns((state.autoRuns ?? []).filter((run) => !run.projectId || teamProjectIds.has(run.projectId))).routingHealth;
  const recovery = summarizeOrchestrationRecovery((state.invocations ?? []).filter((run) => !run.projectId || teamProjectIds.has(run.projectId)));

  const active = [];
  for (const [name, metric] of Object.entries(web.metrics)) {
    if (metric.alerting) active.push({ key: `web_${name.toLowerCase()}`, source: "web_performance", severity: "warning", message: `${name} has ${metric.poorRate}% poor samples.` });
  }
  if (stream.disconnectRate > 20) active.push({ key: "stream_disconnect_rate", source: "event_stream", severity: "warning", message: `Event stream disconnect rate is ${stream.disconnectRate}%.` });
  if (stream.averageEventLatencyMs != null && stream.averageEventLatencyMs > 2_000) active.push({ key: "stream_event_latency", source: "event_stream", severity: "warning", message: `Event delivery averages ${stream.averageEventLatencyMs} ms.` });
  for (const signal of routing?.signals ?? []) active.push({ key: `routing_${signal.key}`, source: "ai_routing", severity: signal.severity, message: `${signal.key} is ${signal.value} (threshold ${signal.threshold}).` });
  if (recovery.alerting) active.push({ key: "recovery_time", source: "recovery", severity: "danger", message: `Median recovery is ${recovery.recoveryHours.median}h (target ${recovery.thresholdHours}h).` });

  state.operationalAlerts ??= [];
  const at = now();
  const activeKeys = new Set(active.map((alert) => alert.key));
  const triggeredAlerts = [];
  const recoveredAlerts = [];
  for (const definition of active) {
    let record = state.operationalAlerts.find((alert) => alert.teamId === teamId && alert.key === definition.key);
    if (!record) {
      record = { ...definition, id: `opalt_${teamId}_${definition.key}`, teamId, status: "open", triggeredAt: at, updatedAt: at, acknowledgedAt: null, acknowledgedBy: null, silencedUntil: null, recoveredAt: null };
      state.operationalAlerts.push(record);
      triggeredAlerts.push(record);
    } else {
      Object.assign(record, definition, { updatedAt: at, recoveredAt: null });
      if (record.status === "recovered") record.status = "open";
      if (record.status === "silenced" && Date.parse(record.silencedUntil ?? "") <= Date.parse(at)) record.status = "open";
    }
  }
  for (const record of state.operationalAlerts.filter((alert) => alert.teamId === teamId && alert.status !== "recovered")) {
    if (!activeKeys.has(record.key)) {
      Object.assign(record, { status: "recovered", recoveredAt: at, updatedAt: at });
      recoveredAlerts.push(record);
    }
  }
  return {
    web, stream, routing, recovery,
    alerts: state.operationalAlerts.filter((alert) => alert.teamId === teamId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    transitions: { triggered: triggeredAlerts, recovered: recoveredAlerts },
  };
}

export function actOnOperationalAlert(state, { teamId, alertId, action, actorId, now, silenceMinutes = 60 }) {
  const alert = (state.operationalAlerts ?? []).find((row) => row.id === alertId && row.teamId === teamId);
  if (!alert) return null;
  const at = now();
  if (action === "acknowledge") Object.assign(alert, { status: "acknowledged", acknowledgedAt: at, acknowledgedBy: actorId, updatedAt: at });
  else if (action === "silence") Object.assign(alert, { status: "silenced", silencedUntil: new Date(Date.parse(at) + Math.max(1, Math.min(1_440, Number(silenceMinutes))) * 60_000).toISOString(), updatedAt: at });
  else return null;
  return alert;
}
