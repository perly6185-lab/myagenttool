import { resolveWorkItemExecution } from "../services/work-item-execution.mjs";
import { projectWorkItemOutcome } from "../services/work-item-outcome.mjs";

export const HOME_ATTENTION_REASON_ORDER = [
  "overdue",
  "approval_required",
  "ai_failed",
  "review_ready",
  "user_action_required",
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
  "user_action_required",
  "follow_up_due",
]);
const HOME_COMPLETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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

function completedTimestamp(item) {
  const parsed = item.completedAt ? Date.parse(item.completedAt) : Number.NaN;
  if (Number.isFinite(parsed)) return parsed;
  const fallback = item.updatedAt ? Date.parse(item.updatedAt) : Number.NaN;
  return Number.isFinite(fallback) ? fallback : null;
}

function isCompleted(item) {
  return item.state === "closed" || item.status === "done";
}

function isVisibleHomeItem(item, nowMs) {
  if (item.archivedAt) return false;
  if (!isCompleted(item)) return true;
  const finishedAt = completedTimestamp(item);
  return finishedAt != null && finishedAt >= nowMs - HOME_COMPLETED_RETENTION_MS;
}

const ACTIVE_AUTO_RUN_STATUSES = new Set(["materializing", "running", "waiting_capacity", "verifying", "publishing"]);
const REVIEWABLE_AUTO_RUN_STATUSES = new Set(["done", "pr_open", "report_posted", "plan_proposed", "decomposed"]);
const ACTIVE_INVOCATION_STATUSES = new Set(["queued", "running", "starting"]);

function userStatus(item, execution, completed) {
  if (completed) return "completed";
  const autoRunStatus = execution.autoRun?.status ?? null;
  const invocationStatus = execution.invocation?.status ?? null;
  if (REVIEWABLE_AUTO_RUN_STATUSES.has(autoRunStatus) || execution.autoRun?.phase === "review_ready") return "ready_for_review";
  if (autoRunStatus === "failed" || invocationStatus === "failed") return "needs_action";
  if (autoRunStatus === "blocked") return "blocked";
  if (["awaiting_approval", "needs_input"].includes(autoRunStatus) || invocationStatus === "waiting_for_local_approval") return "needs_action";
  if (ACTIVE_AUTO_RUN_STATUSES.has(autoRunStatus) || (!execution.autoRun && ACTIVE_INVOCATION_STATUSES.has(invocationStatus))) return "ai_working";
  if (execution.executionState === "completed") return "ready_for_review";
  if (item.waitingOn === "me") return "needs_action";
  if (item.status === "blocked") return "blocked";
  if (["requester", "internal"].includes(item.waitingOn)) return "waiting";
  return item.plannedDate ? "scheduled" : "not_started";
}

function attentionReasons(item, nowMs, today, tomorrow) {
  if (item.state === "closed" || item.status === "done" || item.archivedAt) return [];
  const reasons = [];
  const aiOwnsNextStep = item.userStatus === "ai_working";
  const overdueCommitment = !aiOwnsNextStep && item.commitmentDate && timestamp(item.commitmentDate) < nowMs;
  const overdueDueDate = !aiOwnsNextStep && item.dueDate && item.dueDate < today;
  if (overdueCommitment || overdueDueDate) reasons.push("overdue");
  if (item.executionState === "awaiting_approval") reasons.push("approval_required");
  if (item.executionState === "failed") reasons.push("ai_failed");
  if (item.userStatus === "ready_for_review") reasons.push("review_ready");
  const humanFollowUpDue = ["me", "requester", "internal"].includes(item.waitingOn)
    && item.nextFollowUpAt
    && timestamp(item.nextFollowUpAt) <= nowMs;
  if (humanFollowUpDue) reasons.push("follow_up_due");
  if (item.waitingOn === "me" && !aiOwnsNextStep && !reasons.some((reason) => NEEDS_ATTENTION.has(reason))) {
    reasons.push("user_action_required");
  }
  if (item.userStatus === "ai_working") reasons.push("ai_running");
  if (item.plannedDate === today || item.plannedDate === tomorrow) reasons.push("planned");
  const ordered = HOME_ATTENTION_REASON_ORDER.filter((reason) => reasons.includes(reason));
  return item.userStatus === "ready_for_review"
    ? ["review_ready", ...ordered.filter((reason) => reason !== "review_ready")]
    : ordered;
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
    return { kind: "review_result", label: "review_result", targetId: item.id, section: "task" };
  }
  if (reasons.includes("user_action_required")) {
    return { kind: "record_progress", label: "record_progress", targetId: item.id, section: "task" };
  }
  if (reasons.includes("ai_running")) {
    return { kind: "open_run", label: "open_run", targetId: runTarget, section: execution.autoRun ? "autoRuns" : "invocations" };
  }
  if (reasons.includes("follow_up_due")) {
    return { kind: "record_progress", label: "record_progress", targetId: item.id, section: "task" };
  }
  return { kind: "open_issue", label: "open_issue", targetId: item.id, section: "task" };
}

