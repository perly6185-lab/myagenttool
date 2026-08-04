import { request } from "@/lib/api-client";
import type {
  WorkItemReportAudience,
  WorkItemReportDelivery,
  WorkItemReportDraft,
  WorkItemReportTone,
} from "./work-item-report-types";

const base = (workItemId: string) => `/api/work-items/${encodeURIComponent(workItemId)}/report-drafts`;
const deliveryBase = (workItemId: string, draftId: string) =>
  `${base(workItemId)}/${encodeURIComponent(draftId)}/deliveries`;

export const WORK_ITEM_REPORT_DELIVERY_ACTION = "work_item.report.deliver";

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
  listDeliveries: (workItemId: string, draftId: string) =>
    request<{ reportDeliveries: WorkItemReportDelivery[]; count: number }>(
      "GET", deliveryBase(workItemId, draftId),
    ),
  previewDelivery: (workItemId: string, draftId: string, payload: {
    channelId: string;
    conversationId: string;
    idempotencyKey: string;
  }) => request<{ reportDelivery: WorkItemReportDelivery; replayed: boolean }>(
    "POST", deliveryBase(workItemId, draftId), payload,
  ),
  getDelivery: (workItemId: string, draftId: string, deliveryId: string) =>
    request<{ reportDelivery: WorkItemReportDelivery }>(
      "GET", `${deliveryBase(workItemId, draftId)}/${encodeURIComponent(deliveryId)}`,
    ),
  sendDelivery: (workItemId: string, draftId: string, deliveryId: string, payload: {
    expectedRevision: number;
    idempotencyKey: string;
    approvalToken: string;
  }) => request<{ reportDelivery: WorkItemReportDelivery; replayed: boolean }>(
    "POST", `${deliveryBase(workItemId, draftId)}/${encodeURIComponent(deliveryId)}/send`, payload,
  ),
};
