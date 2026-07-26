import { request } from "@/lib/api-client";
import type { TraceSearchResponse } from "./trace-contract";

export function searchTraces(query: string, cursor?: string | null, limit = 25) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return request<TraceSearchResponse>("GET", `/api/traces?${params}`);
}
