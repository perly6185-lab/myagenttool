import { request } from "@/lib/api-client";
import type { WorkItemReportAudience, WorkItemReportDraft, WorkItemReportTone } from "./work-item-report-types";

const base = (workItemId: string) => `/api/work-items/${encodeURIComponent(workItemId)}/report-drafts`;

export const workItemReportApi = {
  list: (workItemId: string) =>
    request<{ reportDrafts: WorkItemReportDraft[]; count: number }>("GET", base(workItemId)),
  get: (workItemId: string, draftId: string) =>
    request<{ reportDraft: WorkItemReportDraft }>("GET", `${base(workItemId)}/${encodeURIComponent(draftId)}`),
  generate: (workItemId: string, payload: {
    expectedWorkItemRevision: number;
    idempotencyKey: string;
    audience: WorkItemReportAudience;
    tone: WorkItemReportTone;
  }) => request<{ reportDraft: WorkItemReportDraft; replayed: boolean }>("POST", base(workItemId), payload),
  update: (workItemId: string, draftId: string, payload: {
    expectedRevision: number;
    content: string;
    audience: WorkItemReportAudience;
    tone: WorkItemReportTone;
  }) => request<{ reportDraft: WorkItemReportDraft }>(
    "PATCH", `${base(workItemId)}/${encodeURIComponent(draftId)}`, payload,
  ),
  confirm: (workItemId: string, draftId: string, payload: {
    expectedRevision: number;
    idempotencyKey: string;
  }) => request<{ reportDraft: WorkItemReportDraft; replayed: boolean }>(
    "POST", `${base(workItemId)}/${encodeURIComponent(draftId)}/confirm`, payload,
  ),
  discard: (workItemId: string, draftId: string, payload: {
    expectedRevision: number;
    idempotencyKey: string;
  }) => request<{ reportDraft: WorkItemReportDraft; replayed: boolean }>(
    "POST", `${base(workItemId)}/${encodeURIComponent(draftId)}/discard`, payload,
  ),
};
