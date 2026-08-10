import type { ConsoleSnapshot, InvocationSnapshot, PendingDecision, WorkItem } from "@/lib/console-state";

export interface NotificationItem {
  id: string;
  title: string;
  target: "work_item" | "invocation" | "decision";
}

export interface NotificationCenterModel {
  approvals: { count: number; items: NotificationItem[] };
  failures: { count: number; items: NotificationItem[] };
  completions: { count: number; items: NotificationItem[] };
  offline: boolean;
  fallback: boolean;
  eventIds: string[];
}

function invocationTitle(item: InvocationSnapshot): string {
  return item.result?.summary || item.input?.task || item.id;
}

function decisionItem(item: PendingDecision): NotificationItem {
  return { id: item.id, title: item.title, target: "decision" };
}

function workItem(item: WorkItem): NotificationItem {
  return { id: item.id, title: item.title, target: "work_item" };
}

/**
 * One projection for header badges, the in-app center, unread persistence, and
 * optional browser delivery. Counts always come from current server facts.
 */
export function deriveNotificationCenterModel(
  state: ConsoleSnapshot | null | undefined,
  options: { isError: boolean; isLoading: boolean; liveUpdates: boolean },
): NotificationCenterModel {
  const board = state?.workBoard?.states;
  const approvals = state?.pendingDecisions ?? [];
  const failedInvocations = (state?.invocations ?? []).filter((item) =>
    item.status === "failed" || item.status === "timed_out");
  const completedInvocations = (state?.invocations ?? []).filter((item) =>
    item.status === "succeeded" || item.status === "completed");

  const failureItems = board
    ? board.failed.items.map(workItem)
    : failedInvocations.map((item) => ({ id: item.id, title: invocationTitle(item), target: "invocation" as const }));
  const completionItems = board
    ? board.done.items.map(workItem)
    : completedInvocations.map((item) => ({ id: item.id, title: invocationTitle(item), target: "invocation" as const }));
  const offline = options.isError || state?.device?.status === "offline";

  return {
    approvals: {
      count: approvals.length,
      items: approvals.map(decisionItem),
    },
    failures: {
      count: board?.failed.count ?? failedInvocations.length,
      items: failureItems,
    },
    completions: {
      count: board?.done.count ?? completedInvocations.length,
      items: completionItems,
    },
    offline,
    fallback: !options.isError && !options.isLoading && !options.liveUpdates,
    eventIds: [
      ...approvals.map((item) => `approval:${item.id}`),
      ...failureItems.map((item) => `failure:${item.id}`),
      ...completionItems.map((item) => `completion:${item.id}`),
      ...(offline ? ["execution:offline"] : []),
    ],
  };
}

export function unreadCompletionIds(items: NotificationItem[], seenIds: ReadonlySet<string>): string[] {
  return items.map((item) => item.id).filter((id) => !seenIds.has(id));
}
