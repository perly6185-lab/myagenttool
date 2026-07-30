import { request } from "@/lib/api-client";

export const approvalBrokerApi = {
  approve: (id: string) =>
    request("POST", `/api/agent/approval-broker/${encodeURIComponent(id)}/approve`),
  deny: (id: string) =>
    request("POST", `/api/agent/approval-broker/${encodeURIComponent(id)}/deny`),
};
