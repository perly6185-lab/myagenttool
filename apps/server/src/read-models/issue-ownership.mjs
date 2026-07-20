/*
 * "Who owns this issue" — one view over the TWO issue-keyed ownership signals:
 *   - the develop/review CLAIM lease (issue-claims.mjs), keyed by (project, issue);
 *   - the Layer-B dispatch ASSIGNMENT (assigned/<worker> label), same key.
 * They answer different halves of ownership — who is working it vs which worker
 * server it was dispatched to — so an operator otherwise cross-references two
 * places. This aggregates them per issue.
 *
 * Decision soft-claims are DELIBERATELY excluded: they key by decisionId
 * ("<kind>:<record id>"), an approval-queue-row concern, NOT issue ownership —
 * folding a different domain in would be a false unification. The three concepts
 * stay distinct; only the two that are genuinely about issue ownership are unified
 * here, and only in the read (no behavior change).
 */

// Only surface a claim/assignment the moment it is genuinely live — expiry is
// respected here exactly as the admission paths respect it.
export function computeIssueOwnership(state, { includeProject = () => true, nowIso } = {}) {
  const cutoff = Date.parse(nowIso ?? new Date().toISOString());
  const byKey = new Map();
  const keyOf = (projectId, issueNumber) => `${projectId}#${issueNumber}`;
  const rowFor = (projectId, issueNumber) => {
    const key = keyOf(projectId, issueNumber);
    if (!byKey.has(key)) byKey.set(key, { projectId, issueNumber, develop: null, reviewers: [], dispatch: null });
    return byKey.get(key);
  };

  for (const claim of state?.issueClaims ?? []) {
    if (claim?.status !== "active") continue;
    if (claim.leaseExpiresAt && Date.parse(claim.leaseExpiresAt) <= cutoff) continue;
    if (!includeProject(claim.projectId)) continue;
    const row = rowFor(claim.projectId, claim.issueNumber);
    if (claim.mode === "develop") {
      // The develop lease is the authoritative holder (mutually exclusive). If two
      // ever coexist, keep the earliest-seen — the collection is newest-first, so a
      // later row is older; prefer it only when the slot is empty.
      row.develop = row.develop ?? { claimedBy: claim.claimedBy, leaseExpiresAt: claim.leaseExpiresAt ?? null };
    } else if (claim.mode === "review" && !row.reviewers.includes(claim.claimedBy)) {
      row.reviewers.push(claim.claimedBy);
    }
  }

  for (const assignment of state?.dispatchAssignments ?? []) {
    if (assignment?.status !== "open") continue;
    if (!includeProject(assignment.projectId)) continue;
    const row = rowFor(assignment.projectId, assignment.issueNumber);
    row.dispatch = { workerId: assignment.workerId, assignedAt: assignment.assignedAt ?? null, adopted: Boolean(assignment.adopted) };
  }

  const issues = [...byKey.values()].sort(
    (a, b) => (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : a.issueNumber - b.issueNumber),
  );
  return { issues };
}
