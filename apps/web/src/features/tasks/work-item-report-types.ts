import type { WorkItemRequesterRelation } from "./task-view-types";

export type WorkItemReportTone = "concise" | "formal" | "warm";
export type WorkItemReportStatus = "draft" | "confirmed" | "discarded" | "superseded";

export type WorkItemReportAudience = {
  relation: WorkItemRequesterRelation;
  name: string | null;
  organization: string | null;
  userId: string | null;
};
export type WorkItemReportDraft = {
  id: string;
  schemaVersion: 1;
  workItemId: string;
  status: WorkItemReportStatus;
  revision: number;
  audience: WorkItemReportAudience;
  tone: WorkItemReportTone;
  content: string;
  stale: boolean;
  canEdit: boolean;
  canConfirm: boolean;
  source: {
    workItemRevision: number;
    capturedAt: string;
    contextDigest: string;
    progressActivities: Array<{ activityId: string; summary: string; createdAt: string }>;
    executionResults: Array<{
      kind: "auto_run" | "invocation";
      id: string;
      status: string;
      summary: string;
      updatedAt: string | null;
    }>;
  };
  generation: {
    generator: "structured" | string;
    policyVersion: string;
    modelVersion: string | null;
    inputDigest: string;
  };
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  confirmedSnapshot: null | {
    revision: number;
    audience: WorkItemReportAudience;
    tone: WorkItemReportTone;
    content: string;
    source: WorkItemReportDraft["source"];
    contentDigest: string;
    confirmedAt: string;
    confirmedBy: string;
  };
};
