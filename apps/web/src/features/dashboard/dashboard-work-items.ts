import { api } from "@/data/use-console-actions";
import type { LocalWorkItem, LocalWorkItemResult } from "@/features/tasks/task-view-types";
import { request } from "@/lib/api-client";

export function assignDashboardWorkItemToMe(id: string, expectedRevision: number) {
  return request("POST", `/api/work-items/${encodeURIComponent(id)}/assign-to-me`, { expectedRevision });
}

export async function listAllDashboardWorkItems(
  query: { assigneeId?: string } = {},
): Promise<LocalWorkItem[]> {
  const rows: LocalWorkItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.listWorkItems({ ...query, limit: "100", ...(cursor ? { cursor } : {}) }) as LocalWorkItemResult;
    rows.push(...page.workItems);
    if (!page.hasMore || !page.nextCursor || page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}
