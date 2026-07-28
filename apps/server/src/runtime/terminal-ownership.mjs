import { listDevices } from "./device.mjs";

export function backfillTerminalOwnership(state) {
  const terminalId = listDevices(state)[0]?.id ?? null;
  if (!terminalId) return 0;
  let changed = 0;
  const stamp = (row, fallback = terminalId) => {
    if (!row || row.terminalId || !fallback) return;
    row.terminalId = fallback;
    changed += 1;
  };
  for (const item of state.workItems ?? []) {
    stamp(item);
    for (const binding of item.executionBindings ?? []) stamp(binding, item.terminalId);
  }
  const invocations = new Map((state.invocations ?? []).map((row) => [row.id, row]));
  const agents = new Map((state.agents ?? []).map((row) => [row.id, row]));
  for (const invocation of state.invocations ?? []) {
    const agent = agents.get(invocation.agentId);
    stamp(invocation, invocation.delivery?.deviceId
      ?? (agent?.location?.type === "local_device" ? agent.location.deviceId : null)
      ?? terminalId);
  }
  for (const run of state.autoRuns ?? []) {
    const invocation = invocations.get(run.invocationId);
    const agent = agents.get(run.agentId);
    stamp(run, invocation?.terminalId ?? invocation?.delivery?.deviceId
      ?? (agent?.location?.type === "local_device" ? agent.location.deviceId : null)
      ?? terminalId);
  }
  for (const approval of state.approvalRequests ?? []) {
    stamp(approval, invocations.get(approval.invocationId)?.terminalId ?? terminalId);
  }
  for (const audit of state.auditSummaries ?? []) {
    stamp(audit, invocations.get(audit.invocationId)?.terminalId ?? audit.deviceId ?? terminalId);
  }
  return changed;
}
