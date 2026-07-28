import { summarizeOrchestrationRecovery } from "../services/application-recovery-metrics.mjs";

const ACTIVE = new Set(["claimed", "running", "awaiting_approval", "verifying"]);

export function terminalObservationReadModel(snapshot, workItems = [], { now }) {
  const device = snapshot.device;
  const terminalId = device?.id ?? null;
  return {
    contract: "terminal-observation/v1",
    generatedAt: now(),
    namespace: snapshot.namespace,
    protocolVersion: snapshot.protocolVersion,
    terminal: device ? {
      id: device.id,
      name: device.name ?? device.hostname ?? device.id,
      platform: device.platform ?? null,
      status: device.status ?? "unknown",
      lastSeenAt: device.lastSeenAt ?? null,
      maxConcurrency: device.maxConcurrency ?? null,
    } : null,
    capabilities: (snapshot.capabilities ?? []).map((capability) => ({
      id: capability.id ?? capability.name,
      name: capability.name,
      available: capability.available !== false,
    })),
    queue: summarizeQueue(workItems),
    tasks: workItems.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      executionState: item.executionState,
      attentionRequired: Boolean(item.attentionRequired),
      updatedAt: item.updatedAt,
      terminalId: item.terminalId ?? terminalId,
      traceId: item.observability?.trace?.traceId ?? null,
      inputAssets: assetSummary(item.inputAssets),
      outputAssets: assetSummary(item.outputAssets),
    })),
    recovery: summarizeOrchestrationRecovery(snapshot.invocations ?? []),
  };
}

function summarizeQueue(items) {
  const counts = { running: 0, waiting: 0, failed: 0, attention: 0 };
  for (const item of items) {
    const state = item.executionState ?? item.status;
    if (["running", "claimed", "verifying"].includes(state)) counts.running += 1;
    if (["queued", "awaiting_approval", "waiting", "blocked"].includes(state)) counts.waiting += 1;
    if (["failed", "timed_out", "cancelled", "rejected"].includes(state)) counts.failed += 1;
    if (item.attentionRequired || (item.alerts ?? []).some((alert) => alert.status === "open")) counts.attention += 1;
  }
  return { ...counts, active: items.filter((item) => ACTIVE.has(item.executionState)).length };
}

function assetSummary(assets) {
  return (assets ?? []).map((asset) => ({
    id: asset.id ?? null,
    family: asset.family ?? "unknown",
    terminalId: asset.terminalId ?? null,
  }));
}
