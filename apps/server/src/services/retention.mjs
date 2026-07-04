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
