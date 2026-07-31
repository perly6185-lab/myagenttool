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
  "running",
  "succeeded",
  "failed",
  "cancelled",
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

// --- Work profile (Local Issue #14) --------------------------------------
// Runtime mirror of packages/protocol/src/work-profile.ts. Work-profile
// snapshots are versioned and every inferred fact carries a source summary.

export const workProfileInferenceKinds = [
  "category",
  "recurring_activity",
  "document_pattern",
  "preferred_output",
];

export const workProfileConfidenceLevels = [
  "low",
  "medium",
  "high",
];

export const workProfileEvidenceSourceKinds = [
  "explicit_user_input",
  "invocation",
  "document",
  "project",
  "routine",
];

export const workProfileAuthorizationPermissions = [
  "read",
  "update",
  "use_for_personalization",
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
  "running",
  "succeeded",
  "failed",
  "cancelled",
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

// --- Refusal model (Epic #758, Phase 1 / #759) ---------------------------
// Runtime mirror of packages/protocol/src/refusal.ts. Design of record:
// docs/vision/REFUSAL_MODEL.md. A refusal is a first-class, auditable reply,
// not a failure. Phase 1 is taxonomy only — no records are written yet.

export const refusalCategories = ["not_granted", "policy", "state", "human"];

// CLOSED enum, versioned with the device API. Adding a code is a deliberate
// protocol change — never a string literal at a call site.
export const refusalCodes = [
  "capability_not_granted",
  "command_not_allowlisted",
  "cwd_outside_approved_root",
  "file_policy_exceeded",
  "network_policy_exceeded",
  "action_not_permitted",
  "subject_not_actionable",
  "over_budget",
  "over_quota",
  "undeliverable",
  "binary_unavailable",
  "approval_denied",
  "deliverable_rejected",
  "gate_rejected",
];

// Each code belongs to exactly one category.
export const refusalCodesByCategory = {
  not_granted: ["capability_not_granted"],
  policy: [
    "command_not_allowlisted",
    "cwd_outside_approved_root",
    "file_policy_exceeded",
    "network_policy_exceeded",
    "action_not_permitted",
  ],
  state: ["subject_not_actionable", "over_budget", "over_quota", "undeliverable", "binary_unavailable"],
  human: ["approval_denied", "deliverable_rejected", "gate_rejected"],
};

export const refusalSubjectKinds = [
  "invocation",
  "lifecycle_action",
  "capability_call",
  "worktree_action",
  "application_action",
  "registration",
];

export const refusalRequesterKinds = ["local_user", "control_plane", "automation"];

export const refusalDeciderKinds = ["grant", "policy_engine", "arbiter", "user"];

// The completeness map — every existing refusal event type / blocking HTTP error
// code, mapped onto exactly one (category, code). Umbrella event types that
// refuse for several reasons appear once per reason. Mirrors the table in
// docs/vision/REFUSAL_MODEL.md; asserted complete by test/refusal.test.mjs.
export const refusalEventCatalog = [
  // --- bridge ownership / status (state) ---
  { eventType: "bridge_delivery_refused", reason: "not_owned_or_inactive", category: "state", code: "subject_not_actionable" },
  { eventType: "bridge_lifecycle_refused", reason: "not_owned_or_not_running", category: "state", code: "subject_not_actionable" },
  { eventType: "bridge_operation_refused", reason: "not_owned_or_bad_status", category: "state", code: "subject_not_actionable" },
  { eventType: "delivery_refused", reason: "bridge_self_reported", category: "state", code: "undeliverable" },
  { eventType: "device_dispatch_blocked", category: "state", code: "undeliverable", reserved: true },
  { eventType: "project_remove_blocked", category: "state", code: "subject_not_actionable", httpErrorCode: true },
  // --- local execution policy (policy) — umbrella event, one row per reason ---
  { eventType: "local_execution_refused", reason: "command_not_allowlisted", category: "policy", code: "command_not_allowlisted" },
  { eventType: "local_execution_refused", reason: "cwd_outside_approved_root", category: "policy", code: "cwd_outside_approved_root" },
  { eventType: "local_execution_refused", reason: "file_policy_exceeded", category: "policy", code: "file_policy_exceeded" },
  { eventType: "local_execution_refused", reason: "network_policy_exceeded", category: "policy", code: "network_policy_exceeded" },
  // A binary wrapper whose program is not installed on the executing device: an
  // environment STATE, not a policy rule (#802). Same umbrella event, state code.
  { eventType: "local_execution_refused", reason: "binary_unavailable", category: "state", code: "binary_unavailable" },
  { eventType: "policy_blocked", category: "policy", code: "command_not_allowlisted", httpErrorCode: true },
  // --- recovery / lifecycle policy (policy) ---
  { eventType: "application_orchestration_recovery_action_rejected", category: "policy", code: "action_not_permitted" },
  { eventType: "recovery_action_blocked", category: "policy", code: "action_not_permitted", httpErrorCode: true },
  { eventType: "lifecycle_gate_blocked", category: "policy", code: "action_not_permitted", httpErrorCode: true },
  { eventType: "rollback_gate_blocked", category: "policy", code: "action_not_permitted", httpErrorCode: true },
  { eventType: "loop_worktree_promotion_pr_merge_prep_blocked", category: "policy", code: "action_not_permitted" },
  // --- economics / quota / approval on invocation creation (state + human) ---
  { eventType: "invocation_rejected", reason: "over_quota", category: "state", code: "over_quota" },
  { eventType: "invocation_rejected", reason: "over_budget", category: "state", code: "over_budget" },
  { eventType: "invocation_rejected", reason: "local_approval_denied", category: "human", code: "approval_denied" },
  // --- human approvals (human) ---
  { eventType: "local_approval_denied", category: "human", code: "approval_denied" },
  { eventType: "codex_approval_denied", category: "human", code: "approval_denied" },
  { eventType: "auto_run_denied", category: "human", code: "approval_denied" },
  { eventType: "permission_denied", category: "not_granted", code: "capability_not_granted", reserved: true },
  // --- human rejected a deliverable (human) ---
  { eventType: "auto_run_design_rejected", category: "human", code: "deliverable_rejected" },
  { eventType: "auto_run_decomposition_rejected", category: "human", code: "deliverable_rejected" },
  // --- human rejected a workflow / promotion gate (human) ---
  { eventType: "loop_human_gate_rejected", category: "human", code: "gate_rejected" },
  { eventType: "loop_worktree_cleanup_refused", category: "human", code: "gate_rejected" },
  { eventType: "loop_worktree_promotion_refused", category: "human", code: "gate_rejected" },
  { eventType: "loop_worktree_promotion_apply_refused", category: "human", code: "gate_rejected" },
  { eventType: "loop_worktree_promotion_verify_refused", category: "human", code: "gate_rejected" },
  { eventType: "loop_worktree_promotion_pr_prep_refused", category: "human", code: "gate_rejected" },
  { eventType: "loop_worktree_promotion_commit_refused", category: "human", code: "gate_rejected" },
  { eventType: "loop_worktree_promotion_push_plan_refused", category: "human", code: "gate_rejected" },
  { eventType: "loop_worktree_promotion_push_preflight_refused", category: "human", code: "gate_rejected" },
  { eventType: "loop_worktree_promotion_push_execute_refused", category: "human", code: "gate_rejected" },
  { eventType: "loop_worktree_promotion_pr_create_prep_refused", category: "human", code: "gate_rejected" },
  { eventType: "loop_worktree_promotion_pr_create_execute_refused", category: "human", code: "gate_rejected" },
  { eventType: "loop_worktree_promotion_pr_merge_prep_refused", category: "human", code: "gate_rejected" },
  { eventType: "loop_worktree_promotion_pr_merge_execute_refused", category: "human", code: "gate_rejected" },
];

// --- Invocation round telemetry (Epic #805, Phase 1 / #806) --------------
// Runtime mirror of packages/protocol/src/round-telemetry.ts. Design of record:
// docs/engineering/INVOCATION_ROUND_TELEMETRY_ISSUE_PLAN.md. A round is one model
// turn. Phase 1 is taxonomy only — no records are written yet.

export const roundStatuses = ["started", "succeeded", "failed", "cancelled"];

export const roundKinds = ["model_turn"];

export const toolInvocationStatuses = ["started", "succeeded", "failed"];

// How an aggregate AIUsageRecord's tokens were obtained; `rounds` is authoritative.
export const aiUsageDerivations = ["rounds", "client_reported", "import"];

// `tool_invocation_created` already exists in InvocationEventType (unbacked until
// this model); round_started / round_completed are added alongside it.
export const roundTelemetryEventTypes = [
  "round_started",
  "round_completed",
  "tool_invocation_created",
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
  runRefusalTaxonomyCheck();
  runRoundTelemetryCheck();
  runWorkProfileCheck();
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

function runRefusalTaxonomyCheck() {
  // The closed enum must contain the codes the design (docs/vision/REFUSAL_MODEL.md)
  // pins. A code being dropped is a protocol break, not a refactor.
  const requiredRefusalCodes = [
    "capability_not_granted",
    "command_not_allowlisted",
    "cwd_outside_approved_root",
    "file_policy_exceeded",
    "network_policy_exceeded",
    "action_not_permitted",
    "subject_not_actionable",
    "over_budget",
    "over_quota",
    "undeliverable",
    "approval_denied",
    "deliverable_rejected",
    "gate_rejected",
  ];
  assertIncludes(refusalCodes, requiredRefusalCodes, "refusal code");
  assertIncludes(refusalCategories, ["not_granted", "policy", "state", "human"], "refusal category");

  // Every code belongs to exactly one category, and the partition covers the enum.
  const seen = new Set();
  for (const category of refusalCategories) {
    const codes = refusalCodesByCategory[category];
    if (!Array.isArray(codes)) {
      throw new Error(`Missing refusal category in map: ${category}`);
    }
    for (const code of codes) {
      if (!refusalCodes.includes(code)) {
        throw new Error(`refusalCodesByCategory has unknown code: ${code}`);
      }
      if (seen.has(code)) {
        throw new Error(`refusal code in more than one category: ${code}`);
      }
      seen.add(code);
    }
  }
  for (const code of refusalCodes) {
    if (!seen.has(code)) {
      throw new Error(`refusal code not assigned to a category: ${code}`);
    }
  }

  // Every catalog entry uses a code from the closed enum, and its category
  // agrees with the map. A typo here is a taxonomy break.
  for (const entry of refusalEventCatalog) {
    if (!refusalCodes.includes(entry.code)) {
      throw new Error(`refusalEventCatalog uses unknown code: ${entry.code} (${entry.eventType})`);
    }
    if (!refusalCodesByCategory[entry.category]?.includes(entry.code)) {
      throw new Error(
        `refusalEventCatalog category/code mismatch: ${entry.eventType} → ${entry.category}/${entry.code}`,
      );
    }
  }

  // Completeness: every loop refusal event in the protocol vocabulary
  // (`*_refused` / `*_blocked`) must be mapped. A newly-added loop refusal fails
  // here until it is added to the catalog and the design table.
  const mappedEventTypes = new Set(refusalEventCatalog.map((e) => e.eventType));
  for (const eventType of loopEventTypes) {
    if (/_refused$/.test(eventType) || /_blocked$/.test(eventType)) {
      if (!mappedEventTypes.has(eventType)) {
        throw new Error(`Unmapped loop refusal event: ${eventType}`);
      }
    }
  }
}

function runRoundTelemetryCheck() {
  // The taxonomies the design (docs/engineering/INVOCATION_ROUND_TELEMETRY_ISSUE_PLAN.md)
  // pins. Dropping a member is a protocol break, not a refactor.
  assertIncludes(roundStatuses, ["started", "succeeded", "failed", "cancelled"], "round status");
  assertIncludes(roundKinds, ["model_turn"], "round kind");
  assertIncludes(toolInvocationStatuses, ["started", "succeeded", "failed"], "tool invocation status");
  assertIncludes(aiUsageDerivations, ["rounds", "client_reported", "import"], "AI usage derivation");
  assertIncludes(
    roundTelemetryEventTypes,
    ["round_started", "round_completed", "tool_invocation_created"],
    "round telemetry event type",
  );
  // A round's terminal states are a subset of the four; `started` is the only
  // non-terminal. Guard against a stray tool status leaking in.
  for (const status of toolInvocationStatuses) {
    if (!roundStatuses.includes(status)) {
      throw new Error(`tool invocation status not a valid round status: ${status}`);
    }
  }
}

function runWorkProfileCheck() {
  assertIncludes(
    workProfileInferenceKinds,
    ["category", "recurring_activity", "document_pattern", "preferred_output"],
    "work profile inference kind",
  );
  assertIncludes(
    workProfileConfidenceLevels,
    ["low", "medium", "high"],
    "work profile confidence level",
  );
  assertIncludes(
    workProfileEvidenceSourceKinds,
    ["explicit_user_input", "invocation", "document", "project", "routine"],
    "work profile evidence source kind",
  );
  assertIncludes(
    workProfileAuthorizationPermissions,
    ["read", "update", "use_for_personalization"],
    "work profile authorization permission",
  );
}

function assertIncludes(actual, required, label) {
  for (const value of required) {
    if (!actual.includes(value)) {
      throw new Error(`Missing M0 ${label}: ${value}`);
    }
  }
}
