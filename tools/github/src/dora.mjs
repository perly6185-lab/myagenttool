// DORA counters (minimal, honest slice).
//
// Feeds the quantitative gates in docs/engineering/MATURITY_CALIBRATION.md.
// Only reports what the repo can actually measure today:
//   - Lead time for changes: merged-PR createdAt -> mergedAt (PR-based proxy).
//   - Deploy frequency: merges to the default branch per week. PROXY — no
//     production deploy pipeline exists yet; labeled as such in output.
//   - Change failure rate / failed-deployment recovery time: NOT INSTRUMENTED
//     (needs deploy + incident signal); reported as such, never faked.
//
// Elite reference thresholds (2024 DORA snapshot, directional — see
// MATURITY_CALIBRATION.md): lead time < 1 day; deploy on-demand.

export function computeDoraStats(mergedPrs, { days }) {
  const leadTimesHours = mergedPrs
    .map((pr) => (Date.parse(pr.mergedAt) - Date.parse(pr.createdAt)) / 3_600_000)
    .filter((hours) => Number.isFinite(hours) && hours >= 0)
    .sort((a, b) => a - b);

  const weeks = Math.max(days / 7, 1e-9);
  return {
    windowDays: days,
    mergedPrCount: mergedPrs.length,
    leadTimeHours: {
      median: percentile(leadTimesHours, 0.5),
      p90: percentile(leadTimesHours, 0.9),
      max: leadTimesHours.at(-1) ?? null,
    },
    mergesPerWeek: round2(mergedPrs.length / weeks),
    eliteReference: { leadTimeHoursMedian: 24, deployFrequency: "on-demand" },
    notInstrumented: {
      changeFailureRate: "Needs a deploy + incident/rollback signal; no production deploys exist yet.",
      failedDeploymentRecoveryTime: "Needs deploy failure timestamps; not measurable before a real deploy target.",
    },
  };
}

export function formatDoraReport(stats, { repo }) {
  const lt = stats.leadTimeHours;
  const leadCell = lt.median === null ? "no merged PRs in window" : `${formatHours(lt.median)} median / ${formatHours(lt.p90)} p90`;
  const meetsElite = lt.median !== null && lt.median < stats.eliteReference.leadTimeHoursMedian;
  return [
    "# DORA Report",
    "",
    `Repository: ${repo} · window: last ${stats.windowDays} days · merged PRs: ${stats.mergedPrCount}`,
    "",
    "| Metric | Value | Elite reference (2024 snapshot) | Status |",
    "| --- | --- | --- | --- |",
    `| Lead time for changes (PR created→merged) | ${leadCell} | < 24h median | ${lt.median === null ? "n/a" : meetsElite ? "meets" : "below"} |`,
    `| Deploy frequency (PROXY: merges to main) | ${stats.mergesPerWeek}/week | on-demand | proxy only |`,
    `| Change failure rate | not instrumented | ~5% | — |`,
    `| Failed deployment recovery time | not instrumented | < 1h | — |`,
    "",
    "Not-instrumented metrics need a real deploy target plus incident/rollback",
    "signals; they are reported honestly rather than proxied. See",
    "docs/engineering/MATURITY_CALIBRATION.md for how these feed the L2/L3/L5 gates.",
    "",
  ].join("\n");
}

export function doraSelfCheck() {
  const fixture = [
    { createdAt: "2026-01-01T00:00:00Z", mergedAt: "2026-01-01T12:00:00Z" },
    { createdAt: "2026-01-02T00:00:00Z", mergedAt: "2026-01-03T00:00:00Z" },
    { createdAt: "2026-01-04T00:00:00Z", mergedAt: "2026-01-06T00:00:00Z" },
  ];
  const stats = computeDoraStats(fixture, { days: 7 });
  const failures = [];
  if (stats.leadTimeHours.median !== 24) failures.push(`median lead time expected 24h, got ${stats.leadTimeHours.median}`);
  if (stats.leadTimeHours.max !== 48) failures.push(`max lead time expected 48h, got ${stats.leadTimeHours.max}`);
  if (stats.mergesPerWeek !== 3) failures.push(`merges/week expected 3, got ${stats.mergesPerWeek}`);
  if (!stats.notInstrumented.changeFailureRate) failures.push("change failure rate must be reported as not instrumented");
  const empty = computeDoraStats([], { days: 30 });
  if (empty.leadTimeHours.median !== null) failures.push("empty window must report null lead time, not a fake number");
  return failures;
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.ceil(fraction * sortedValues.length) - 1);
  return round2(sortedValues[Math.max(0, index)]);
}

function formatHours(hours) {
  if (hours === null) return "n/a";
  return hours >= 48 ? `${round2(hours / 24)}d` : `${round2(hours)}h`;
}

function round2(value) {
  return value === null ? null : Math.round(value * 100) / 100;
}
