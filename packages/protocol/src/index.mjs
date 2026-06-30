export const invocationStatuses = [
  "created",
  "authorized",
  "rejected",
  "queued",
  "dispatching",
  "waiting_for_local_approval",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "expired",
];

export const deliveryStates = [
  "not_required",
  "queued",
  "dispatching",
  "delivered",
  "acknowledged",
  "redelivering",
  "delivery_failed",
  "expired",
];

export const cancellationStates = [
  "none",
  "requested",
  "queued_cancelled",
  "dispatched",
  "acknowledged",
  "applied",
  "failed",
  "not_supported",
];

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
];

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
];

export const loopHumanGateStates = [
  "none",
  "requested",
  "approved",
  "rejected",
  "expired",
];

export const loopRoutineScheduleModes = [
  "manual",
  "cron",
  "event",
];

export const loopRoutineInputTypes = [
  "filesystem.glob",
  "git.commits",
  "github.issues",
  "github.prs",
  "github.checks",
  "github.commits",
  "loop.registry",
];

export const loopRoutineCheckTypes = [
  "command",
  "loop-registry",
  "docs-check",
  "typecheck",
  "test",
];

export const loopRoutineWritePolicies = [
  "forbidden",
  "approval-required",
  "allowed",
];

export const lifecycleRecipeActions = [
  "install",
  "update",
  "uninstall",
];

export const lifecycleRecipeReviewStates = [
  "draft",
  "needs_review",
  "approved",
  "rejected",
  "archived",
];

export const lifecycleRecipeQueueStates = [
  "not_queued",
  "local_approval_required",
  "queued",
  "observed",
  "blocked",
  "expired",
];

export const aiProviderModes = [
  "byok",
  "platform_managed",
  "local_model",
  "disabled",
];

export const deploymentModes = [
  "local_developer",
  "self_hosted",
  "saas",
  "private_deployment",
];

export const m0RequiredEventTypes = [
  "invocation_created",
  "invocation_authorized",
  "delivery_queued",
  "delivery_dispatched",
  "delivery_acknowledged",
  "delivery_redelivered",
  "trace_created",
  "span_started",
  "span_completed",
  "invocation_started",
  "invocation_succeeded",
  "invocation_failed",
  "cancel_requested",
  "cancel_applied",
];

const m0RequiredInvocationStatuses = [
  "created",
  "authorized",
  "queued",
  "dispatching",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "expired",
];

const m0RequiredDeliveryStates = [
  "queued",
  "dispatching",
  "acknowledged",
  "redelivering",
  "delivery_failed",
  "expired",
];

const m0RequiredCancellationStates = [
  "none",
  "requested",
  "queued_cancelled",
  "dispatched",
  "applied",
  "failed",
  "not_supported",
];

const loopRequiredRunStates = [
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
];

const loopRequiredEventTypes = [
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
  "loop_completed",
  "loop_failed",
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
];

const loopRequiredHumanGateStates = [
  "none",
  "requested",
  "approved",
  "rejected",
  "expired",
];

const loopRequiredRoutineScheduleModes = [
  "manual",
  "cron",
  "event",
];

const loopRequiredRoutineInputTypes = [
  "filesystem.glob",
  "git.commits",
  "github.issues",
  "github.prs",
  "github.checks",
  "github.commits",
  "loop.registry",
];

const loopRequiredRoutineCheckTypes = [
  "command",
  "loop-registry",
  "docs-check",
  "typecheck",
  "test",
];

const loopRequiredRoutineWritePolicies = [
  "forbidden",
  "approval-required",
  "allowed",
];

const m3RequiredLifecycleRecipeActions = [
  "install",
  "update",
  "uninstall",
];

const m3RequiredLifecycleRecipeReviewStates = [
  "draft",
  "needs_review",
  "approved",
  "rejected",
  "archived",
];

const m3RequiredLifecycleRecipeQueueStates = [
  "not_queued",
  "local_approval_required",
  "queued",
  "observed",
  "blocked",
  "expired",
];

const m3RequiredAiProviderModes = [
  "byok",
  "platform_managed",
  "local_model",
  "disabled",
];

const m3RequiredDeploymentModes = [
  "local_developer",
  "self_hosted",
  "saas",
  "private_deployment",
];

const mode = process.argv.includes("--check") ? "check" : "dev";

if (mode === "check") {
  runM0ProtocolCheck();
  console.log("[protocol:check] M0 protocol vocabulary OK");
} else {
  console.log("[protocol:dev] M0 protocol vocabulary loaded");
}

function runM0ProtocolCheck() {
  assertIncludes(invocationStatuses, m0RequiredInvocationStatuses, "invocation status");
  assertIncludes(deliveryStates, m0RequiredDeliveryStates, "delivery state");
  assertIncludes(cancellationStates, m0RequiredCancellationStates, "cancellation state");
  assertIncludes(loopRunStates, loopRequiredRunStates, "loop run state");
  assertIncludes(loopEventTypes, loopRequiredEventTypes, "loop event type");
  assertIncludes(loopHumanGateStates, loopRequiredHumanGateStates, "loop human gate state");
  assertIncludes(loopRoutineScheduleModes, loopRequiredRoutineScheduleModes, "loop routine schedule mode");
  assertIncludes(loopRoutineInputTypes, loopRequiredRoutineInputTypes, "loop routine input type");
  assertIncludes(loopRoutineCheckTypes, loopRequiredRoutineCheckTypes, "loop routine check type");
  assertIncludes(loopRoutineWritePolicies, loopRequiredRoutineWritePolicies, "loop routine write policy");
  assertIncludes(lifecycleRecipeActions, m3RequiredLifecycleRecipeActions, "M3 lifecycle recipe action");
  assertIncludes(lifecycleRecipeReviewStates, m3RequiredLifecycleRecipeReviewStates, "M3 lifecycle recipe review state");
  assertIncludes(lifecycleRecipeQueueStates, m3RequiredLifecycleRecipeQueueStates, "M3 lifecycle recipe queue state");
  assertIncludes(aiProviderModes, m3RequiredAiProviderModes, "M3 AI provider mode");
  assertIncludes(deploymentModes, m3RequiredDeploymentModes, "M3 deployment mode");
  assertIncludes(m0RequiredEventTypes, [
    "invocation_created",
    "delivery_dispatched",
    "delivery_acknowledged",
    "delivery_redelivered",
    "trace_created",
    "span_completed",
    "cancel_applied",
  ], "event type");
}

function assertIncludes(actual, required, label) {
  for (const value of required) {
    if (!actual.includes(value)) {
      throw new Error(`Missing M0 ${label}: ${value}`);
    }
  }
}
