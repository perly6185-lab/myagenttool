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
  const tasks = Array.isArray(snapshot?.workItems) ? snapshot.workItems : [];
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
    alerts: (snapshot?.operationalHealth?.alerts ?? []).map((alert) => ({
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

export function createCompositionService({ terminals, request }) {
  const registry = new Map(terminals.map((terminal) => [terminal.id, Object.freeze({ ...terminal })]));

  async function readOne(terminal) {
    try {
      const [stateResponse, tasksResponse, healthResponse] = await Promise.all([
        request(terminal, { method: "GET", path: assertPublicTerminalPath("/api/state") }),
        request(terminal, { method: "GET", path: assertPublicTerminalPath("/api/work-items?limit=100") }),
        request(terminal, { method: "GET", path: assertPublicTerminalPath("/api/observability/operations") }),
      ]);
      if (!stateResponse.ok || !tasksResponse.ok || !healthResponse.ok) {
        throw new Error(`terminal summary unavailable (${stateResponse.status}/${tasksResponse.status}/${healthResponse.status})`);
      }
      const [state, tasks, operationalHealth] = await Promise.all([
        stateResponse.json(), tasksResponse.json(), healthResponse.json(),
      ]);
      return projectTerminalSnapshot(terminal, {
        namespace: state.namespace,
        protocolVersion: state.protocolVersion,
        workItems: tasks.workItems,
        capabilities: state.capabilities,
        operationalHealth,
      });
    } catch (error) {
      return {
        id: terminal.id, name: terminal.name, status: "offline", lastSeenAt: null,
        counts: { running: 0, waiting: 0, failed: 0, attention: 1 },
        tasks: [], alerts: [], capabilities: [], recovery: recoveryTrend([]),
        unavailableReason: error instanceof Error ? error.message : "terminal unavailable",
      };
    }
  }

  return {
    async overview() {
      const terminalRows = await Promise.all([...registry.values()].map(readOne));
      const online = terminalRows.filter((row) => row.status === "online");
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
        terminals: terminalRows,
        configurationConsistency: { baselineTerminalId: online[0]?.id ?? null, terminals: consistency },
        totals: terminalRows.reduce((total, row) => {
          for (const key of Object.keys(total)) total[key] += row.counts[key];
          return total;
        }, { running: 0, waiting: 0, failed: 0, attention: 0 }),
      };
    },
    async proxyAction({ terminalId, resourceType, localResourceId, action, body = {} }) {
      const terminal = registry.get(terminalId);
      if (!terminal) return { ok: false, status: 404, code: "terminal_not_found" };
      if (!ALLOWED_ACTIONS.has(action)) return { ok: false, status: 400, code: "unsupported_action" };
      let operation;
      try {
        operation = ownerOperation({ resourceType, localResourceId, action, body });
        operation.path = assertPublicTerminalPath(operation.path);
      } catch {
        return { ok: false, status: 400, code: "invalid_owner_operation" };
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
