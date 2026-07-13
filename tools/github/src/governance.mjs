// L3 governance counters (minimal, honest slice — same shape as dora.mjs).
//
// Feeds the L3 gate in docs/engineering/MATURITY_CALIBRATION.md:
//   "100% of PRs carry required risk-evidence routes; 0 silent-bypass merges;
//    scope-drift false-positive rate tracked."
//
// - Risk-evidence coverage: every merged PR in the window is re-judged with the
//   SAME predicates the per-PR gate uses (pr-evidence.mjs) — issue link,
//   verification evidence, and the file-triggered risk-evidence routes — so the
//   measurement cannot drift from the gate.
// - Silent-bypass merges: first-parent non-merge commits on the default branch
//   that no merged PR claims as its merge commit (squash/rebase merges land as
//   non-merge commits and must not read as bypasses). Counted from local git
//   history cross-checked against PR mergeCommit oids.
// - Scope-drift false-positive rate: NOT INSTRUMENTED — needs scope-check
//   verdicts recorded per run plus a human label on each; reported as such.

import {
  hasVerificationEvidence,
  prFilePath,
  reviewRiskGates,
} from "./pr-evidence.mjs";

export function judgePrEvidence(pr) {
  const body = pr.body ?? "";
  const files = (pr.files ?? []).map(prFilePath).filter(Boolean);
  const linksIssue =
    (pr.closingIssuesReferences ?? []).length > 0 || /\b(refs|closes|fixes)\s+#\d+/i.test(body);
  const verification = hasVerificationEvidence(body);
  const riskFindings = reviewRiskGates(files, body, pr.number).warnings;
  return {
    number: pr.number,
    linksIssue,
    verification,
    riskRoutesClean: riskFindings.length === 0,
    riskFindings,
    covered: linksIssue && verification && riskFindings.length === 0,
  };
}

// Classify a missing-evidence reason into a stable route key, so gaps aggregate
// across PRs. Keep aligned with reviewRiskGates' warning phrasing.
const MISSING_ROUTE_KEYS = [
  [/issue link/i, "issue link"],
  [/verification/i, "verification"],
  [/visual QA/i, "visual QA (web UI)"],
  [/Product Flow/i, "Product Flow (product-facing UI)"],
  [/cross-platform/i, "cross-platform (desktop/local-exec)"],
  [/state-machine or schema/i, "protocol compatibility"],
  [/adapter/i, "adapter evidence"],
  [/security review/i, "security review (governed surface)"],
  [/release, rollback/i, "release/deploy"],
];

export function classifyMissingRoute(message) {
  for (const [re, key] of MISSING_ROUTE_KEYS) {
    if (re.test(message)) return key;
  }
  return "other";
}

function aggregateMissingRoutes(judged) {
  const counts = new Map();
  for (const pr of judged) {
    if (pr.covered) continue;
    const reasons = [
      ...(pr.linksIssue ? [] : ["issue link"]),
      ...(pr.verification ? [] : ["verification evidence"]),
      ...pr.riskFindings,
    ];
    for (const reason of reasons) {
      const key = classifyMissingRoute(reason);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([route, count]) => ({ route, count }))
    .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route));
}

// When pr-governance was promoted from advisory to a REQUIRED merge check
// (commit f798ed3, #294 — the ci:activate --require-governance promotion). Merges
// before this date predate enforcement, so the rolling all-time window understates
// current discipline; the coverageSince slice is anchored here by default. Same
// role as dora.mjs's CHANGE_FAILURE_SIGNAL_SINCE (2026-07-04).
export const GOVERNANCE_ENFORCEMENT_SINCE = "2026-07-03";

export function computeGovernanceStats(mergedPrs, { days, directPushCount = null, since = null, directPushCountSince = null }) {
  const judged = mergedPrs.map(judgePrEvidence);
  const covered = judged.filter((pr) => pr.covered);
  const total = judged.length;
  // Optional post-cutoff slice (e.g. since enforcement went live): the rolling
  // window carries pre-enforcement merges for up to `days`, so the slice shows
  // current discipline while the window catches up. Same rationale as the
  // dora --ci-since slice.
  const sinceSlice = since ? computeSinceSlice(mergedPrs, since, directPushCountSince) : null;
  return {
    coverageSince: sinceSlice,
    windowDays: days,
    mergedPrCount: total,
    coveredPrCount: covered.length,
    coverageRate: total === 0 ? null : round3(covered.length / total),
    byCheck: {
      linksIssue: total === 0 ? null : round3(judged.filter((pr) => pr.linksIssue).length / total),
      verification: total === 0 ? null : round3(judged.filter((pr) => pr.verification).length / total),
      riskRoutesClean: total === 0 ? null : round3(judged.filter((pr) => pr.riskRoutesClean).length / total),
    },
    uncovered: judged
      .filter((pr) => !pr.covered)
      .map((pr) => ({
        number: pr.number,
        missing: [
          ...(pr.linksIssue ? [] : ["issue link"]),
          ...(pr.verification ? [] : ["verification evidence"]),
          ...pr.riskFindings,
        ],
      })),
    // Team-level signal: which evidence routes drag coverage down, ranked. Turns
    // "65% covered" into "fix these two routes" (#812 follow-up).
    topMissingRoutes: aggregateMissingRoutes(judged),
    directPushCount,
    gate: {
      coverageTarget: 1,
      bypassTarget: 0,
      coverageMet: total > 0 && covered.length === total,
      bypassMet: directPushCount === 0,
    },
    notInstrumented: {
      scopeDriftFalsePositiveRate:
        "Needs scope-check verdicts recorded per run plus a human true/false label on each; no labeled corpus exists yet.",
    },
  };
}

