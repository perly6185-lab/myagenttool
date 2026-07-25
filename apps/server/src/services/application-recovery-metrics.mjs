// Orchestration recovery metrics — the metric-layer convergence of application
// recovery with deploy self-healing (docs/design/APPLICATION_RECOVERY_CONVERGENCE.md).
// Mirrors summarizeDeployments' recovery calc: for each FAILED orchestration run,
// the gap to the FIRST later SUCCESSFUL run of the SAME stream (application +
// routine). Restore is only a later successful run — executing a recovery action
// (e.g. regenerating the routine) does not count until a run actually succeeds.
// All null when there's no data (honest, never fabricated).

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round(n, dp) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function summarizeOrchestrationRecovery(invocations = []) {
  const runs = (Array.isArray(invocations) ? invocations : []).filter((inv) => {
    const meta = inv?.options?.metadata;
    if (meta?.source !== "application_orchestration") return false;
    if (inv.status !== "succeeded" && inv.status !== "failed") return false;
    // A terminal run without completedAt can't anchor a duration; skip it rather
    // than guessing from createdAt (which would understate queue-heavy recoveries).
    return typeof inv.completedAt === "string" && Number.isFinite(Date.parse(inv.completedAt));
  });
  if (!runs.length) {
    return { total: 0, failed: 0, recoveryHours: { median: null, count: 0 }, trend: [], alerting: false, thresholdHours: 24 };
  }

  // Stream = one routine of one application. A success in routine B never
  // recovers routine A.
  const streams = new Map();
  for (const run of runs) {
    const meta = run.options.metadata;
    const key = `${meta.applicationId ?? "?"}::${meta.routineId ?? "?"}`;
    const list = streams.get(key);
    if (list) list.push(run);
    else streams.set(key, [run]);
  }

  const recoveries = [];
  const recoveryPoints = [];
  let failed = 0;
  for (const list of streams.values()) {
    const sorted = [...list].sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
    // One incident = a maximal run of consecutive failures, recovered by the
    // first later success. Recovery time = success − the incident's FIRST
    // failure; one restore recovers one incident (not once per failed run).
    let incidentStart = null;
    for (const run of sorted) {
      if (run.status === "failed") {
        failed += 1;
        if (incidentStart === null) incidentStart = Date.parse(run.completedAt);
      } else if (run.status === "succeeded" && incidentStart !== null) {
        const hours = (Date.parse(run.completedAt) - incidentStart) / 3_600_000;
        recoveries.push(hours);
        recoveryPoints.push({ at: run.completedAt, hours: round(hours, 2) });
        incidentStart = null;
      }
    }
  }

  const recoveryMedian = round(median(recoveries), 2);
  return {
    total: runs.length,
    failed,
    recoveryHours: { median: recoveryMedian, count: recoveries.length },
    trend: recoveryPoints.slice(-30),
    thresholdHours: 24,
    alerting: recoveryMedian != null && recoveryMedian > 24,
  };
}
