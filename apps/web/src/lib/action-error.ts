import { ApiError } from "@/lib/api-client";

export type ActionErrorModel = {
  cause: string;
  impact: string;
  remedy: string;
  retryable: boolean;
};

export function actionErrorModel(error: unknown): ActionErrorModel {
  const message = error instanceof Error ? error.message : "The action could not be completed.";
  const code = error instanceof ApiError ? error.code : "";
  if (code === "unauthenticated" || /session expired|credential.*expired/i.test(message)) {
    return { cause: message, impact: "This action was not sent.", remedy: "Sign in or reconnect the local bridge, then retry.", retryable: true };
  }
  if (/offline|unavailable|unhealthy|bridge/i.test(`${code} ${message}`)) {
    return { cause: message, impact: "The task remains queued or was not started.", remedy: "Restore the local provider or bridge, then retry.", retryable: true };
  }
  if (/approval|denied|forbidden/i.test(`${code} ${message}`)) {
    return { cause: message, impact: "No protected change was applied.", remedy: "Review the requested scope and approve it from Approvals.", retryable: false };
  }
  return { cause: message, impact: "The requested action did not finish.", remedy: "Check the task details and retry. If it repeats, open Trace.", retryable: true };
}
