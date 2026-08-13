import type {
  WorkItemExecutionKind,
  WorkItemExecutionState,
  WorkItemRequesterRelation,
  WorkItemWaitingOn,
  LocalWorkItem,
} from "@/features/tasks/task-view-types";

export type HomeAttentionReason =
  | "ai_needs_input"
  | "overdue"
  | "approval_required"
  | "ai_failed"
  | "dependency_blocked"
  | "review_ready"
  | "user_action_required"
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
  revision: number;
  priority: LocalWorkItem["priority"];
  assignees: { id: string; name: string }[];
  requester: {
    relation: WorkItemRequesterRelation;
    name: string | null;
    organization: string | null;
  };
  planningStatus: LocalWorkItem["status"];
  executionState: WorkItemExecutionState;
  executionKind: WorkItemExecutionKind | null;
  executionUpdatedAt: string | null;
  userStatus?: "not_started" | "scheduled" | "ai_working" | "waiting" | "needs_action" | "ready_for_review" | "blocked" | "completed";
  waitingOn: WorkItemWaitingOn;
  attentionReason: HomeAttentionReason | null;
  secondaryReasons: HomeAttentionReason[];
  needsAttention: boolean;
  dueDate: string | null;
  plannedDate: string | null;
  commitmentDate: string | null;
  nextFollowUpAt: string | null;
  completedAt?: string | null;
  report: null | {
    id: string;
    status: "draft" | "confirmed";
    stale: boolean;
    updatedAt: string;
  };
  result?: null | {
    status: "available" | "missing";
    summary: string | null;
    updatedAt: string | null;
    needsReview: boolean;
  };
  nextAction: {
    kind: "open_issue" | "record_progress" | "review_result" | "open_approval" | "open_run" | "retry" | "answer_ai";
    label: string;
    targetId: string;
    section: "task" | "approvals" | "autoRuns" | "invocations";
  };
  userAction?: null | {
    required: true;
    kind: "answer_question" | "approve" | "resolve_dependency" | "retry" | "update_progress";
    title: string;
    reason: string;
    instruction: string | null;
    questions?: string[];
    suggestedActions?: Array<{ id: string; label: string; description?: string; payload?: Record<string, unknown> | null }>;
    dependency?: { id: string; localRef: string; title: string } | null;
    primaryAction: string;
    target: { section: "task" | "approvals" | "autoRuns" | "invocations"; id: string };
    resumeAfterAction: boolean;
    requestedBy: "ai" | "system";
    requiresPermission: boolean;
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
