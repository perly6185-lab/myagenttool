export const loopRunStates = [
  "created",
  "planning",
  "planned",
  "applying",
  "running_adapter",
  "checking_scope",
  "verifying",
  "awaiting_human",
  "queued",
  "claimed",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export type LoopRunState = (typeof loopRunStates)[number];

export const loopEventTypes = [
  "loop_run_created",
  "loop_state_changed",
  "loop_plan_written",
  "loop_manifest_written",
  "loop_testing_plan_written",
  "loop_adapter_contract_written",
  "loop_adapter_started",
  "loop_adapter_completed",
  "loop_scope_checked",
  "loop_verification_completed",
  "loop_pr_requested",
  "loop_completed",
  "loop_failed",
  "loop_cancelled",
  "loop_cancel_requested",
  "loop_resume_requested",
  "loop_retry_requested",
  "loop_human_gate_required",
  "loop_human_gate_approved",
  "loop_human_gate_rejected",
  "loop_enqueued",
  "loop_claimed",
  "loop_heartbeat",
  "loop_released",
  "loop_timed_out",
  "loop_worker_started",
  "loop_worker_completed",
  "loop_worker_failed",
  "loop_worktree_cleanup_requested",
  "loop_worktree_cleanup_completed",
  "loop_worktree_cleanup_refused",
  "loop_worktree_review_written",
  "loop_worktree_promotion_requested",
  "loop_worktree_promotion_refused",
  "loop_worktree_promotion_planned",
  "loop_worktree_promotion_apply_requested",
  "loop_worktree_promotion_apply_checked",
  "loop_worktree_promotion_apply_refused",
  "loop_worktree_promotion_apply_succeeded",
  "loop_worktree_promotion_apply_failed",
  "loop_worktree_promotion_verify_requested",
  "loop_worktree_promotion_verify_started",
  "loop_worktree_promotion_verify_refused",
  "loop_worktree_promotion_verify_succeeded",
  "loop_worktree_promotion_verify_failed",
  "loop_worktree_promotion_pr_prep_requested",
  "loop_worktree_promotion_pr_prep_refused",
  "loop_worktree_promotion_pr_prep_written",
  "loop_worktree_promotion_commit_requested",
  "loop_worktree_promotion_commit_refused",
  "loop_worktree_promotion_commit_succeeded",
  "loop_worktree_promotion_commit_failed",
  "loop_worktree_promotion_push_plan_requested",
  "loop_worktree_promotion_push_plan_refused",
  "loop_worktree_promotion_push_plan_written",
  "loop_worktree_promotion_push_preflight_requested",
  "loop_worktree_promotion_push_preflight_refused",
  "loop_worktree_promotion_push_preflight_succeeded",
  "loop_worktree_promotion_push_preflight_failed",
  "loop_worktree_promotion_push_execute_requested",
  "loop_worktree_promotion_push_execute_refused",
  "loop_worktree_promotion_push_execute_started",
  "loop_worktree_promotion_push_execute_succeeded",
  "loop_worktree_promotion_push_execute_failed",
  "loop_worktree_promotion_pr_create_prep_requested",
  "loop_worktree_promotion_pr_create_prep_refused",
  "loop_worktree_promotion_pr_create_prep_written",
  "loop_worktree_promotion_pr_create_execute_requested",
  "loop_worktree_promotion_pr_create_execute_refused",
  "loop_worktree_promotion_pr_create_execute_started",
  "loop_worktree_promotion_pr_create_execute_succeeded",
  "loop_worktree_promotion_pr_create_execute_failed",
  "loop_worktree_promotion_pr_merge_prep_requested",
  "loop_worktree_promotion_pr_merge_prep_refused",
  "loop_worktree_promotion_pr_merge_prep_ready",
  "loop_worktree_promotion_pr_merge_prep_blocked",
  "loop_worktree_promotion_pr_merge_execute_requested",
  "loop_worktree_promotion_pr_merge_execute_refused",
  "loop_worktree_promotion_pr_merge_execute_started",
  "loop_worktree_promotion_pr_merge_execute_succeeded",
  "loop_worktree_promotion_pr_merge_execute_failed",
] as const;

export type LoopEventType = (typeof loopEventTypes)[number];

export const loopHumanGateStates = [
  "none",
  "requested",
  "approved",
  "rejected",
  "expired",
] as const;

export type LoopHumanGateState = (typeof loopHumanGateStates)[number];

export type LoopHumanGateRecord = {
  gateId: string;
  state: LoopHumanGateState;
  reason: string;
  risk: string;
  scope: string;
  requestedAction: string;
  requestedBy: string | null;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  expiresAt: string | null;
  evidence: string | null;
};

export type LoopEvidenceRef = {
  manifest: string | null;
  codePlan: string | null;
  testingPlan: string | null;
  testingPlanJson: string | null;
  adapterContract: string | null;
  adapterResult: string | null;
  scopeCheck: string | null;
  scopeCheckJson: string | null;
  verification: string | null;
  prBody: string | null;
  workerLog: string | null;
  workerResult: string | null;
};

export type LoopRunRegistryEntry = {
  runId: string;
  issue: string;
  repo: string | null;
  branch: string;
  adapter: string;
  state: LoopRunState;
  apply: boolean;
  verify: boolean;
  openPr: boolean;
  runDir: string;
  eventLog: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  workerId: string | null;
  heartbeatAt: string | null;
  leaseExpiresAt: string | null;
  timeoutAt: string | null;
  queuePriority: string | null;
  prNumber: string | null;
  humanApproval: string | null;
  humanGate: LoopHumanGateRecord | null;
  evidence: LoopEvidenceRef;
  lastError: string | null;
};
