// Consolidated "one place for every pending human decision" — the data behind the
// Approvals section. It is PURE over the already-tenancy-scoped read-model locals
// (approvalRequests/autoRuns/compareRuns/codexApprovalBrokerRequests are filtered
// by team before they reach here), so it inherits scoping for free and stays
// unit-testable.
//
// Out of scope by design: loop human-gates. Those live in the `ai` loop registry
// (a separate JSON store), not server `state`, so they never reach /api/state; a
// future bridge could surface them, but a snapshot aggregator can't.
//
// Every row is intentionally LIGHTWEIGHT — enough to render a queue row, drive the
// right inline action, and deep-link to the native surface for the rich cases
// (plan/design/clarify review). The heavy payloads stay in their own sections.

function truncate(text, max = 80) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function autoRunContext(run) {
  const link = run?.link;
  if (link?.number) return truncate(`#${link.number}${link.title ? ` ${link.title}` : ""}`);
  return truncate(run?.name ?? run?.id ?? "auto-run");
}

// The most recent gate transition stamp, so the queue can sort by "waiting since".
function autoRunStamp(run) {
  return run?.updatedAt ?? run?.createdAt ?? null;
}

/**
 * @param {object} sources - already team-scoped read-model locals
 * @param {Map<string, object>} [sources.invocationsById] - to resolve a project + task for invocation-scoped rows
 * @returns {Array<object>} normalized pending-decision rows, oldest-waiting first
 */
export function pendingDecisions({
  approvalRequests = [],
  autoRuns = [],
  compareRuns = [],
  codexApprovalBrokerRequests = [],
  invocationsById = new Map(),
} = {}) {
  const out = [];
  const invOf = (id) => (id != null ? invocationsById.get(id) ?? null : null);

  // 1. Invocation approvals — a high/critical-risk (or explicitly gated) run parked
  // for approve/deny. Binary; actionable inline.
  for (const a of approvalRequests) {
    if (a?.status !== "pending") continue;
    const inv = invOf(a.invocationId);
    out.push({
      id: `approval:${a.id}`,
      kind: "invocation_approval",
      title: "Invocation needs approval",
      subtitle: truncate([a.riskLevel ? `${a.riskLevel} risk` : null, a.summary ?? inv?.task].filter(Boolean).join(" · ")),
      projectId: inv?.projectId ?? null,
      createdAt: a.createdAt ?? null,
      section: "invocations",
      targetId: a.invocationId ?? null,
      ref: { approvalId: a.id, invocationId: a.invocationId ?? null },
    });
  }

  // 2. Auto-run lifecycle gates — one row per parked run, keyed by the gate kind.
  for (const r of autoRuns) {
    const path = r?.decision?.path ?? null;
    const common = { projectId: r?.projectId ?? null, createdAt: autoRunStamp(r), section: "autoRuns", targetId: r?.id ?? null };
    if (r?.status === "plan_proposed" && path === "decompose" && r?.decompositionApproval?.status !== "approving") {
      out.push({ id: `decompose:${r.id}`, kind: "decomposition", title: "Decomposition plan awaiting approval", subtitle: autoRunContext(r), ref: { autoRunId: r.id }, ...common });
    } else if (r?.status === "report_posted" && path === "design" && r?.designApproval == null) {
      out.push({ id: `design:${r.id}`, kind: "design", title: "Design report awaiting approval", subtitle: autoRunContext(r), ref: { autoRunId: r.id }, ...common });
    } else if (r?.status === "needs_input" && path === "clarify") {
      out.push({ id: `clarify:${r.id}`, kind: "clarify", title: "Agent needs an answer", subtitle: autoRunContext(r), ref: { autoRunId: r.id }, ...common });
    } else if (r?.status === "pr_open" && r?.prNumber && r?.prState !== "MERGED") {
      out.push({
        id: `merge:${r.id}`,
        kind: "merge",
        title: `PR #${r.prNumber} ready to merge`,
        subtitle: truncate([autoRunContext(r), r.mergeRisk ? `${r.mergeRisk} risk` : null].filter(Boolean).join(" · ")),
        ref: { autoRunId: r.id, prNumber: r.prNumber, prUrl: r.prUrl ?? null, mergeRisk: r.mergeRisk ?? null },
        ...common,
      });
    }
  }

  // 3. Compare-run promotions — an isolated compare with a human-picked winner but
  // no PR yet. (A shared/answer compare has no worktree to promote.)
  for (const c of compareRuns) {
    if (!(c?.isolated && c?.preferredInvocationId && !c?.promotion?.prNumber)) continue;
    out.push({
      id: `promote:${c.id}`,
      kind: "compare_promote",
      title: "Compare winner ready to promote",
      subtitle: truncate(c.task ?? "Open the winner's pull request"),
      projectId: c.projectId ?? null,
      createdAt: c.updatedAt ?? c.createdAt ?? null,
      section: "compare",
      targetId: c.id,
      ref: { compareRunId: c.id, invocationId: c.preferredInvocationId },
    });
  }

  // 4. Codex approval-broker — a managed Codex "ask"-mode tool-permission request.
  for (const q of codexApprovalBrokerRequests) {
    if (q?.status !== "pending") continue;
    const inv = invOf(q.invocationId);
    out.push({
      id: `codex:${q.id}`,
      kind: "codex_broker",
      title: "Codex tool permission",
      subtitle: truncate(q.summary ?? q.toolName ?? q.command ?? inv?.task ?? "Approve or deny a tool call"),
      projectId: inv?.projectId ?? null,
      createdAt: q.createdAt ?? null,
      section: "invocations",
      targetId: q.invocationId ?? null,
      ref: { requestId: q.id, invocationId: q.invocationId ?? null },
    });
  }

  // Oldest-waiting first (deterministic tiebreak on id): the stalest decision is the
  // one most in need of a nudge, and a stable order keeps the UI from jumping.
  return out.sort((a, b) => {
    const at = a.createdAt ?? "";
    const bt = b.createdAt ?? "";
    if (at !== bt) return at < bt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
