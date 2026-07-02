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

export function computeDoraStats(mergedPrs, { days, checksReadable = true, ciSource = "check-rollup" }) {
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
    ciChecks: checksReadable
      ? { ...computeCiChecks(mergedPrs), source: ciSource }
      : { unavailable: "This token can read neither check runs nor Actions runs." },
    eliteReference: { leadTimeHoursMedian: 24, deployFrequency: "on-demand" },
    notInstrumented: {
      changeFailureRate: "Needs a deploy + incident/rollback signal; no production deploys exist yet.",
      failedDeploymentRecoveryTime: "Needs deploy failure timestamps; not measurable before a real deploy target.",
    },
  };
}

// L2 gate: "CI+smoke green on ≥95% of merged PRs". A PR is green when it has
// at least one check and every check ended successful (neutral/skipped count
// as non-blocking). The denominator is ALL merged PRs — a PR that merged with
// no checks at all is not green (CI simply never ran on it), which is exactly
// the pre-activation gap this metric is meant to expose.
export function computeCiChecks(mergedPrs) {
  const judged = mergedPrs.map((pr) => {
    const contexts = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
    const verdicts = contexts.map((ctx) => String(ctx.conclusion ?? ctx.state ?? "").toUpperCase());
    const hasChecks = verdicts.length > 0;
    const green = hasChecks && verdicts.every((v) => ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(v));
    return { number: pr.number, hasChecks, green };
  });
  const total = judged.length;
  const withChecks = judged.filter((pr) => pr.hasChecks).length;
  const green = judged.filter((pr) => pr.green).length;
  return {
    mergedPrCount: total,
    prsWithChecks: withChecks,
    greenPrs: green,
    greenRate: total === 0 ? null : Math.round((green / total) * 1000) / 1000,
    gateTarget: 0.95,
    gateMet: total > 0 && green / total >= 0.95,
    ciActive: withChecks > 0,
    redPrs: judged.filter((pr) => pr.hasChecks && !pr.green).map((pr) => pr.number),
  };
}

// Fallback source for tokens that cannot read the checks API: judge the same
// gate from Actions workflow runs on the PR's head sha (the Actions runs API
// is readable with plain repo access). Synthesizes the rollup shape so
// computeCiChecks is byte-for-byte the same judge for both sources. A run
// with no conclusion yet (in_progress) maps to a non-green verdict — an
// incomplete run is not a pass.
export function rollupFromActionsRuns(runs) {
  return (runs ?? []).map((run) => ({ conclusion: String(run.conclusion ?? "IN_PROGRESS").toUpperCase() }));
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
    formatCiChecksRow(stats.ciChecks),
    `| Change failure rate | not instrumented | ~5% | — |`,
    `| Failed deployment recovery time | not instrumented | < 1h | — |`,
    "",
    "Not-instrumented metrics need a real deploy target plus incident/rollback",
    "signals; they are reported honestly rather than proxied. See",
    "docs/engineering/MATURITY_CALIBRATION.md for how these feed the L2/L3/L5 gates.",
    "",
  ].join("\n");
}

function formatCiChecksRow(ci) {
  if (ci?.unavailable) {
    return `| CI green on merged PRs (L2 gate) | not measurable (${ci.unavailable}) | ≥95% | — |`;
  }
  if (!ci || ci.mergedPrCount === 0) {
    return "| CI green on merged PRs (L2 gate) | no merged PRs in window | ≥95% | n/a |";
  }
  if (!ci.ciActive) {
    return `| CI green on merged PRs (L2 gate) | 0% (0/${ci.mergedPrCount} — CI not active; no PR carried check runs) | ≥95% | CI not active |`;
  }
  const noChecks = ci.mergedPrCount - ci.prsWithChecks;
  const noChecksNote = noChecks > 0 ? `; ${noChecks} merged with no checks` : "";
  const sourceNote = ci.source && ci.source !== "check-rollup" ? ` [source: ${ci.source}]` : "";
  return `| CI green on merged PRs (L2 gate) | ${(ci.greenRate * 100).toFixed(1)}% (${ci.greenPrs}/${ci.mergedPrCount}${noChecksNote})${sourceNote} | ≥95% | ${ci.gateMet ? "meets" : "below"} |`;
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

  // L2 ci-green gate: green + red + no-checks PRs → 1/3 green, CI active.
  const ci = computeCiChecks([
    { number: 1, statusCheckRollup: [{ conclusion: "SUCCESS" }, { state: "SUCCESS" }] },
    { number: 2, statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }] },
    { number: 3 }, // merged with no checks — counts against the rate
  ]);
  if (ci.greenRate !== 0.333) failures.push(`ci green rate expected 0.333, got ${ci.greenRate}`);
  if (ci.gateMet) failures.push("1/3 green must not meet the ≥95% gate");
  if (!ci.ciActive || ci.prsWithChecks !== 2) failures.push("ci activity detection is wrong");
  const inactive = computeCiChecks([{ number: 1 }, { number: 2 }]);
  if (inactive.ciActive || inactive.greenRate !== 0) {
    failures.push("all-unchecked PRs must read as CI-not-active with a 0 rate, not a fake pass");
  }
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
