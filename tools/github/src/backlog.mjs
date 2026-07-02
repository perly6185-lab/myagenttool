// Backlog health / evidence-coverage counters (minimal, honest slice).
//
// Feeds the L1 gate in docs/engineering/MATURITY_CALIBRATION.md ("100% of
// active work items have issue + Project fields; backlog health report
// emitted"). Measures, per open issue: required label-group coverage
// (type/status/area/risk), milestone coverage, and staleness. Project-board
// field drift stays with `sync-project-fields`; this report is the counting
// side.

const REQUIRED_LABEL_GROUPS = ["type/", "status/", "area/", "risk/"];

export function computeBacklogStats(issues, { staleDays, now }) {
  const nowMs = Date.parse(now);
  const staleCutoff = nowMs - staleDays * 86_400_000;
  const rows = issues.map((issue) => {
    const labels = (issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name ?? ""));
    const missingGroups = REQUIRED_LABEL_GROUPS.filter((group) => !labels.some((label) => label.startsWith(group)));
    return {
      number: issue.number,
      title: issue.title ?? "",
      missingGroups,
      hasMilestone: Boolean(issue.milestone),
      stale: Date.parse(issue.updatedAt ?? now) < staleCutoff,
    };
  });
  const total = rows.length;
  const fullyLabeled = rows.filter((row) => row.missingGroups.length === 0).length;
  const withMilestone = rows.filter((row) => row.hasMilestone).length;
  const stale = rows.filter((row) => row.stale).length;
  return {
    openIssues: total,
    staleDays,
    labelCoverage: { fullyLabeled, rate: rate(fullyLabeled, total) },
    milestoneCoverage: { withMilestone, rate: rate(withMilestone, total) },
    staleIssues: { count: stale, rate: rate(stale, total) },
    gaps: rows
      .filter((row) => row.missingGroups.length > 0 || !row.hasMilestone || row.stale)
      .map((row) => ({
        number: row.number,
        title: row.title,
        problems: [
          ...row.missingGroups.map((group) => `missing ${group}label`),
          ...(row.hasMilestone ? [] : ["no milestone"]),
          ...(row.stale ? [`stale > ${staleDays}d`] : []),
        ],
      })),
  };
}

export function formatBacklogReport(stats, { repo }) {
  const lines = [
    "# Backlog Health Report",
    "",
    `Repository: ${repo} · open issues: ${stats.openIssues} · stale threshold: ${stats.staleDays}d`,
    "",
    "| Coverage | Value | L1 gate |",
    "| --- | --- | --- |",
    `| Required label groups (type/status/area/risk) | ${stats.labelCoverage.fullyLabeled}/${stats.openIssues} (${pct(stats.labelCoverage.rate)}) | 100% |`,
    `| Milestone assigned | ${stats.milestoneCoverage.withMilestone}/${stats.openIssues} (${pct(stats.milestoneCoverage.rate)}) | 100% |`,
    `| Stale (no update > ${stats.staleDays}d) | ${stats.staleIssues.count}/${stats.openIssues} (${pct(stats.staleIssues.rate)}) | 0 |`,
    "",
  ];
  if (stats.gaps.length > 0) {
    lines.push("## Gaps", "");
    for (const gap of stats.gaps) {
      lines.push(`- #${gap.number} ${gap.title} — ${gap.problems.join(", ")}`);
    }
    lines.push("");
  } else if (stats.openIssues > 0) {
    lines.push("No gaps: every open issue is fully labeled, milestoned, and fresh.", "");
  }
  return lines.join("\n");
}

export function backlogSelfCheck() {
  const now = "2026-01-15T00:00:00Z";
  const fixture = [
    { number: 1, title: "good", labels: ["type/feature", "status/ready", "area/server", "risk/low"], milestone: { title: "M1" }, updatedAt: "2026-01-14T00:00:00Z" },
    { number: 2, title: "missing risk", labels: ["type/bug", "status/ready", "area/web"], milestone: { title: "M1" }, updatedAt: "2026-01-14T00:00:00Z" },
    { number: 3, title: "stale no milestone", labels: ["type/task", "status/ready", "area/docs", "risk/low"], milestone: null, updatedAt: "2025-12-01T00:00:00Z" },
  ];
  const stats = computeBacklogStats(fixture, { staleDays: 14, now });
  const failures = [];
  if (stats.labelCoverage.fullyLabeled !== 2) failures.push(`fully labeled expected 2, got ${stats.labelCoverage.fullyLabeled}`);
  if (stats.milestoneCoverage.withMilestone !== 2) failures.push(`with milestone expected 2, got ${stats.milestoneCoverage.withMilestone}`);
  if (stats.staleIssues.count !== 1) failures.push(`stale expected 1, got ${stats.staleIssues.count}`);
  if (stats.gaps.length !== 2) failures.push(`gaps expected 2, got ${stats.gaps.length}`);
  const empty = computeBacklogStats([], { staleDays: 14, now });
  if (empty.labelCoverage.rate !== null) failures.push("empty backlog must report null rates, not fake 100%");
  return failures;
}

function rate(part, total) {
  return total === 0 ? null : Math.round((part / total) * 1000) / 1000;
}

function pct(value) {
  return value === null ? "n/a" : `${Math.round(value * 1000) / 10}%`;
}
