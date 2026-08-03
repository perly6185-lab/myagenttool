export const HOME_ATTENTION_REASON_ORDER = [
  "overdue",
  "approval_required",
  "ai_failed",
  "review_ready",
  "follow_up_due",
  "waiting_requester",
  "waiting_internal",
  "ai_running",
  "planned",
];

const PRIORITY_RANK = { p0: 0, p1: 1, p2: 2, p3: 3 };
const NEEDS_ATTENTION = new Set([
  "overdue",
  "approval_required",
  "ai_failed",
  "review_ready",
  "follow_up_due",
]);

function localDateKey(timestamp, timezoneOffset = 0) {
  return new Date(timestamp - timezoneOffset * 60_000).toISOString().slice(0, 10);
}

function addUtcDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function timestamp(value) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function latestExecution(item, state) {
  const bindings = [...(item.executionBindings ?? [])].reverse();
  const autoRunBinding = bindings.find((binding) => binding.kind === "auto_run");
  const autoRun = autoRunBinding
    ? (state.autoRuns ?? []).find((candidate) => candidate.id === autoRunBinding.targetId) ?? null
    : null;
  const applicationBinding = bindings.find((binding) => binding.kind === "application_invocation");
  const invocationId = autoRun?.invocationId
    ?? applicationBinding?.targetId
    ?? applicationBinding?.id
    ?? null;
  const invocation = invocationId
    ? (state.invocations ?? []).find((candidate) => candidate.id === invocationId) ?? null
    : null;
  const agentId = autoRun?.agentId ?? invocation?.agentId ?? null;
  const agent = agentId
    ? (state.agents ?? []).find((candidate) => candidate.id === agentId) ?? null
    : null;
  const approval = invocationId
    ? [...(state.approvalRequests ?? [])].reverse().find((candidate) => candidate.invocationId === invocationId) ?? null
    : null;
  return { autoRun, invocation, agent, approval };
}

function attentionReasons(item, nowMs, today, tomorrow) {
  if (item.state === "closed" || item.status === "done" || item.archivedAt) return [];
  const reasons = [];
  const overdueCommitment = item.commitmentDate && timestamp(item.commitmentDate) < nowMs;
  const overdueDueDate = item.dueDate && item.dueDate < today;
  if (overdueCommitment || overdueDueDate) reasons.push("overdue");
  if (item.executionState === "awaiting_approval") reasons.push("approval_required");
  if (item.executionState === "failed") reasons.push("ai_failed");
  if (item.executionState === "completed") reasons.push("review_ready");
  if (item.nextFollowUpAt && timestamp(item.nextFollowUpAt) <= nowMs) reasons.push("follow_up_due");
  if (item.waitingOn === "requester") reasons.push("waiting_requester");
  if (item.waitingOn === "internal") reasons.push("waiting_internal");
  if (item.executionState === "running") reasons.push("ai_running");
  if (item.plannedDate === today || item.plannedDate === tomorrow) reasons.push("planned");
  return HOME_ATTENTION_REASON_ORDER.filter((reason) => reasons.includes(reason));
}

function nextAction(item, reasons, execution) {
  const runTarget = execution.autoRun?.id ?? execution.invocation?.id ?? item.id;
  if (reasons.includes("approval_required")) {
    return {
      kind: "open_approval",
      label: "review_approval",
      targetId: execution.approval?.id ?? runTarget,
      section: "approvals",
    };
  }
  if (reasons.includes("ai_failed")) {
    return { kind: "retry", label: "retry", targetId: runTarget, section: execution.autoRun ? "autoRuns" : "invocations" };
  }
  if (reasons.includes("review_ready")) {
    return { kind: "review_result", label: "review_result", targetId: runTarget, section: execution.autoRun ? "autoRuns" : "invocations" };
  }
  if (reasons.includes("ai_running")) {
    return { kind: "open_run", label: "open_run", targetId: runTarget, section: execution.autoRun ? "autoRuns" : "invocations" };
  }
  if (reasons.some((reason) => ["follow_up_due", "waiting_requester", "waiting_internal"].includes(reason))) {
    return { kind: "record_progress", label: "record_progress", targetId: item.id, section: "task" };
  }
  return { kind: "open_issue", label: "open_issue", targetId: item.id, section: "task" };
}

function overdueAge(item, nowMs, today) {
  const values = [];
  if (item.commitmentDate && timestamp(item.commitmentDate) < nowMs) values.push(nowMs - timestamp(item.commitmentDate));
  if (item.dueDate && item.dueDate < today) values.push(nowMs - Date.parse(`${item.dueDate}T23:59:59.999Z`));
  return Math.max(0, ...values);
}

