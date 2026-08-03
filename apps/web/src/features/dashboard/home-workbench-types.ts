import type {
  WorkItemExecutionState,
  WorkItemRequesterRelation,
  WorkItemWaitingOn,
  LocalWorkItem,
} from "@/features/tasks/task-view-types";

export type HomeAttentionReason =
  | "overdue"
  | "approval_required"
  | "ai_failed"
  | "review_ready"
  | "follow_up_due"
  | "waiting_requester"
  | "waiting_internal"
  | "ai_running"
  | "planned";

export type HomeWorkbenchItem = {
  workItemId: string;
  localRef: string;
  title: string;
  projectId: string | null;
  priority: LocalWorkItem["priority"];
  assignees: { id: string; name: string }[];
  requester: {
    relation: WorkItemRequesterRelation;
    name: string | null;
    organization: string | null;
  };
  planningStatus: LocalWorkItem["status"];
  executionState: WorkItemExecutionState;
  waitingOn: WorkItemWaitingOn;
  attentionReason: HomeAttentionReason | null;
  secondaryReasons: HomeAttentionReason[];
  needsAttention: boolean;
  dueDate: string | null;
  plannedDate: string | null;
  commitmentDate: string | null;
  nextFollowUpAt: string | null;
  nextAction: {
    kind: "open_issue" | "record_progress" | "review_result" | "open_approval" | "open_run" | "retry";
    label: string;
    targetId: string;
    section: "task" | "approvals" | "autoRuns" | "invocations";
  };
  ai: null | {
    autoRunId: string | null;
    invocationId: string | null;
    agentId: string | null;
    agentName: string | null;
    status: string;
    updatedAt: string;
  };
};

export type HomeWorkbench = {
  generatedAt: string;
  horizon: { today: string; tomorrow: string };
  summary: {
    total: number;
    needsAttention: number;
    waitingMe: number;
    approvals: number;
    aiFailed: number;
    dueToday: number;
    reviewReady: number;
    byRelation: Record<WorkItemRequesterRelation, number>;
    byWaitingOn: Record<WorkItemWaitingOn, number>;
  };
  items: HomeWorkbenchItem[];
};