// A squash- (or rebase-) merged PR lands as a first-parent NON-merge commit on
// the default branch, so `rev-list --no-merges` alone misreads it as a silent
// bypass. A commit only counts as a bypass when no merged PR claims it as its
// merge commit.
export function countBypassCommits(shas, mergedPrs) {
  const mergeShas = new Set((mergedPrs ?? []).map((pr) => pr.mergeCommit?.oid).filter(Boolean));
  return (shas ?? []).filter((sha) => sha && !mergeShas.has(sha)).length;
}

function computeSinceSlice(mergedPrs, since, directPushCountSince) {
  const judged = mergedPrs.filter((pr) => pr.mergedAt && pr.mergedAt >= since).map(judgePrEvidence);
  const covered = judged.filter((pr) => pr.covered).length;
  const total = judged.length;
  return {
    since,
    mergedPrCount: total,
    coveredPrCount: covered,
    coverageRate: total === 0 ? null : round3(covered / total),
    coverageMet: total > 0 && covered === total,
    directPushCount: directPushCountSince,
    bypassMet: directPushCountSince === 0,
  };
}

export function formatGovernanceReport(stats, { repo }) {
  const pct = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
  const lines = [
    "# Governance (L3) Report",
    "",
    `Repository: ${repo} · window: last ${stats.windowDays} days · merged PRs: ${stats.mergedPrCount}`,
    "",
    "| Gate | Value | Target | Status |",
    "| --- | --- | --- | --- |",
    `| Risk-evidence coverage (issue link + verification + risk routes) | ${pct(stats.coverageRate)} (${stats.coveredPrCount}/${stats.mergedPrCount}) | 100% | ${stats.gate.coverageMet ? "meets" : "below"} |`,
    `| Silent-bypass merges (commits on main without a PR) | ${stats.directPushCount ?? "n/a"} | 0 | ${stats.gate.bypassMet ? "meets" : "above"} |`,
    ...(stats.coverageSince ? formatSinceRows(stats.coverageSince) : []),
    `| Scope-drift false-positive rate | not instrumented | tracked | — |`,
    "",
    `Per-check coverage: issue link ${pct(stats.byCheck.linksIssue)} · verification ${pct(stats.byCheck.verification)} · risk routes clean ${pct(stats.byCheck.riskRoutesClean)}`,
  ];
  if (stats.topMissingRoutes?.length) {
    lines.push("", "## Top missing routes (fix these first)", "");
    for (const { route, count } of stats.topMissingRoutes.slice(0, 8)) {
      lines.push(`- ${route}: ${count} PR(s)`);
    }
  }
  if (stats.uncovered.length > 0) {
    lines.push("", "## PRs missing evidence", "");
    for (const pr of stats.uncovered.slice(0, 20)) {
      lines.push(`- #${pr.number}: ${pr.missing.join("; ")}`);
    }
    if (stats.uncovered.length > 20) lines.push(`- … and ${stats.uncovered.length - 20} more`);
  }
  lines.push(
    "",
    "Coverage is judged by the same predicates the per-PR gate (check-pr) uses,",
    "so this measurement cannot drift from what the gate enforces. Scope-drift",
    "false positives need a labeled corpus and are reported honestly as not",
    "instrumented. See docs/engineering/MATURITY_CALIBRATION.md (L3).",
    "",
  );
  return lines.join("\n");
}

function formatSinceRows(slice) {
  const day = slice.since.slice(0, 10);
  const coverageCell =
    slice.mergedPrCount === 0
      ? "no merged PRs since cutoff"
      : `${(slice.coverageRate * 100).toFixed(1)}% (${slice.coveredPrCount}/${slice.mergedPrCount})`;
  const rows = [
    `| Risk-evidence coverage since ${day} (current discipline) | ${coverageCell} | 100% | ${slice.mergedPrCount === 0 ? "n/a" : slice.coverageMet ? "meets" : "below"} |`,
  ];
  if (slice.directPushCount !== null && slice.directPushCount !== undefined) {
    rows.push(`| Silent-bypass merges since ${day} | ${slice.directPushCount} | 0 | ${slice.bypassMet ? "meets" : "above"} |`);
  }
  return rows;
}

export function governanceSelfCheck() {
  const covered = judgePrEvidence({
    number: 1,
    body: "Closes #7\n## Verification\n- pnpm test passed\n",
    files: ["docs/vision/PRODUCT.md"],
    closingIssuesReferences: [{ number: 7 }],
  });
  if (!covered.covered) throw new Error("Governance self-check: a fully evidenced PR should be covered.");

  const uncovered = judgePrEvidence({ number: 2, body: "no evidence here", files: ["apps/web/src/App.tsx"] });
  if (uncovered.covered || uncovered.riskRoutesClean) {
    throw new Error("Governance self-check: a web change without visual evidence must not be covered.");
  }

  const stats = computeGovernanceStats(
    [
      { number: 1, body: "Closes #7\n## Verification\n- pnpm test passed\n", files: [], closingIssuesReferences: [] },
      { number: 2, body: "nothing", files: [] },
    ],
    { days: 30, directPushCount: 1 },
  );
  if (stats.coverageRate !== 0.5 || stats.gate.coverageMet || stats.gate.bypassMet) {
    throw new Error("Governance self-check: coverage math or gate flags are wrong.");
  }
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
