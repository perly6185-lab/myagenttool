import { request } from "@/lib/api-client";

export const autoRunApi = {
  reverify: (id: string) =>
    request("POST", `/api/auto-runs/${encodeURIComponent(id)}/reverify`),
};
