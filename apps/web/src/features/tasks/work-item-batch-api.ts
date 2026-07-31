import { request } from "@/lib/api-client";

export const workItemBatchApi = {
  create: (payload: {
    workItemIds: string[];
    maxConcurrent: number;
    agentId?: string;
    idempotencyKey?: string;
  }) => request("POST", "/api/work-item-auto-run-batches", payload),
  list: () => request("GET", "/api/work-item-auto-run-batches"),
};
