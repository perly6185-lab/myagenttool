import { ALLOWED_ACTIONS, assertPublicTerminalPath, ownerOperation, resourceRef } from "./contract.mjs";

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export function recoveryTrend(points = []) {
  const valid = points
    .filter((point) => Number.isFinite(point?.hours) && typeof point?.at === "string")
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-30);
  const hours = valid.map((point) => point.hours);
  return {
    points: valid,
    sampleCount: hours.length,
    medianHours: percentile(hours, 0.5),
    p95Hours: percentile(hours, 0.95),
    status: hours.length < 5 ? "insufficient_data" : percentile(hours, 0.5) <= 24 ? "healthy" : "attention",
  };
}

function taskState(task) {
  const state = task.executionState ?? task.status;
  if (["running", "dispatching", "queued"].includes(state)) return "running";
  if (["awaiting_approval", "waiting", "blocked"].includes(state)) return "waiting";
  if (["failed", "timed_out", "cancelled", "rejected"].includes(state)) return "failed";
  return task.attentionRequired ? "attention" : null;
}

export function projectTerminalSnapshot(terminal, snapshot) {
  const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];
  const counts = { running: 0, waiting: 0, failed: 0, attention: 0 };
  const projectedTasks = tasks.map((task) => {
    const state = taskState(task);
    if (state) counts[state] += 1;
    return {
      ref: resourceRef(terminal.id, task.id),
      localResourceId: task.id,
      terminalId: terminal.id,
      terminalName: terminal.name,
      title: task.title,
      state: state ?? task.status ?? "unknown",
      updatedAt: task.updatedAt ?? null,
      traceId: task.observability?.trace?.traceId ?? task.traceId ?? null,
      assetFamilies: [...new Set([...(task.inputAssets ?? []), ...(task.outputAssets ?? [])].map((asset) => asset.family).filter(Boolean))],
      deepLink: `${terminal.consoleUrl.replace(/\/$/, "")}/tasks/${encodeURIComponent(task.id)}`,
    };
  });
  const recovery = snapshot?.operationalHealth?.recovery ?? snapshot?.recovery ?? {};
  return {
    id: terminal.id,
    name: terminal.name,
    apiUrl: terminal.apiUrl,
    consoleUrl: terminal.consoleUrl,
    status: "online",
    lastSeenAt: new Date().toISOString(),
    capabilities: Array.isArray(snapshot?.capabilities) ? snapshot.capabilities.map((item) => item.id ?? item).filter(Boolean) : [],
    configuration: {
      namespace: snapshot?.namespace ?? null,
      protocolVersion: snapshot?.protocolVersion ?? null,
      capabilityIds: Array.isArray(snapshot?.capabilities) ? snapshot.capabilities.map((item) => item.id ?? item).filter(Boolean).sort() : [],
    },
    counts,
    tasks: projectedTasks,
    alerts: (snapshot?.alerts ?? []).map((alert) => ({
      ref: resourceRef(terminal.id, alert.id),
      terminalId: terminal.id,
      severity: alert.severity,
      status: alert.status,
      message: alert.message,
      updatedAt: alert.updatedAt,
    })),
    recovery: recoveryTrend(recovery.trend),
  };
}

export function createCompositionService({ terminals, request, operationRuntime = null }) {
  const terminalRows = () => typeof terminals === "function" ? terminals() : terminals;
  const registry = () => new Map(terminalRows().map((terminal) => [terminal.id, Object.freeze({ ...terminal })]));
  const lastGood = new Map();

  async function readOne(terminal) {
    try {
      const response = await request(terminal, {
        method: "GET", path: assertPublicTerminalPath("/api/terminal-observation/v1"), readOnly: true,
      });
      if (!response.ok) throw new Error(`terminal summary unavailable (${response.status})`);
      const projected = projectTerminalSnapshot(terminal, await response.json());
      lastGood.set(terminal.id, projected);
      return { ...projected, stale: false, observedAt: projected.lastSeenAt };
    } catch (error) {
      const cached = lastGood.get(terminal.id);
      return {
        id: terminal.id, name: terminal.name, status: "offline", lastSeenAt: null,
        counts: { running: 0, waiting: 0, failed: 0, attention: 1 },
        tasks: (cached?.tasks ?? []).map((task) => ({ ...task, stale: true })),
        alerts: cached?.alerts ?? [], capabilities: cached?.capabilities ?? [], recovery: cached?.recovery ?? recoveryTrend([]),
        configuration: cached?.configuration ?? { namespace: null, protocolVersion: null, capabilityIds: [] },
        stale: Boolean(cached), observedAt: cached?.observedAt ?? null,
        unavailableReason: error instanceof Error ? error.message : "terminal unavailable",
      };
    }
  }

  return {
    async overview() {
      const rows = await Promise.all([...registry().values()].map(readOne));
      const online = rows.filter((row) => row.status === "online");
      const baseline = online[0]?.configuration ?? null;
      const consistency = online.map((row) => ({
        terminalId: row.id,
        status: !baseline ? "unknown"
          : row.configuration.namespace === baseline.namespace
            && row.configuration.protocolVersion === baseline.protocolVersion
            && JSON.stringify(row.configuration.capabilityIds) === JSON.stringify(baseline.capabilityIds)
            ? "consistent" : "different",
      }));
      return {
        generatedAt: new Date().toISOString(),
        scheduling: { supported: false, globalQueue: false, migration: false, failover: false },
        terminals: rows,
        configurationConsistency: { baselineTerminalId: online[0]?.id ?? null, terminals: consistency },
        totals: rows.reduce((total, row) => {
          for (const key of Object.keys(total)) total[key] += row.counts[key];
          return total;
        }, { running: 0, waiting: 0, failed: 0, attention: 0 }),
      };
    },
    async proxyAction({ terminalId, resourceType, localResourceId, action, body = {}, idempotencyKey = null }) {
      const terminal = registry().get(terminalId);
      if (!terminal) return { ok: false, status: 404, code: "terminal_not_found" };
      if (!ALLOWED_ACTIONS.has(action)) return { ok: false, status: 400, code: "unsupported_action" };
      let operation;
      try {
        operation = ownerOperation({ resourceType, localResourceId, action, body });
        operation.path = assertPublicTerminalPath(operation.path);
      } catch {
        return { ok: false, status: 400, code: "invalid_owner_operation" };
      }
      if (operationRuntime) {
        return operationRuntime.execute({ terminal, operation, idempotencyKey, action, localResourceId, request });
      }
      try {
        const response = await request(terminal, operation);
        return { ok: response.ok, status: response.status, terminalId, localResourceId, result: await response.json() };
      } catch {
        return { ok: false, status: 503, code: "owning_terminal_unavailable", terminalId, localResourceId, migrated: false };
      }
    },
  };
}
