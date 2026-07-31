import { request } from "@/lib/api-client";

export const workProfileApi = {
  infer: (payload: {
    projectId: string;
    input: {
      schema: "local-sanitized-profile-features/v1";
      sanitized: true;
      features: { key: string; score: number; observations: number }[];
    };
    maxCandidates?: number;
  }) => request("POST", "/api/work-profile/infer", payload),
  confirm: (id: string) =>
    request("POST", `/api/work-profile/inferences/${encodeURIComponent(id)}/confirm`, {}),
  update: (
    id: string,
    payload: { category: string; value: string; reason?: string },
  ) => request("PATCH", `/api/work-profile/inferences/${encodeURIComponent(id)}`, payload),
  reject: (id: string, reason?: string) =>
    request("POST", `/api/work-profile/inferences/${encodeURIComponent(id)}/reject`, { reason }),
  delete: (id: string, reason?: string) =>
    request("DELETE", `/api/work-profile/inferences/${encodeURIComponent(id)}`, { reason }),
};
