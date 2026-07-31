import {
  request,
  type LocalScheduleCapacityResponse,
  type LocalSchedulePreviewResponse,
  type LocalScheduleRolloverResponse,
  type LocalScheduleUrgentResponse,
} from "@/lib/api-client";

export const localScheduleApi = {
  capacity: () => request<LocalScheduleCapacityResponse>("GET", "/api/local-schedule/capacity"),
  preview: () => request<LocalSchedulePreviewResponse>("GET", "/api/local-schedule/preview"),
  applyPlan: (planRevision: string) =>
    request("POST", "/api/local-schedule/apply", { planRevision }),
  rolloverPreview: () =>
    request<LocalScheduleRolloverResponse>("GET", "/api/local-schedule/rollover-preview"),
  applyRollover: (rolloverRevision: string, confirmPinned = false) =>
    request("POST", "/api/local-schedule/rollover", { rolloverRevision, confirmPinned }),
  urgentPreview: () =>
    request<LocalScheduleUrgentResponse>("GET", "/api/local-schedule/urgent-preview"),
  applyUrgent: (urgentRevision: string, confirmPinned = false) =>
    request("POST", "/api/local-schedule/urgent", { urgentRevision, confirmPinned }),
};
