// DORA counters (minimal, honest slice).
//
// Feeds the quantitative gates in docs/engineering/MATURITY_CALIBRATION.md.
// Only reports what the repo can actually measure today:
//   - Lead time for changes: merged-PR createdAt -> mergedAt (PR-based proxy).
//   - Deploy frequency: merges to the default branch per week. PROXY — no
//     production deploy pipeline exists yet; labeled as such in output.
//   - Change failure rate / failed-deployment recovery time: instrumented from
//     an explicit `Change-failure: #N` marker signal on remediation PRs
//     (adopted 2026-07-04). Honest zero ("0 recorded incidents") until markers
//     exist; a window before adoption is a lower bound. Never faked/inferred.
//
// Elite reference thresholds (2024 DORA snapshot, directional — see
// MATURITY_CALIBRATION.md): lead time < 1 day; deploy on-demand.

// Date the change-failure convention was adopted. Merges before it could not
// carry the marker, so a rate over a window that starts earlier is a lower
// bound — surfaced with this date rather than faked.
export const CHANGE_FAILURE_SIGNAL_SINCE = "2026-07-04";

// A remediation PR names the merge it fixes with a `Change-failure: #N` marker
// (one or more) in its body. That explicit, greppable link is the honest
// incident signal — no inferred reverts, no faked backfill: only failures
// recorded from the convention's adoption onward are counted.
export function parseChangeFailureRefs(body) {
  const refs = new Set();
  const re = /change-failure:\s*((?:#\d+[\s,]*)+)/gi;
  let match;
  while ((match = re.exec(String(body ?? ""))) !== null) {
    for (const token of match[1].match(/#\d+/g) ?? []) refs.add(Number(token.slice(1)));
  }
  return [...refs];
}

// Change failure rate + failed-deployment recovery time from the marker signal.
// A change failure is an in-window merge (deploy) that a later merged PR
// remediates. CFR = distinct culprits / window merges; recovery =
// median(remediation.mergedAt - culprit.mergedAt). With no markers it reports
// recorded:false + the signal-live-since date, never a fabricated ~5%.
export function computeChangeFailures(mergedPrs, { signalSince = CHANGE_FAILURE_SIGNAL_SINCE } = {}) {
  const byNumber = new Map(mergedPrs.map((pr) => [pr.number, pr]));
  const remediatedAt = new Map(); // culprit number -> earliest remediation mergedAt
  for (const pr of mergedPrs) {
    for (const culprit of parseChangeFailureRefs(pr.body)) {
      if (culprit === pr.number) continue; // a PR cannot remediate itself
      const prior = remediatedAt.get(culprit);
      if (!prior || (pr.mergedAt && pr.mergedAt < prior)) remediatedAt.set(culprit, pr.mergedAt);
    }
  }
  const recoveryHours = [];
  const incidents = [];
  for (const [culprit, fixedAt] of remediatedAt) {
    const culpritPr = byNumber.get(culprit);
    if (!culpritPr?.mergedAt || !fixedAt) continue; // culprit merged outside the fetched window
    const hours = (Date.parse(fixedAt) - Date.parse(culpritPr.mergedAt)) / 3_600_000;
    if (Number.isFinite(hours) && hours >= 0) {
      recoveryHours.push(hours);
      incidents.push({ culprit, recoveryHours: round2(hours) });
    }
  }
  recoveryHours.sort((a, b) => a - b);
  const total = mergedPrs.length;
  const culpritCount = incidents.length;
  return {
    signalSince,
    recorded: culpritCount > 0,
    culpritCount,
    mergedPrCount: total,
    changeFailureRate: total === 0 ? null : round3(culpritCount / total),
    recoveryHours: { median: percentile(recoveryHours, 0.5), p90: percentile(recoveryHours, 0.9) },
    incidents: incidents.sort((a, b) => a.culprit - b.culprit),
  };
}

export function computeDoraStats(mergedPrs, { days, checksReadable = true, ciSource = "check-rollup", ciSince = null, signalSince = CHANGE_FAILURE_SIGNAL_SINCE }) {
  const leadTimesHours = mergedPrs
    .map((pr) => (Date.parse(pr.mergedAt) - Date.parse(pr.createdAt)) / 3_600_000)
    .filter((hours) => Number.isFinite(hours) && hours >= 0)
    .sort((a, b) => a - b);

  const weeks = Math.max(days / 7, 1e-9);
  // Optional post-cutoff slice of the CI-green gate (e.g. since CI activation):
  // the rolling window carries pre-activation merges for up to `days`, so the
  // slice shows current discipline while the window catches up.
  const sinceSlice =
    checksReadable && ciSince
      ? { ...computeCiChecks(mergedPrs.filter((pr) => pr.mergedAt >= ciSince)), since: ciSince }
      : null;
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
    ciChecksSince: sinceSlice,
    eliteReference: { leadTimeHoursMedian: 24, deployFrequency: "on-demand" },
    changeFailures: computeChangeFailures(mergedPrs, { signalSince }),
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
    ...(stats.ciChecksSince
      ? [formatCiChecksRow(stats.ciChecksSince).replace(
          "CI green on merged PRs (L2 gate)",
          `CI green on merges since ${stats.ciChecksSince.since.slice(0, 10)} (current discipline)`,
        )]
      : []),
    formatChangeFailureRow(stats.changeFailures),
    formatRecoveryRow(stats.changeFailures),
    "",
    "Change failure rate + recovery time come from `Change-failure: #N` markers on",
    "remediation PRs (adoption 2026-07-04) — an explicit incident signal, not an",
    "inferred revert or a faked number; a window that starts before adoption is a",
    "lower bound. Deploy frequency is still a merge-to-main proxy (no production",
    "deploy pipeline). See docs/engineering/MATURITY_CALIBRATION.md for the gates.",
    "",
  ].join("\n");
}

function formatChangeFailureRow(cf) {
  if (!cf || !cf.recorded) {
    return `| Change failure rate (marker-traced) | 0 recorded incidents (signal live since ${cf?.signalSince ?? CHANGE_FAILURE_SIGNAL_SINCE}) | ~5% | — |`;
  }
  const status = cf.changeFailureRate <= 0.05 ? "meets" : "below";
  return `| Change failure rate (marker-traced) | ${(cf.changeFailureRate * 100).toFixed(1)}% (${cf.culpritCount}/${cf.mergedPrCount}) | ~5% | ${status} |`;
}

function formatRecoveryRow(cf) {
  const median = cf?.recoveryHours?.median ?? null;
  if (!cf || !cf.recorded || median === null) {
    return "| Failed deployment recovery time (fix-merge) | no incidents recorded yet | < 1h | — |";
  }
  return `| Failed deployment recovery time (fix-merge) | ${formatHours(median)} median | < 1h | ${median < 1 ? "meets" : "below"} |`;
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

  // Change-failure marker signal: #11 remediates #10 (3h later); #12 is clean.
  const cf = computeChangeFailures([
    { number: 10, mergedAt: "2026-07-04T00:00:00Z", body: "feat: X" },
    { number: 11, mergedAt: "2026-07-04T03:00:00Z", body: "fix: regression\n\nChange-failure: #10" },
    { number: 12, mergedAt: "2026-07-05T00:00:00Z", body: "feat: Y" },
  ]);
  if (cf.culpritCount !== 1) failures.push(`change failures: expected 1 culprit, got ${cf.culpritCount}`);
  if (cf.changeFailureRate !== 0.333) failures.push(`change failure rate expected 0.333, got ${cf.changeFailureRate}`);
  if (cf.recoveryHours.median !== 3) failures.push(`recovery expected 3h median, got ${cf.recoveryHours.median}`);
  const cfEmpty = computeChangeFailures([{ number: 1, mergedAt: "2026-07-04T00:00:00Z", body: "no marker here" }]);
  if (cfEmpty.recorded || cfEmpty.changeFailureRate !== 0) {
    failures.push("no markers must report recorded:false with rate 0, not a fabricated number");
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

function round3(value) {
  return value === null ? null : Math.round(value * 1000) / 1000;
}
