import { api } from "@/data/use-console-actions";
import type { LocalWorkItem, LocalWorkItemResult } from "@/features/tasks/task-view-types";
import { request } from "@/lib/api-client";
import type { HomeWorkbench } from "./home-workbench-types";

export function assignDashboardWorkItemToMe(id: string, expectedRevision: number) {
  return request("POST", `/api/work-items/${encodeURIComponent(id)}/assign-to-me`, { expectedRevision });
}

export function getDashboardHomeWorkbench(): Promise<HomeWorkbench> {
  return request("GET", `/api/work-items/home-workbench?assigneeId=all&timezoneOffset=${new Date().getTimezoneOffset()}`) as Promise<HomeWorkbench>;
}

export async function listAllDashboardWorkItems(
  query: { assigneeId?: string; terminalId?: "local" } = {},
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