function reportDraftSummary(state, item) {
  const draft = (state.workItemReportDrafts ?? []).find((candidate) =>
    candidate.workItemId === item.id
    && candidate.ownerTeamId === item.ownerTeamId
    && ["draft", "confirmed"].includes(candidate.status));
  if (!draft) return null;
  return {
    id: draft.id,
    status: draft.status,
    stale: draft.source?.workItemRevision !== item.revision,
    updatedAt: draft.updatedAt ?? draft.createdAt,
  };
}

function overdueAge(item, nowMs, today) {
  const values = [];
  if (item.commitmentDate && timestamp(item.commitmentDate) < nowMs) values.push(nowMs - timestamp(item.commitmentDate));
  if (item.dueDate && item.dueDate < today) values.push(nowMs - Date.parse(`${item.dueDate}T23:59:59.999Z`));
  return Math.max(0, ...values);
}

function compareItems(left, right, nowMs, today) {
  const leftCompleted = left.executionState === "completed" && left.planningStatus === "done";
  const rightCompleted = right.executionState === "completed" && right.planningStatus === "done";
  if (leftCompleted !== rightCompleted) return leftCompleted ? 1 : -1;
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
    .filter((item) => isVisibleHomeItem(item, nowMs))
    .map((item) => {
      const execution = resolveWorkItemExecution(item, state, { now: nowMs });
      const completed = isCompleted(item);
      const executionState = completed ? "completed" : execution.executionState;
      const projectedUserStatus = userStatus(item, execution, completed);
      const executionItem = {
        ...item,
        executionState,
        userStatus: projectedUserStatus,
        hasManagedExecution: Boolean(execution.binding),
      };
      const reasons = attentionReasons(executionItem, nowMs, today, tomorrow);
      const attentionReason = reasons[0] ?? null;
      const aiStatus = execution.autoRun?.status ?? execution.invocation?.status ?? null;
      const waitingOn = completed ? "none" : (item.waitingOn ?? "none");
      const invocationSummary = execution.invocation?.result?.output?.latestMessage
        ?? execution.invocation?.result?.output?.summary
        ?? execution.invocation?.result?.summary
        ?? null;
      const projectedDeliveryReport = execution.autoRun?.deliveryReport ?? (
        execution.autoRun?.status === "done"
        && execution.autoRun?.link?.type === "local_issue"
        && execution.autoRun?.localDelivery
        ? {
            summary: invocationSummary,
            verification: execution.autoRun.verification ?? null,
            changedFiles: [],
            completedAt: execution.invocation?.completedAt ?? execution.autoRun.updatedAt ?? null,
          }
        : null
      );
      const outcome = execution.autoRun ? projectWorkItemOutcome({
        item,
        latestRun: execution.autoRun,
        deliveryReport: projectedDeliveryReport,
        invocationSummary,
      }) : null;
      return {
        workItemId: item.id,
        localRef: item.localRef,
        title: item.title,
        projectId: item.projectId ?? null,
        revision: item.revision,
        priority: item.priority,
        assignees: (item.assigneeIds ?? []).map((id) => ({ id, name: users.get(id)?.name ?? id })),
        requester: {
          relation: item.requesterRelation ?? "unknown",
          name: item.requesterName ?? (item.requesterUserId ? users.get(item.requesterUserId)?.name ?? null : null),
          organization: item.requesterOrganization ?? null,
        },
        planningStatus: completed ? "done" : item.status,
        executionState,
        executionKind: execution.binding?.kind ?? null,
        executionUpdatedAt: execution.articleImport?.completedAt
          ?? execution.articleImport?.startedAt
          ?? execution.articleImport?.createdAt
          ?? execution.autoRun?.updatedAt
          ?? execution.invocation?.updatedAt
          ?? null,
        userStatus: projectedUserStatus,
        waitingOn,
        attentionReason,
        secondaryReasons: reasons.slice(1),
        needsAttention: Boolean(attentionReason && NEEDS_ATTENTION.has(attentionReason)) || waitingOn === "me",
        dueDate: item.dueDate ?? null,
        plannedDate: item.plannedDate ?? null,
        commitmentDate: item.commitmentDate ?? null,
        nextFollowUpAt: item.nextFollowUpAt ?? null,
        completedAt: completed ? (item.completedAt ?? item.updatedAt ?? null) : null,
        report: reportDraftSummary(state, item),
        result: outcome && outcome.status !== "pending" ? {
          status: outcome.status,
          summary: outcome.summary,
          updatedAt: outcome.deliveredAt,
          needsReview: projectedUserStatus === "ready_for_review",
        } : null,
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
  const byRelation = Object.fromEntries(["boss", "manager", "customer", "child", "colleague", "self", "unknown"]
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
