import { request } from "@/lib/api-client";
import type { ArticleDerivativeRequest } from "./article-workflow-types";

export const articleApi = {
  inspect: (payload: { projectId: string; url: string }) =>
    request("POST", "/api/work-items/article-imports/inspect", payload),
  startImport: (id: string, payload: { url: string; worktreeId: string }) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/article-imports`, payload),
  listImports: (id: string) =>
    request("GET", `/api/work-items/${encodeURIComponent(id)}/article-imports`),
  getImport: (id: string, jobId: string) =>
    request("GET", `/api/work-items/${encodeURIComponent(id)}/article-imports/${encodeURIComponent(jobId)}`),
  cancelImport: (id: string, jobId: string) =>
    request("DELETE", `/api/work-items/${encodeURIComponent(id)}/article-imports/${encodeURIComponent(jobId)}`),
  analyze: (id: string, jobId: string) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/article-imports/${encodeURIComponent(jobId)}/analysis`, {}),
  findSimilar: (id: string, jobId: string) =>
    request("GET", `/api/work-items/${encodeURIComponent(id)}/article-imports/${encodeURIComponent(jobId)}/similar`),
  createDerivative: (id: string, jobId: string, payload: ArticleDerivativeRequest) =>
    request(
      "POST",
      `/api/work-items/${encodeURIComponent(id)}/article-imports/${encodeURIComponent(jobId)}/derivatives`,
      payload,
    ),
  listDerivatives: (id: string, jobId: string) =>
    request("GET", `/api/work-items/${encodeURIComponent(id)}/article-imports/${encodeURIComponent(jobId)}/derivatives`),
  getDerivative: (id: string, jobId: string, derivativeId: string) =>
    request(
      "GET",
      `/api/work-items/${encodeURIComponent(id)}/article-imports/${encodeURIComponent(jobId)}/derivatives/${encodeURIComponent(derivativeId)}`,
    ),
};
