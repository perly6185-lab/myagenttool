import type { LocalWorkItem, LocalWorkItemAutoRun } from "./task-view-types";

export type WorkItemUserStatus =
  | "not_started"
  | "scheduled"
  | "ai_working"
  | "waiting"
  | "needs_action"
  | "ready_for_review"
  | "blocked"
  | "completed";

const ACTIVE_RUN_STATUSES = new Set([
  "materializing",
  "running",
  "waiting_capacity",
  "verifying",
  "publishing",
]);

const REVIEWABLE_RUN_STATUSES = new Set([
  "done",
  "pr_open",
  "report_posted",
  "plan_proposed",
  "decomposed",
]);

export function deriveWorkItemUserStatus(
  item: LocalWorkItem,
  latestRun: LocalWorkItemAutoRun | null = null,
): WorkItemUserStatus {
  if (item.state === "closed" || item.status === "done" || item.planningStatus === "done") return "completed";

  const runStatus = latestRun?.status ?? null;
  if (runStatus === "failed") return "needs_action";
  if (runStatus === "blocked") return "blocked";
  if (["awaiting_approval", "needs_input"].includes(runStatus ?? "")) return "needs_action";
  if (REVIEWABLE_RUN_STATUSES.has(runStatus ?? "") || latestRun?.phase === "review_ready") return "ready_for_review";
  if (ACTIVE_RUN_STATUSES.has(runStatus ?? "")) return "ai_working";

  if (item.executionState === "failed") return "needs_action";
  if (item.executionState === "awaiting_approval") return "needs_action";
  if (item.executionState === "completed") return "ready_for_review";
  if (item.status === "review" || item.planningStatus === "review") return "ready_for_review";
  if (["claimed", "running", "verifying"].includes(item.executionState ?? "")) return "ai_working";
  if (item.waitingOn === "me") return "needs_action";
  if (item.status === "blocked" || item.planningStatus === "blocked") return "blocked";
  if (["requester", "internal"].includes(item.waitingOn)) return "waiting";
  if (item.plannedDate) return "scheduled";
  return "not_started";
}
