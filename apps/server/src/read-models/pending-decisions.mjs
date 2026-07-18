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

// A decompose plan is no longer "awaiting approval" once it's in-flight, done, or
// declined. (approveDecomposition leaves status "partial" on a retryable partial
// failure — that one SHOULD stay visible, so it's deliberately absent here.)
const DECOMPOSE_SETTLED = new Set(["approving", "approved", "rejected"]);

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
  lifecycleLocalApprovals = [],
  lifecycleRollbackRequests = [],
  channelTaskRequests = [],
  applicationRecoveryActions = [],
  applicationsById = new Map(),
  invocationsById = new Map(),
  // #1151: active decision soft-claims (already expiry-filtered + team-scoped by
  // the caller), keyed by this queue's row ids.
  decisionSoftClaims = [],
} = {}) {
  const out = [];
  const invOf = (id) => (id != null ? invocationsById.get(id) ?? null : null);
  const recoveryActionsById = new Map(applicationRecoveryActions.map((request) => [request?.id, request]));

  // 1. Invocation approvals — a high/critical-risk (or explicitly gated) run parked
  // for approve/deny. Binary; actionable inline.
  for (const a of approvalRequests) {
    if (a?.status !== "pending") continue;
    const inv = invOf(a.invocationId);
    // approval.summary is an object ({risk,data,cost,…}) in production, a string in
    // some tests — use the risk line, never the stringified object ("[object Object]").
    const summaryText = typeof a.summary === "string" ? a.summary : a.summary?.risk;
    out.push({
      id: `approval:${a.id}`,
      kind: "invocation_approval",
      title: "Invocation needs approval",
      subtitle: truncate([a.riskLevel ? `${a.riskLevel} risk` : null, summaryText ?? inv?.task].filter(Boolean).join(" · ")),
      projectId: inv?.projectId ?? null,
      createdAt: a.createdAt ?? null,
      section: "invocations",
      targetId: a.invocationId ?? null,
      // S6 (#1090): a channel-originated approval carries its conversation
      // context so the console row and the in-channel /approve are visibly the
      // SAME pending decision (one approval system, ADR 0012 rule 5).
      ref: { approvalId: a.id, invocationId: a.invocationId ?? null, channel: inv?.options?.metadata?.channel ?? null },
    });
  }

  // 2. Auto-run lifecycle gates — one row per parked run, keyed by the gate kind.
  for (const r of autoRuns) {
    const path = r?.decision?.path ?? null;
    const common = { projectId: r?.projectId ?? null, createdAt: autoRunStamp(r), section: "autoRuns", targetId: r?.id ?? null };
    // These gates settle by setting a sub-field (decompositionApproval / clarifyAnswer /
    // prState) while the run STATUS stays parked — so each predicate must also exclude
    // its own settled state, not just show on status.
    if (r?.status === "plan_proposed" && path === "decompose" && !DECOMPOSE_SETTLED.has(r?.decompositionApproval?.status)) {
      // Hidden while approving/approved and — critically — after a REJECT (reject
      // leaves status plan_proposed; re-showing it could re-spawn declined work).
      out.push({ id: `decompose:${r.id}`, kind: "decomposition", title: "Decomposition plan awaiting approval", subtitle: autoRunContext(r), ref: { autoRunId: r.id }, ...common });
    } else if (r?.status === "report_posted" && path === "design" && r?.designApproval == null) {
      out.push({ id: `design:${r.id}`, kind: "design", title: "Design report awaiting approval", subtitle: autoRunContext(r), ref: { autoRunId: r.id }, ...common });
    } else if (r?.status === "needs_input" && path === "clarify" && !r?.clarifyAnswer) {
      // clarifyAnswer set → the human already answered (status stays needs_input).
      out.push({ id: `clarify:${r.id}`, kind: "clarify", title: "Agent needs an answer", subtitle: autoRunContext(r), ref: { autoRunId: r.id }, ...common });
    } else if (r?.status === "pr_open" && r?.prNumber && r?.prState !== "MERGED" && r?.prState !== "CLOSED") {
      out.push({
        id: `merge:${r.id}`,
        kind: "merge",
        title: `PR #${r.prNumber} ready to merge`,
        subtitle: truncate([autoRunContext(r), r.mergeRisk?.level ? `${r.mergeRisk.level} risk` : null].filter(Boolean).join(" · ")),
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
  // Application recovery approvals ride this same store (source
  // "application_recovery_action") but are a different human decision: they gate an
  // application-domain recovery action, and their native surface is the Applications
  // inspector — so they get their own kind, context, and deep link, not the generic
  // "Codex tool permission" row.
  for (const q of codexApprovalBrokerRequests) {
    if (q?.status !== "pending") continue;
    const inv = invOf(q.invocationId);
    if (q.source === "application_recovery_action") {
      const action = recoveryActionsById.get(q.applicationRecoveryActionRequestId) ?? null;
      const app = action?.applicationId ? applicationsById.get(action.applicationId) ?? null : null;
      out.push({
        id: `apprecovery:${q.id}`,
        kind: "application_recovery",
        title: "Application recovery needs approval",
        subtitle: truncate(
          [
            app?.name ?? action?.applicationId,
            action?.actionType ? String(action.actionType).replaceAll("_", " ") : null,
            typeof q.summary === "string" ? q.summary : null,
          ].filter(Boolean).join(" · ") || "Approve or deny an application recovery action",
        ),
        projectId: app?.projectId ?? inv?.projectId ?? null,
        createdAt: q.createdAt ?? null,
        section: "applications",
        targetId: action?.applicationId ?? null,
        ref: {
          requestId: q.id,
          recoveryActionRequestId: q.applicationRecoveryActionRequestId ?? null,
          applicationId: action?.applicationId ?? null,
          invocationId: q.invocationId ?? null,
        },
      });
      continue;
    }
    out.push({
      id: `codex:${q.id}`,
      kind: "codex_broker",
      title: "Codex tool permission",
      subtitle: truncate((typeof q.summary === "string" ? q.summary : null) ?? q.toolName ?? q.command ?? inv?.task ?? "Approve or deny a tool call"),
      projectId: inv?.projectId ?? null,
      createdAt: q.createdAt ?? null,
      section: "invocations",
      targetId: q.invocationId ?? null,
      ref: { requestId: q.id, invocationId: q.invocationId ?? null },
    });
  }

  // 5. Lifecycle local approvals — a device/agent lifecycle op (from a governed
  // recipe) parked for local approve/deny. Global admin-plane, binary, actionable
  // inline — belongs in the one queue like the invocation approvals.
  for (const a of lifecycleLocalApprovals) {
    if (a?.status !== "pending") continue;
    out.push({
      id: `lifecycle:${a.id}`,
      kind: "lifecycle_approval",
      title: "Lifecycle op needs approval",
      subtitle: truncate([a.riskLevel ? `${a.riskLevel} risk` : null, a.summary].filter(Boolean).join(" · ") || "Approve or deny an agent/device lifecycle operation"),
      projectId: null,
      createdAt: a.createdAt ?? null,
      section: "agents",
      targetId: a.agentId ?? null,
      ref: { approvalId: a.id, recipeId: a.recipeId ?? null, agentId: a.agentId ?? null },
    });
  }

  // 6. Lifecycle rollback requests — a failed lifecycle op with a rollback the human
  // can queue. Single-action ("queue rollback"), not binary. queueRollbackAction
  // flips status to "queued", so `available` is the genuinely-pending state.
  for (const r of lifecycleRollbackRequests) {
    if (r?.status !== "available") continue;
    out.push({
      id: `rollback:${r.id}`,
      kind: "lifecycle_rollback",
      title: "Lifecycle rollback available",
      subtitle: truncate(r.summary ?? "A lifecycle action failed — queue its rollback?"),
      projectId: null,
      createdAt: r.createdAt ?? null,
      section: "agents",
      targetId: r.agentId ?? null,
      ref: { rollbackRequestId: r.id, recipeId: r.recipeId ?? null, agentId: r.agentId ?? null },
    });
  }

  // 7. Channel /task requests — a captured inbound task awaiting a human's
  // route-or-dismiss decision (the capture-then-promote trust model). Routing
  // starts a tracked auto-run; dismissing closes the issue.
  for (const r of channelTaskRequests) {
    if (r?.status !== "pending") continue;
    out.push({
      id: `channeltask:${r.id}`,
      kind: "channel_task",
      title: "Channel task ready to route",
      subtitle: truncate(`#${r.issueNumber}${r.title ? ` ${r.title}` : ""}`),
      projectId: r.projectId ?? null,
      createdAt: r.createdAt ?? null,
      section: "channels",
      targetId: r.id,
      ref: { channelTaskRequestId: r.id, issueNumber: r.issueNumber ?? null, issueUrl: r.issueUrl ?? null },
    });
  }

  // #1151: advisory "X is handling this" markers. Attached, never filtering —
  // a claimed row stays visible and actionable for everyone.
  if (decisionSoftClaims.length) {
    const claimByDecision = new Map(decisionSoftClaims.map((claim) => [claim?.decisionId, claim]));
    for (const row of out) {
      const claim = claimByDecision.get(row.id);
      if (claim) row.softClaim = { claimedBy: claim.claimedBy ?? null, expiresAt: claim.expiresAt ?? null };
    }
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
