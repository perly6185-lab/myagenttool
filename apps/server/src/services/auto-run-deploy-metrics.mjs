// Deploy metrics (D2) — pure summary over the `deployments` collection the deploy
// stage (D1) records. Feeds the DORA "deploy" keys and the maturity scorecard's
// L5 recovery gate (which was indeterminate for lack of a deploy target).
//
// Change-failure rate = failed / (deploys that ran). Recovery time = for each
// FAILED deploy, the gap to the FIRST later SUCCESSFUL deploy (the recovery) —
// median across failures. Deploy frequency = successful deploys per week over the
// observed span. All null when there's no data (honest, never fabricated).

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

export function summarizeDeployments(deployments = []) {
  // `deployed`/`failed` are deploy attempts; `rolled_back` is a self-healing
  // recovery action (not a deploy) — kept for the recovery calc, excluded from
  // the deploy counts + change-failure rate.
  const rows = (Array.isArray(deployments) ? deployments : []).filter(
    (d) => d && ["deployed", "failed", "rolled_back"].includes(d.status) && typeof d.at === "string" && Number.isFinite(Date.parse(d.at)),
  );
  if (!rows.length) {
    return { total: 0, deployed: 0, failed: 0, changeFailureRate: null, recoveryHours: { median: null, count: 0 }, deployFrequencyPerWeek: null, lastDeployAt: null };
  }
  const sorted = [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); // oldest first
  const attempts = sorted.filter((d) => d.status === "deployed" || d.status === "failed");
  const deployed = attempts.filter((d) => d.status === "deployed").length;
  const failed = attempts.filter((d) => d.status === "failed").length;
  const total = attempts.length;
  if (!total) {
    return { total: 0, deployed: 0, failed: 0, changeFailureRate: null, recoveryHours: { median: null, count: 0 }, deployFrequencyPerWeek: null, lastDeployAt: null };
  }

  // Recovery (DORA MTTR): a maximal run of consecutive failures is ONE incident,
  // recovered by the first later restore (a successful deploy fix-forward OR a
  // rollback). Recovery time = restore − the incident's FIRST failure. A single
  // restore recovers ONE incident — not once per failure, which would count a
  // burst of retries as several short recoveries and understate the median.
  const recoveries = [];
  let incidentStart = null;
  for (const d of sorted) {
    if (d.status === "failed") {
      if (incidentStart === null) incidentStart = Date.parse(d.at);
    } else if ((d.status === "deployed" || d.status === "rolled_back") && incidentStart !== null) {
      recoveries.push((Date.parse(d.at) - incidentStart) / 3_600_000); // hours
      incidentStart = null;
    }
  }

  // Frequency of SUCCESSFUL deploys over the observed span (fallback: the count
  // when everything landed in one instant, e.g. a single deploy).
  const firstAt = Date.parse(attempts[0].at);
  const lastAt = Date.parse(attempts[attempts.length - 1].at);
  const spanDays = Math.max((lastAt - firstAt) / 86_400_000, 0);
  // A rate needs a span: with everything at one instant (e.g. a single deploy),
  // "N per week" is undefined — report null, not the raw count (which read as a
  // weekly rate misstates the magnitude).
  const deployFrequencyPerWeek = spanDays > 0 ? round((deployed / spanDays) * 7, 2) : null;

  return {
    total,
    deployed,
    failed,
    changeFailureRate: round(failed / total, 3),
    recoveryHours: { median: round(median(recoveries), 2), count: recoveries.length },
    // An incident still open at the end of the window is an ACTIVE, unrecovered
    // failure — the median (which only reflects healed incidents) would otherwise
    // let L5 read "met" during a live outage. Surface it so it stays visible.
    openIncident: incidentStart !== null,
    deployFrequencyPerWeek,
    lastDeployAt: attempts[attempts.length - 1].at,
  };
}
