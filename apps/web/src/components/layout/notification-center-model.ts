import type { ConsoleSnapshot, InvocationSnapshot, PendingDecision, WorkItem } from "@/lib/console-state";

export interface NotificationItem {
  id: string;
  title: string;
  target: "work_item" | "invocation" | "decision" | "template" | "channel";
}

export interface NotificationCenterModel {
  approvals: { count: number; items: NotificationItem[] };
  failures: { count: number; items: NotificationItem[] };
  followUps: { count: number; items: NotificationItem[] };
  channelDeliveries: { count: number; items: NotificationItem[] };
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
  const followUpItems = board?.follow_up.items
    .filter((item) => item.kind === "work_item_follow_up_reminder")
    .map(workItem) ?? [];
  const channelDeliveryIssues = (state?.channelOperations ?? [])
    .filter((channel) => channel.provider === "wechat_ilink" && channel.deliveryHealth?.state === "outbound_delayed")
    .map((channel) => {
      const delivery = (state?.channelDeliveries ?? []).find((candidate) => candidate.id === channel.deliveryHealth?.latestDeliveryId) ?? null;
      const thread = (state?.channelTaskThreads ?? []).find((candidate) =>
        candidate.channelId === channel.id
        && (candidate.id === delivery?.taskContext?.threadId || candidate.lastDeliveryId === delivery?.id)) ?? null;
      return {
        eventId: `channel-delivery:${delivery?.id ?? channel.id}:unconfirmed`,
        item: thread?.workItemId
          ? { id: thread.workItemId, title: `${thread.summary || "任务结果"} · 微信可能尚未显示`, target: "work_item" as const }
          : { id: channel.id, title: `${channel.name || "微信"} · 结果可能尚未显示`, target: "channel" as const },
      };
    });
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
    followUps: {
      count: followUpItems.length,
      items: followUpItems,
    },
    channelDeliveries: {
      count: channelDeliveryIssues.length,
      items: channelDeliveryIssues.map((issue) => issue.item),
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
      ...followUpItems.map((item) => item.id),
      ...channelDeliveryIssues.map((issue) => issue.eventId),
      ...completionItems.map((item) => `completion:${item.id}`),
      ...(offline ? ["execution:offline"] : []),
    ],
  };
}

export function unreadCompletionIds(items: NotificationItem[], seenIds: ReadonlySet<string>): string[] {
  return items.map((item) => item.id).filter((id) => !seenIds.has(id));
}
