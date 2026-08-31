const TERMINAL_CASE_STATUSES = new Set(["recovered", "unresolved", "needs_help"]);
const TERMINAL_PLAN_STATUSES = new Set(["not_needed", "completed", "completed_unresolved", "failed", "outcome_unknown", "expired"]);

function ratio(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

function durationSeconds(item) {
  const start = Date.parse(String(item?.createdAt ?? ""));
  const end = Date.parse(String(item?.updatedAt ?? item?.completedAt ?? ""));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 100) / 10;
}

/**
 * Read-only, aggregate view for a host's real-user/pilot observation.
 * It deliberately accepts public case/plan projections so raw input, commands,
 * addresses and credentials cannot enter this read model.
 */
export function summarizeHostOperationsMetrics({ cases = [], remediationPlans = [], generatedAt = new Date().toISOString() } = {}) {
  const caseRows = Array.isArray(cases) ? cases : [];
  const planRows = Array.isArray(remediationPlans) ? remediationPlans : [];
  const terminalCases = caseRows.filter((item) => TERMINAL_CASE_STATUSES.has(item.status));
  const changedCases = caseRows.filter((item) => item.deviceChanged === true);
  const unresolvedCases = caseRows.filter((item) => ["unresolved", "needs_help"].includes(item.status));
  const manualHandoffs = caseRows.filter((item) => item.nextStep === "review_manual_handoff" || item.status === "needs_help");
  const terminalPlans = planRows.filter((item) => TERMINAL_PLAN_STATUSES.has(item.status));
  const safeAborts = planRows.filter((item) => item.status === "failed" && item.result?.changeAttempted !== true);
  const unknownOutcomes = planRows.filter((item) => item.status === "outcome_unknown");
  const durations = terminalCases.map(durationSeconds).filter((value) => value != null);

  return {
    version: 1,
    generatedAt,
    cases: {
      total: caseRows.length,
      active: caseRows.length - terminalCases.length,
      terminal: terminalCases.length,
      recovered: caseRows.filter((item) => item.status === "recovered").length,
      unresolved: unresolvedCases.length,
      changed: changedCases.length,
      manualHandoff: manualHandoffs.length,
      recoveryRate: ratio(caseRows.filter((item) => item.status === "recovered").length, terminalCases.length),
      changeRate: ratio(changedCases.length, caseRows.length),
    },
    remediation: {
      total: planRows.length,
      terminal: terminalPlans.length,
      safeAbort: safeAborts.length,
      unknownOutcome: unknownOutcomes.length,
      completed: planRows.filter((item) => item.status === "completed").length,
      noChangeNeeded: planRows.filter((item) => item.status === "not_needed").length,
    },
    timing: {
      completedCaseCount: durations.length,
      averageCaseSeconds: durations.length ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10 : null,
      latestCaseUpdatedAt: caseRows.map((item) => item.updatedAt).filter(Boolean).sort().at(-1) ?? null,
    },
  };
}
