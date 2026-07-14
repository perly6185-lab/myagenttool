const criticalLifecycleStatuses = new Set(["succeeded", "failed", "cancelled", "blocked", "rejected", "observed"]);

export function isCriticalLifecycleAuditRecord(record) {
  if (!record || typeof record !== "object") {
    return false;
  }
  const status = String(record.status ?? "").toLowerCase();
  return (
    criticalLifecycleStatuses.has(status) ||
    Boolean(record.completedAt) ||
    record.result != null ||
    record.rollback != null ||
    record.operation === "rollback"
  );
}

// #970: TIME-based retention. The per-collection count caps (events.slice(0,500),
// healthChecks.slice(0,50), …) bound SPACE; this bounds TIME by reaping pure
// telemetry — events, traces, spans — older than the operator-configured window
// (retentionSettings.logsDays). Shielded EVIDENCE is never reaped here: the spend
// ledger, critical lifecycle audit, refusals, and audit summaries keep their own
// count caps + shields, so a compliance/billing record can't age out by accident.
// `logsDays` unset or ≤ 0 turns the time policy off (the count caps still bound).
export function applyRetentionPolicies(state, { now }) {
  const days = Number(state?.retentionSettings?.logsDays);
  if (!Number.isFinite(days) || days <= 0) return { reaped: 0 };
  const cutoffMs = Date.parse(now()) - days * 86_400_000;
  if (!Number.isFinite(cutoffMs)) return { reaped: 0 };
  let reaped = 0;
  const reapByAge = (key, tsFields) => {
    const rows = state[key];
    if (!Array.isArray(rows)) return;
    state[key] = rows.filter((row) => {
      const raw = tsFields.map((field) => row?.[field]).find((value) => value != null);
      const ts = Date.parse(raw ?? "");
      const stale = Number.isFinite(ts) && ts < cutoffMs;
      if (stale) reaped += 1;
      return !stale;
    });
  };
  reapByAge("events", ["createdAt"]);
  reapByAge("traces", ["createdAt"]);
  reapByAge("spans", ["startedAt", "createdAt"]);
  return { reaped };
}

// Lifecycle audit records explain operator-visible recovery state. Bound routine
// queued/running noise, but keep completed/failure/result/rollback evidence even
// when it is older than the display cap.
export function capLifecycleAuditRecords(state, cap = 100) {
  const records = Array.isArray(state.lifecycleAuditRecords) ? state.lifecycleAuditRecords : [];
  const max = Math.max(0, Number(cap) || 0);
  let ordinary = 0;
  state.lifecycleAuditRecords = records.filter((record) => {
    if (isCriticalLifecycleAuditRecord(record)) {
      return true;
    }
    ordinary += 1;
    return ordinary <= max;
  });
}
