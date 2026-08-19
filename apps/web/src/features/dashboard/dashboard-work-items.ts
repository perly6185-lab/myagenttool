import { api } from "@/data/use-console-actions";
import type { LocalWorkItem, LocalWorkItemResult } from "@/features/tasks/task-view-types";
import { request } from "@/lib/api-client";
import type { HomeWorkbench } from "./home-workbench-types";

export function assignDashboardWorkItemToMe(id: string, expectedRevision: number) {
  return request("POST", `/api/work-items/${encodeURIComponent(id)}/assign-to-me`, { expectedRevision });
}

export function isHomeWorkbench(value: unknown): value is HomeWorkbench {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HomeWorkbench>;
  return Boolean(
    candidate.summary
    && typeof candidate.summary === "object"
    && Number.isFinite(candidate.summary.total)
    && Number.isFinite(candidate.summary.needsAttention)
    && Number.isFinite(candidate.summary.waitingMe)
    && Number.isFinite(candidate.summary.reviewReady)
    && Array.isArray(candidate.items),
  );
}

export async function getDashboardHomeWorkbench(): Promise<HomeWorkbench> {
  const response = await request("GET", `/api/work-items/home-workbench?assigneeId=all&timezoneOffset=${new Date().getTimezoneOffset()}`);
  if (!isHomeWorkbench(response)) throw new Error("invalid_home_workbench_response");
  return response;
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
