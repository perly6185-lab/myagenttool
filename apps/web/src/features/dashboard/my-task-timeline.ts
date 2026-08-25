import type { LocalWorkItem } from "@/features/tasks/task-view-types";
import type {
  ChannelDelivery,
  ChannelTaskRequest,
  ChannelTaskRevision,
  ChannelTaskThread,
} from "@/lib/console-state";

export type MyTaskTimelineEvent = {
  id: string;
  kind: "created" | "status" | "revision" | "delivery" | "result" | "updated";
  at: string;
  detail?: string | null;
};

export type MyTaskTimelineRow = {
  id: string;
  source: "channel" | "local";
  title: string;
  summary: string | null;
  status: string;
  updatedAt: string;
  workItemId: string | null;
  channelId: string | null;
  events: MyTaskTimelineEvent[];
};

type BuildMyTaskTimelineInput = {
  workItems?: LocalWorkItem[];
  channelTaskThreads?: ChannelTaskThread[];
  channelTaskRequests?: ChannelTaskRequest[];
  channelTaskRevisions?: ChannelTaskRevision[];
  channelDeliveries?: ChannelDelivery[];
  limit?: number;
};

function validDate(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function latestDate(...values: Array<string | null | undefined>): string {
  const valid = values.map(validDate).filter((value): value is string => Boolean(value));
  return valid.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? new Date(0).toISOString();
}

function channelEvents(
  thread: ChannelTaskThread,
  revisions: ChannelTaskRevision[],
  deliveries: ChannelDelivery[],
): MyTaskTimelineEvent[] {
  const events: MyTaskTimelineEvent[] = [];
  const createdAt = validDate(thread.createdAt);
  if (createdAt) events.push({ id: `${thread.id}:created`, kind: "created", at: createdAt });
  for (const [index, item] of (thread.statusHistory ?? []).entries()) {
    const at = validDate(item.at);
    if (at) events.push({ id: `${thread.id}:status:${index}`, kind: "status", at, detail: item.status });
  }
  for (const revision of revisions.filter((item) => item.threadId === thread.id)) {
    const at = validDate(revision.createdAt);
    if (at) events.push({ id: revision.id, kind: "revision", at, detail: revision.type });
  }
  for (const delivery of deliveries.filter((item) => item.taskContext?.threadId === thread.id)) {
    const at = validDate(delivery.updatedAt ?? delivery.createdAt);
    if (at) events.push({ id: delivery.id, kind: "delivery", at, detail: delivery.status });
  }
  const resultAt = validDate(thread.updatedAt ?? thread.lastActivityAt);
  if (thread.resultSummary && resultAt) {
    events.push({ id: `${thread.id}:result`, kind: "result", at: resultAt, detail: thread.resultSummary });
  }
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6);
}

function localEvents(item: LocalWorkItem): MyTaskTimelineEvent[] {
  const createdAt = latestDate(item.createdAt, item.updatedAt, item.lastProgressAt, item.commitmentDate);
  const updatedAt = latestDate(item.updatedAt, item.lastProgressAt, item.nextFollowUpAt, item.commitmentDate);
  const events: MyTaskTimelineEvent[] = [{ id: `${item.id}:updated`, kind: "updated", at: updatedAt, detail: item.status }];
  if (item.lastProgressSummary && createdAt !== new Date(0).toISOString()) {
    events.push({ id: `${item.id}:result`, kind: "result", at: createdAt, detail: item.lastProgressSummary });
  }
  return events;
}

/**
 * Creates the small, user-facing task feed on Home from existing read models.
 * A channel thread linked to a local work item owns the row, so the same task
 * does not appear twice in the ordinary-user view.
 */
export function buildMyTaskTimeline({
  workItems = [],
  channelTaskThreads = [],
  channelTaskRequests = [],
  channelTaskRevisions = [],
  channelDeliveries = [],
  limit = 8,
}: BuildMyTaskTimelineInput): MyTaskTimelineRow[] {
  const linkedWorkItemIds = new Set<string>();
  const rows: MyTaskTimelineRow[] = channelTaskThreads.map((thread) => {
    if (thread.workItemId) linkedWorkItemIds.add(thread.workItemId);
    const request = channelTaskRequests.find((item) => item.threadId === thread.id);
    const events = channelEvents(thread, channelTaskRevisions, channelDeliveries);
    return {
      id: `channel:${thread.id}`,
      source: "channel" as const,
      title: request?.title || thread.summary || "未命名任务",
      summary: thread.resultSummary ?? thread.summary ?? null,
      status: thread.status,
      updatedAt: latestDate(thread.updatedAt, thread.lastActivityAt, thread.createdAt),
      workItemId: thread.workItemId ?? null,
      channelId: thread.channelId,
      events,
    };
  });

  for (const item of workItems) {
    if (linkedWorkItemIds.has(item.id)) continue;
    rows.push({
      id: `local:${item.id}`,
      source: "local",
      title: item.title,
      summary: item.lastProgressSummary ?? null,
      status: item.status,
      updatedAt: latestDate(item.updatedAt, item.createdAt, item.lastProgressAt, item.nextFollowUpAt, item.commitmentDate),
      workItemId: item.id,
      channelId: null,
      events: localEvents(item),
    });
  }

  return rows
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, Math.max(0, limit));
}