function compareItems(left, right, nowMs, today) {
  const leftOverdue = left.attentionReason === "overdue" ? overdueAge(left, nowMs, today) : 0;
  const rightOverdue = right.attentionReason === "overdue" ? overdueAge(right, nowMs, today) : 0;
  if (leftOverdue !== rightOverdue) return rightOverdue - leftOverdue;
  const reasonRank = (reason) => reason == null ? HOME_ATTENTION_REASON_ORDER.length : HOME_ATTENTION_REASON_ORDER.indexOf(reason);
  return reasonRank(left.attentionReason) - reasonRank(right.attentionReason)
    || timestamp(left.commitmentDate) - timestamp(right.commitmentDate)
    || timestamp(left.nextFollowUpAt) - timestamp(right.nextFollowUpAt)
    || (PRIORITY_RANK[left.priority] ?? 9) - (PRIORITY_RANK[right.priority] ?? 9)
    || String(left.plannedDate ?? "9999-12-31").localeCompare(String(right.plannedDate ?? "9999-12-31"))
    || left.workItemId.localeCompare(right.workItemId);
}

export function homeWorkbenchReadModel({
  state,
  workItems,
  now = Date.now(),
  timezoneOffset = 0,
}) {
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  const generatedAt = new Date(nowMs).toISOString();
  const today = localDateKey(nowMs, timezoneOffset);
  const tomorrow = addUtcDays(today, 1);
  const users = new Map((state.users ?? []).map((user) => [user.id, user]));
  const items = workItems
    .filter((item) => !item.archivedAt && item.state !== "closed" && item.status !== "done")
    .map((item) => {
      const reasons = attentionReasons(item, nowMs, today, tomorrow);
      const execution = latestExecution(item, state);
      const attentionReason = reasons[0] ?? null;
      const aiStatus = execution.autoRun?.status ?? execution.invocation?.status ?? null;
      return {
        workItemId: item.id,
        localRef: item.localRef,
        title: item.title,
        projectId: item.projectId ?? null,
        priority: item.priority,
        assignees: (item.assigneeIds ?? []).map((id) => ({ id, name: users.get(id)?.name ?? id })),
        requester: {
          relation: item.requesterRelation ?? "unknown",
          name: item.requesterName ?? (item.requesterUserId ? users.get(item.requesterUserId)?.name ?? null : null),
          organization: item.requesterOrganization ?? null,
        },
        planningStatus: item.status,
        executionState: item.executionState ?? "unclaimed",
        waitingOn: item.waitingOn ?? "none",
        attentionReason,
        secondaryReasons: reasons.slice(1),
        needsAttention: Boolean(attentionReason && NEEDS_ATTENTION.has(attentionReason)) || item.waitingOn === "me",
        dueDate: item.dueDate ?? null,
        plannedDate: item.plannedDate ?? null,
        commitmentDate: item.commitmentDate ?? null,
        nextFollowUpAt: item.nextFollowUpAt ?? null,
        nextAction: nextAction(item, reasons, execution),
        ai: aiStatus ? {
          autoRunId: execution.autoRun?.id ?? null,
          invocationId: execution.invocation?.id ?? execution.autoRun?.invocationId ?? null,
          agentId: execution.agent?.id ?? execution.autoRun?.agentId ?? execution.invocation?.agentId ?? null,
          agentName: execution.agent?.name ?? null,
          status: aiStatus,
          updatedAt: execution.autoRun?.updatedAt ?? execution.invocation?.updatedAt ?? item.updatedAt,
        } : null,
      };
    });
  items.sort((left, right) => compareItems(left, right, nowMs, today));
  const byRelation = Object.fromEntries(["boss", "manager", "customer", "colleague", "self", "unknown"]
    .map((relation) => [relation, items.filter((item) => item.requester.relation === relation).length]));
  const byWaitingOn = Object.fromEntries(["me", "requester", "internal", "ai", "none"]
    .map((waitingOn) => [waitingOn, items.filter((item) => item.waitingOn === waitingOn).length]));
  return {
    generatedAt,
    horizon: { today, tomorrow },
    summary: {
      total: items.length,
      needsAttention: items.filter((item) => item.needsAttention).length,
      waitingMe: byWaitingOn.me,
      approvals: items.filter((item) => item.attentionReason === "approval_required" || item.secondaryReasons.includes("approval_required")).length,
      aiFailed: items.filter((item) => item.attentionReason === "ai_failed" || item.secondaryReasons.includes("ai_failed")).length,
      dueToday: items.filter((item) => item.dueDate === today || (item.commitmentDate && localDateKey(timestamp(item.commitmentDate), timezoneOffset) === today)).length,
      reviewReady: items.filter((item) => item.attentionReason === "review_ready" || item.secondaryReasons.includes("review_ready")).length,
      byRelation,
      byWaitingOn,
    },
    items,
  };
}
