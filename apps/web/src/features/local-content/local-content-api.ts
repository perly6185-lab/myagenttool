import { request } from "@/lib/api/request";
import type {
  LocalContentCatalogStats,
  LocalContentKind,
  LocalContentHealth,
  LocalContentPreview,
  LocalContentRecord,
  WorkItemContentReference,
} from "./local-content-types";

export type LocalContentSearchQuery = {
  q?: string;
  kinds?: LocalContentKind[];
  projectId?: string;
  workItemId?: string;
  sourceType?: string;
  yearMonth?: string;
  availability?: "available" | "unavailable";
  indexStatus?: "ready" | "partial" | "metadata_only" | "missing";
  limit?: number;
  offset?: number;
  cursor?: string;
};

export const localContentApi = {
  search: (query: LocalContentSearchQuery = {}) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.kinds?.length) params.set("kind", query.kinds.join(","));
    if (query.projectId) params.set("projectId", query.projectId);
    if (query.workItemId) params.set("workItemId", query.workItemId);
    if (query.sourceType) params.set("sourceType", query.sourceType);
    if (query.yearMonth) params.set("yearMonth", query.yearMonth);
    if (query.availability) params.set("availability", query.availability);
    if (query.indexStatus) params.set("indexStatus", query.indexStatus);
    if (query.limit != null) params.set("limit", String(query.limit));
    if (query.offset != null) params.set("offset", String(query.offset));
    if (query.cursor) params.set("cursor", query.cursor);
    return request<{
      results: LocalContentRecord[];
      count: number;
      query: string;
      limit: number;
      offset: number;
      hasMore: boolean;
      nextCursor: string | null;
      retrieval: { mode: string; offline: boolean };
    }>("GET", `/api/local-content${params.size ? `?${params}` : ""}`);
  },
  stats: () => request<{ catalog: LocalContentCatalogStats }>("GET", "/api/local-content/stats"),
  rebuild: () => request<{
    catalog: LocalContentCatalogStats;
    rebuild: { records: number; relations: number; indexedAt: string; originalFilesChanged: false };
  }>("POST", "/api/local-content/rebuild", {}),
  preview: (contentId: string) => request<{ preview: LocalContentPreview }>(
    "GET",
    `/api/local-content/${encodeURIComponent(contentId)}/preview`,
  ),
  reveal: (contentId: string) => request<{ revealed: true; name: string | null }>(
    "POST",
    `/api/local-content/${encodeURIComponent(contentId)}/reveal`,
    {},
  ),
  revealContainer: (contentId: string) => request<{ revealed: true; name: string | null }>(
    "POST",
    `/api/local-content/${encodeURIComponent(contentId)}/reveal-container`,
    {},
  ),
  refresh: (contentId: string) => request<{ content: LocalContentRecord; refresh: Record<string, unknown> }>(
    "POST",
    `/api/local-content/${encodeURIComponent(contentId)}/refresh`,
    {},
  ),
  health: (contentIds: string[]) => request<{ health: LocalContentHealth[] }>(
    "POST",
    "/api/local-content/health",
    { contentIds },
  ),
  addToWorkItem: (
    workItemId: string,
    payload: { contentId: string; expectedRevision: number; purpose?: "reference" | "required_input"; selectedFingerprint?: string },
  ) => request<{ reference: WorkItemContentReference; workItem: unknown; appliesTo?: string; replayed?: boolean }>(
    "POST",
    `/api/work-items/${encodeURIComponent(workItemId)}/content-references`,
    payload,
  ),
  removeFromWorkItem: (workItemId: string, referenceId: string, expectedRevision: number) =>
    request<{ workItem: unknown; appliesTo: string }>(
      "DELETE",
      `/api/work-items/${encodeURIComponent(workItemId)}/content-references/${encodeURIComponent(referenceId)}`,
      { expectedRevision },
    ),
};
