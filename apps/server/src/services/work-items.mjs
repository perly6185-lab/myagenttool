/*
 * Local-first work items. These records deliberately live beside, rather than
 * inside, repository Projects: a repository is an execution boundary while a
 * work item is planning data that may later bind to GitHub or another tracker.
 */

import { createHash } from "node:crypto";
import { businessRoutineSchemaVersion, normalizeLocalIssueRoutineBinding } from "@myagenttool/protocol/business-routine";
import { normalizeTaskRecordBinding } from "@myagenttool/protocol/task-resources";
import { actorCanAccessProject, findUser, LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { listDevices } from "../runtime/device.mjs";
import { homeWorkbenchReadModel } from "../read-models/home-workbench.mjs";
import { backfillTerminalOwnership } from "../runtime/terminal-ownership.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { normalizedUpdatedSince, paginateRows } from "./cursor-pagination.mjs";
import { externalIssueProviderReadiness } from "./external-issue-provider.mjs";
import { ASSET_CAPABILITY_VERBS, evaluateAssetRequirements } from "./asset-capabilities.mjs";
import { createApplicationExecutionContract } from "./application-execution-contract.mjs";
import { routineIdempotencyKeys } from "./business-routines.mjs";
import {
  WORK_ITEM_FOLLOW_UP_MUTABLE_FIELDS,
  WORK_ITEM_FOLLOW_UP_SERVER_FIELDS,
  normalizeWorkItemFollowUpInput,
  workItemFollowUpContextView,
} from "./work-item-follow-up.mjs";
import { createWorkItemReportDraftService } from "./work-item-report-drafts.mjs";
import { createWorkItemFollowUpReminderService } from "./work-item-follow-up-reminders.mjs";
import { resolveWorkItemExecution } from "./work-item-execution.mjs";
import { projectWorkItemOutcome } from "./work-item-outcome.mjs";
import {
  compactMatchText,
  definitionTemplateContract,
  evaluateMyTemplateGovernance,
  latestMyTemplateGovernanceIntervention,
  learnedTemplateOutput,
  matchPublishedMyTemplate,
  templateRoutingTerms,
  textSimilarity,
} from "./work-item-template-matching.mjs";
import { defaultVerificationSop, extractAcceptanceCriteriaFromBody } from "./work-item-verification.mjs";
import { normalizeRuntimeDataPlan } from "./data-plan-contract.mjs";
import { normalizeDataRelationPreview } from "./data-relation-preview.mjs";
import { normalizeDataMutationPreview } from "./data-mutation-contract.mjs";
import { normalizeWorkModeSnapshot } from "./work-mode-runtime.mjs";
import { normalizeChannelExecutionStrategy } from "./channel-execution-strategy.mjs";
import { normalizeChannelOperationIntent } from "./channel-operation-intent.mjs";
import { normalizeChannelDataOperationPreview } from "./channel-data-operation-preview.mjs";
import { draftSyncCapabilityReadiness, publicationCapabilityReadiness } from "./publication-readiness.mjs";
import { artifactDependencyReadiness, propagateCompletedWorkGoalTask, validatedArtifactTransfer } from "./work-goal-artifacts.mjs";
import { buildWorkGoalUserSummary } from "./work-goal-user-summary.mjs";
import { resultVerificationContract, verifyWorkItemResult } from "./work-item-result-verification.mjs";
import { deriveWorkItemOutputMetricsForAssets } from "./work-item-output-metrics.mjs";
import { planDiscreteTasks } from "./discrete-task-planner.mjs";
import { validateTaskPlan } from "./task-plan-contract.mjs";
import { taskPlanCapabilityReadiness } from "./task-capability-readiness.mjs";
import { applyResultRepairSpec, buildResultRepairTaskSpec } from "./result-repair-task.mjs";
import { projectWorkItemReviewEvidence } from "./work-item-review-evidence.mjs";
import { normalizeExecutionStartFailure, projectExecutionStartReceipt } from "./work-item-execution-start.mjs";
import { projectWorkItemExecutionReview } from "./work-item-execution-review.mjs";
import { projectWorkItemPlanActual } from "./work-item-plan-actual.mjs";
import { assessWorkItemCompletion, taskCompletionQualityMetrics } from "./work-item-completion-assessment.mjs";
import { projectWorkItemContextSummary } from "./work-item-context-summary.mjs";
import { buildWorkItemIntentContract, freezeWorkItemIntentContract } from "./work-item-intent-contract.mjs";

export { evaluateMyTemplateGovernance, matchPublishedMyTemplate } from "./work-item-template-matching.mjs";
export { defaultVerificationSop, extractAcceptanceCriteriaFromBody } from "./work-item-verification.mjs";

const TYPES = new Set(["task", "bug", "feature", "initiative"]);
const STATUSES = new Set(["backlog", "ready", "in_progress", "review", "blocked", "done"]);
const PRIORITIES = new Set(["p0", "p1", "p2", "p3"]);
const EXECUTION_POLICIES = new Set(["inherit", "auto", "manual", "paused"]);
const TASK_CREATION_BASES = new Set([
  "explicit_user_intent",
  "channel_ingest_rule",
  "saved_automation",
  "required_guard",
  "imported",
]);
const ARTIFACT_KINDS_RE = /^[a-z][a-z0-9_]{0,63}$/;
const CHANNEL_TASK_DOMAINS = new Set(["general", "office", "development", "design", "product_design", "creative", "content"]);
const CHANNEL_TASK_RISK_LEVELS = new Set(["low", "local_change", "external_communication", "financial", "destructive"]);
const DATA_CONTEXT_SNAPSHOT_SCHEMA_VERSION = 2;
// Friendly aliases normalized to canonical p0–p3 before validation, so callers
// may pass "critical"/"high"/"medium"/"low" etc. (mirrors the alias→canonical
// pattern in normalizeClaudePermissionMode). Invalid values still reject.
const PRIORITY_ALIASES = { critical: "p0", urgent: "p0", high: "p1", medium: "p2", normal: "p2", low: "p3" };
function normalizePriority(value) {
  const candidate = String(value ?? "").toLowerCase().trim();
  return PRIORITY_ALIASES[candidate] ?? candidate;
}

function normalizeArtifactContract(input) {
  if (input == null) return { consumes: [], produces: [] };
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const normalizeKinds = (value) => {
    if (!Array.isArray(value) || value.length > 20) return null;
    const kinds = [...new Set(value.map((entry) => String(entry ?? "").trim().toLowerCase()))];
    return kinds.every((kind) => ARTIFACT_KINDS_RE.test(kind)) ? kinds : null;
  };
  const consumes = normalizeKinds(input.consumes ?? []);
  const produces = normalizeKinds(input.produces ?? []);
  if (!consumes || !produces) return null;
  const rawRequirements = input.requirements ?? [];
  if (!Array.isArray(rawRequirements) || rawRequirements.length > 20) return null;
  const requirements = [];
  const normalizeQuality = (quality) => {
    if (quality == null) return null;
    if (!quality || typeof quality !== "object" || Array.isArray(quality)) return undefined;
    const normalized = {};
    const integerFields = [
      "minChars", "maxChars", "minSections", "maxSections", "minPages", "maxPages",
      "minWidth", "maxWidth", "minHeight", "maxHeight",
    ];
    const numberFields = ["minDurationSeconds", "maxDurationSeconds"];
    for (const field of integerFields) {
      if (!Object.hasOwn(quality, field)) continue;
      const value = Number(quality[field]);
      if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000) return undefined;
      normalized[field] = value;
    }
    for (const field of numberFields) {
      if (!Object.hasOwn(quality, field)) continue;
      const value = Number(quality[field]);
      if (!Number.isFinite(value) || value < 0 || value > 10_000_000) return undefined;
      normalized[field] = value;
    }
    if (Object.hasOwn(quality, "requiredHeadings")) {
      if (!Array.isArray(quality.requiredHeadings) || quality.requiredHeadings.length > 30) return undefined;
      const headings = [...new Set(quality.requiredHeadings.map((value) => String(value).trim()).filter(Boolean))];
      if (headings.some((value) => value.length > 200)) return undefined;
      normalized.requiredHeadings = headings;
    }
    if (Object.keys(normalized).length === 0) return undefined;
    if (normalized.minChars != null && normalized.maxChars != null && normalized.minChars > normalized.maxChars) return undefined;
    if (normalized.minSections != null && normalized.maxSections != null && normalized.minSections > normalized.maxSections) return undefined;
    if (normalized.minPages != null && normalized.maxPages != null && normalized.minPages > normalized.maxPages) return undefined;
    if (normalized.minDurationSeconds != null && normalized.maxDurationSeconds != null && normalized.minDurationSeconds > normalized.maxDurationSeconds) return undefined;
    if (normalized.minWidth != null && normalized.maxWidth != null && normalized.minWidth > normalized.maxWidth) return undefined;
    if (normalized.minHeight != null && normalized.maxHeight != null && normalized.minHeight > normalized.maxHeight) return undefined;
    return normalized;
  };
  for (const value of rawRequirements) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const kind = String(value.kind ?? "").trim().toLowerCase();
    const minCount = Number(value.minCount ?? 1);
    if (!Array.isArray(value.extensions ?? []) || !Array.isArray(value.families ?? [])) return null;
    const extensions = [...new Set((value.extensions ?? []).map((entry) => String(entry ?? "").trim().toLowerCase()))];
    const families = [...new Set((value.families ?? []).map((entry) => String(entry ?? "").trim().toLowerCase()))];
    const quality = normalizeQuality(value.quality);
    if (!ARTIFACT_KINDS_RE.test(kind) || !produces.includes(kind)
      || !Number.isInteger(minCount) || minCount < 1 || minCount > 100
      || extensions.length > 20
      || !extensions.every((extension) => /^\.[a-z0-9]{1,10}$/.test(extension))
      || families.length > 10
      || !families.every((family) => ARTIFACT_KINDS_RE.test(family)) || quality === undefined) return null;
    requirements.push({ kind, minCount, ...(extensions.length ? { extensions } : {}), ...(families.length ? { families } : {}), ...(quality ? { quality } : {}) });
  }
  const verification = input.verification;
  let normalizedVerification = null;
  if (verification != null) {
    if (!verification || typeof verification !== "object" || Array.isArray(verification)
      || !Array.isArray(verification.requiredKinds) || verification.requiredKinds.length > 10) return null;
    const allowedKinds = new Set(["test", "build", "lint", "typecheck", "manual", "review"]);
    const requiredKinds = [...new Set(verification.requiredKinds.map((value) => String(value).trim().toLowerCase()))];
    if (!requiredKinds.length || requiredKinds.some((kind) => !allowedKinds.has(kind))) return null;
    normalizedVerification = { requiredKinds };
  }
  return {
    consumes,
    produces,
    ...(requirements.length ? { requirements } : {}),
    ...(normalizedVerification ? { verification: normalizedVerification } : {}),
  };
}

function normalizePlatformTarget(input) {
  if (input == null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const id = String(input.id ?? "").trim().toLowerCase();
  const label = String(input.label ?? "").trim();
  if (!ARTIFACT_KINDS_RE.test(id) || !label || label.length > 80) return undefined;
  return { id, label };
}
const MAX_TITLE = 300;
const MAX_BODY = 200_000;
const MAX_LABELS = 50;
const MAX_COMMENT = 100_000;
const MAX_MILESTONE = 200;
const ROUTINE_BINDING_FIELDS = [
  "routineDefinitionId",
  "routineVersion",
  "businessCaseId",
  "businessKey",
  "triggerArtifactIds",
];
const GITHUB_SYNC_FIELDS = ["title", "body", "state", "labels", "milestone", "assigneeIds"];
const EXTERNAL_RELATIONS = new Set(["source", "related", "duplicate", "parent", "blocks"]);
const EXTERNAL_SYNC_POLICIES = new Set(["manual", "webhook_pull", "bidirectional"]);
const VERIFICATION_KINDS = new Set(["test", "build", "lint", "typecheck", "manual", "review"]);
const VERIFICATION_STATUSES = new Set(["passed", "failed"]);
const EXECUTION_OPERATION_TTL_MS = 30 * 60_000;
const ACTIVE_AUTO_RUN_STATUSES = new Set([
  "materializing", "running", "waiting_capacity", "awaiting_approval", "verifying", "publishing",
  "pr_open", "report_posted", "needs_input", "plan_proposed",
]);
const SCHEDULABLE_RUNTIME_STATES = new Set([
  "materializing", "running", "waiting_capacity", "verifying", "publishing", "decomposed",
]);

export function taskTraceStage(type, source = "issue") {
  const value = String(type ?? "").toLowerCase();
  if (value === "created" || value === "invocation_created") return "creation";
  if (value.includes("route") || value.includes("auto_run_started") || value.includes("worktree_created")) return "routing";
  if (value.includes("queue") || value.includes("claim")) return "queue";
  if (value.includes("approval")) return "approval";
  if (value.includes("tool_invocation") || value.includes("asset_operation") || value.includes("round_")) return "tool";
  if (value.includes("verif") || value.includes("review") || value.includes("evidence")) return "verification";
  if (value.includes("retry") || value.includes("recover") || value.includes("repair")) return "retry";
  if (value.includes("complete") || value.includes("done") || value.includes("merged") || value.includes("closed")) return "completion";
  if (source === "execution" || value.includes("run") || value.includes("invocation")) return "execution";
  return "other";
}

function normalizeApplicationResolution(value, terminalId) {
  if (!value || typeof value !== "object" || value.terminalId !== terminalId) return null;
  const state = ["ready", "waiting_capability", "waiting_approval", "waiting_capacity", "refusal"].includes(value.state)
    ? value.state
    : null;
  if (!state) return null;
  return {
    state,
    terminalId,
    applicationId: value.capability?.applicationId ? String(value.capability.applicationId).slice(0, 200) : null,
    label: value.capability?.displayName ? String(value.capability.displayName).replace(/[\r\n\t]/g, " ").slice(0, 120) : null,
    reason: String(value.reason ?? "").replace(/[\r\n\t]/g, " ").slice(0, 200),
    durationMs: Number.isFinite(value.telemetry?.durationMs) ? Math.max(0, Math.min(60_000, value.telemetry.durationMs)) : null,
  };
}

function aggregateApplicationReadiness(resolutions, assetReadiness) {
  if (assetReadiness?.state !== "ready") return assetReadiness;
  const rows = Array.isArray(resolutions) ? resolutions : [];
  for (const state of ["refusal", "waiting_capability", "waiting_capacity", "waiting_approval"]) {
    const match = rows.find((resolution) => resolution?.state === state);
    if (match) return { state, reason: match.reason, terminalId: match.terminalId, capability: match.capability ?? null };
  }
  return { state: "ready", reason: rows.length ? "application_requirements_satisfied" : "no_application_required", terminalId: assetReadiness?.terminalId ?? null };
}

export const backfillWorkItemTerminalOwnership = backfillTerminalOwnership;

function strings(values, { limit = MAX_LABELS, maxLength = 100 } = {}) {
  if (!Array.isArray(values)) return null;
  const normalized = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  if (normalized.length > limit || normalized.some((value) => value.length > maxLength)) return null;
  return normalized;
}

function validDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function normalizeIsoDateTime(value) {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || value.length > 50
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
    || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return { ok: false };
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? { ok: true, value: new Date(parsed).toISOString() }
    : { ok: false };
}

function validateDraft(input, { partial = false } = {}) {
  const value = {};
  if (WORK_ITEM_FOLLOW_UP_SERVER_FIELDS.some((field) => Object.hasOwn(input, field))) {
    return { error: "work_item_follow_up_server_fields_immutable" };
  }
  if (!partial || Object.hasOwn(input, "title")) {
    const title = String(input.title ?? "").trim();
    if (!title || title.length > MAX_TITLE) return { error: "invalid_work_item_title" };
    value.title = title;
  }
  if (!partial || Object.hasOwn(input, "body")) {
    const body = String(input.body ?? "");
    if (body.length > MAX_BODY) return { error: "work_item_body_too_large" };
    value.body = body;
  }
  for (const [field, allowed, fallback] of [
    ["type", TYPES, "task"],
    ["status", STATUSES, "backlog"],
    ["priority", PRIORITIES, "p2"],
    ["executionPolicy", EXECUTION_POLICIES, "inherit"],
  ]) {
    if (!partial || Object.hasOwn(input, field)) {
      const candidate = field === "priority"
        ? normalizePriority(input[field] ?? fallback)
        : String(input[field] ?? fallback);
      if (!allowed.has(candidate)) {
        return { error: `invalid_work_item_${field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}` };
      }
      value[field] = candidate;
    }
  }
  for (const field of ["labels", "assigneeIds"]) {
    if (!partial || Object.hasOwn(input, field)) {
      const normalized = strings(input[field] ?? []);
      if (!normalized) return { error: `invalid_work_item_${field}` };
      value[field] = normalized;
    }
  }
  if (!partial || Object.hasOwn(input, "acceptanceCriteria")) {
    const acceptanceCriteria = strings(input.acceptanceCriteria ?? [], { limit: 100, maxLength: 2_000 });
    if (!acceptanceCriteria) return { error: "invalid_work_item_acceptance_criteria" };
    value.acceptanceCriteria = acceptanceCriteria;
  }
  if (!partial || Object.hasOwn(input, "verificationSop")) {
    const verificationSop = strings(input.verificationSop ?? [], { limit: 30, maxLength: 2_000 });
    if (!verificationSop) return { error: "invalid_work_item_verification_sop" };
    value.verificationSop = verificationSop;
  }
  if (!partial || Object.hasOwn(input, "dueDate")) {
    const dueDate = input.dueDate == null || input.dueDate === "" ? null : String(input.dueDate);
    if (dueDate && !validDateOnly(dueDate)) return { error: "invalid_work_item_due_date" };
    value.dueDate = dueDate;
  }
  if (!partial || Object.hasOwn(input, "notBefore")) {
    const notBefore = normalizeIsoDateTime(input.notBefore);
    if (!notBefore.ok) return { error: "invalid_work_item_not_before" };
    value.notBefore = notBefore.value;
  }
  for (const field of ["plannedDate", "carriedFromDate"]) {
    if (!partial || Object.hasOwn(input, field)) {
      const date = input[field] == null || input[field] === "" ? null : String(input[field]);
      if (date && !validDateOnly(date)) return { error: `invalid_work_item_${field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}` };
      value[field] = date;
    }
  }
  if (!partial || Object.hasOwn(input, "milestone")) {
    const milestone = input.milestone == null ? "" : String(input.milestone).trim();
    if (milestone.length > MAX_MILESTONE) return { error: "invalid_work_item_milestone" };
    value.milestone = milestone;
  }
  if (!partial || Object.hasOwn(input, "estimatePoints")) {
    const estimatePoints = input.estimatePoints == null || input.estimatePoints === "" ? 0 : Number(input.estimatePoints);
    if (!Number.isInteger(estimatePoints) || estimatePoints < 0 || estimatePoints > 1_000) {
      return { error: "invalid_work_item_estimate_points" };
    }
    value.estimatePoints = estimatePoints;
  }
  if (!partial || Object.hasOwn(input, "inputAssets")) {
    const assets = normalizeAssetRefs(input.inputAssets ?? []);
    if (!assets) return { error: "invalid_work_item_input_assets" };
    value.inputAssets = assets;
  }
  if (!partial || Object.hasOwn(input, "recordBindings")) {
    const rawBindings = Object.hasOwn(input, "recordBindings") ? input.recordBindings : [];
    if (!Array.isArray(rawBindings) || rawBindings.length > 50) {
      return { error: "invalid_work_item_record_bindings" };
    }
    const bindings = [];
    const bindingIds = new Set();
    let primaryLedgerCount = 0;
    for (const candidate of rawBindings) {
      const normalized = normalizeTaskRecordBinding(candidate);
      if (!normalized.ok) return { error: normalized.error };
      if (bindingIds.has(normalized.value.id)) return { error: "duplicate_work_item_record_binding" };
      bindingIds.add(normalized.value.id);
      if (normalized.value.direction === "output" && normalized.value.role === "primary_ledger") {
        primaryLedgerCount += 1;
      }
      bindings.push(normalized.value);
    }
    if (primaryLedgerCount > 1) return { error: "multiple_primary_work_item_ledgers" };
    value.recordBindings = bindings;
  }
  if (!partial || Object.hasOwn(input, "requiredCapabilities")) {
    const capabilities = strings(input.requiredCapabilities ?? [], { limit: 20, maxLength: 40 });
    if (!capabilities || capabilities.some((verb) => !ASSET_CAPABILITY_VERBS.includes(verb))) {
      return { error: "invalid_work_item_required_capabilities" };
    }
    value.requiredCapabilities = capabilities;
  }
  if (Object.hasOwn(input, "channelTaskContract")) {
    const contract = normalizeChannelTaskContract(input.channelTaskContract);
    if (!contract.ok) return { error: contract.error };
    value.channelTaskContract = contract.value;
  }
  if (!partial || Object.hasOwn(input, "outputAssets")) {
    const assets = normalizeAssetRefs(input.outputAssets ?? []);
    if (!assets) return { error: "invalid_work_item_output_assets" };
    value.outputAssets = assets;
  }
  const intentFields = ["intentId", "intentStatement", "taskKind", "creationBasis", "planningHorizon", "workGoalId", "artifactContract", "platformTarget"];
  if (partial && intentFields.some((field) => Object.hasOwn(input, field))) {
    return { error: "work_item_intent_fields_immutable" };
  }
  if (!partial) {
    const intentId = input.intentId == null || input.intentId === "" ? null : String(input.intentId).trim();
    const intentStatement = input.intentStatement == null ? "" : String(input.intentStatement).trim();
    const taskKind = String(input.taskKind ?? "general").trim().toLowerCase();
    const creationBasis = String(input.creationBasis ?? "explicit_user_intent").trim();
    const planningHorizon = String(input.planningHorizon ?? "committed").trim();
    const workGoalId = input.workGoalId == null || input.workGoalId === "" ? null : String(input.workGoalId).trim();
    const artifactContract = normalizeArtifactContract(input.artifactContract);
    const platformTarget = normalizePlatformTarget(input.platformTarget);
    if (intentId && (!/^[A-Za-z0-9:_-]{1,200}$/.test(intentId) || !intentStatement)) {
      return { error: "invalid_work_item_intent" };
    }
    if (intentStatement.length > 4_000) return { error: "invalid_work_item_intent_statement" };
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(taskKind)) return { error: "invalid_work_item_task_kind" };
    if (!TASK_CREATION_BASES.has(creationBasis)) return { error: "invalid_work_item_creation_basis" };
    if (workGoalId && !/^[A-Za-z0-9:_-]{1,200}$/.test(workGoalId)) return { error: "invalid_work_item_goal" };
    if (!artifactContract) return { error: "invalid_work_item_artifact_contract" };
    if (platformTarget === undefined) return { error: "invalid_work_item_platform_target" };
    // A suggestion is not a task. Only a committed user/rule decision may be
    // persisted as a WorkItem; possible next steps live outside this model.
    if (planningHorizon !== "committed") return { error: "invalid_work_item_planning_horizon" };
    value.intentId = intentId;
    value.intentStatement = intentStatement;
    value.taskKind = taskKind;
    value.creationBasis = creationBasis;
    value.planningHorizon = planningHorizon;
    value.workGoalId = workGoalId;
    value.artifactContract = artifactContract;
    value.platformTarget = platformTarget;
    value.resultVerificationContract = resultVerificationContract({ taskKind, artifactContract }, { enforced: false });
  }
  const followUp = normalizeWorkItemFollowUpInput(input, { partial });
  if (followUp.error) return followUp;
  Object.assign(value, followUp.value);
  const hasRoutineBinding = Object.hasOwn(input, "routineBinding")
    || ROUTINE_BINDING_FIELDS.some((field) => Object.hasOwn(input, field));
  if (hasRoutineBinding) {
    if (partial) return { error: "work_item_routine_binding_immutable" };
    const candidate = input.routineBinding ?? Object.fromEntries(
      ROUTINE_BINDING_FIELDS.map((field) => [field, input[field]]),
    );
    const normalized = normalizeLocalIssueRoutineBinding(candidate);
    if (!normalized.ok || !normalized.value) {
      return { error: normalized.error ?? "invalid_work_item_routine_binding" };
    }
    const { schemaVersion, ...binding } = normalized.value;
    Object.assign(value, binding, { routineBindingSchemaVersion: schemaVersion });
  }
  if (Object.hasOwn(input, "myTemplateBinding")) {
    const binding = input.myTemplateBinding;
    const definitionId = String(binding?.definitionId ?? "").trim();
    const familyId = String(binding?.familyId ?? "").trim();
    const version = Number(binding?.version);
    const matchReasons = strings(binding?.matchReasons ?? [], { limit: 10, maxLength: 500 });
    if (!definitionId || !familyId || !Number.isInteger(version) || version < 1 || !matchReasons) {
      return { error: "invalid_work_item_my_template_binding" };
    }
    value.myTemplateBinding = {
      definitionId, familyId, version, matchReasons,
      userConfirmedResult: binding?.userConfirmedResult === true,
    };
  }
  return { value };
}

function normalizeChannelTaskContract(input) {
  if (input == null) return { ok: true, value: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "invalid_channel_task_contract" };
  }
  const domain = String(input.domain ?? "general").trim().toLowerCase();
  const riskLevel = String(input.riskLevel ?? "low").trim().toLowerCase();
  if (!CHANNEL_TASK_DOMAINS.has(domain)) return { ok: false, error: "invalid_channel_task_domain" };
  if (!CHANNEL_TASK_RISK_LEVELS.has(riskLevel)) return { ok: false, error: "invalid_channel_task_risk_level" };
  const boundedText = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  const sources = Array.isArray(input.dataSources) ? input.dataSources.slice(0, 100).map((source) => ({
    kind: boundedText(source?.kind, 80) || "unknown",
    id: boundedText(source?.id, 200) || null,
    name: boundedText(source?.name, 300) || null,
    version: boundedText(source?.version, 200) || null,
    hash: boundedText(source?.hash, 200) || null,
  })) : [];
  const templateMatch = input.templateMatch && typeof input.templateMatch === "object"
    ? {
      state: boundedText(input.templateMatch.state, 40) || "missing",
      decision: boundedText(input.templateMatch.decision, 80) || null,
      definitionId: boundedText(input.templateMatch.definitionId, 200) || null,
      familyId: boundedText(input.templateMatch.familyId, 200) || null,
      version: Number.isInteger(Number(input.templateMatch.version)) ? Number(input.templateMatch.version) : null,
      reasons: Array.isArray(input.templateMatch.reasons)
        ? input.templateMatch.reasons.slice(0, 10).map((reason) => boundedText(reason, 500)).filter(Boolean)
        : [],
    }
    : null;
  const executionPreview = input.executionPreview && typeof input.executionPreview === "object"
    ? {
      schemaVersion: 1,
      action: boundedText(input.executionPreview.action, 200) || "任务处理",
      target: boundedText(input.executionPreview.target, 300) || "尚未明确",
      targetStatus: ["explicit", "inferred", "unknown"].includes(input.executionPreview.targetStatus)
        ? input.executionPreview.targetStatus
        : "unknown",
      amount: boundedText(input.executionPreview.amount, 100) || null,
      scope: boundedText(input.executionPreview.scope, 500) || null,
      inputs: Array.isArray(input.executionPreview.inputs)
        ? input.executionPreview.inputs.slice(0, 20).map((asset) => ({
          name: boundedText(asset?.name, 300) || "附件",
          family: boundedText(asset?.family, 80) || "file",
        }))
        : [],
      impact: boundedText(input.executionPreview.impact, 300) || "任务处理可能产生变更",
      unknownFields: Array.isArray(input.executionPreview.unknownFields)
        ? input.executionPreview.unknownFields.slice(0, 10).map((field) => boundedText(field, 200)).filter(Boolean)
        : [],
      requiredFields: Array.isArray(input.executionPreview.requiredFields)
        ? input.executionPreview.requiredFields.slice(0, 10).map((field) => boundedText(field, 200)).filter(Boolean)
        : [],
      previewReady: input.executionPreview.previewReady === true,
      digest: boundedText(input.executionPreview.digest, 128) || null,
    }
    : null;
  const objectValidation = input.objectValidation && typeof input.objectValidation === "object"
    ? {
      schemaVersion: 1,
      state: ["verified", "not_found", "ambiguous", "stale", "forbidden"].includes(input.objectValidation.state)
        ? input.objectValidation.state
        : "not_found",
      verifiedObjects: Array.isArray(input.objectValidation.verifiedObjects)
        ? input.objectValidation.verifiedObjects.slice(0, 20).map((object) => ({
          kind: boundedText(object?.kind, 60) || "unknown",
          id: boundedText(object?.id, 200) || null,
          label: boundedText(object?.label, 300) || null,
          projectId: boundedText(object?.projectId, 200) || null,
          sourceId: boundedText(object?.sourceId, 200) || null,
          revision: Number.isInteger(Number(object?.revision)) ? Number(object.revision) : null,
          fingerprint: boundedText(object?.fingerprint, 200) || null,
          metadata: object?.metadata && typeof object.metadata === "object"
            ? Object.fromEntries(Object.entries(object.metadata).slice(0, 10).map(([key, value]) => [
              boundedText(key, 80), boundedText(value, 160),
            ]).filter(([key, value]) => key && value))
            : {},
        }))
        : [],
      snapshot: Array.isArray(input.objectValidation.snapshot)
        ? input.objectValidation.snapshot.slice(0, 20).map((object) => ({
          kind: boundedText(object?.kind, 60) || "unknown",
          id: boundedText(object?.id, 200) || null,
          revision: Number.isInteger(Number(object?.revision)) ? Number(object.revision) : null,
          fingerprint: boundedText(object?.fingerprint, 200) || null,
        }))
        : [],
      requiredFields: Array.isArray(input.objectValidation.requiredFields)
        ? input.objectValidation.requiredFields.slice(0, 10).map((field) => boundedText(field, 200)).filter(Boolean)
        : [],
      digest: boundedText(input.objectValidation.digest, 128) || null,
    }
    : null;
  const dataPlan = normalizeRuntimeDataPlan(input.dataPlan);
  const dataOperationPreview = normalizeChannelDataOperationPreview(input.dataOperationPreview);
  const fileDiscoveries = Array.isArray(input.fileDiscoveries)
    ? input.fileDiscoveries.slice(0, 20).map((discovery) => ({
      status: ["ready", "stale", "unsupported", "unavailable", "forbidden"].includes(discovery?.status)
        ? discovery.status : "unavailable",
      assetId: boundedText(discovery?.assetId, 200) || null,
      fileName: boundedText(discovery?.fileName, 300) || "本地文件",
      format: boundedText(discovery?.format, 12) || null,
      contentHash: boundedText(discovery?.contentHash, 80) || null,
      rowCount: Number.isInteger(Number(discovery?.rowCount)) ? Math.max(0, Math.min(5_000, Number(discovery.rowCount))) : null,
      columnCount: Number.isInteger(Number(discovery?.columnCount)) ? Math.max(0, Math.min(100, Number(discovery.columnCount))) : null,
      recognizedFields: Array.isArray(discovery?.recognizedFields)
        ? discovery.recognizedFields.slice(0, 40).map((field) => boundedText(field, 80)).filter(Boolean)
        : [],
      keyCandidates: Array.isArray(discovery?.keyCandidates)
        ? discovery.keyCandidates.slice(0, 20).map((key) => ({
          name: boundedText(key?.name, 160) || null,
          field: boundedText(key?.field, 80) || null,
        })).filter((key) => key.name)
        : [],
      likelyKinds: Array.isArray(discovery?.likelyKinds)
        ? discovery.likelyKinds.slice(0, 10).map((kind) => boundedText(kind, 80)).filter(Boolean)
        : [],
      readOnly: true,
      reason: boundedText(discovery?.reason, 120) || null,
    }))
    : [];
  const dataRelationPreview = normalizeDataRelationPreview(input.dataRelationPreview);
  const dataMutationPreview = normalizeDataMutationPreview(input.dataMutationPreview);
  const workMode = normalizeWorkModeSnapshot(input.workMode);
  const executionStrategy = normalizeChannelExecutionStrategy(input.executionStrategy);
  const operationIntent = normalizeChannelOperationIntent(input.operationIntent);
  const dataMutationBinding = input.dataMutationBinding && typeof input.dataMutationBinding === "object"
    ? {
      schemaVersion: 1,
      id: boundedText(input.dataMutationBinding.id, 200) || null,
      projectId: boundedText(input.dataMutationBinding.projectId, 200) || null,
      fileSourceId: boundedText(input.dataMutationBinding.fileSourceId, 200) || null,
      ledgerDefinitionId: boundedText(input.dataMutationBinding.ledgerDefinitionId, 200) || null,
      fileName: boundedText(input.dataMutationBinding.fileName, 300) || null,
      format: boundedText(input.dataMutationBinding.format, 20) || null,
      fileSourceRevision: Number.isInteger(Number(input.dataMutationBinding.fileSourceRevision))
        ? Number(input.dataMutationBinding.fileSourceRevision) : null,
      ledgerDefinitionRevision: Number.isInteger(Number(input.dataMutationBinding.ledgerDefinitionRevision))
        ? Number(input.dataMutationBinding.ledgerDefinitionRevision) : null,
      stale: input.dataMutationBinding.stale === true,
    }
    : null;
  const dataMutationBindings = Array.isArray(input.dataMutationBindings)
    ? input.dataMutationBindings.slice(0, 20).map((binding) => ({
      schemaVersion: 1,
      id: boundedText(binding?.id, 200) || null,
      projectId: boundedText(binding?.projectId, 200) || null,
      fileSourceId: boundedText(binding?.fileSourceId, 200) || null,
      ledgerDefinitionId: boundedText(binding?.ledgerDefinitionId, 200) || null,
      fileName: boundedText(binding?.fileName, 300) || null,
      format: boundedText(binding?.format, 20) || null,
      fileSourceRevision: Number.isInteger(Number(binding?.fileSourceRevision)) ? Number(binding.fileSourceRevision) : null,
      ledgerDefinitionRevision: Number.isInteger(Number(binding?.ledgerDefinitionRevision)) ? Number(binding.ledgerDefinitionRevision) : null,
      stale: binding?.stale === true,
    })).filter((binding) => binding.id && binding.fileSourceId && binding.ledgerDefinitionId)
    : [];
  const ledgerBatchMutationPreview = input.ledgerMutationPreview?.kind === "batch"
    ? {
      schemaVersion: 1,
      kind: "batch",
      id: boundedText(input.ledgerMutationPreview.id, 200) || null,
      targetCount: Math.max(0, Math.min(50, Number(input.ledgerMutationPreview.targetCount) || 0)),
      operationCount: Math.max(0, Math.min(50, Number(input.ledgerMutationPreview.operationCount) || 0)),
      state: ["pending", "waiting", "committing", "partial", "committed", "rolled_back", "needs_attention", "invalidated"].includes(input.ledgerMutationPreview.state)
        ? input.ledgerMutationPreview.state : "pending",
      revision: Number.isInteger(Number(input.ledgerMutationPreview.revision))
        ? Number(input.ledgerMutationPreview.revision) : null,
      journal: input.ledgerMutationPreview.journal && typeof input.ledgerMutationPreview.journal === "object"
        ? {
          id: boundedText(input.ledgerMutationPreview.journal.id, 200) || null,
          status: boundedText(input.ledgerMutationPreview.journal.status, 40) || null,
          appliedCount: Array.isArray(input.ledgerMutationPreview.journal.appliedPreviewIds)
            ? Math.min(50, input.ledgerMutationPreview.journal.appliedPreviewIds.length) : 0,
          snapshotCount: Array.isArray(input.ledgerMutationPreview.journal.snapshots)
            ? Math.min(50, input.ledgerMutationPreview.journal.snapshots.length) : 0,
          rollback: input.ledgerMutationPreview.journal.rollback && typeof input.ledgerMutationPreview.journal.rollback === "object"
            ? {
              restoredTargets: Math.max(0, Number(input.ledgerMutationPreview.journal.rollback.restoredTargets) || 0),
              blockedTargets: Math.max(0, Number(input.ledgerMutationPreview.journal.rollback.blockedTargets) || 0),
            } : null,
        } : null,
      children: Array.isArray(input.ledgerMutationPreview.children)
        ? input.ledgerMutationPreview.children.slice(0, 50).map((child) => ({
          id: boundedText(child?.id, 200) || null,
          ledgerDefinitionId: boundedText(child?.ledgerDefinitionId, 200) || null,
          businessKey: boundedText(child?.businessKey, 300) || null,
          action: ["insert", "update", "no_op"].includes(child?.action) ? child.action : "update",
          rowNumber: Number.isInteger(Number(child?.rowNumber)) ? Number(child.rowNumber) : null,
          changedCells: Array.isArray(child?.changedCells) ? child.changedCells.slice(0, 50).map((cell) => ({
            field: boundedText(cell?.field, 120) || null,
            column: boundedText(cell?.column, 200) || null,
            before: cell?.before == null ? null : boundedText(cell.before, 2_000),
            after: cell?.after == null ? null : boundedText(cell.after, 2_000),
          })).filter((cell) => cell.field && cell.column) : [],
          state: ["pending", "waiting", "committed", "rolled_back", "invalidated", "expired"].includes(child?.state)
            ? child.state : "pending",
          revision: Number.isInteger(Number(child?.revision)) ? Number(child.revision) : null,
          queue: child?.queue && typeof child.queue === "object" ? {
            state: boundedText(child.queue.state, 30) || null,
            position: Number.isInteger(Number(child.queue.position)) ? Number(child.queue.position) : null,
          } : null,
        })) : [],
    }
    : null;
  const ledgerMutationPreparation = input.ledgerMutationPreparation && typeof input.ledgerMutationPreparation === "object"
    ? {
      ok: input.ledgerMutationPreparation.ok === true,
      reason: boundedText(input.ledgerMutationPreparation.reason, 120) || null,
    }
    : null;
  const ledgerMutationPreview = !ledgerBatchMutationPreview && input.ledgerMutationPreview && typeof input.ledgerMutationPreview === "object"
    ? {
      schemaVersion: 1,
      id: boundedText(input.ledgerMutationPreview.id, 200) || null,
      ledgerDefinitionId: boundedText(input.ledgerMutationPreview.ledgerDefinitionId, 200) || null,
      action: ["insert", "update", "no_op"].includes(input.ledgerMutationPreview.action)
        ? input.ledgerMutationPreview.action
        : "update",
      rowNumber: Number.isInteger(Number(input.ledgerMutationPreview.rowNumber))
        ? Number(input.ledgerMutationPreview.rowNumber) : null,
      changedCells: Array.isArray(input.ledgerMutationPreview.changedCells)
        ? input.ledgerMutationPreview.changedCells.slice(0, 20).map((cell) => ({
          field: boundedText(cell?.field, 120) || null,
          column: boundedText(cell?.column, 200) || null,
          before: cell?.before == null ? null : boundedText(cell.before, 2_000),
          after: cell?.after == null ? null : boundedText(cell.after, 2_000),
        })).filter((cell) => cell.field && cell.column)
        : [],
      targetRevision: boundedText(input.ledgerMutationPreview.targetRevision, 128) || null,
      targetContentHash: boundedText(input.ledgerMutationPreview.targetContentHash, 128) || null,
      proposedTargetRevision: boundedText(input.ledgerMutationPreview.proposedTargetRevision, 128) || null,
      sourceEvidence: Array.isArray(input.ledgerMutationPreview.sourceEvidence)
        ? input.ledgerMutationPreview.sourceEvidence.slice(0, 20).map((evidence) => ({
          artifactId: boundedText(evidence?.artifactId, 200) || null,
          field: boundedText(evidence?.field, 120) || null,
        })).filter((evidence) => evidence.artifactId)
        : [],
      approvalRequired: input.ledgerMutationPreview.approvalRequired === true,
      state: ["pending", "waiting", "committed", "invalidated"].includes(input.ledgerMutationPreview.state)
        ? input.ledgerMutationPreview.state
        : "pending",
      queue: input.ledgerMutationPreview.queue && typeof input.ledgerMutationPreview.queue === "object"
        ? {
          state: boundedText(input.ledgerMutationPreview.queue.state, 30) || null,
          position: Number.isInteger(Number(input.ledgerMutationPreview.queue.position))
            ? Number(input.ledgerMutationPreview.queue.position) : null,
        }
        : null,
      expiresAt: boundedText(input.ledgerMutationPreview.expiresAt, 50) || null,
      revision: Number.isInteger(Number(input.ledgerMutationPreview.revision))
        ? Number(input.ledgerMutationPreview.revision) : null,
    }
    : null;
  const dataRelationConfirmation = input.dataRelationConfirmation && typeof input.dataRelationConfirmation === "object"
    ? {
      schemaVersion: 1,
      id: boundedText(input.dataRelationConfirmation.id, 200) || null,
      status: ["verified", "pending", "stale"].includes(input.dataRelationConfirmation.status)
        ? input.dataRelationConfirmation.status
        : "pending",
      confirmationMode: ["runtime_verified", "user_confirmation"].includes(input.dataRelationConfirmation.confirmationMode)
        ? input.dataRelationConfirmation.confirmationMode
        : "runtime_verified",
      planDigest: boundedText(input.dataRelationConfirmation.planDigest, 128) || null,
      relationDigest: boundedText(input.dataRelationConfirmation.relationDigest, 128) || null,
      objectSnapshotCount: Number.isInteger(Number(input.dataRelationConfirmation.objectSnapshotCount))
        ? Math.max(0, Math.min(2_000, Number(input.dataRelationConfirmation.objectSnapshotCount)))
        : 0,
      confirmedAt: boundedText(input.dataRelationConfirmation.confirmedAt, 50) || null,
      confirmedBy: boundedText(input.dataRelationConfirmation.confirmedBy, 200) || null,
    }
    : null;
  if (executionPreview && objectValidation) executionPreview.objectValidation = objectValidation;
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      source: boundedText(input.source, 40) || "channel",
      domain,
      riskLevel,
      goal: boundedText(input.goal, 4_000),
      outputExpectation: boundedText(input.outputExpectation, 1_000) || null,
      dataSources: sources,
      templateMatch,
      workMode,
      operationIntent,
      executionStrategy,
      dataPlan,
      dataOperationPreview,
      fileDiscoveries,
      dataRelationPreview,
      dataMutationPreview,
      dataMutationBinding,
      dataMutationBindings,
      ledgerMutationPreview: ledgerBatchMutationPreview ?? ledgerMutationPreview,
      ledgerMutationPreparation,
      dataRelationConfirmation,
      executionPreview,
      objectValidation,
      generatedAt: boundedText(input.generatedAt, 50) || null,
    },
  };
}

function dataContextSourceKey(source) {
  return String(source?.sourceId ?? source?.path ?? source?.name ?? "unknown").slice(0, 300);
}

function dataContextSourceFingerprint(source) {
  return source?.version || source?.hash || null;
}

function materialAllowedOperations(purpose, capabilities = []) {
  const operations = ["read"];
  if (["query_source", "change_target"].includes(purpose)) operations.push("query");
  if (purpose === "change_target" && capabilities.includes("propose_change")) operations.push("propose_change");
  if (purpose === "change_target" && capabilities.includes("commit_change")) operations.push("commit_change");
  return operations;
}

function buildDataContextSnapshot({
  workItemId,
  workItemRevision,
  capturedAt,
  inputAssets = [],
  localContentRefs = [],
  taskResourceRefs = [],
  channelTaskContract = null,
  channelOrigin = null,
  taskContextControl = null,
} = {}) {
  const fromChannel = channelTaskContract?.source === "channel" || Boolean(channelOrigin?.channelId);
  const sources = [];
  for (const asset of Array.isArray(inputAssets) ? inputAssets.slice(0, 100) : []) {
    const sourceId = asset?.id ?? asset?.path ?? asset?.originalName ?? null;
    if (!sourceId) continue;
    sources.push({
      sourceId: String(sourceId).slice(0, 300),
      referenceId: asset?.id ? String(asset.id).slice(0, 200) : null,
      kind: "asset",
      origin: fromChannel ? "channel_attachment" : "work_item_input",
      name: String(asset?.originalName ?? asset?.path ?? "输入材料").replace(/[\r\n\t]/g, " ").slice(0, 300),
      path: asset?.path ? String(asset.path).replaceAll("\\", "/").slice(0, 1_000) : null,
      family: asset?.family ? String(asset.family).slice(0, 80) : null,
      version: asset?.version ? String(asset.version).slice(0, 200) : null,
      hash: asset?.hash ? String(asset.hash).slice(0, 200) : null,
      purpose: "required_input",
      allowedOperations: ["read"],
      trust: "untrusted_reference",
    });
  }
  for (const reference of Array.isArray(localContentRefs) ? localContentRefs.slice(0, 20) : []) {
    const sourceId = reference?.contentId ?? reference?.id ?? null;
    if (!sourceId) continue;
    sources.push({
      sourceId: String(sourceId).slice(0, 300),
      referenceId: reference?.id ? String(reference.id).slice(0, 200) : null,
      kind: "local_content",
      origin: "local_content_reference",
      name: String(reference?.title ?? "本地内容").replace(/[\r\n\t]/g, " ").slice(0, 300),
      path: null,
      family: reference?.kind ? String(reference.kind).slice(0, 80) : null,
      version: reference?.selectedFingerprint ? String(reference.selectedFingerprint).slice(0, 200) : null,
      hash: reference?.selectedFingerprint ? String(reference.selectedFingerprint).slice(0, 200) : null,
      purpose: ["reference", "required_input"].includes(reference?.purpose) ? reference.purpose : "reference",
      allowedOperations: ["read"],
      trust: "untrusted_reference",
    });
  }
  for (const reference of Array.isArray(taskResourceRefs) ? taskResourceRefs.slice(0, 20) : []) {
    const sourceId = reference?.resourceId ?? reference?.id ?? null;
    if (!sourceId) continue;
    const purpose = ["query_source", "change_target", "reference"].includes(reference?.purpose) ? reference.purpose : "reference";
    const capabilities = Array.isArray(reference?.capabilities)
      ? reference.capabilities.filter((capability) => ["read", "query", "propose_change", "commit_change"].includes(capability)).slice(0, 10)
      : [];
    sources.push({
      sourceId: String(sourceId).slice(0, 300),
      referenceId: reference?.id ? String(reference.id).slice(0, 200) : null,
      kind: "work_resource",
      origin: reference?.locality === "remote" ? "remote_resource_reference" : "local_resource_reference",
      name: String(reference?.title ?? "工作资料").replace(/[\r\n\t]/g, " ").slice(0, 300),
      path: null,
      family: reference?.resourceKind ? String(reference.resourceKind).slice(0, 80) : null,
      version: reference?.selectedVersion ? String(reference.selectedVersion).slice(0, 200) : null,
      hash: null,
      purpose,
      allowedOperations: materialAllowedOperations(purpose, capabilities),
      trust: "untrusted_reference",
    });
  }
  const uniqueSources = [...new Map(sources.map((source) => [
    `${source.kind}:${dataContextSourceKey(source)}`,
    source,
  ])).values()].slice(0, 120);
  const canonical = uniqueSources.map((source) => ({
    sourceId: source.sourceId,
    referenceId: source.referenceId,
    kind: source.kind,
    origin: source.origin,
    name: source.name,
    path: source.path,
    family: source.family,
    version: source.version,
    hash: source.hash,
    purpose: source.purpose,
    allowedOperations: source.allowedOperations,
  }));
  const deliveryDestination = taskContextControl?.deliveryDestination === "task" ? "task"
    : fromChannel ? "channel" : "task";
  const digest = createHash("sha256").update(JSON.stringify({ sources: canonical, deliveryDestination })).digest("hex");
  const hasUnversioned = uniqueSources.some((source) => !dataContextSourceFingerprint(source));
  return {
    schemaVersion: DATA_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
    id: `dcs:${String(workItemId ?? "unknown")}:${Number(workItemRevision) || 1}`,
    workItemId: workItemId ? String(workItemId) : null,
    workItemRevision: Number.isInteger(workItemRevision) ? workItemRevision : null,
    capturedAt: String(capturedAt ?? new Date(0).toISOString()),
    status: uniqueSources.length === 0 ? "empty" : hasUnversioned ? "partial" : "captured",
    sources: uniqueSources,
    sourceCount: uniqueSources.length,
    deliveryDestination,
    digest,
  };
}

function compareDataContextSnapshot(item) {
  const baseline = item?.dataContextSnapshot ?? buildDataContextSnapshot({
    workItemId: item?.id,
    workItemRevision: item?.revision,
    capturedAt: item?.createdAt ?? item?.updatedAt,
    inputAssets: item?.inputAssets,
    localContentRefs: item?.localContentRefs,
    taskResourceRefs: item?.taskResourceRefs,
    channelTaskContract: item?.channelTaskContract,
    channelOrigin: item?.channelOrigin,
    taskContextControl: item?.taskContextControl,
  });
  const current = buildDataContextSnapshot({
    workItemId: item?.id,
    workItemRevision: item?.revision,
    capturedAt: baseline.capturedAt,
    inputAssets: item?.inputAssets,
    localContentRefs: item?.localContentRefs,
    taskResourceRefs: item?.taskResourceRefs,
    channelTaskContract: item?.channelTaskContract,
    channelOrigin: item?.channelOrigin,
    taskContextControl: item?.taskContextControl,
  });
  const baselineByKey = new Map((baseline.sources ?? []).map((source) => [
    `${source.kind}:${dataContextSourceKey(source)}`,
    source,
  ]));
  const currentByKey = new Map((current.sources ?? []).map((source) => [
    `${source.kind}:${dataContextSourceKey(source)}`,
    source,
  ]));
  const changes = [];
  for (const [key, source] of baselineByKey) {
    const next = currentByKey.get(key);
    if (!next) {
      changes.push({ kind: "removed", sourceId: source.sourceId, name: source.name });
      continue;
    }
    if (dataContextSourceFingerprint(source) !== dataContextSourceFingerprint(next)) {
      changes.push({
        kind: "changed", sourceId: source.sourceId, name: source.name,
        previous: dataContextSourceFingerprint(source), current: dataContextSourceFingerprint(next),
      });
    }
  }
  for (const [key, source] of currentByKey) {
    if (!baselineByKey.has(key)) changes.push({ kind: "added", sourceId: source.sourceId, name: source.name });
  }
  if (!changes.length && Number(baseline.schemaVersion) >= 2 && baseline.digest !== current.digest) {
    changes.push({
      kind: "scope_changed",
      previous: baseline.digest,
      current: current.digest,
    });
  }
  const status = changes.length
    ? "stale"
    : current.status === "partial" || baseline.status === "partial"
      ? baseline.confirmedAt ? "current" : "unknown"
      : baseline.status === "empty" ? "empty" : "current";
  return {
    status,
    baseline,
    current,
    changes: changes.slice(0, 100),
    requiresConfirmation: status === "stale" || status === "unknown",
  };
}

function normalizeAssetRefs(input) {
  if (!Array.isArray(input) || input.length > 100) return null;
  const assets = [];
  for (const candidate of input) {
    if (!candidate || typeof candidate !== "object") return null;
    const path = String(candidate.path ?? "").replaceAll("\\", "/");
    const terminalId = String(candidate.terminalId ?? "");
    if (!path || path.startsWith("/") || path.split("/").includes("..") || path.length > 1_000 || !terminalId) return null;
    if (candidate.contentId != null && !/^lc_[a-f0-9]{32}$/i.test(String(candidate.contentId))) return null;
    const capabilities = strings(candidate.capabilities ?? [], { limit: 20, maxLength: 40 });
    if (!capabilities || capabilities.some((verb) => !ASSET_CAPABILITY_VERBS.includes(verb))) return null;
    const rawMetrics = candidate.contentMetrics;
    if (rawMetrics != null && (!rawMetrics || typeof rawMetrics !== "object" || Array.isArray(rawMetrics))) return null;
    const contentMetrics = rawMetrics == null ? null : {};
    for (const field of ["charCount", "sectionCount", "pageCount", "width", "height"]) {
      if (contentMetrics && Object.hasOwn(rawMetrics, field)) {
        const value = Number(rawMetrics[field]);
        if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000) return null;
        contentMetrics[field] = value;
      }
    }
    for (const field of ["durationSeconds"]) {
      if (contentMetrics && Object.hasOwn(rawMetrics, field)) {
        const value = Number(rawMetrics[field]);
        if (!Number.isFinite(value) || value < 0 || value > 10_000_000) return null;
        contentMetrics[field] = value;
      }
    }
    for (const field of ["sampleRate", "channels"]) {
      if (contentMetrics && Object.hasOwn(rawMetrics, field)) {
        const value = Number(rawMetrics[field]);
        if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) return null;
        contentMetrics[field] = value;
      }
    }
    if (contentMetrics && Object.hasOwn(rawMetrics, "codec")) {
      contentMetrics.codec = String(rawMetrics.codec).trim().slice(0, 40);
      if (!contentMetrics.codec) return null;
    }
    if (contentMetrics && Object.hasOwn(rawMetrics, "headings")) {
      if (!Array.isArray(rawMetrics.headings) || rawMetrics.headings.length > 100) return null;
      contentMetrics.headings = rawMetrics.headings.map((value) => String(value).trim().slice(0, 200)).filter(Boolean);
    }
    if (contentMetrics && Object.hasOwn(rawMetrics, "source")) {
      const source = String(rawMetrics.source).trim().toLowerCase();
      if (!["local_file", "producer", "media_probe"].includes(source)) return null;
      contentMetrics.source = source;
    }
    assets.push({
      id: String(candidate.id ?? "").slice(0, 100) || null,
      ...(candidate.contentId ? { contentId: String(candidate.contentId).toLowerCase() } : {}),
      originalName: candidate.originalName ? String(candidate.originalName).replace(/[\r\n\t]/g, " ").slice(0, 200) : undefined,
      path,
      family: String(candidate.family ?? "unknown").slice(0, 40),
      mimeType: candidate.mimeType ? String(candidate.mimeType).slice(0, 120) : null,
      terminalId,
      size: Number.isSafeInteger(candidate.size) && candidate.size >= 0 ? candidate.size : null,
      ...(contentMetrics && Object.keys(contentMetrics).length ? { contentMetrics } : {}),
      resourceClass: ["small", "medium", "large", "unknown"].includes(candidate.resourceClass)
        ? candidate.resourceClass
        : "unknown",
      hash: candidate.hash ? String(candidate.hash).slice(0, 100) : null,
      version: candidate.version ? String(candidate.version).slice(0, 100) : null,
      worktreeId: candidate.worktreeId ? String(candidate.worktreeId).slice(0, 200) : null,
      capabilities,
      readiness: candidate.readiness?.state === "ready"
        ? { state: "ready", reason: String(candidate.readiness.reason ?? "available_on_owning_terminal").slice(0, 100) }
        : { state: "waiting_capability", reason: String(candidate.readiness?.reason ?? "local_application_required").slice(0, 100) },
    });
  }
  return assets;
}

function contentReferenceView(reference) {
  const { selectedFingerprint: _selectedFingerprint, ...visible } = reference ?? {};
  return { ...visible, fingerprintPinned: Boolean(reference?.selectedFingerprint) };
}

function taskResourceReferenceView(reference) {
  const { selectedVersion: _selectedVersion, ...visible } = reference ?? {};
  return { ...visible, versionPinned: Boolean(reference?.selectedVersion) };
}

function planActualFeedbackView(feedback) {
  if (!feedback) return null;
  return {
    id: feedback.id,
    runId: feedback.runId,
    planActualDigest: feedback.planActualDigest,
    decisions: (feedback.decisions ?? []).map((decision) => ({ ...decision })),
    note: feedback.note ?? "",
    revision: feedback.revision,
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
  };
}

export function createWorkItemService({
  state,
  now,
  nextId,
  appendEvent = () => {},
  persistStateSoon = () => {},
  sendAlert = () => Promise.resolve({ sent: false }),
  retryAlert = () => null,
  budgetStatusFor = () => null,
  teamBudgetStatusFor = () => null,
  resolveApplicationCapability = () => ({ state: "refusal", reason: "resolver_unavailable", capability: null }),
  invokeResolvedCapability = () => ({ status: 503, body: { error: "capability_gateway_unavailable" } }),
  issueApplicationApprovalGrant = null,
  enqueueChannelDeliveryBatch = null,
  validateApprovalToken = null,
  onWorkItemChanged = () => {},
  claimTaskMaterialDraft = null,
  inspectTaskMaterialDraft = null,
  resolveClaimedTaskMaterial = null,
  resolveLocalContentReference = null,
  resolveWorkResourceReference = null,
  probeMediaAsset = null,
  store,
}) {
  state.myTemplateRoutingFeedback ??= [];
  state.myTemplateOutcomeFeedback ??= [];
  state.workItemPlanActualFeedback ??= [];
  state.myTemplateGovernanceInterventions ??= [];
  state.myTemplateDrafts ??= [];
  state.myTemplateLearningCases ??= [];
  state.routineDefinitions ??= [];
  const runTx = makeRunTx({ store, persistStateSoon });
  const actorTeam = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const actorUser = (actor) => actor?.userId ?? LOCAL_USER_ID;
  const projectRootFor = (projectId) => state.projects?.find((project) => project.id === projectId)?.path ?? null;
  const outputMetricsOptions = (projectId) => ({
    projectRoot: projectRootFor(projectId),
    ...(typeof probeMediaAsset === "function" ? { probeMedia: probeMediaAsset } : {}),
  });
  const taskDraftsNeedingSingleCaseMigration = state.myTemplateDrafts.filter((draft) =>
    draft.casesRequired !== 1 || (draft.state === "learning" && Number(draft.caseCount ?? 0) >= 1));
  if (taskDraftsNeedingSingleCaseMigration.length) runTx(() => {
    for (const draft of taskDraftsNeedingSingleCaseMigration) {
      draft.casesRequired = 1;
      if (draft.state === "learning" && Number(draft.caseCount ?? 0) >= 1) draft.state = "needs_review";
    }
  });
  const legacyContractCandidates = (state.workItems ?? []).filter((item) =>
    !item.executionContractSnapshot && item.executionContractConfirmedAt
    && (item.acceptanceCriteria ?? []).length && (item.verificationSop ?? []).length);
  if (legacyContractCandidates.length) runTx(() => {
    for (const item of legacyContractCandidates) {
      const confirmedBy = ["assisted", "agent_assisted"].includes(item.executionContractSource)
        ? "ai_policy"
        : item.lastModifiedBy ?? item.createdBy ?? "legacy_user";
      item.executionContractSnapshot = {
        schemaVersion: "legacy-v1",
        id: `contract:legacy:${item.id}:${item.executionContractConfirmedAt}`,
        workItemId: item.id,
        workItemRevision: item.revision ?? null,
        autoRunId: null,
        acceptanceCriteria: [...item.acceptanceCriteria],
        verificationSop: [...item.verificationSop],
        confirmedBy,
        confirmedAt: item.executionContractConfirmedAt,
        digest: createHash("sha256").update(JSON.stringify({
          schemaVersion: "legacy-v1",
          workItemId: item.id,
          acceptanceCriteria: item.acceptanceCriteria,
          verificationSop: item.verificationSop,
          confirmedAt: item.executionContractConfirmedAt,
        })).digest("hex"),
        readOnly: true,
        migratedAt: now(),
      };
    }
  });
  const notifyWorkItemChanged = (item, actor, reason) => {
    try {
      onWorkItemChanged(item, actor, reason);
    } catch {
      // Outcome projection is best-effort and must never roll back the Issue mutation.
    }
  };
  const propagateCompletedGoalTask = (source, actor) => {
    let result = { sourceChanged: false, dependents: [] };
    runTx(() => {
      result = propagateCompletedWorkGoalTask({
        state,
        source,
        now,
        recordActivity: (item, action, details) => recordActivity(item, actor, action, details),
      });
    });
    if (result.sourceChanged) notifyWorkItemChanged(source, actor, "delivery_outputs_registered");
    for (const dependent of result.dependents) notifyWorkItemChanged(dependent, actor, "goal_artifact_handoff");
  };
  const materializeMyTemplateBinding = (requested, projectId, actor, timestamp = now()) => {
    const definition = (state.routineDefinitions ?? []).find((row) =>
      row.id === requested.definitionId
      && row.familyId === requested.familyId
      && row.version === requested.version
      && (row.projectId === projectId || row.templateScope === "team")
      && row.ownerTeamId === actorTeam(actor)
      && row.state === "published");
    if (!definition) return { error: "work_item_my_template_not_available" };
    const snapshot = {
      name: definition.name,
      description: definition.description,
      expectedOutput: learnedTemplateOutput(definition),
      ...(definition.templateContract ? { templateContract: definition.templateContract } : {}),
      ...(definition.dataRequirements?.length ? { dataRequirements: definition.dataRequirements } : {}),
      ...(definition.relations?.length ? { relations: definition.relations } : {}),
      steps: (definition.steps ?? []).map((step) => ({
        key: step.key,
        kind: step.kind,
        label: step.label,
        required: Boolean(step.required),
      })),
    };
    return {
      value: {
        schemaVersion: 1,
        definitionId: definition.id,
        familyId: definition.familyId,
        version: definition.version,
        name: definition.name,
        expectedOutput: snapshot.expectedOutput,
        matchReasons: requested.matchReasons,
        snapshot,
        snapshotHash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
        matchedAt: timestamp,
      },
    };
  };
  const localTerminalId = () => listDevices(state)[0]?.id ?? null;
  const localAssetResourceClasses = (terminalId) => {
    const device = (state.devices ?? []).find((candidate) => candidate.id === terminalId);
    return Array.isArray(device?.assetResourceClasses) ? device.assetResourceClasses : ["small", "medium"];
  };
  const validateRoutineBindingContext = (binding, projectId, actor, { allowPinnedDefinition = false } = {}) => {
    if (!binding?.routineDefinitionId) return null;
    const teamId = actorTeam(actor);
    const definition = (state.routineDefinitions ?? []).find((row) =>
      row.id === binding.routineDefinitionId
      && row.ownerTeamId === teamId
      && row.projectId === projectId);
    if (!definition) return { status: 404, error: "work_item_routine_definition_not_found" };
    if (definition.version !== binding.routineVersion
      || (!allowPinnedDefinition && definition.state !== "published")) {
      return { status: 409, error: "work_item_routine_definition_not_published_or_version_mismatch" };
    }
    const businessCase = (state.businessCases ?? []).find((row) =>
      row.id === binding.businessCaseId
      && row.ownerTeamId === teamId
      && row.projectId === projectId
      && row.sourceId === definition.sourceId);
    if (!businessCase) return { status: 404, error: "work_item_business_case_not_found" };
    if (businessCase.businessKey !== binding.businessKey) {
      return { status: 409, error: "work_item_business_key_mismatch" };
    }
    if (!["confirmed", "active"].includes(businessCase.state)) {
      return { status: 409, error: "work_item_business_case_not_confirmed" };
    }
    const source = (state.workflowSources ?? []).find((row) =>
      row.id === definition.sourceId
      && row.ownerTeamId === teamId
      && row.projectId === projectId);
    if (!source || source.state !== "active") {
      return { status: 409, error: "work_item_routine_source_revoked" };
    }
    const artifacts = binding.triggerArtifactIds.map((artifactId) =>
      (state.workflowArtifacts ?? []).find((row) =>
        row.id === artifactId
        && row.ownerTeamId === teamId
        && row.projectId === projectId
        && row.sourceId === definition.sourceId
        && row.availability !== "missing"
        && !row.exclusion));
    if (artifacts.some((artifact) => !artifact)) {
      return { status: 404, error: "work_item_routine_trigger_artifact_not_found" };
    }
    if (artifacts.some((artifact) =>
      businessCase.artifactFingerprints?.[artifact.id] !== artifact.fingerprint)) {
      return { status: 409, error: "work_item_routine_trigger_evidence_changed" };
    }
    return null;
  };
  const notFound = () => ({ ok: false, status: 404, body: { error: "work_item_not_found" } });
  const commentNotFound = () => ({ ok: false, status: 404, body: { error: "work_item_comment_not_found" } });

  function activityAttribution(item, actor, details = {}) {
    return {
      ...details,
      principalId: actorUser(actor),
      deviceId: actor?.deviceId ?? item.terminalId ?? localTerminalId(),
      terminalId: item.terminalId ?? localTerminalId(),
      effectiveAuthority: actor?.role ?? "owner",
      entryContext: details.entryContext ?? "task",
      traceParent: details.traceParent ?? item.id,
    };
  }

  function recordActivity(item, actor, action, details = {}) {
    const activity = {
      id: nextId("wia"),
      workItemId: item.id,
      ownerTeamId: item.ownerTeamId,
      projectId: item.projectId,
      action,
      actorId: actorUser(actor),
      createdAt: now(),
      details: activityAttribution(item, actor, details),
    };
    (state.workItemActivities ??= []).unshift(activity);
    return activity;
  }

  function findOwn(id, actor) {
    const item = (state.workItems ?? []).find((row) => row.id === String(id));
    return item && item.ownerTeamId === actorTeam(actor) ? item : null;
  }

  const reportDraftService = createWorkItemReportDraftService({
    state,
    now,
    nextId,
    runTx,
    findOwn,
    recordActivity,
    appendEvent,
    actorTeam,
    actorUser,
    enqueueChannelDeliveryBatch,
    validateApprovalToken,
  });
  const followUpReminderService = createWorkItemFollowUpReminderService({
    state, now, nextId, runTx, recordActivity, appendEvent, actorTeam, actorUser,
  });

  function resolveFollowUpContext(context, actor, { input = {} } = {}) {
    const value = workItemFollowUpContextView(context);
    const relation = value.requesterRelation;
    const explicitRequesterUserId = Object.hasOwn(input, "requesterUserId");
    const explicitIdentity = ["requesterName", "requesterOrganization", "requesterUserId"]
      .some((field) => Object.hasOwn(input, field) && input[field] != null && input[field] !== "");

    if (relation === "self") {
      if (explicitRequesterUserId && value.requesterUserId && value.requesterUserId !== actorUser(actor)) {
        return { error: "work_item_self_requester_mismatch" };
      }
      value.requesterUserId = actorUser(actor);
      value.requesterName = null;
      value.requesterOrganization = null;
    } else if (relation === "unknown") {
      if (explicitIdentity) return { error: "work_item_unknown_requester_identity_forbidden" };
      value.requesterUserId = null;
      value.requesterName = null;
      value.requesterOrganization = null;
    } else if (relation === "customer") {
      if (!value.requesterName) return { error: "work_item_customer_requester_name_required" };
      if (explicitRequesterUserId && value.requesterUserId) {
        return { error: "work_item_customer_internal_requester_forbidden" };
      }
      value.requesterUserId = null;
    } else if (relation === "child") {
      if (explicitRequesterUserId && value.requesterUserId) {
        return { error: "work_item_child_internal_requester_forbidden" };
      }
      value.requesterUserId = null;
    } else {
      if (!value.requesterUserId && !value.requesterName) {
        return { error: "work_item_internal_requester_identity_required" };
      }
      if (value.requesterUserId) {
        const requester = findUser(state, value.requesterUserId);
        if (!requester || (requester.teamId ?? LOCAL_TEAM_ID) !== actorTeam(actor)) {
          return { error: "invalid_work_item_requester_user" };
        }
      }
    }

    if (value.waitingOn === "requester" && ["self", "unknown"].includes(relation)) {
      return { error: "work_item_waiting_on_requester_requires_requester" };
    }
    if (Object.hasOwn(input, "nextFollowUpAt") && value.nextFollowUpAt
      && Date.parse(value.nextFollowUpAt) <= Date.parse(now())) {
      return { error: "work_item_next_follow_up_at_in_past" };
    }
    return { value };
  }

  function applyPlanningAutomation(item, actor) {
    const matchingProjects = (state.planningProjects ?? []).filter((project) =>
      project.ownerTeamId === actorTeam(actor) && !project.archivedAt
      && (project.automationRules ?? []).some((rule) =>
        (!rule.status || rule.status === item.status)
        && (!rule.priority || rule.priority === item.priority)
        && (!rule.type || rule.type === item.type)
        && (!rule.label || item.labels.includes(rule.label))));
    for (const project of matchingProjects) {
      const memberships = (state.planningProjectItems ?? []).filter((row) =>
        row.ownerTeamId === actorTeam(actor) && row.planningProjectId === project.id);
      if (memberships.some((row) => row.workItemId === item.id)) continue;
      (state.planningProjectItems ??= []).push({
        id: nextId("ppi"),
        ownerTeamId: project.ownerTeamId,
        planningProjectId: project.id,
        workItemId: item.id,
        position: Math.max(0, ...memberships.map((row) => Number(row.position) || 0)) + 1_000,
        addedAt: now(),
        addedBy: "usr_planning_automation",
      });
      project.activity = [{
        id: nextId("ppa"),
        action: "item_auto_added",
        actorId: "usr_planning_automation",
        createdAt: now(),
        details: { workItemId: item.id, localRef: item.localRef },
      }, ...(project.activity ?? [])].slice(0, 100);
      recordActivity(item, actor, "planning_auto_added", { planningProjectId: project.id });
      appendEvent({
        invocationId: null, type: "planning_project_item_auto_added", level: "info",
        message: `${item.localRef} automatically added to ${project.name}.`,
        data: { planningProjectId: project.id, workItemId: item.id, actorTeamId: actorTeam(actor) },
      });
    }
  }

  function executionState(item) {
    return resolveWorkItemExecution(item, state, { now: now() }).executionState;
  }

  function completionGate(item) {
    const hasCriteria = (item.acceptanceCriteria ?? []).length > 0;
    const resultVerification = item.resultVerificationContract?.enforced === true
      ? verifyWorkItemResult(item)
      : null;
    if (!hasCriteria && !resultVerification) {
      return { ready: true, missingCriteria: [], verificationRequired: false, resultVerificationRequired: false };
    }
    const passed = new Set((item.acceptanceResults ?? [])
      .filter((result) => result.status === "passed")
      .map((result) => result.criterion));
    const missingCriteria = (item.acceptanceCriteria ?? []).filter((criterion) => !passed.has(criterion));
    const verificationRequired = !resultVerification
      && !(item.verificationRecords ?? []).some((record) => record.status === "passed");
    const resultVerificationRequired = Boolean(resultVerification && resultVerification.status !== "passed");
    return {
      ready: missingCriteria.length === 0 && !verificationRequired && !resultVerificationRequired,
      missingCriteria,
      verificationRequired,
      resultVerificationRequired,
      resultVerification,
    };
  }

  function executionContractGate(item) {
    const missing = [];
    if (!(item.acceptanceCriteria ?? []).length) missing.push("acceptance_criteria");
    if (!(item.verificationSop ?? []).length) missing.push("verification_sop");
    if (!item.executionContractConfirmedAt) missing.push("confirmation");
    const latestRun = [...(item.executionBindings ?? [])].reverse()
      .filter((binding) => binding.kind === "auto_run")
      .map((binding) => (state.autoRuns ?? []).find((candidate) => candidate.id === binding.targetId))
      .find(Boolean) ?? null;
    const latestAttemptStartedAt = latestRun?.executionBudget?.startedAt ?? latestRun?.createdAt ?? null;
    if (item.executionContractConfirmedAt && latestAttemptStartedAt
      && Date.parse(item.executionContractConfirmedAt) > Date.parse(latestAttemptStartedAt)) {
      missing.push("confirmed_before_execution");
    }
    const intentContract = buildWorkItemIntentContract(item);
    const intentChanged = Boolean(
      item.executionContractConfirmedAt
      && item.executionIntentContractSnapshot?.digest
      && item.executionIntentContractSnapshot.digest !== intentContract.digest,
    );
    if (intentChanged) missing.push("intent_changed");
    return {
      ready: missing.length === 0 && intentContract.status !== "needs_clarification",
      missing,
      source: item.executionContractSource ?? null,
      confirmedAt: item.executionContractConfirmedAt ?? null,
      latestAttemptStartedAt,
      intentReady: intentContract.status === "ready" && !intentChanged,
      clarification: intentContract.clarification,
      intentChanged,
    };
  }

  function intentContractView(item) {
    const current = buildWorkItemIntentContract(item);
    const frozen = item.executionIntentContractSnapshot ?? null;
    const executionActive = Boolean(
      item.executionOperation
      || (item.executionBindings ?? []).length
      || (item.executionStartRequest && item.executionStartRequest.status !== "cancelled"),
    );
    if (executionActive && frozen) return frozen;
    return {
      ...current,
      ...(frozen?.digest && frozen.digest !== current.digest ? {
        previousConfirmedDigest: frozen.digest,
        confirmationStale: true,
      } : {}),
    };
  }

  function reviewContract(item) {
    const latestRun = [...(item.executionBindings ?? [])].reverse()
      .filter((binding) => binding.kind === "auto_run")
      .map((binding) => (state.autoRuns ?? []).find((candidate) => candidate.id === binding.targetId))
      .find(Boolean) ?? null;
    const contract = latestRun?.executionContract ?? item.executionContractSnapshot ?? null;
    if (!contract) return null;
    const supersededByGoalRevision = Number.isInteger(item.executionContractRefreshRevision)
      && (!Number.isInteger(contract.workItemRevision)
        || contract.workItemRevision < item.executionContractRefreshRevision);
    return {
      schemaVersion: contract.schemaVersion ?? "execution-contract-v2",
      id: contract.id,
      workItemId: contract.workItemId ?? item.id,
      workItemRevision: contract.workItemRevision ?? null,
      autoRunId: contract.autoRunId ?? latestRun?.id ?? null,
      acceptanceCriteria: [...(contract.acceptanceCriteria ?? [])],
      verificationSop: [...(contract.verificationSop ?? [])],
      intentContract: contract.intentContract ? {
        ...contract.intentContract,
        conflicts: (contract.intentContract.conflicts ?? []).map((conflict) => ({ ...conflict })),
      } : null,
      dataContextSnapshot: contract.dataContextSnapshot
        ? {
          ...contract.dataContextSnapshot,
          sources: (contract.dataContextSnapshot.sources ?? []).map((source) => ({ ...source })),
        }
        : null,
      confirmedBy: contract.confirmedBy ?? null,
      confirmedAt: contract.confirmedAt ?? null,
      digest: contract.digest ?? null,
      readOnly: true,
      supersededByGoalRevision,
    };
  }

  function reviewEvidence(item, contract) {
    if (!contract) return [];
    const verificationById = new Map((item.verificationRecords ?? []).map((record) => [record.id, record]));
    return contract.acceptanceCriteria.map((criterion) => {
      const result = (item.acceptanceResults ?? []).find((candidate) => candidate.criterion === criterion) ?? null;
      const verification = result?.verificationId ? verificationById.get(result.verificationId) ?? null : null;
      return {
        criterion,
        status: result?.status ?? "not_tested",
        note: result?.note ?? "",
        verificationId: verification?.id ?? null,
        command: verification?.command ?? null,
        verificationSummary: verification?.summary ?? null,
        evidence: [...(verification?.evidence ?? [])],
        sourceAutoRunId: verification?.sourceAutoRunId ?? contract.autoRunId ?? null,
        reviewedBy: verification?.recordedBy ?? null,
        reviewedAt: verification?.recordedAt ?? null,
      };
    });
  }

  function executionContractDefinitionGate(item) {
    const missing = [];
    if (!(item.acceptanceCriteria ?? []).length) missing.push("acceptance_criteria");
    if (!(item.verificationSop ?? []).length) missing.push("verification_sop");
    if (!item.executionContractConfirmedAt) missing.push("confirmation");
    return {
      ready: missing.length === 0,
      missing,
      source: item.executionContractSource ?? null,
      confirmedAt: item.executionContractConfirmedAt ?? null,
    };
  }

  function myTemplateDraftView(draft) {
    if (!draft) return null;
    return {
      id: draft.id,
      projectId: draft.projectId,
      name: draft.name,
      typicalInput: draft.typicalInput,
      expectedOutput: draft.expectedOutput,
      applicability: draft.applicability,
      steps: [...(draft.steps ?? [])],
      state: draft.state,
      caseCount: draft.caseCount,
      casesRequired: draft.casesRequired,
      revision: draft.revision,
      origin: { ...draft.origin },
      activation: draft.activation ? { ...draft.activation } : null,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  }

  function taskTemplateDraftFor(item, actor) {
    return state.myTemplateDrafts.find((draft) =>
      draft.ownerTeamId === actorTeam(actor)
      && draft.projectId === item.projectId
      && draft.origin?.workItemId === item.id) ?? null;
  }

  function latestTaskDelivery(item) {
    const runIds = new Set((item.executionBindings ?? [])
      .filter((binding) => binding.kind === "auto_run" && binding.targetId)
      .map((binding) => binding.targetId));
    const run = (state.autoRuns ?? [])
      .filter((candidate) => runIds.has(candidate.id))
      .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0] ?? null;
    return { run, report: run?.deliveryReport ?? null };
  }

  function taskTemplateDraftPreview(item, actor) {
    const existing = taskTemplateDraftFor(item, actor);
    if (existing) return { eligible: true, alreadySaved: true, draft: myTemplateDraftView(existing), reasons: [] };

    const reasons = [];
    if (item.status !== "done") reasons.push("task_not_completed");
    if (item.myTemplateBinding) reasons.push("task_already_used_my_template");
    const { report } = latestTaskDelivery(item);
    const passedVerification = (item.verificationRecords ?? []).some((record) => record.status === "passed");
    const passedAcceptance = (item.acceptanceResults ?? []).some((result) => result.status === "passed");
    const hasResultEvidence = Boolean(
      (item.outputAssets ?? []).length
      || report?.summary
      || report?.changedFiles?.length
      || item.lastProgressSummary
      || passedVerification
      || passedAcceptance,
    );
    if (!hasResultEvidence) reasons.push("task_result_evidence_required");

    const fileLabel = (asset) => String(asset.originalName ?? asset.path ?? "").replaceAll("\\", "/").split("/").pop();
    const inputLabels = [...new Set((item.inputAssets ?? []).map(fileLabel).filter(Boolean))];
    const outputLabels = [...new Set([
      ...(item.outputAssets ?? []).map(fileLabel),
      ...(report?.changedFiles ?? []).map((path) => String(path).replaceAll("\\", "/").split("/").pop()),
    ].filter(Boolean))];
    const typicalInput = inputLabels.length
      ? inputLabels.slice(0, 5).join("、")
      : `与“${String(item.title ?? "这项工作").slice(0, 120)}”类似的任务说明和材料`;
    const expectedOutput = outputLabels.length
      ? outputLabels.slice(0, 5).join("、")
      : String(report?.summary ?? item.lastProgressSummary ?? "得到符合任务目标并通过检查的结果").trim().slice(0, 1_000);
    const observedSteps = [...new Set((item.assetOperations ?? [])
      .map((operation) => String(operation.summary ?? operation.capability ?? "").trim().slice(0, 1_000))
      .filter(Boolean))];
    const steps = (observedSteps.length ? observedSteps : [
      `理解并检查${typicalInput}`,
      "按任务目标完成处理",
      `检查并交付${expectedOutput}`,
    ]).slice(0, 12);
    return {
      eligible: reasons.length === 0,
      alreadySaved: false,
      reasons,
      draft: null,
      suggestion: {
        name: String(item.title ?? "新的我的模版").trim().slice(0, 200),
        typicalInput: typicalInput.slice(0, 1_000),
        expectedOutput: expectedOutput.slice(0, 1_000),
        applicability: `当收到${typicalInput.slice(0, 500)}，并希望得到${expectedOutput.slice(0, 500)}时`,
        steps,
      },
      evidence: {
        inputCount: item.inputAssets?.length ?? 0,
        outputCount: item.outputAssets?.length ?? 0,
        passedVerification,
        passedAcceptance,
        hasDeliveryReport: Boolean(report?.summary || report?.changedFiles?.length),
      },
    };
  }

  function taskTemplateLearningSnapshot(item) {
    const boundedAssetRef = (asset) => ({
      id: asset.id ?? null,
      ...(asset.contentId ? { contentId: asset.contentId } : {}),
      name: asset.originalName ?? String(asset.path ?? "").replaceAll("\\", "/").split("/").pop() ?? null,
      path: asset.path ?? null,
      family: asset.family ?? null,
      hash: asset.hash ?? null,
      version: asset.version ?? null,
      terminalId: asset.terminalId ?? null,
    });
    const { report } = latestTaskDelivery(item);
    const snapshot = {
      schemaVersion: 1,
      workItemId: item.id,
      workItemRevision: item.revision,
      taskTitle: String(item.title ?? "").slice(0, 300),
      inputAssets: (item.inputAssets ?? []).slice(0, 100).map(boundedAssetRef),
      outputAssets: (item.outputAssets ?? []).slice(0, 100).map(boundedAssetRef),
      resultSummary: String(report?.summary ?? item.lastProgressSummary ?? "").slice(0, 2_000),
      changedFiles: strings(report?.changedFiles ?? [], { limit: 100, maxLength: 1_000 }) ?? [],
      acceptanceCriteria: strings(item.acceptanceCriteria ?? [], { limit: 30, maxLength: 2_000 }) ?? [],
      acceptanceResults: (item.acceptanceResults ?? []).slice(0, 100).map((result) => ({
        criterion: String(result.criterion ?? "").slice(0, 2_000),
        status: result.status,
      })),
      verificationEvidence: (item.verificationRecords ?? []).slice(-30).map((record) => ({
        kind: record.kind,
        status: record.status,
        summary: String(record.summary ?? "").slice(0, 1_000),
      })),
    };
    return {
      snapshot,
      snapshotHash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
    };
  }

  function similarTaskCandidate(draft, item, actor) {
    if (item.ownerTeamId !== actorTeam(actor) || item.projectId !== draft.projectId) return null;
    if ((draft.learningCaseIds ?? []).some((caseId) => state.myTemplateLearningCases
      .some((entry) => entry.id === caseId && entry.workItemId === item.id))) return null;
    if (state.myTemplateLearningCases.some((entry) =>
      entry.ownerTeamId === actorTeam(actor) && entry.workItemId === item.id)) return null;
    if (item.status !== "done" || item.myTemplateBinding) return null;
    const preview = taskTemplateDraftPreview(item, actor);
    if (!preview.eligible || !preview.suggestion) return null;

    const titleScore = textSimilarity(draft.name, item.title);
    const inputScore = textSimilarity(draft.typicalInput, preview.suggestion.typicalInput);
    const outputScore = textSimilarity(draft.expectedOutput, preview.suggestion.expectedOutput);
    const draftOutputExtension = String(draft.expectedOutput).toLowerCase().match(/\.[a-z0-9]{1,8}\b/)?.[0] ?? null;
    const candidateOutputExtension = String(preview.suggestion.expectedOutput).toLowerCase().match(/\.[a-z0-9]{1,8}\b/)?.[0] ?? null;
    const sameOutputFormat = Boolean(draftOutputExtension && draftOutputExtension === candidateOutputExtension);
    if (outputScore < 0.12 && !sameOutputFormat) return null;
    const score = Math.min(1, titleScore * 0.35 + inputScore * 0.25 + outputScore * 0.4 + (sameOutputFormat ? 0.08 : 0));
    if (score < 0.22) return null;
    const reasons = [];
    if (outputScore >= 0.2) reasons.push("交付结果相似");
    if (inputScore >= 0.2) reasons.push("输入材料相似");
    if (titleScore >= 0.2) reasons.push("任务目标相似");
    if (sameOutputFormat) reasons.push("输出格式一致");
    return {
      workItem: {
        id: item.id,
        localRef: item.localRef ?? null,
        title: item.title,
        completedAt: item.completedAt ?? item.updatedAt ?? null,
        revision: item.revision,
      },
      similarity: Number(score.toFixed(4)),
      confidence: score >= 0.55 ? "high" : score >= 0.35 ? "medium" : "low",
      reasons,
      typicalInput: preview.suggestion.typicalInput,
      expectedOutput: preview.suggestion.expectedOutput,
      evidence: preview.evidence,
    };
  }

  function workItemView(item, actor) {
    const {
      createIdempotencyKey: _createIdempotencyKey,
      followUpScheduleRevision: _followUpScheduleRevision,
      executionStartRequest: _executionStartRequest,
      ...publicItem
    } = item;
    const bodyAcceptanceCriteria = (item.acceptanceCriteria ?? []).length
      ? []
      : extractAcceptanceCriteriaFromBody(item.body);
    const visibleAcceptanceCriteria = (publicItem.acceptanceCriteria ?? []).length
      ? publicItem.acceptanceCriteria
      : bodyAcceptanceCriteria;
    const derivedExecution = resolveWorkItemExecution(item, state, { now: now() });
    const derivedExecutionState = derivedExecution.executionState;
    const frozenReviewContract = reviewContract(item);
    const memberships = (state.planningProjectItems ?? []).filter(
      (row) => row.workItemId === item.id && row.ownerTeamId === actorTeam(actor),
    );
    const parent = item.parentId ? findOwn(item.parentId, actor) : null;
    const subIssues = (state.workItems ?? []).filter(
      (candidate) => candidate.ownerTeamId === actorTeam(actor) && candidate.parentId === item.id,
    );
    const completedSubIssues = subIssues.filter(
      (candidate) => candidate.status === "done" || candidate.state === "closed",
    ).length;
    const intentPeers = item.intentId
      ? (state.workItems ?? []).filter((candidate) =>
        candidate.ownerTeamId === actorTeam(actor)
        && candidate.intentId === item.intentId
        && candidate.id !== item.id)
      : [];
    const workGoal = item.workGoalId
      ? (state.workGoals ?? []).find((candidate) =>
        candidate.id === item.workGoalId && candidate.ownerTeamId === actorTeam(actor)) ?? null
      : null;
    const goalTasks = workGoal
      ? (state.workItems ?? []).filter((candidate) =>
        candidate.ownerTeamId === actorTeam(actor) && candidate.workGoalId === workGoal.id)
      : [];
    const publicationReadiness = item.taskKind === "content_publish"
      ? publicationCapabilityReadiness({
        applications: state.applications ?? [],
        platformTarget: item.platformTarget,
        ownerTeamId: actorTeam(actor),
      })
      : null;
    const draftSyncReadiness = item.taskKind === "wechat_draft_sync"
      ? draftSyncCapabilityReadiness({
        applications: state.applications ?? [],
        platformTarget: item.platformTarget,
        ownerTeamId: actorTeam(actor),
      })
      : null;
    const effectiveResultVerificationContract = item.resultVerificationContract
      ? resultVerificationContract(item, { enforced: item.resultVerificationContract.enforced === true })
      : null;
    const effectiveVerificationItem = effectiveResultVerificationContract
      ? { ...item, resultVerificationContract: effectiveResultVerificationContract }
      : item;
    const resultVerification = effectiveResultVerificationContract
      ? verifyWorkItemResult(effectiveVerificationItem)
      : null;
    const latestGoalChange = workGoal
      ? (state.workGoalChanges ?? [])
        .filter((change) => change.goalId === workGoal.id)
        .sort((left, right) => String(right.appliedAt ?? right.updatedAt ?? right.createdAt ?? "")
          .localeCompare(String(left.appliedAt ?? left.updatedAt ?? left.createdAt ?? "")))[0] ?? null
      : null;
    const workGoalUserSummary = workGoal ? buildWorkGoalUserSummary({
      goal: workGoal,
      tasks: goalTasks,
      workItems: goalTasks.map((candidate) => candidate.resultVerificationContract && !candidate.resultVerification
        ? { ...candidate, resultVerification: verifyWorkItemResult(candidate) }
        : candidate),
      latestChange: latestGoalChange,
    }) : null;
    const templateOutcomeFeedback = state.myTemplateOutcomeFeedback.find((feedback) =>
      feedback.ownerTeamId === actorTeam(actor) && feedback.workItemId === item.id) ?? null;
    return {
      ...publicItem,
      taskContextSummary: projectWorkItemContextSummary({
        item,
        state,
        ownerTeamId: actorTeam(actor),
      }),
      dataContext: dataContextView(item),
      localContentRefs: (item.localContentRefs ?? []).map(contentReferenceView),
      taskResourceRefs: (item.taskResourceRefs ?? []).map(taskResourceReferenceView),
      acceptanceCriteria: visibleAcceptanceCriteria,
      acceptanceCriteriaSource: (publicItem.acceptanceCriteria ?? []).length
        ? publicItem.executionContractSource ?? "structured"
        : bodyAcceptanceCriteria.length ? "body_unstructured" : null,
      completedAt: publicItem.completedAt ?? ((item.state === "closed" || item.status === "done") ? item.updatedAt : null),
      ...workItemFollowUpContextView(item),
      assetReadiness: evaluateAssetRequirements(
        item.inputAssets ?? [],
        item.requiredCapabilities ?? [],
        item.terminalId,
        { availableResourceClasses: localAssetResourceClasses(item.terminalId) },
      ),
      externalBindings: (item.externalBindings ?? []).map((binding) => externalBindingView(binding)),
      businessState: item.state,
      planningStatus: item.status,
      executionState: derivedExecutionState,
      executionKind: derivedExecution.binding?.kind ?? null,
      statusModel: {
        business: item.state,
        planning: item.status,
        execution: derivedExecutionState,
      },
      completionGate: completionGate({ ...effectiveVerificationItem, acceptanceCriteria: visibleAcceptanceCriteria }),
      resultVerificationContract: effectiveResultVerificationContract,
      resultVerification,
      executionContractGate: executionContractGate(item),
      intentContract: intentContractView(item),
      executionStartReceipt: projectExecutionStartReceipt(item, state, { now: now() }),
      reviewContract: frozenReviewContract,
      reviewEvidence: reviewEvidence(item, frozenReviewContract),
      myTemplateOutcomeFeedback: templateOutcomeFeedback ? {
        id: templateOutcomeFeedback.id,
        outcome: templateOutcomeFeedback.outcome,
        note: templateOutcomeFeedback.note,
        definitionId: templateOutcomeFeedback.definitionId,
        familyId: templateOutcomeFeedback.familyId,
        version: templateOutcomeFeedback.version,
        revision: templateOutcomeFeedback.revision,
        createdAt: templateOutcomeFeedback.createdAt,
        updatedAt: templateOutcomeFeedback.updatedAt,
      } : null,
      myTemplateDraft: myTemplateDraftView(taskTemplateDraftFor(item, actor)),
      intentPeers: intentPeers.map((candidate) => ({
        id: candidate.id,
        localRef: candidate.localRef,
        title: candidate.title,
        taskKind: candidate.taskKind ?? "general",
        status: candidate.status,
        state: candidate.state,
      })),
      workGoal: workGoal ? {
        id: workGoal.id,
        title: workGoal.title,
        statement: workGoal.statement,
        outcome: workGoal.outcome,
        status: workGoal.status,
        planVersion: workGoal.planVersion,
        platforms: workGoal.platforms ?? [],
        progress: {
          total: goalTasks.length,
          completed: goalTasks.filter((candidate) => candidate.status === "done" || candidate.state === "closed").length,
        },
        userSummary: workGoalUserSummary,
      } : null,
      publicationReadiness,
      draftSyncReadiness,
      goalTasks: goalTasks.map((candidate) => ({
        id: candidate.id,
        localRef: candidate.localRef,
        title: candidate.title,
        taskKind: candidate.taskKind ?? "general",
        status: candidate.status,
        state: candidate.state,
        dependencyIds: candidate.dependencyIds ?? [],
        platformTarget: candidate.platformTarget ?? null,
      })),
      parent: parent ? {
        id: parent.id, localRef: parent.localRef, title: parent.title,
        status: parent.status, state: parent.state,
      } : null,
      subIssues: subIssues.map((candidate) => ({
        id: candidate.id, localRef: candidate.localRef, title: candidate.title,
        status: candidate.status, state: candidate.state,
      })),
      subIssuesSummary: {
        total: subIssues.length,
        completed: completedSubIssues,
        percentCompleted: subIssues.length ? Math.round((completedSubIssues / subIssues.length) * 100) : 0,
      },
      dependencyIds: item.dependencyIds ?? [],
      blockedBy: (item.dependencyIds ?? []).map((dependencyId) => {
        const dependency = findOwn(dependencyId, actor);
        const readiness = artifactDependencyReadiness(item, dependency);
        return dependency ? {
          id: dependency.id,
          localRef: dependency.localRef,
          title: dependency.title,
          status: dependency.status,
          state: dependency.state,
          resolved: readiness.resolved,
          taskResolved: readiness.taskResolved,
          artifactResolved: readiness.artifactResolved,
          unresolvedArtifactKinds: readiness.unresolvedArtifactKinds,
        } : null;
      }).filter(Boolean),
      blocks: (state.workItems ?? [])
        .filter((candidate) => candidate.ownerTeamId === actorTeam(actor)
          && (candidate.dependencyIds ?? []).includes(item.id))
        .map((candidate) => ({
          id: candidate.id, localRef: candidate.localRef, title: candidate.title,
          status: candidate.status, state: candidate.state,
        })),
      planningProjects: memberships.map((membership) => {
        const project = (state.planningProjects ?? []).find(
          (row) => row.id === membership.planningProjectId && row.ownerTeamId === actorTeam(actor),
        );
        return project ? {
          id: project.id,
          name: project.name,
          archivedAt: project.archivedAt,
          autonomyProfile: project.autonomyProfile ?? "standard",
        } : null;
      }).filter(Boolean),
    };
  }

  function dataContextView(item) {
    const comparison = compareDataContextSnapshot(item);
    return {
      snapshot: comparison.baseline,
      status: comparison.status,
      currentDigest: comparison.current.digest,
      currentSourceCount: comparison.current.sourceCount,
      requiresConfirmation: comparison.requiresConfirmation,
      changes: comparison.changes,
    };
  }

  function listWorkItems(query = {}, actor = null) {
    const q = String(query.q ?? "").trim().toLowerCase();
    const projectNames = new Map((state.projects ?? []).map((project) => [project.id, project.name ?? ""]));
    const updatedSince = normalizedUpdatedSince(query.updatedSince);
    if (updatedSince === undefined) return { ok: false, status: 400, body: { error: "invalid_updated_since" } };
    const plannedDate = String(query.plannedDate ?? "");
    if (plannedDate && !validDateOnly(plannedDate)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_planned_date" } };
    }
    const assigneeId = query.assigneeId === "mine" ? actorUser(actor) : String(query.assigneeId ?? "");
    const terminalId = query.terminalId === "local" ? localTerminalId() : String(query.terminalId ?? "");
    const planningProjectId = String(query.planningProjectId ?? "");
    const planningWorkItemIds = planningProjectId
      ? new Set((state.planningProjectItems ?? [])
        .filter((row) => row.ownerTeamId === actorTeam(actor) && row.planningProjectId === planningProjectId)
        .map((row) => row.workItemId))
      : null;
    const rows = (state.workItems ?? [])
      .filter((item) => item.ownerTeamId === actorTeam(actor))
      .filter((item) => !planningWorkItemIds || planningWorkItemIds.has(item.id))
      .filter((item) => !query.projectId || item.projectId === query.projectId)
      .filter((item) => !query.status || item.status === query.status)
      .filter((item) => !query.type || item.type === query.type)
      .filter((item) => !terminalId || item.terminalId === terminalId)
      .filter((item) => !plannedDate || item.plannedDate === plannedDate)
      .filter((item) => !assigneeId || (item.assigneeIds ?? []).includes(assigneeId))
      .filter((item) => query.includeArchived === "1" || !item.archivedAt)
      .filter((item) => !updatedSince || item.updatedAt > updatedSince)
      .filter((item) => !q || `${item.localRef} ${item.title} ${item.body} ${item.labels.join(" ")} ${projectNames.get(item.projectId) ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .map((item) => workItemView(item, actor));
    const page = paginateRows(rows, query);
    if (!page.ok) return { ok: false, status: 400, body: { error: page.error } };
    return {
      ok: true, status: 200,
      body: { workItems: page.rows, count: page.rows.length, nextCursor: page.nextCursor, hasMore: page.hasMore },
    };
  }

  function getCompletionMetrics(query = {}, actor = null) {
    const projectId = String(query.projectId ?? "").trim();
    if (projectId && !actorCanAccessProject(state, actor, projectId)) return notFound();
    const items = (state.workItems ?? [])
      .filter((item) => item.ownerTeamId === actorTeam(actor))
      .filter((item) => !projectId || item.projectId === projectId)
      .filter((item) => !item.archivedAt)
      .filter((item) => (item.executionBindings ?? []).length > 0
        || item.executionStartRequest
        || ["in_progress", "review", "blocked", "done"].includes(item.status)
        || item.state === "closed");
    const assessments = [];
    const runIds = new Set();
    for (const item of items) {
      for (const binding of item.executionBindings ?? []) {
        if (binding.kind === "auto_run" && binding.targetId) runIds.add(binding.targetId);
      }
      const detail = getWorkItem({ workItemId: item.id }, actor);
      if (detail.ok) assessments.push(detail.body.observability?.completionAssessment ?? null);
    }
    const receipts = [];
    for (const entry of state.executionActionIdempotencyRecords ?? []) {
      if (runIds.has(entry.autoRunId) && entry.receipt) receipts.push(entry.receipt);
    }
    for (const autoRun of state.autoRuns ?? []) {
      if (!runIds.has(autoRun.id)) continue;
      receipts.push(...(autoRun.executionActionReceipts ?? []));
    }
    return {
      ok: true,
      status: 200,
      body: {
        generatedAt: now(),
        scope: {
          projectId: projectId || null,
          trackedWorkItems: assessments.filter(Boolean).length,
          trackedAutoRuns: runIds.size,
        },
        metrics: taskCompletionQualityMetrics({ assessments, receipts }),
      },
    };
  }

  function getHomeWorkbench(query = {}, actor = null) {
    const timezoneOffset = Number(query.timezoneOffset ?? 0);
    if (!Number.isInteger(timezoneOffset) || timezoneOffset < -840 || timezoneOffset > 840) {
      return { ok: false, status: 400, body: { error: "invalid_timezone_offset" } };
    }
    const assigneeId = query.assigneeId === "mine" || query.assigneeId == null
      ? actorUser(actor)
      : query.assigneeId === "all"
        ? ""
        : String(query.assigneeId);
    const workItems = (state.workItems ?? [])
      .filter((item) => item.ownerTeamId === actorTeam(actor))
      .filter((item) => query.assigneeId !== "all" || item.terminalId === localTerminalId())
      .filter((item) => !assigneeId || (item.assigneeIds ?? []).includes(assigneeId))
      .map((item) => workItemView(item, actor));
    return {
      ok: true,
      status: 200,
      body: homeWorkbenchReadModel({ state, workItems, now: now(), timezoneOffset }),
    };
  }

  function listAttention(query = {}, actor = null) {
    const projectId = String(query.projectId ?? "");
    const workItemId = String(query.workItemId ?? "");
    const kind = String(query.kind ?? "");
    const severity = String(query.severity ?? "");
    const sla = String(query.sla ?? "");
    const handler = String(query.handler ?? "");
    const updatedSince = normalizedUpdatedSince(query.updatedSince);
    if (updatedSince === undefined) return { ok: false, status: 400, body: { error: "invalid_updated_since" } };
    const items = (state.workItems ?? []).filter((item) =>
      item.ownerTeamId === actorTeam(actor)
      && (!projectId || item.projectId === projectId)
      && (!workItemId || item.id === workItemId));
    const rows = [];
    for (const item of items) {
      const staleRecordBindings = (item.recordBindings ?? []).filter((recordBinding) =>
        recordBinding.record && recordBinding.resolution?.state !== "resolved");
      if (staleRecordBindings.length && !item.archivedAt) {
        const freshnessActivity = (state.workItemActivities ?? []).find((activity) =>
          activity.workItemId === item.id && activity.action === "record_bindings_freshness_changed");
        const executionBlocked = staleRecordBindings.some((recordBinding) => recordBinding.direction === "input");
        rows.push({
          id: `record_binding_stale:${item.id}`,
          kind: "record_binding_stale",
          severity: executionBlocked ? "high" : "medium",
          workItemId: item.id,
          localRef: item.localRef,
          projectId: item.projectId,
          title: item.title,
          createdAt: freshnessActivity?.createdAt ?? item.updatedAt,
          details: {
            workItemRevision: item.revision,
            bindingIds: staleRecordBindings.map((recordBinding) => recordBinding.id),
            bindingCount: staleRecordBindings.length,
            states: [...new Set(staleRecordBindings.map((recordBinding) =>
              recordBinding.resolution?.state ?? "unavailable"))],
            executionBlocked,
            postingBlocked: true,
            refreshable: (item.executionBindings ?? []).length === 0,
          },
        });
      }
      const binding = githubBinding(item);
      if (binding?.conflict) rows.push({
        id: `github_conflict:${item.id}`, kind: "github_conflict", severity: "high",
        workItemId: item.id, localRef: item.localRef, projectId: item.projectId,
        title: item.title, createdAt: binding.conflict.detectedAt, details: { fields: binding.conflict.fields },
      });
      if (binding?.remoteDeletedAt) rows.push({
        id: `github_deleted:${item.id}`, kind: "github_deleted", severity: "high",
        workItemId: item.id, localRef: item.localRef, projectId: item.projectId,
        title: item.title, createdAt: binding.remoteDeletedAt,
        details: { number: binding.number, repository: binding.repository },
      });
      const runBinding = [...(item.executionBindings ?? [])].reverse().find((bindingRow) => bindingRow.kind === "auto_run");
      const run = runBinding ? (state.autoRuns ?? []).find((candidate) => candidate.id === runBinding.targetId) : null;
      if (run?.status === "awaiting_approval") rows.push({
        id: `execution_approval:${item.id}:${run.id}`, kind: "execution_approval", severity: "high",
        workItemId: item.id, localRef: item.localRef, projectId: item.projectId,
        title: item.title, createdAt: run.updatedAt ?? run.createdAt ?? item.updatedAt,
        details: { autoRunId: run.id, status: run.status },
      });
      if (run?.status === "needs_input" && !run.clarifyAnswer) rows.push({
        id: `execution_input:${item.id}:${run.id}`, kind: "execution_input", severity: "high",
        workItemId: item.id, localRef: item.localRef, projectId: item.projectId,
        title: item.title, createdAt: run.updatedAt ?? run.createdAt ?? item.updatedAt,
        details: { autoRunId: run.id, status: run.status, questions: run.decision?.clarifyingQuestions ?? [] },
      });
      const failed = (item.verificationRecords ?? []).find((record) => record.status === "failed");
      if (failed) rows.push({
        id: `verification_failed:${item.id}:${failed.id}`, kind: "verification_failed", severity: "high",
        workItemId: item.id, localRef: item.localRef, projectId: item.projectId,
        title: item.title, createdAt: failed.recordedAt, details: { verificationId: failed.id, summary: failed.summary },
      });
      const gate = completionGate(item);
      if (!gate.ready && ["review", "done"].includes(item.status)) rows.push({
        id: `acceptance_blocked:${item.id}`, kind: "acceptance_blocked", severity: "medium",
        workItemId: item.id, localRef: item.localRef, projectId: item.projectId,
        title: item.title, createdAt: item.updatedAt,
        details: { missingCriteria: gate.missingCriteria, verificationRequired: gate.verificationRequired },
      });
    }
    for (const project of workItemId ? [] : (state.planningProjects ?? []).filter((candidate) => candidate.ownerTeamId === actorTeam(actor))) {
      for (const request of (project.recommendedActionApprovalRequests ?? []).filter((candidate) => candidate.status === "pending")) {
        rows.push({
          id: `recommended_action_approval:${project.id}:${request.id}`,
          kind: "recommended_action_approval",
          severity: "high",
          workItemId: null,
          localRef: null,
          projectId: null,
          planningProjectId: project.id,
          title: project.name,
          createdAt: request.requestedAt,
          details: {
            approvalRequestId: request.id, code: request.code,
            parameters: request.parameters, context: request.context,
            requestedBy: request.requestedBy,
          },
        });
      }
      for (const execution of (project.recommendedActionExecutions ?? []).filter((candidate) => candidate.status === "queued")) {
        rows.push({
          id: `governed_action:${project.id}:${execution.id}`, kind: "governed_action", severity: execution.risk,
          workItemId: null, localRef: null, projectId: null, planningProjectId: project.id,
          title: project.name, createdAt: execution.requestedAt,
          details: { executionId: execution.id, code: execution.code, approvalRequired: execution.approvalRequired },
        });
      }
    }
    const at = Date.parse(now());
    const operations = state.workItemAttentionOperations ?? [];
    const derivedRows = rows.map((row) => {
      const operation = operations.find((candidate) =>
        candidate.ownerTeamId === actorTeam(actor) && candidate.attentionId === row.id);
      const handling = operation?.handling && Date.parse(operation.handling.expiresAt ?? operation.handling.claimedAt) > at
        ? operation.handling
        : null;
      const resolution = row.kind === "record_binding_stale"
        ? null
        : operation?.resolution ?? null;
      const hours = row.severity === "high" ? 4 : row.severity === "medium" ? 24 : 72;
      const dueAt = new Date(Date.parse(row.createdAt) + hours * 3_600_000).toISOString();
      const history = row.workItemId ? (state.workItemActivities ?? [])
        .filter((activity) => activity.workItemId === row.workItemId)
        .slice(0, 5)
        .map((activity) => ({
          action: activity.action, actorId: activity.actorId, createdAt: activity.createdAt,
        })) : [];
      return {
        ...row, dueAt, slaStatus: Date.parse(dueAt) < at ? "breached" : "within_sla", history,
        updatedAt: operation?.history?.[0]?.createdAt ?? row.createdAt,
        handling,
        resolution,
      };
    });
    const allDecorated = derivedRows.filter((row) => !updatedSince || row.updatedAt > updatedSince);
    const decorated = allDecorated.filter((row) => !kind || row.kind === kind)
      .filter((row) => !severity || row.severity === severity)
      .filter((row) => !sla || row.slaStatus === sla)
      .filter((row) => !handler
        || (handler === "mine" && row.handling?.actorId === actorUser(actor))
        || (handler === "unclaimed" && !row.handling))
      .filter((row) => query.includeResolved === "1" || !row.resolution);
    const rank = { high: 3, medium: 2, low: 1 };
    decorated.sort((a, b) => rank[b.severity] - rank[a.severity]
      || String(a.dueAt).localeCompare(String(b.dueAt)) || a.id.localeCompare(b.id));
    const openRows = derivedRows.filter((row) => !row.resolution);
    const oldestCreatedAt = openRows.reduce((oldest, row) =>
      !oldest || row.createdAt < oldest ? row.createdAt : oldest, null);
    const page = paginateRows(decorated, query);
    if (!page.ok) return { ok: false, status: 400, body: { error: page.error } };
    return {
      ok: true, status: 200, body: {
        items: page.rows,
        count: page.rows.length,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        metrics: {
          backlog: openRows.length,
          breached: openRows.filter((row) => row.slaStatus === "breached").length,
          claimed: openRows.filter((row) => row.handling).length,
          pendingApprovals: openRows.filter((row) => row.kind === "recommended_action_approval").length,
          staleRecords: openRows.filter((row) => row.kind === "record_binding_stale").length,
          oldestAgeSeconds: oldestCreatedAt ? Math.max(0, Math.floor((at - Date.parse(oldestCreatedAt)) / 1_000)) : 0,
        },
      },
    };
  }

  function updateAttention({
    attentionIds, action, note = "", leaseSeconds = 900, idempotencyKey = null,
  } = {}, actor = null) {
    const ids = [...new Set((Array.isArray(attentionIds) ? attentionIds : []).map(String))];
    const lease = Number(leaseSeconds);
    const key = idempotencyKey == null ? null : String(idempotencyKey).trim();
    if (!ids.length || ids.length > 100 || !["claim", "renew", "release", "resolve", "reopen"].includes(action)
      || typeof note !== "string" || note.length > 5_000
      || !Number.isInteger(lease) || lease < 60 || lease > 86_400
      || (key != null && (!key || key.length > 200))) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_attention_update" } };
    }
    const visible = new Set(listAttention({ includeResolved: "1" }, actor).body.items.map((item) => item.id));
    if (ids.some((id) => !visible.has(id))) return { ok: false, status: 404, body: { error: "work_item_attention_not_found" } };
    if (action === "resolve" && ids.some((id) => id.startsWith("record_binding_stale:"))) {
      return {
        ok: false,
        status: 409,
        body: { error: "work_item_record_binding_attention_requires_refresh" },
      };
    }
    const timestamp = now();
    const operations = state.workItemAttentionOperations ?? [];
    const replayed = key && ids.every((attentionId) => operations.some((operation) =>
      operation.ownerTeamId === actorTeam(actor) && operation.attentionId === attentionId
      && operation.history?.some((entry) => entry.idempotencyKey === key)));
    if (replayed) {
      const updated = operations.filter((operation) =>
        operation.ownerTeamId === actorTeam(actor) && ids.includes(operation.attentionId));
      return { ok: true, status: 200, body: { updated, count: updated.length, replayed: true } };
    }
    for (const attentionId of ids) {
      const operation = operations.find((candidate) =>
        candidate.ownerTeamId === actorTeam(actor) && candidate.attentionId === attentionId);
      const active = operation?.handling && Date.parse(operation.handling.expiresAt ?? operation.handling.claimedAt) > Date.parse(timestamp)
        ? operation.handling
        : null;
      if (active && active.actorId !== actorUser(actor) && ["claim", "renew", "release", "resolve"].includes(action)) {
        return { ok: false, status: 409, body: { error: "work_item_attention_claim_conflict", attentionId, handling: active } };
      }
      if (action === "renew" && (!active || active.actorId !== actorUser(actor))) {
        return { ok: false, status: 409, body: { error: "work_item_attention_lease_not_owned", attentionId } };
      }
    }
    const updated = [];
    runTx(() => {
      for (const attentionId of ids) {
        let operation = (state.workItemAttentionOperations ??= []).find((candidate) =>
          candidate.ownerTeamId === actorTeam(actor) && candidate.attentionId === attentionId);
        if (!operation) {
          operation = { attentionId, ownerTeamId: actorTeam(actor), handling: null, resolution: null, history: [] };
          state.workItemAttentionOperations.unshift(operation);
        }
        if (action === "claim") operation.handling = {
          actorId: actorUser(actor), claimedAt: timestamp,
          expiresAt: new Date(Date.parse(timestamp) + lease * 1_000).toISOString(),
        };
        if (action === "renew") operation.handling = {
          ...operation.handling, renewedAt: timestamp,
          expiresAt: new Date(Date.parse(timestamp) + lease * 1_000).toISOString(),
        };
        if (action === "release") operation.handling = null;
        if (action === "resolve") operation.resolution = { actorId: actorUser(actor), resolvedAt: timestamp, note };
        if (action === "reopen") operation.resolution = null;
        operation.history.unshift({ action, actorId: actorUser(actor), createdAt: timestamp, note, idempotencyKey: key });
        updated.push(operation);
      }
    });
    return { ok: true, status: 200, body: { updated, count: updated.length } };
  }

  function ingestGithubWebhook({ deliveryId, event, payload, teamId = null, replayOf = null } = {}) {
    const id = String(deliveryId ?? "").trim();
    if (!id || id.length > 200 || !["issues", "issue_comment"].includes(event) || !payload?.issue) {
      return { ok: false, status: 400, body: { error: "invalid_github_work_item_webhook" } };
    }
    const prior = (state.githubWorkItemWebhookDeliveries ?? []).find((row) => row.id === id);
    if (prior) return { ok: true, status: 200, body: { ...prior.result, replayed: true } };
    const issue = payload.issue;
    const repository = String(payload.repository?.full_name ?? "");
    const matchingItems = (state.workItems ?? []).filter((item) => {
      if (teamId && item.ownerTeamId !== teamId) return false;
      const binding = githubBinding(item);
      return binding?.number === Number(issue.number)
        && (!binding.repository || !repository || binding.repository === repository);
    });
    if (event === "issue_comment") {
      const comment = payload.comment;
      if (!comment?.id || !["created", "edited", "deleted"].includes(payload.action)) {
        return { ok: false, status: 400, body: { error: "invalid_github_issue_comment_webhook" } };
      }
      let syncedComments = 0;
      runTx(() => {
        for (const item of matchingItems) {
          let local = (state.workItemComments ??= []).find((candidate) =>
            candidate.workItemId === item.id && candidate.externalBinding?.kind === "github_comment"
            && candidate.externalBinding.id === String(comment.id));
          if (!local) {
            local = {
              id: nextId("wic"), workItemId: item.id, ownerTeamId: item.ownerTeamId,
              projectId: item.projectId, body: String(comment.body ?? "").slice(0, MAX_COMMENT),
              revision: 1, createdAt: comment.created_at ?? now(), updatedAt: comment.updated_at ?? now(),
              createdBy: `github:${comment.user?.login ?? "unknown"}`,
              lastModifiedBy: `github:${comment.user?.login ?? "unknown"}`,
              deletedAt: null,
              externalBinding: { kind: "github_comment", id: String(comment.id), url: comment.html_url ?? null },
            };
            state.workItemComments.push(local);
          } else if (payload.action !== "deleted") {
            local.body = String(comment.body ?? "").slice(0, MAX_COMMENT);
            local.revision += 1;
            local.updatedAt = comment.updated_at ?? now();
          }
          if (payload.action === "deleted") local.deletedAt = comment.updated_at ?? now();
          recordActivity(item, { userId: "usr_github_webhook", teamId: item.ownerTeamId },
            `github_comment_${payload.action}`, { commentId: local.id, githubCommentId: String(comment.id) });
          syncedComments += 1;
        }
      });
      return recordGithubDelivery({
        id, event, repository, issueNumber: Number(issue.number), matchingItems, replayOf,
        result: { deliveryId: id, syncedComments, outcome: syncedComments ? "synced" : "no_match", replayOf },
        snapshot: null,
      });
    }
    if (payload.action === "deleted") {
      runTx(() => {
        for (const item of matchingItems) {
          const binding = githubBinding(item);
          binding.remoteDeletedAt = issue.updated_at ?? now();
          binding.remoteUpdatedAt = issue.updated_at ?? binding.remoteUpdatedAt;
          recordActivity(item, { userId: "usr_github_webhook", teamId: item.ownerTeamId },
            "github_issue_deleted", { number: binding.number, repository });
        }
      });
      return recordGithubDelivery({
        id, event, repository, issueNumber: Number(issue.number), matchingItems, replayOf,
        result: { deliveryId: id, deleted: matchingItems.length, outcome: matchingItems.length ? "deleted" : "no_match", replayOf },
        snapshot: null,
      });
    }
    const snapshot = normalizeGithubSnapshot({
      number: issue.number, title: issue.title, body: issue.body ?? "",
      state: issue.state, labels: (issue.labels ?? []).map((label) => label?.name ?? label),
      milestone: issue.milestone?.title ?? "",
      assigneeIds: (issue.assignees ?? []).map((assignee) => assignee?.login ?? assignee),
      url: issue.html_url, repository, updatedAt: issue.updated_at,
    });
    if (!snapshot) return { ok: false, status: 400, body: { error: "invalid_github_issue_snapshot" } };
    let synced = 0;
    let stale = 0;
    let conflicts = 0;
    const matchedTeamIds = new Set();
    for (const item of state.workItems ?? []) {
      if (teamId && item.ownerTeamId !== teamId) continue;
      const binding = githubBinding(item);
      if (!binding || binding.number !== snapshot.number
        || (binding.repository && repository && binding.repository !== repository)) continue;
      matchedTeamIds.add(item.ownerTeamId);
      if (Date.parse(snapshot.updatedAt) <= Date.parse(binding.remoteUpdatedAt)) {
        stale += 1;
        continue;
      }
      const result = syncGithubIssue({
        workItemId: item.id, expectedRevision: item.revision, direction: "pull", remote: snapshot,
      }, { userId: "usr_github_webhook", teamId: item.ownerTeamId });
      if (result.ok) synced += 1;
      else if (result.body?.error === "github_sync_conflict") conflicts += 1;
    }
    const outcome = conflicts ? "conflict" : synced ? "synced" : stale ? "stale" : "no_match";
    const result = { deliveryId: id, synced, stale, conflicts, outcome, replayOf };
    return recordGithubDelivery({
      id, event, repository, issueNumber: snapshot.number,
      matchingItems: [...matchedTeamIds].map((ownerTeamId) => ({ ownerTeamId })),
      replayOf, result, snapshot,
    });
  }

  function recordGithubDelivery({ id, event, repository, issueNumber, matchingItems, replayOf, result, snapshot }) {
    runTx(() => {
      (state.githubWorkItemWebhookDeliveries ??= []).unshift({
        id, event, receivedAt: now(), repository, issueNumber,
        teamIds: [...new Set(matchingItems.map((item) => item.ownerTeamId))],
        snapshot, replayOf, result,
      });
      state.githubWorkItemWebhookDeliveries = state.githubWorkItemWebhookDeliveries.slice(0, 1_000);
    });
    return { ok: true, status: 202, body: result };
  }

  function githubSyncDiagnostics(actor = null) {
    const own = (state.workItems ?? []).filter((item) => item.ownerTeamId === actorTeam(actor));
    const bindings = own.flatMap((item) => item.externalBindings ?? []).filter((binding) => binding.kind === "github_issue");
    const repositories = new Set(bindings.map((binding) => binding.repository).filter(Boolean));
    const deliveries = (state.githubWorkItemWebhookDeliveries ?? []).filter((delivery) =>
      delivery.teamIds?.includes(actorTeam(actor))
      || (!delivery.teamIds && repositories.has(delivery.repository)));
    const secretConfigured = Boolean(String(process.env.MYAGENTTOOL_GITHUB_WEBHOOK_SECRET ?? ""));
    const recentConflicts = deliveries.slice(0, 20).filter((delivery) => delivery.result?.conflicts > 0).length;
    const recentFailures = (state.githubWorkItemWebhookFailures ?? []).slice(0, 20);
    const deliveryWindow = deliveries.slice(0, 20);
    const totalAttempts = deliveryWindow.length + recentFailures.length;
    const health = !secretConfigured && bindings.length
      ? "misconfigured"
      : recentFailures.length || recentConflicts || bindings.some((binding) => binding.conflict)
        ? "degraded"
        : "healthy";
    return {
      ok: true, status: 200, body: {
        health,
        secretConfigured,
        boundIssues: bindings.length,
        conflicts: bindings.filter((binding) => binding.conflict).length,
        failureRate: totalAttempts ? recentFailures.length / totalAttempts : 0,
        lastWebhookAt: deliveries[0]?.receivedAt ?? null,
        recentFailures,
        recentDeliveries: deliveryWindow,
      },
    };
  }

  function replayGithubWebhook({ deliveryId } = {}, actor = null) {
    const source = (state.githubWorkItemWebhookDeliveries ?? []).find((delivery) => delivery.id === deliveryId);
    if (!source?.snapshot) return { ok: false, status: 404, body: { error: "github_webhook_delivery_not_found" } };
    const ownsBinding = (state.workItems ?? []).some((item) => {
      if (item.ownerTeamId !== actorTeam(actor)) return false;
      const binding = githubBinding(item);
      return binding?.number === source.issueNumber
        && (!binding.repository || binding.repository === source.repository);
    });
    if (!ownsBinding) return { ok: false, status: 404, body: { error: "github_webhook_delivery_not_found" } };
    return ingestGithubWebhook({
      deliveryId: `${source.id}:replay:${nextId("ghr")}`,
      event: "issues",
      teamId: actorTeam(actor),
      replayOf: source.id,
      payload: {
        repository: { full_name: source.repository },
        issue: {
          number: source.snapshot.number, title: source.snapshot.title, body: source.snapshot.body,
          state: source.snapshot.state, labels: source.snapshot.labels,
          html_url: source.snapshot.url, updated_at: source.snapshot.updatedAt,
        },
      },
    });
  }

  function recordGithubWebhookFailure({ deliveryId, event, reason } = {}) {
    const id = String(deliveryId ?? "").trim().slice(0, 200) || nextId("ghf");
    runTx(() => {
      (state.githubWorkItemWebhookFailures ??= []).unshift({
        id, event: String(event ?? "").slice(0, 100),
        reason: String(reason ?? "unknown").slice(0, 100), receivedAt: now(),
      });
      state.githubWorkItemWebhookFailures = state.githubWorkItemWebhookFailures.slice(0, 100);
    });
  }

  function ingestExternalWebhook({ provider, deliveryId, event = "issues", snapshot, replayOf = null } = {}) {
    const normalizedProvider = String(provider ?? "").toLowerCase();
    const id = String(deliveryId ?? "").trim();
    if (!["gitlab", "gitea"].includes(normalizedProvider) || !id || id.length > 200 || !snapshot) {
      return { ok: false, status: 400, body: { error: "invalid_external_work_item_webhook" } };
    }
    const normalized = normalizeGithubSnapshot(snapshot);
    if (!normalized) return { ok: false, status: 400, body: { error: "invalid_external_issue_snapshot" } };
    const deliveryKey = `${normalizedProvider}:${id}`;
    const prior = (state.externalWorkItemWebhookDeliveries ?? []).find((row) => row.id === deliveryKey);
    if (prior) return { ok: true, status: 200, body: { ...prior.result, replayed: true } };
    let synced = 0;
    let stale = 0;
    let conflicts = 0;
    const teamIds = new Set();
    for (const item of state.workItems ?? []) {
      const binding = externalIssueBinding(item, normalizedProvider);
      if (!binding || binding.number !== normalized.number
        || (binding.repository && normalized.repository && binding.repository !== normalized.repository)) continue;
      teamIds.add(item.ownerTeamId);
      if (Date.parse(normalized.updatedAt) <= Date.parse(binding.remoteUpdatedAt)) {
        stale += 1;
        continue;
      }
      const result = syncExternalIssue({
        workItemId: item.id, expectedRevision: item.revision, provider: normalizedProvider,
        direction: "pull", remote: normalized,
      }, { userId: `usr_${normalizedProvider}_webhook`, teamId: item.ownerTeamId });
      if (result.ok) synced += 1;
      else if (result.body?.error?.endsWith("_sync_conflict")) conflicts += 1;
    }
    const result = {
      deliveryId: id, provider: normalizedProvider, synced, stale, conflicts,
      outcome: conflicts ? "conflict" : synced ? "synced" : stale ? "stale" : "no_match", replayOf,
    };
    runTx(() => {
      (state.externalWorkItemWebhookDeliveries ??= []).unshift({
        id: deliveryKey, provider: normalizedProvider, event, receivedAt: now(),
        repository: normalized.repository, issueNumber: normalized.number,
        teamIds: [...teamIds], snapshot: normalized, replayOf, result,
      });
      state.externalWorkItemWebhookDeliveries = state.externalWorkItemWebhookDeliveries.slice(0, 1_000);
    });
    return { ok: true, status: 202, body: result };
  }

  function recordExternalWebhookFailure({ provider, deliveryId, event, reason } = {}) {
    runTx(() => {
      (state.externalWorkItemWebhookFailures ??= []).unshift({
        id: `${String(provider)}:${String(deliveryId ?? nextId("ewf")).slice(0, 200)}`,
        provider: String(provider ?? "").slice(0, 20),
        event: String(event ?? "").slice(0, 100),
        reason: String(reason ?? "unknown").slice(0, 100), receivedAt: now(),
      });
      state.externalWorkItemWebhookFailures = state.externalWorkItemWebhookFailures.slice(0, 100);
    });
  }

  function replayExternalWebhook({ provider, deliveryId } = {}, actor = null) {
    const key = `${String(provider).toLowerCase()}:${String(deliveryId)}`;
    const source = (state.externalWorkItemWebhookDeliveries ?? []).find((delivery) => delivery.id === key);
    if (!source?.snapshot || !source.teamIds?.includes(actorTeam(actor))) {
      return { ok: false, status: 404, body: { error: "external_webhook_delivery_not_found" } };
    }
    return ingestExternalWebhook({
      provider: source.provider, deliveryId: `${deliveryId}:replay:${nextId("ewr")}`,
      event: source.event, snapshot: source.snapshot, replayOf: deliveryId,
    });
  }

  function sweepOperationalAlerts() {
    const teamIds = [...new Set((state.workItems ?? []).map((item) => item.ownerTeamId).filter(Boolean))];
    let changed = 0;
    for (const teamId of teamIds) {
      const metrics = listAttention({}, { userId: "usr_work_item_alerts", teamId }).body.metrics;
      const breached = metrics?.breached ?? 0;
      changed += updateOperationalAlert({
        scope: `team:${teamId}`,
        signature: breached > 0 ? "breached" : "healthy",
        alert: breached > 0 ? {
          kind: "work_item_sla_breach", severity: "warning",
          message: `${breached} work item attention SLA(s) breached.`,
          data: { teamId, breached, backlog: metrics?.backlog ?? 0 },
        } : null,
      }) ? 1 : 0;
    }
    const deliveries = (state.githubWorkItemWebhookDeliveries ?? []).slice(0, 20);
    const failures = (state.githubWorkItemWebhookFailures ?? []).slice(0, 20);
    const attempts = deliveries.length + failures.length;
    const failureRate = attempts ? failures.length / attempts : 0;
    changed += updateOperationalAlert({
      scope: "github_webhook",
      signature: failureRate >= 0.05 ? "critical" : failureRate >= 0.01 ? "warning" : "healthy",
      alert: failureRate >= 0.01 ? {
        kind: "github_work_item_webhook_failures",
        severity: failureRate >= 0.05 ? "critical" : "warning",
        message: `GitHub work item Webhook failure rate is ${(failureRate * 100).toFixed(1)}%.`,
        data: { failureRate, failures: failures.length, attempts },
      } : null,
    }) ? 1 : 0;
    return { changed, failureRate };
  }

  function updateOperationalAlert({ scope, signature, alert }) {
    const existing = (state.workItemOperationalAlerts ?? []).find((candidate) => candidate.scope === scope);
    if (existing?.signature === signature) return false;
    runTx(() => {
      let row = existing;
      if (!row) {
        row = { scope, signature: "", updatedAt: null };
        (state.workItemOperationalAlerts ??= []).push(row);
      }
      const previous = row.signature;
      row.signature = signature;
      row.updatedAt = now();
      if (alert) {
        void sendAlert(alert);
        appendEvent({
          invocationId: null, type: alert.kind,
          level: alert.severity === "critical" ? "error" : "warn",
          message: alert.message, data: alert.data,
        });
      } else if (previous) {
        appendEvent({
          invocationId: null, type: "work_item_operational_recovered", level: "info",
          message: `${scope} operational alert recovered.`, data: { scope },
        });
      }
    });
    return true;
  }

  function getWorkItem({ workItemId }, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const effectiveResultVerificationContract = item.resultVerificationContract
      ? resultVerificationContract(item, { enforced: item.resultVerificationContract.enforced === true })
      : null;
    const projectedItem = effectiveResultVerificationContract
      ? {
        ...item,
        resultVerificationContract: effectiveResultVerificationContract,
        resultVerification: verifyWorkItemResult({ ...item, resultVerificationContract: effectiveResultVerificationContract }),
      }
      : item;
    const attention = listAttention({ workItemId, limit: 100 }, actor).body.items ?? [];
    const runIds = new Set((item.executionBindings ?? [])
      .filter((binding) => binding.kind === "auto_run")
      .map((binding) => binding.targetId));
    const boundRuns = (state.autoRuns ?? []).filter((run) => runIds.has(run.id));
    const latestRun = boundRuns
      .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0] ?? null;
    const pendingLocalDelivery = latestRun?.status === "done"
      && latestRun.link?.type === "local_issue"
      && latestRun.localDelivery
      && !latestRun.localDelivery.deliveredAt;
    const deliveryWorktree = pendingLocalDelivery
      ? (state.worktrees ?? []).find((worktree) => worktree.id === latestRun.localDelivery.worktreeId) ?? null
      : null;
    const deliveryReview = deliveryWorktree
      ? (state.worktreeReviews ?? []).find((review) => review.worktreeId === deliveryWorktree.id) ?? null
      : null;
    const latestRunBinding = [...(item.executionBindings ?? [])].reverse().find(
      (binding) => binding.kind === "auto_run" && binding.targetId === latestRun?.id,
    ) ?? null;
    const outcomeWorktreeId = latestRun?.localDelivery?.worktreeId ?? latestRunBinding?.worktreeId ?? null;
    const boundWorktreeIds = new Set((item.executionBindings ?? [])
      .map((binding) => binding.worktreeId)
      .filter(Boolean));
    if (outcomeWorktreeId) boundWorktreeIds.add(outcomeWorktreeId);
    const {
      deliveryProject,
      deliveryRemoteUrl,
      deliveryMode,
      relatedInvocations,
      runInvocations,
      latestExecutionInvocation,
      projectedDeliveryReview,
      projectedDeliveryReport,
      deliveryEvidence,
    } = projectWorkItemReviewEvidence({
      item: projectedItem,
      state,
      boundRuns,
      latestRun,
      pendingLocalDelivery,
      deliveryWorktree,
      deliveryReview,
      outcomeWorktreeId,
    });
    const outcomeFileContext = {
      projectId: item.projectId,
      worktreeId: outcomeWorktreeId,
      scopes: [
        ...(deliveryProject?.path ? [{ root: deliveryProject.path, worktreeId: null }] : []),
        ...(state.worktrees ?? [])
          .filter((worktree) => boundWorktreeIds.has(worktree.id) && worktree.projectId === item.projectId)
          .map((worktree) => ({ root: worktree.path ?? worktree.worktreePath, worktreeId: worktree.id })),
      ].filter((scope) => scope.root),
    };
    const taskOutcome = projectWorkItemOutcome({
      item: projectedItem,
      latestRun,
      deliveryReport: projectedDeliveryReport,
      invocationSummary: latestExecutionInvocation?.result?.output?.latestMessage
        ?? latestExecutionInvocation?.result?.output?.summary
        ?? latestExecutionInvocation?.result?.summary
        ?? null,
      fileContext: outcomeFileContext,
    });
    const outcomeHistory = (latestRun?.outcomeHistory ?? []).map((entry, index, entries) => ({
      version: entries.length - index,
      ...projectWorkItemOutcome({
        item: projectedItem,
        latestRun: {
          status: entry.status,
          report: entry.report,
          updatedAt: entry.completedAt ?? entry.supersededAt,
        },
        deliveryReport: entry.deliveryReport,
        fileContext: outcomeFileContext,
      }),
      invocationId: entry.invocationId ?? null,
      supersededAt: entry.supersededAt ?? null,
      supersededByFeedback: entry.supersededByFeedback ?? null,
    }));
    const invocationIds = new Set(relatedInvocations.map((invocation) => invocation.id));
    const failureStatuses = new Set(["failed", "timed_out", "cancelled", "rejected", "expired"]);
    const showRunHistory = runInvocations.length > 1
      || runInvocations.some((invocation) => failureStatuses.has(invocation.status));
    const runHistory = showRunHistory
      ? runInvocations.map((invocation, index) => {
        const autoRunId = invocation.options?.metadata?.autoRunId
          ?? boundRuns.find((run) => run.invocationId === invocation.id)?.id
          ?? null;
        const run = autoRunId ? boundRuns.find((candidate) => candidate.id === autoRunId) ?? null : null;
        const historicalOutcome = run?.outcomeHistory?.find((entry) => entry.invocationId === invocation.id) ?? null;
        const invocationSettled = failureStatuses.has(invocation.status) || invocation.status === "succeeded";
        const verification = historicalOutcome?.verification
          ?? historicalOutcome?.deliveryReport?.verification
          ?? (invocation.id === latestRun?.invocationId && invocationSettled
            ? latestRun?.deliveryReport?.verification ?? latestRun?.verification
            : null)
          ?? invocation.result?.output?.verification
          ?? invocation.result?.verification
          ?? null;
        const verified = verification?.verified === true
          || verification?.passed === true
          || verification?.passed === false
          || Number.isInteger(verification?.exitCode);
        const passed = verification?.passed === true || verification?.exitCode === 0;
        return {
          invocationId: invocation.id,
          autoRunId,
          attempt: index + 1,
          status: invocation.status,
          createdAt: invocation.createdAt ?? null,
          startedAt: invocation.startedAt ?? null,
          completedAt: invocation.completedAt ?? null,
          errorCode: invocation.result?.errorCode ?? null,
          summary: invocation.result?.summary
            ? String(invocation.result.summary).slice(0, 500)
            : historicalOutcome?.report ? String(historicalOutcome.report).slice(0, 500) : null,
          verification: verification ? {
            status: verified ? (passed ? "passed" : "failed") : "not_run",
            command: String(verification.command ?? verification.commands?.at?.(-1) ?? "").slice(0, 500) || null,
            summary: String(verification.summary ?? "").slice(0, 500) || null,
          } : null,
          current: invocation.id === latestRun?.invocationId,
        };
      })
      : [];
    const activeClaim = item.claim?.status === "active" && Date.parse(item.claim.leaseExpiresAt) > Date.parse(now())
      ? item.claim
      : null;
    const ledgerEntries = (state.ledgerEntries ?? []).filter(
      (entry) => (entry.localIssueId === item.id || (entry.autoRunId && runIds.has(entry.autoRunId)))
        && entry.billable !== false
        && !["voided", "cancelled"].includes(entry.status),
    );
    const knownCostUsd = ledgerEntries.reduce(
      (total, entry) => total + (entry.amountUsd != null && Number.isFinite(Number(entry.amountUsd)) ? Number(entry.amountUsd) : 0),
      0,
    );
    const costGroup = (keyFor, keyName) => [...ledgerEntries.reduce((groups, entry) => {
      const key = String(keyFor(entry) ?? "unattributed");
      const current = groups.get(key) ?? { [keyName]: key, knownUsd: 0, unknownEntries: 0, entryCount: 0 };
      current.entryCount += 1;
      if (entry.amountUsd != null && Number.isFinite(Number(entry.amountUsd))) current.knownUsd += Number(entry.amountUsd);
      else current.unknownEntries += 1;
      groups.set(key, current);
      return groups;
    }, new Map()).values()]
      .map((row) => ({ ...row, knownUsd: Number(row.knownUsd.toFixed(6)) }))
      .sort((left, right) => right.knownUsd - left.knownUsd);
    const projectBudget = budgetStatusFor(item.projectId);
    const teamBudget = teamBudgetStatusFor(item.ownerTeamId);
    const alertRows = (state.alertOutbox ?? []).filter((row) => {
      const data = row.alert?.data ?? {};
      return data.localIssueId === item.id || (data.autoRunId && runIds.has(data.autoRunId));
    });
    const activityTimeline = (state.workItemActivities ?? [])
      .filter((row) => row.workItemId === item.id)
      .map((row) => ({
        id: row.id, at: row.createdAt, source: "issue", type: row.action,
        stage: taskTraceStage(row.action, "issue"),
        actorId: row.actorId ?? null, message: row.action.replaceAll("_", " "), data: row.details ?? {},
      }));
    const executionTimeline = (state.invocationEvents ?? state.events ?? [])
      .filter((row) => invocationIds.has(row.invocationId) || row.data?.executionChainId === item.id)
      .map((row) => ({
        id: row.id, at: row.createdAt ?? row.at, source: "execution", type: row.type,
        stage: taskTraceStage(row.type, "execution"),
        actorId: null, message: row.message ?? row.type, data: row.data ?? {},
      }));
    const costTimeline = ledgerEntries.map((row) => ({
      id: row.id,
      at: row.createdAt ?? row.finalizedAt,
      source: "cost",
      type: "cost_recorded",
      stage: "execution",
      actorId: row.userId ?? null,
      message: row.amountUsd == null
        ? `Unmetered cost recorded for ${row.model ?? row.provider ?? "unknown model"}`
        : `${row.currency ?? "USD"} ${Number(row.amountUsd).toFixed(4)} recorded for ${row.model ?? row.provider ?? "unknown model"}`,
      data: { autoRunId: row.autoRunId ?? null, model: row.model ?? null, amountUsd: row.amountUsd ?? null },
    }));
    const alertTimeline = alertRows.map((row) => ({
      id: row.id,
      at: row.sentAt ?? row.nextAttemptAt ?? row.createdAt,
      source: "alert",
      type: row.alert?.kind ?? "alert",
      stage: taskTraceStage(row.alert?.kind ?? "alert", "alert"),
      actorId: null,
      message: `${row.alert?.kind ?? "alert"} · ${row.status}`,
      data: { status: row.status, attempts: row.attempts ?? 0, lastError: row.lastError ?? null },
    }));
    const traceStageOrder = ["creation", "routing", "queue", "execution", "approval", "tool", "verification", "retry", "completion", "other"];
    const timeline = [...activityTimeline, ...executionTimeline, ...costTimeline, ...alertTimeline]
      .filter((row) => row.at)
      .sort((left, right) =>
        String(left.at).localeCompare(String(right.at))
        || traceStageOrder.indexOf(left.stage) - traceStageOrder.indexOf(right.stage))
      .slice(0, 200);
    const comparableDurations = (state.autoRuns ?? [])
      .filter((run) => run.projectId === item.projectId
        && run.id !== latestRun?.id
        && run.decision?.path === latestRun?.decision?.path
        && ["pr_open", "report_posted", "done"].includes(run.status))
      .map((run) => Date.parse(run.updatedAt ?? "") - Date.parse(run.createdAt ?? ""))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right);
    const typicalDurationMs = comparableDurations.length
      ? comparableDurations[Math.floor(comparableDurations.length / 2)]
      : null;
    const p90DurationMs = comparableDurations.length
      ? comparableDurations[Math.min(comparableDurations.length - 1, Math.ceil(comparableDurations.length * 0.9) - 1)]
      : null;
    const calibrationErrors = comparableDurations.flatMap((actual, index) => {
      const training = comparableDurations.filter((_value, candidateIndex) => candidateIndex !== index);
      if (!training.length) return [];
      const predicted = training[Math.floor(training.length / 2)];
      return [Math.abs(actual - predicted)];
    });
    const calibrationMaeMs = calibrationErrors.length
      ? Math.round(calibrationErrors.reduce((sum, value) => sum + value, 0) / calibrationErrors.length)
      : null;
    const elapsedMs = latestRun ? Math.max(0, Date.parse(now()) - Date.parse(latestRun.createdAt ?? latestRun.updatedAt)) : null;
    const terminal = latestRun && ["pr_open", "report_posted", "done", "failed", "blocked", "needs_input"].includes(latestRun.status);
    const estimate = latestRun ? {
      sampleCount: comparableDurations.length,
      typicalDurationMs,
      p90DurationMs,
      calibrationSampleCount: calibrationErrors.length,
      calibrationMaeMs,
      elapsedMs,
      remainingMs: terminal || typicalDurationMs == null || elapsedMs == null ? null : Math.max(0, typicalDurationMs - elapsedMs),
      confidence: comparableDurations.length >= 5 ? "high" : comparableDurations.length >= 2 ? "medium" : "low",
    } : null;
    const selectedPath = latestRun?.decision?.path ?? null;
    const routeSignals = {
      develop: item.type === "bug" || item.type === "feature" ? "The issue requests a concrete product change." : "No stronger change signal.",
      office: /台账|表格|excel|csv|报价|订单|合同|客户/i.test(`${item.title} ${item.body}`) ? "Office or business-data language is present." : "No office artifact signal.",
      general: "A concrete task is present without a stronger specialist workflow signal.",
      design: /design|ux|ui|mockup|wireframe/i.test(`${item.title} ${item.body}`) ? "Design/UI language is present." : "No design artifact signal.",
      creative: /海报|封面|插画|logo|poster|illustration|graphic design/i.test(`${item.title} ${item.body}`) ? "Visual creative language is present." : "No visual creative signal.",
      content: /文章|文案|公众号|脚本|article|copywriting|newsletter/i.test(`${item.title} ${item.body}`) ? "Content-production language is present." : "No content deliverable signal.",
      prototype: /prototype|spike|experiment|proof of concept/i.test(`${item.title} ${item.body}`) ? "Experiment language is present." : "No experiment signal.",
      clarify: latestRun?.decision?.clarifyingQuestions?.length ? "The router identified unresolved questions." : "No unresolved questions were detected.",
      decompose: item.type === "initiative" ? "The item is an initiative and may require decomposition." : "The item is not classified as an initiative.",
    };
    const routeCandidates = ["develop", "office", "general", "design", "creative", "content", "prototype", "clarify", "decompose"].map((path, index) => ({
      path,
      selected: path === selectedPath,
      score: path === selectedPath
        ? latestRun?.decision?.confidence ?? null
        : Math.max(0, Number(((latestRun?.decision?.confidence ?? 0.5) - 0.12 - index * 0.04).toFixed(2))),
      reason: path === selectedPath
        ? latestRun?.decision?.rationale ?? routeSignals[path]
        : routeSignals[path],
    }));
    const nextAction = attention.some((row) => row.kind === "execution_input")
      ? "answer_ai"
      : attention.some((row) => row.kind === "execution_approval")
        ? "review_approval"
      : attention.some((row) => row.kind === "github_conflict")
        ? "resolve_sync_conflict"
        : executionState(item) === "failed"
          ? "inspect_failure"
          : pendingLocalDelivery
            ? "review_delivery"
          : item.state === "closed"
            ? "none"
            : latestRun
              ? "monitor_execution"
              : "start_execution";
    const startReceipt = projectExecutionStartReceipt(item, state, { now: now() });
    const executionReview = projectWorkItemExecutionReview({
      item: projectedItem,
      state,
      startReceipt,
      deliveryEvidence,
      now: now(),
    });
    const taskContextSummary = projectWorkItemContextSummary({
      item,
      state,
      ownerTeamId: actorTeam(actor),
    });
    const projectedIntentContract = item.executionIntentContractSnapshot ?? buildWorkItemIntentContract(item);
    const projectedPlanActual = projectWorkItemPlanActual({
      item: projectedItem.executionIntentContractSnapshot
        ? projectedItem
        : { ...projectedItem, intentContract: projectedIntentContract },
      latestRun,
      outcome: taskOutcome,
      deliveryEvidence,
      executionReview,
      contextSummary: taskContextSummary,
    });
    const planActualFeedback = projectedPlanActual
      ? state.workItemPlanActualFeedback.find((feedback) =>
        feedback.ownerTeamId === actorTeam(actor)
        && feedback.workItemId === item.id
        && feedback.runId === projectedPlanActual.runId
        && feedback.planActualDigest === projectedPlanActual.digest) ?? null
      : null;
    const planActual = projectedPlanActual ? {
      ...projectedPlanActual,
      feedback: planActualFeedbackView(planActualFeedback),
    } : null;
    const completionAssessment = assessWorkItemCompletion({
      item: projectedItem,
      latestRun,
      planActual,
      completionGate: completionGate(projectedItem),
    });
    return {
      ok: true,
      status: 200,
      body: {
        workItem: workItemView(projectedItem, actor),
        observability: {
          executionChainId: item.id,
          nextAction,
          executionReview,
          planActual,
          completionAssessment,
          attention,
          latestRun: latestRun ? {
            id: latestRun.id,
            status: latestRun.status,
            phase: latestRun.phase ?? null,
            updatedAt: latestRun.updatedAt,
            decision: latestRun.decision ?? null,
            routingOverride: latestRun.routingOverride ? {
              recommendedPath: latestRun.routingOverride.recommendedPath ?? null,
              actualPath: latestRun.routingOverride.actualPath,
              reason: latestRun.routingOverride.reason,
              actorId: latestRun.routingOverride.actorId,
              recordedAt: latestRun.routingOverride.recordedAt,
              revision: latestRun.routingOverride.revision,
            } : null,
            terminalOutcome: latestRun.terminalOutcome ?? null,
            invocationId: latestRun.invocationId ?? null,
            agentId: latestRun.agentId ?? null,
            report: latestRun.report ?? null,
            localDelivery: latestRun.localDelivery ?? null,
            deliveryReport: projectedDeliveryReport,
            deliveryReview: projectedDeliveryReview,
          } : null,
          outcome: taskOutcome,
          outcomeHistory,
          runHistory,
          delivery: pendingLocalDelivery ? {
            state: "awaiting_review",
            mode: deliveryMode,
            worktreeId: deliveryWorktree?.id ?? latestRun.localDelivery.worktreeId,
            branchName: latestRun.localDelivery.branchName ?? deliveryWorktree?.branchName ?? null,
            remoteUrl: deliveryRemoteUrl,
            report: projectedDeliveryReport,
            aiReview: projectedDeliveryReview,
            review: deliveryReview ? {
              verdict: deliveryReview.verdict,
              summary: deliveryReview.summary ?? null,
              comments: Array.isArray(deliveryReview.comments) ? deliveryReview.comments : [],
              reviewedCommit: deliveryReview.reviewedCommit ?? null,
              reviewedBy: deliveryReview.reviewedBy ?? null,
              source: deliveryReview.source ?? "human",
              reviewerName: deliveryReview.reviewerName ?? null,
              reviewInvocationId: deliveryReview.reviewInvocationId ?? null,
              createdAt: deliveryReview.createdAt ?? null,
            } : null,
            evidence: deliveryEvidence,
          } : null,
          deliveryEvidence,
          activeClaim: activeClaim ? {
            actorId: activeClaim.claimedBy ?? null,
            claimedAt: activeClaim.claimedAt ?? null,
            expiresAt: activeClaim.expiresAt ?? activeClaim.leaseExpiresAt ?? null,
          } : null,
          cost: {
            knownUsd: Number(knownCostUsd.toFixed(6)),
            unknownEntries: ledgerEntries.filter((entry) => entry.amountUsd == null || !Number.isFinite(Number(entry.amountUsd))).length,
            entryCount: ledgerEntries.length,
            byAutoRun: costGroup((entry) => entry.autoRunId, "autoRunId"),
            byModel: costGroup((entry) => entry.model ?? entry.counterparty, "model"),
            byBudgetPool: costGroup((entry) => entry.budgetPoolId, "budgetPoolId"),
            projectBudget: projectBudget?.exists ? projectBudget : null,
            teamBudget: teamBudget?.exists ? teamBudget : null,
          },
          alerts: {
            queued: alertRows.filter((row) => row.status === "queued").length,
            failed: alertRows.filter((row) => row.status === "failed").length,
            sent: alertRows.filter((row) => row.status === "sent").length,
            skipped: alertRows.filter((row) => row.status === "skipped").length,
            items: alertRows.slice(0, 10).map((row) => ({
              id: row.id,
              kind: row.alert?.kind ?? "unknown",
              status: row.status,
              attempts: Number(row.attempts ?? 0),
              nextAttemptAt: row.nextAttemptAt ?? null,
              sentAt: row.sentAt ?? null,
              lastError: row.lastError ?? null,
            })),
          },
          timeline,
          estimate,
          routingExplanation: latestRun ? {
            selectedPath,
            via: latestRun.decision?.via ?? latestRun.decision?.decidedBy ?? "unknown",
            confidence: latestRun.decision?.confidence ?? null,
            rationale: latestRun.decision?.rationale ?? null,
            humanCorrection: latestRun.routingOverride ? {
              actualPath: latestRun.routingOverride.actualPath,
              reason: latestRun.routingOverride.reason,
              actorId: latestRun.routingOverride.actorId,
              recordedAt: latestRun.routingOverride.recordedAt,
            } : null,
            candidates: routeCandidates,
          } : null,
        },
      },
    };
  }

  function suggestWorkItemDraft(input = {}, actor = null) {
    const projectId = String(input.projectId ?? "");
    if (!projectId || !actorCanAccessProject(state, actor, projectId)) return notFound();
    const title = String(input.title ?? "").trim().slice(0, 300);
    const body = String(input.body ?? "").trim().slice(0, 20_000);
    if (!title) return { ok: false, status: 400, body: { error: "title_required" } };
    const lower = `${title} ${body}`.toLowerCase();
    const type = /bug|fix|error|fail|崩溃|错误|修复/.test(lower) ? "bug"
      : /initiative|epic|项目|计划/.test(lower) ? "initiative"
        : /feature|新增|支持|能力/.test(lower) ? "feature" : "task";
    const extractedCriteria = input.ignoreBodyAcceptanceCriteria === true
      ? []
      : extractAcceptanceCriteriaFromBody(body);
    let materialDraft = null;
    const materialDraftId = String(input.materialDraftId ?? "").trim();
    if (materialDraftId) {
      if (typeof inspectTaskMaterialDraft !== "function") {
        return { ok: false, status: 503, body: { error: "task_material_service_unavailable" } };
      }
      const inspected = inspectTaskMaterialDraft({ projectId, draftId: materialDraftId }, actor);
      if (inspected.status !== 200) return { ok: false, status: inspected.status, body: inspected.body };
      materialDraft = inspected.body.draft;
      const expectedRevision = Number(input.materialDraftRevision);
      if (Number.isInteger(expectedRevision) && expectedRevision !== materialDraft.revision) {
        return { ok: false, status: 409, body: { error: "task_material_revision_conflict", currentRevision: materialDraft.revision } };
      }
    }
    const channelAttachments = Array.isArray(input.inputAssets)
      ? input.inputAssets.slice(0, 100).map((asset) => ({
        ...asset,
        originalName: asset?.originalName
          ?? asset?.name
          ?? String(asset?.path ?? "").replaceAll("\\", "/").split("/").at(-1),
      }))
      : [];
    const attachments = channelAttachments.length ? channelAttachments : (materialDraft?.assets ?? []);
    const attachmentNames = attachments.map((asset) => asset.originalName).filter(Boolean).join("\n");
    const templateMatch = matchPublishedMyTemplate({
      definitions: (state.routineDefinitions ?? []).filter((definition) => definition.ownerTeamId === actorTeam(actor)),
      routingFeedback: state.myTemplateRoutingFeedback.filter((feedback) =>
        feedback.ownerTeamId === actorTeam(actor) && feedback.projectId === projectId),
      outcomeFeedback: state.myTemplateOutcomeFeedback.filter((feedback) =>
        feedback.ownerTeamId === actorTeam(actor) && feedback.projectId === projectId),
      planActualFeedback: state.workItemPlanActualFeedback.filter((feedback) =>
        feedback.ownerTeamId === actorTeam(actor) && feedback.projectId === projectId),
      governanceInterventions: state.myTemplateGovernanceInterventions.filter((entry) =>
        entry.ownerTeamId === actorTeam(actor) && entry.projectId === projectId),
      projectId,
      intent: `${title}\n${body}`,
      attachments,
    });
    const preferenceHints = planActualPreferenceHints({ projectId, intent: `${title}\n${body}`, actor });
    const selectedDefinition = templateMatch.selected
      ? (state.routineDefinitions ?? []).find((definition) => definition.id === templateMatch.selected.definitionId)
      : null;
    const templateContract = definitionTemplateContract(selectedDefinition);
    const expectedOutput = templateMatch.selected?.expectedOutput ?? "工作结果";
    const outputFileName = templateContract?.outputFileName || expectedOutput;
    const outputColumns = (templateContract?.outputColumns ?? []).filter(Boolean);
    const uncertainFields = (templateContract?.uncertainFields ?? []).filter(Boolean);
    const chinese = /[\u3400-\u9fff]/.test(`${title}${body}${attachmentNames}`);
    const businessLike = attachments.length > 0 || templateMatch.state !== "missing";
    const templateAcceptance = selectedDefinition ? [
      `生成并可正常打开${outputFileName}`,
      ...(outputColumns.length ? [`结果保留模版约定的 ${outputColumns.length} 个字段，字段名称和顺序一致`] : []),
      "输入材料中能够确认的信息已准确写入结果",
      ...(uncertainFields.length ? [`${uncertainFields.join("、")}无法确认时保持空白，不得猜测`] : []),
    ] : [];
    const acceptanceCriteria = extractedCriteria.length ? extractedCriteria
      : templateAcceptance.length ? templateAcceptance
        : businessLike && chinese ? [
          `已生成可查看、可继续使用的${expectedOutput}`,
          "结果中的关键信息与输入文件一致，无法确认的内容没有被猜测填充",
        ] : chinese ? [
          `已完成“${title}”并生成可查看的结果。`,
          "结果与用户提供的目标和材料一致，无法确认的内容没有被猜测填充。",
          ...(type === "bug" ? ["已复现原问题，并通过回归验证。"] : []),
        ] : [
          `The requested outcome for “${title}” is demonstrably complete.`,
          "Automated verification covers the primary success path.",
          ...(type === "bug" ? ["A regression test reproduces the prior failure and passes after the fix."] : []),
        ];
    const verificationSop = businessLike && chinese ? [
      `打开${outputFileName}，确认文件可正常查看且格式完整`,
      "对照输入材料抽查关键信息，确认名称、规格、数量等内容准确",
      ...(uncertainFields.length ? [`检查${uncertainFields.join("、")}；原文没有依据时应保持空白`] : []),
      "确认系统只处理任务中的安全副本，原始文件未被修改",
    ] : defaultVerificationSop({ title, body });
    return {
      ok: true, status: 200, body: {
        draft: {
          title, body: body || `Implement ${title} with a user-visible result and documented verification.`,
          type, priority: /urgent|critical|p0|紧急|严重/.test(lower) ? "p0" : "p2",
          acceptanceCriteria,
          verificationSop,
          executionContractSource: extractedCriteria.length ? "body_extracted" : "assisted",
          suggestedRoute: type === "initiative" ? "decompose" : body.length < 40 ? "clarify" : "develop",
          templateMatch,
          risks: [
            ...preferenceHints.map((hint) => hint.kind === "materials"
              ? "相似任务曾纠正过资料版本；启动前请重新确认资料范围。"
              : hint.kind === "delivery"
                ? "相似任务曾纠正过交付位置；启动前请确认结果留在任务还是发送到 Channel。"
                : hint.kind === "scope"
                  ? "相似任务曾纠正过读写范围；本次仍需单独确认，不会自动扩大写入权限。"
                  : hint.kind === "template" || hint.kind === "result"
                    ? "相似任务曾纠正过结果类型；系统已将它作为本次模板匹配信号。"
                    : "相似任务曾纠正过检查要求；本次仍保留独立验证。"),
            ...(businessLike && chinese
              ? ["系统只处理任务中的安全副本，不会修改原始文件。"]
              : [...(!body ? ["The problem statement needs more context."] : []), "Confirm affected users and rollback expectations before execution."]),
          ],
          evidence: {
            generator: "heuristic",
            policyVersion: "local-work-item-draft-v1",
            modelVersion: null,
            inputDigest: createHash("sha256").update(JSON.stringify({
              projectId, title, body, attachments: attachments.map((asset) => ({ name: asset.originalName, hash: asset.hash, version: asset.version })),
            })).digest("hex"),
            confidence: body.length >= 120 ? 0.78 : body.length >= 40 ? 0.65 : 0.45,
          },
          preferenceHints,
        },
      },
    };
  }

  function previewIntentTaskPlan(input = {}, actor = null) {
    const projectId = String(input.projectId ?? "");
    if (!projectId || !actorCanAccessProject(state, actor, projectId)) return notFound();
    const title = String(input.title ?? "").trim().slice(0, 300);
    const body = String(input.body ?? "").trim().slice(0, 20_000);
    const clarificationAnswer = String(input.clarificationAnswer ?? "").trim().slice(0, 1_000);
    const statement = [
      title,
      body && body !== title ? body : "",
      clarificationAnswer ? `用户补充：${clarificationAnswer}` : "",
    ].filter(Boolean).join("\n").slice(0, 4_000);
    if (!statement) return { ok: false, status: 400, body: { error: "intent_statement_required" } };
    const excludeKinds = [...new Set((Array.isArray(input.excludeKinds) ? input.excludeKinds : [])
      .map((kind) => String(kind ?? "").trim().slice(0, 80))
      .filter(Boolean))].slice(0, 30);
    const excludeTaskKeys = [...new Set((Array.isArray(input.excludeTaskKeys) ? input.excludeTaskKeys : [])
      .map((key) => String(key ?? "").trim().slice(0, 160))
      .filter(Boolean))].slice(0, 50);
    const requestedSourceId = String(input.sourceWorkItemId ?? "").trim();
    const sourceQuery = String(input.sourceQuery ?? "").trim().toLowerCase().slice(0, 120);
    const referencesExistingResult = Boolean(requestedSourceId)
      || /(?:根据|基于|结合|使用|沿用|接着|继续).{0,24}(?:已有|现有|前面|此前|之前|刚才|上一个|已经完成|已完成).{0,24}(?:分析|结果|报告|方案|文章|资料|任务|成果)|(?:根据|基于).{0,20}(?:分析结果|分析报告|已有结果|前序结果|上一步结果)|based on (?:the )?(?:existing|previous|earlier) (?:analysis|result|report|task)/i.test(statement);
    const sourceRows = (state.workItems ?? [])
      .filter((item) => item.ownerTeamId === actorTeam(actor)
        && item.projectId === projectId
        && (item.status === "done" || item.state === "closed" || item.executionState === "completed")
        && (item.outputAssets ?? []).some((asset) => asset?.id && asset?.path && asset?.terminalId)
        && (item.artifactContract?.produces ?? []).length
        && (!sourceQuery || [item.localRef, item.title, ...(item.artifactContract?.produces ?? [])]
          .some((value) => String(value ?? "").toLowerCase().includes(sourceQuery))))
      .sort((left, right) => String(right.completedAt ?? right.updatedAt ?? "").localeCompare(String(left.completedAt ?? left.updatedAt ?? "")));
    const selectedSource = requestedSourceId
      ? sourceRows.find((item) => item.id === requestedSourceId) ?? null
      : null;
    if (requestedSourceId && !selectedSource) {
      return { ok: false, status: 400, body: { error: "intent_source_work_item_invalid" } };
    }
    const selectedTransfer = selectedSource
      ? validatedArtifactTransfer({ source: selectedSource, kinds: selectedSource.artifactContract?.produces ?? [] })
      : null;
    if (selectedSource && selectedTransfer.handoff.status !== "attached") {
      return {
        ok: false,
        status: 409,
        body: {
          error: "intent_source_artifacts_invalid",
          workItemId: selectedSource.id,
          validationErrors: selectedTransfer.handoff.validationErrors,
        },
      };
    }
    const sourceCandidates = (selectedSource
      ? [selectedSource, ...sourceRows.filter((item) => item.id !== selectedSource.id)]
      : sourceRows)
      .slice(0, 20)
      .map((item) => {
        const transfer = validatedArtifactTransfer({ source: item, kinds: item.artifactContract?.produces ?? [] });
        return {
          workItemId: item.id,
          localRef: item.localRef,
          title: item.title,
          completedAt: item.completedAt ?? item.updatedAt ?? null,
          artifactKinds: [...new Set(item.artifactContract?.produces ?? [])],
          readyArtifactKinds: transfer.handoff.kinds,
          outputCount: (item.outputAssets ?? []).length,
          ready: transfer.handoff.status === "attached",
          validationErrors: transfer.handoff.validationErrors,
        };
      });
    const intentId = String(input.intentId ?? "").trim()
      || `desktop-intent:${createHash("sha256").update(`${projectId}\n${statement}`).digest("hex").slice(0, 24)}`;
    const inspected = input.materialDraftId && typeof inspectTaskMaterialDraft === "function"
      ? inspectTaskMaterialDraft({ projectId, draftId: String(input.materialDraftId) }, actor)
      : null;
    if (inspected && inspected.status !== 200) return { ok: false, status: inspected.status, body: inspected.body };
    let plan = planDiscreteTasks({
      text: statement,
      intentId,
      excludeKinds,
      excludeTaskKeys,
      materials: (inspected?.body?.draft?.assets ?? []).map((asset) => ({
        id: asset.id,
        contentId: asset.contentId,
        title: asset.originalName ?? asset.path,
      })),
    });
    if (!plan.tasks.length && !plan.clarification
      && /^(?:(?:请|帮我|麻烦)?(?:按|照)?(?:这个|这样|上面(?:这个)?|刚才(?:那个)?|之前(?:那个)?)?\s*(?:优化|完善|处理|调整|修改|改|弄|做)(?:一下|下)?)[。.!！?？]*$/i.test(statement)) {
      plan = {
        ...plan,
        clarification: {
          kind: "task_scope",
          prompt: "你希望优化或修改什么？请补充对象和想得到的结果，例如“优化首页任务创建，让手机上也能顺畅使用”。我先不创建笼统任务。",
        },
      };
    }
    if (!plan.tasks.length && !plan.clarification && (excludeKinds.length || excludeTaskKeys.length)) {
      plan = {
        ...plan,
        clarification: {
          kind: "task_selection_empty",
          prompt: "方案里已经没有要创建的任务。请恢复至少一项，或重新描述希望完成的结果。",
        },
      };
    }
    if (!plan.tasks.length && !plan.clarification) {
      plan = {
        ...plan,
        tasks: [{
          key: "general",
          kind: "general",
          domain: "general",
          title: title || statement.slice(0, 120),
          outcome: `完成“${(title || statement).slice(0, 100)}”并交付可检查的结果`,
          intentId,
          intentStatement: statement,
          creationBasis: "explicit_user_intent",
          planningHorizon: "committed",
          sourceContentIds: [],
          sourceTitles: [],
          requires: [],
          artifactContract: { consumes: [], produces: [], requirements: [] },
          platform: null,
          approvalRequired: false,
          gate: null,
        }],
      };
    }
    if (selectedSource) {
      const sourceKinds = [...new Set(selectedSource.artifactContract?.produces ?? [])];
      plan = {
        ...plan,
        tasks: plan.tasks.map((task) => (task.requires ?? []).length ? task : {
          ...task,
          artifactContract: {
            ...task.artifactContract,
            consumes: [...new Set([...(task.artifactContract?.consumes ?? []), ...sourceKinds])],
          },
          externalSource: {
            workItemId: selectedSource.id,
            localRef: selectedSource.localRef,
            title: selectedSource.title,
            artifactKinds: sourceKinds,
          },
        }),
      };
    }
    const sourceSelectionRequired = referencesExistingResult && !selectedSource;
    const usableSourceCandidates = sourceCandidates.filter((candidate) => candidate.ready);
    const sourceSelection = referencesExistingResult ? {
      required: sourceSelectionRequired,
      candidates: sourceCandidates,
      selected: selectedSource ? sourceCandidates.find((candidate) => candidate.workItemId === selectedSource.id) ?? null : null,
      unavailable: sourceSelectionRequired && usableSourceCandidates.length === 0,
      query: sourceQuery,
    } : null;
    plan = { ...plan, sourceSelection, excludedKinds: excludeKinds, excludedTaskKeys: excludeTaskKeys };
    const contract = validateTaskPlan(plan, { requireTasks: !plan.clarification });
    if (!contract.ok) {
      return { ok: false, status: 422, body: { error: "invalid_intent_task_plan", details: contract.errors } };
    }
    const repositoryKinds = new Set([
      "coding_digest", "software_analysis", "software_implementation", "software_verification", "software_deployment",
    ]);
    const capabilityReadiness = taskPlanCapabilityReadiness(state, plan.tasks);
    return {
      ok: true,
      status: 200,
      body: {
        plan: { ...plan, planContract: contract },
        summary: {
          taskCount: plan.tasks.length,
          requiresRepository: plan.tasks.some((task) => repositoryKinds.has(task.kind)),
          approvalTaskCount: plan.tasks.filter((task) => task.approvalRequired).length,
          canCommit: !plan.clarification && !sourceSelectionRequired,
          canStartAi: capabilityReadiness.ready,
          capabilityBlockers: capabilityReadiness.blockers,
          nextStep: plan.clarification?.prompt
            ?? (sourceSelectionRequired
              ? usableSourceCandidates.length
                ? "请选择这次工作要使用的已有结果；确认后系统会建立真实的任务和产物依赖。"
                : "没有找到可使用的已完成结果。请先完成前序任务，或把结果作为附件加入。"
              : null)
            ?? (!capabilityReadiness.ready
              ? `可以先保存任务；交给 AI 前还需要配置：${capabilityReadiness.blockers.map((blocker) => blocker.requiredCapability).join("、")}。`
              : plan.tasks.some((task) => task.approvalRequired)
                ? "先创建可执行任务；涉及发布、发送或部署时再由你确认。"
                : `确认后将创建 ${plan.tasks.length} 项可独立执行的任务。`),
        },
      },
    };
  }

  function commitIntentTaskPlan(input = {}, actor = null) {
    const projectId = String(input.projectId ?? "");
    const mode = input.mode === "ai" ? "ai" : "task";
    const idempotencyKey = String(input.idempotencyKey ?? "").trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return { ok: false, status: 400, body: { error: "intent_plan_idempotency_key_required" } };
    }
    const replayGoal = (state.workGoals ?? []).find((goal) =>
      goal.ownerTeamId === actorTeam(actor)
      && goal.projectId === projectId
      && goal.createIdempotencyKey === idempotencyKey);
    if (replayGoal) {
      const workItems = (replayGoal.taskIds ?? [])
        .map((id) => findOwn(id, actor))
        .filter(Boolean)
        .map((item) => workItemView(item, actor));
      return { ok: true, status: 200, body: { workGoal: replayGoal, workItems, replayed: true } };
    }
    const preview = previewIntentTaskPlan(input, actor);
    if (!preview.ok) return preview;
    const { plan } = preview.body;
    if (plan.clarification) {
      return { ok: false, status: 409, body: { error: "intent_clarification_required", clarification: plan.clarification } };
    }
    if (plan.sourceSelection?.required) {
      return {
        ok: false,
        status: 409,
        body: { error: "intent_source_selection_required", sourceSelection: plan.sourceSelection },
      };
    }
    if (mode === "ai" && preview.body.summary.canStartAi === false) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "intent_task_capability_required",
          capabilityBlockers: preview.body.summary.capabilityBlockers,
        },
      };
    }
    const timestamp = now();
    const goalId = `desktop-goal:${nextId("wgl")}`;
    const workGoal = {
      id: goalId,
      ownerTeamId: actorTeam(actor),
      projectId,
      conversationId: null,
      sourceEventIds: [],
      title: plan.goal?.title ?? String(input.title ?? "一件待完成的工作").slice(0, 120),
      statement: plan.goal?.statement ?? String(input.body ?? input.title ?? "").slice(0, 4_000),
      outcome: plan.goal?.outcome ?? "完成用户明确提出的工作",
      planContract: plan.planContract.summary,
      intentConfidence: plan.planContract.confidence,
      domains: plan.goal?.domains ?? [],
      platforms: plan.goal?.platforms ?? [],
      status: "active",
      planVersion: 1,
      taskIds: [],
      artifacts: [],
      createIdempotencyKey: idempotencyKey,
      createdBy: actorUser(actor),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    runTx(() => { (state.workGoals ??= []).push(workGoal); });

    const createdByKey = new Map();
    const pending = [...plan.tasks];
    const created = [];
    let sharedInputAssets = null;
    try {
      while (pending.length) {
        const index = pending.findIndex((task) => (task.requires ?? []).every((key) => createdByKey.has(key)));
        if (index < 0) throw new Error("intent_task_dependency_order_invalid");
        const [task] = pending.splice(index, 1);
        const approvalRequired = task.approvalRequired === true;
        const taskBody = [
          task.outcome,
          task.executionInstructions,
          `原始需求：${plan.intent?.statement ?? workGoal.statement}`,
          approvalRequired ? "到达对外发布、发送、部署或上游审核步骤时必须等待用户确认。" : "只完成这一项任务，不自动执行同一目标中的其他任务。",
        ].filter(Boolean).join("\n\n");
        const assisted = suggestWorkItemDraft({ projectId, title: task.title, body: taskBody }, actor);
        if (!assisted.ok) throw new Error(assisted.body?.error ?? "intent_task_draft_failed");
        const singleTaskCriteria = plan.tasks.length === 1 && Array.isArray(input.acceptanceCriteria)
          ? input.acceptanceCriteria.map((value) => String(value).trim()).filter(Boolean)
          : null;
        const singleTaskSop = plan.tasks.length === 1 && Array.isArray(input.verificationSop)
          ? input.verificationSop.map((value) => String(value).trim()).filter(Boolean)
          : null;
        const includeMaterialDraft = created.length === 0 && input.materialDraftId;
        const externalSource = task.externalSource?.workItemId
          ? findOwn(task.externalSource.workItemId, actor)
          : null;
        const result = createWorkItem({
          projectId,
          title: task.title,
          body: taskBody,
          type: "task",
          status: mode === "ai" && !approvalRequired ? "ready" : "backlog",
          priority: "p2",
          executionPolicy: mode === "ai" && !approvalRequired ? "auto" : "manual",
          acceptanceCriteria: singleTaskCriteria?.length ? singleTaskCriteria : assisted.body.draft.acceptanceCriteria,
          verificationSop: singleTaskSop?.length ? singleTaskSop : assisted.body.draft.verificationSop,
          requesterRelation: "self",
          intakeChannel: "manual",
          waitingOn: approvalRequired ? "me" : mode === "ai" ? "ai" : "none",
          plannedDate: mode === "ai" && !approvalRequired ? timestamp.slice(0, 10) : null,
          dueDate: input.dueDate || null,
          intentId: plan.intent?.id ?? task.intentId,
          intentStatement: plan.intent?.statement ?? task.intentStatement,
          taskKind: task.kind,
          creationBasis: task.creationBasis,
          planningHorizon: "committed",
          workGoalId: goalId,
          artifactContract: task.artifactContract,
          platformTarget: task.platform ?? null,
          dependencyIds: [...new Set([
            ...(task.requires ?? []).map((key) => createdByKey.get(key).id),
            ...(externalSource ? [externalSource.id] : []),
          ])],
          ...(plan.tasks.length === 1 && input.myTemplateBinding ? { myTemplateBinding: input.myTemplateBinding } : {}),
          ...(includeMaterialDraft ? {
            materialDraftId: String(input.materialDraftId),
            materialDraftRevision: input.materialDraftRevision,
          } : sharedInputAssets?.length ? { inputAssets: sharedInputAssets } : {}),
          idempotencyKey: `${idempotencyKey}:${task.key}`.slice(0, 200),
        }, actor);
        if (!result.ok) throw new Error(result.body?.error ?? "intent_task_creation_failed");
        let item = result.body.workItem;
        if (externalSource) {
          const stored = findOwn(item.id, actor);
          const sourceKinds = [...new Set(task.externalSource?.artifactKinds ?? [])];
          const transfer = validatedArtifactTransfer({ source: externalSource, kinds: sourceKinds, at: now() });
          const sourceAssets = transfer.assets.filter((asset) => asset?.terminalId);
          const handoff = {
            ...transfer.handoff,
            assetIds: transfer.handoff.assetIds.filter((assetId) => sourceAssets.some((asset) => asset.id === assetId)),
          };
          if (!sourceAssets.length || handoff.kinds.length !== sourceKinds.length) handoff.status = "awaiting_artifact";
          runTx(() => {
            const existingIds = new Set((stored.inputAssets ?? []).map((asset) => asset.id).filter(Boolean));
            stored.inputAssets = [
              ...(stored.inputAssets ?? []),
              ...sourceAssets.filter((asset) => !existingIds.has(asset.id)).map((asset) => ({ ...asset })),
            ].slice(0, 100);
            stored.artifactHandoffs = [
              ...(stored.artifactHandoffs ?? []).filter((handoff) => handoff.sourceWorkItemId !== externalSource.id),
              handoff,
            ].slice(-50);
            stored.dataContextSnapshot = buildDataContextSnapshot({
              workItemId: stored.id,
              workItemRevision: stored.revision,
              capturedAt: stored.updatedAt,
              inputAssets: stored.inputAssets,
              localContentRefs: stored.localContentRefs,
              taskResourceRefs: stored.taskResourceRefs,
              channelTaskContract: stored.channelTaskContract,
              channelOrigin: stored.channelOrigin,
              taskContextControl: stored.taskContextControl,
            });
          });
          item = workItemView(stored, actor);
        }
        if (!sharedInputAssets && item.inputAssets?.length) sharedInputAssets = item.inputAssets;
        created.push(item);
        createdByKey.set(task.key, item);
        runTx(() => {
          workGoal.taskIds.push(item.id);
          workGoal.updatedAt = now();
        });
      }
    } catch (error) {
      runTx(() => {
        workGoal.status = "needs_repair";
        workGoal.lastError = error instanceof Error ? error.message : String(error);
        workGoal.updatedAt = now();
      });
      return {
        ok: false,
        status: 500,
        body: { error: "intent_task_plan_commit_failed", workGoalId: goalId, createdWorkItemIds: created.map((item) => item.id) },
      };
    }
    return {
      ok: true,
      status: 201,
      body: { workGoal, workItems: created.map((item) => workItemView(item, actor)), replayed: false, plan: preview.body },
    };
  }

  function createResultRepairTask({ workItemId } = {}, actor = null) {
    const source = findOwn(String(workItemId ?? ""), actor);
    if (!source) return notFound();
    if (!(["review", "blocked", "done"].includes(source.status) || source.state === "closed")) {
      return { ok: false, status: 409, body: { error: "work_item_result_repair_not_ready" } };
    }
    const verification = source.resultVerification ?? verifyWorkItemResult(source);
    if (verification.status !== "failed" || !verification.repair?.suggestedRequest) {
      return {
        ok: false,
        status: 409,
        body: { error: "work_item_result_repair_not_required", resultVerification: verification },
      };
    }

    const spec = buildResultRepairTaskSpec({ source, verification, at: now() });
    const idempotencyKey = `result-repair:${source.id}:${source.revision}:${verification.digest}`.slice(0, 200);
    const created = createWorkItem({
      projectId: source.projectId,
      title: spec.title,
      body: spec.description,
      type: "task",
      status: "backlog",
      priority: source.priority ?? "p2",
      executionPolicy: "manual",
      requesterRelation: "self",
      intakeChannel: "manual",
      waitingOn: "none",
      intentId: `${source.intentId ?? source.id}:repair:${source.revision}:${verification.digest.slice(-16)}`.slice(0, 200),
      intentStatement: spec.description,
      taskKind: source.taskKind ?? "general",
      creationBasis: "explicit_user_intent",
      planningHorizon: "committed",
      workGoalId: source.workGoalId ?? null,
      artifactContract: spec.artifactContract,
      dependencyIds: spec.dependencyIds,
      inputAssets: spec.inputAssets,
      acceptanceCriteria: [...(source.acceptanceCriteria ?? [])],
      verificationSop: [...(source.verificationSop ?? [])],
      idempotencyKey,
    }, actor);
    if (!created.ok) return created;

    const repair = findOwn(created.body.workItem.id, actor);
    if (!repair) return { ok: false, status: 500, body: { error: "work_item_result_repair_missing" } };
    runTx(() => {
      applyResultRepairSpec(repair, spec);
      repair.dataContextSnapshot = buildDataContextSnapshot({
        workItemId: repair.id,
        workItemRevision: repair.revision,
        capturedAt: repair.updatedAt,
        inputAssets: repair.inputAssets,
        localContentRefs: repair.localContentRefs,
        taskResourceRefs: repair.taskResourceRefs,
        channelTaskContract: repair.channelTaskContract,
        channelOrigin: repair.channelOrigin,
        taskContextControl: repair.taskContextControl,
      });
      const goal = source.workGoalId
        ? (state.workGoals ?? []).find((candidate) => candidate.id === source.workGoalId
          && candidate.ownerTeamId === actorTeam(actor))
        : null;
      if (goal && !(goal.taskIds ?? []).includes(repair.id)) {
        goal.taskIds = [...(goal.taskIds ?? []), repair.id];
        goal.status = "active";
        goal.updatedAt = now();
      }
    });
    return {
      ok: true,
      status: created.body.replayed ? 200 : 201,
      body: {
        workItem: workItemView(repair, actor),
        repairOfWorkItemId: source.id,
        resultVerification: verification,
        replayed: created.body.replayed === true,
      },
    };
  }

  function listMyTemplateRoutingFeedback({ projectId = null } = {}, actor = null) {
    const selectedProjectId = projectId ? String(projectId) : null;
    if (selectedProjectId && !actorCanAccessProject(state, actor, selectedProjectId)) return notFound();
    const ownerTeamId = actorTeam(actor);
    const ownedFeedback = state.myTemplateRoutingFeedback.filter((entry) => entry.ownerTeamId === ownerTeamId
      && (!selectedProjectId || entry.projectId === selectedProjectId));
    const conflictFor = (entry) => {
      const related = ownedFeedback.filter((candidate) => candidate.projectId === entry.projectId
        && (candidate.intentTerms ?? []).some((term) => (entry.intentTerms ?? []).includes(term)));
      const choices = [...related.reduce((counts, candidate) => {
        const key = compactMatchText(candidate.selectedOutput);
        if (!key) return counts;
        const current = counts.get(key) ?? { label: candidate.selectedOutput, count: 0 };
        current.count += candidate.kind === "confirmation" ? 2 : 1;
        counts.set(key, current);
        return counts;
      }, new Map()).values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
      const conflict = choices.length > 1 && choices[0].count - choices[1].count <= 1;
      return { state: conflict ? "conflict" : "active", conflictingOutputs: conflict ? choices.map((choice) => choice.label) : [] };
    };
    const feedback = ownedFeedback
      .map((entry) => {
        const workItem = (state.workItems ?? []).find((item) => item.id === entry.workItemId
          && item.ownerTeamId === ownerTeamId);
        return {
          id: entry.id,
          projectId: entry.projectId,
          workItemId: entry.workItemId,
          workItem: workItem ? { id: workItem.id, localRef: workItem.localRef, title: workItem.title } : null,
          intentTerms: [...(entry.intentTerms ?? [])],
          rejectedOutput: entry.rejectedOutput,
          selectedOutput: entry.selectedOutput,
          reason: entry.reason,
          createdAt: entry.createdAt,
          ...conflictFor(entry),
        };
      });
    return { ok: true, status: 200, body: { feedback, count: feedback.length } };
  }

  function removeMyTemplateRoutingFeedback({ feedbackId } = {}, actor = null) {
    const ownerTeamId = actorTeam(actor);
    const index = state.myTemplateRoutingFeedback.findIndex((entry) =>
      entry.id === String(feedbackId ?? "") && entry.ownerTeamId === ownerTeamId);
    if (index < 0) return notFound();
    const feedback = state.myTemplateRoutingFeedback[index];
    runTx(() => {
      state.myTemplateRoutingFeedback.splice(index, 1);
      const workItem = (state.workItems ?? []).find((item) => item.id === feedback.workItemId
        && item.ownerTeamId === ownerTeamId);
      if (workItem) {
        recordActivity(workItem, actor, "my_template_learning_removed", {
          feedbackId: feedback.id,
          selectedOutput: feedback.selectedOutput,
          rejectedOutput: feedback.rejectedOutput,
          affectsFutureMatchesOnly: true,
        });
      }
      appendEvent({
        invocationId: null,
        type: "my_template_learning_removed",
        level: "info",
        message: "A learned My template routing preference was removed.",
        data: { feedbackId: feedback.id, projectId: feedback.projectId, actorTeamId: ownerTeamId },
      });
    });
    return {
      ok: true,
      status: 200,
      body: {
        removed: {
          id: feedback.id,
          projectId: feedback.projectId,
          selectedOutput: feedback.selectedOutput,
          rejectedOutput: feedback.rejectedOutput,
        },
        affectsFutureMatchesOnly: true,
      },
    };
  }

  function previewMyTemplateDraft({ workItemId } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    return { ok: true, status: 200, body: taskTemplateDraftPreview(item, actor) };
  }

  function listMyTemplateDrafts({ projectId = null } = {}, actor = null) {
    const selectedProjectId = projectId ? String(projectId) : null;
    if (selectedProjectId && !actorCanAccessProject(state, actor, selectedProjectId)) return notFound();
    const drafts = state.myTemplateDrafts
      .filter((draft) => draft.ownerTeamId === actorTeam(actor)
        && actorCanAccessProject(state, actor, draft.projectId)
        && (!selectedProjectId || draft.projectId === selectedProjectId))
      .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
      .map(myTemplateDraftView);
    return { ok: true, status: 200, body: { drafts, count: drafts.length } };
  }

  function findOwnMyTemplateDraft(draftId, actor) {
    const draft = state.myTemplateDrafts.find((entry) =>
      entry.id === String(draftId)
      && entry.ownerTeamId === actorTeam(actor)
      && actorCanAccessProject(state, actor, entry.projectId));
    return draft ?? null;
  }

  function myTemplateLearningCaseView(entry, actor) {
    const item = (state.workItems ?? []).find((candidate) =>
      candidate.id === entry.workItemId
      && candidate.ownerTeamId === actorTeam(actor)
      && candidate.projectId === entry.projectId);
    const inputNames = (entry.snapshot?.inputAssets ?? []).map((asset) => asset.name).filter(Boolean);
    const outputNames = [
      ...(entry.snapshot?.outputAssets ?? []).map((asset) => asset.name),
      ...(entry.snapshot?.changedFiles ?? []).map((path) => String(path).replaceAll("\\", "/").split("/").pop()),
    ].filter(Boolean);
    return {
      id: entry.id,
      workItem: item ? {
        id: item.id,
        localRef: item.localRef ?? null,
        title: item.title,
        completedAt: item.completedAt ?? item.updatedAt ?? null,
      } : {
        id: entry.workItemId,
        localRef: null,
        title: entry.snapshot?.taskTitle ?? "原任务已不可用",
        completedAt: null,
      },
      typicalInput: entry.extracted?.typicalInput ?? (inputNames.join("、") || "任务说明和相关材料"),
      expectedOutput: entry.extracted?.expectedOutput
        ?? (outputNames.join("、") || entry.snapshot?.resultSummary || "已确认的任务结果"),
      similarity: entry.similarity ?? null,
      createdAt: entry.createdAt,
    };
  }

  function myTemplateDraftReview(draft, actor) {
    const cases = (draft.learningCaseIds ?? [])
      .map((caseId) => state.myTemplateLearningCases.find((entry) =>
        entry.id === caseId && entry.ownerTeamId === actorTeam(actor) && entry.projectId === draft.projectId))
      .filter(Boolean)
      .map((entry) => myTemplateLearningCaseView(entry, actor));
    const inputExamples = [...new Set(cases.map((entry) => entry.typicalInput).filter(Boolean))];
    const outputExamples = [...new Set(cases.map((entry) => entry.expectedOutput).filter(Boolean))];
    const confidence = cases.length >= 3 ? "high" : cases.length >= 2 ? "medium" : "initial";
    return {
      draft: myTemplateDraftView(draft),
      cases,
      learnedResult: {
        taskGoal: draft.name,
        typicalInput: draft.typicalInput,
        useWhen: draft.applicability,
        expectedOutput: draft.expectedOutput,
        steps: [...(draft.steps ?? [])],
        inputExamples,
        outputExamples,
      },
      readiness: {
        canEnable: draft.state === "needs_review" && cases.length >= 1,
        confidence,
        caseCount: cases.length,
        message: cases.length === 1
          ? "已具备一个成功案例，可以启用；系统会继续根据后续任务结果校正匹配。"
          : `已用 ${cases.length} 个成功案例交叉验证，可以启用。`,
      },
      futureBehavior: {
        participatesInMatching: draft.state === "ready",
        affectsExistingTasks: false,
        requiresExplicitConfirmation: draft.state !== "ready",
      },
    };
  }

  function reviewMyTemplateDraft({ draftId } = {}, actor = null) {
    const draft = findOwnMyTemplateDraft(draftId, actor);
    if (!draft) return { ok: false, status: 404, body: { error: "my_template_draft_not_found" } };
    return { ok: true, status: 200, body: myTemplateDraftReview(draft, actor) };
  }

  function listSimilarMyTemplateWorkItems({ draftId } = {}, actor = null) {
    const draft = findOwnMyTemplateDraft(draftId, actor);
    if (!draft) return { ok: false, status: 404, body: { error: "my_template_draft_not_found" } };
    const cases = (draft.learningCaseIds ?? [])
      .map((caseId) => state.myTemplateLearningCases.find((entry) =>
        entry.id === caseId && entry.ownerTeamId === actorTeam(actor) && entry.projectId === draft.projectId))
      .filter(Boolean)
      .map((entry) => myTemplateLearningCaseView(entry, actor));
    const suggestions = draft.state === "ready" || draft.state === "rejected" ? [] : (state.workItems ?? [])
      .map((item) => similarTaskCandidate(draft, item, actor))
      .filter(Boolean)
      .sort((left, right) => right.similarity - left.similarity
        || String(right.workItem.completedAt ?? "").localeCompare(String(left.workItem.completedAt ?? "")))
      .slice(0, 20);
    return {
      ok: true,
      status: 200,
      body: {
        draft: myTemplateDraftView(draft), cases, suggestions, count: suggestions.length,
        review: myTemplateDraftReview(draft, actor),
      },
    };
  }

  function addMyTemplateLearningCase({
    draftId, workItemId, expectedDraftRevision, expectedWorkItemRevision, confirm = false,
  } = {}, actor = null) {
    const draft = findOwnMyTemplateDraft(draftId, actor);
    if (!draft) return { ok: false, status: 404, body: { error: "my_template_draft_not_found" } };
    const existingCase = state.myTemplateLearningCases.find((entry) =>
      entry.ownerTeamId === actorTeam(actor) && entry.draftId === draft.id && entry.workItemId === String(workItemId));
    if (existingCase) {
      return {
        ok: true, status: 200,
        body: { draft: myTemplateDraftView(draft), learningCase: myTemplateLearningCaseView(existingCase, actor), replayed: true },
      };
    }
    if (!["learning", "needs_review"].includes(draft.state)) {
      return { ok: false, status: 409, body: { error: "my_template_draft_not_learning", state: draft.state } };
    }
    if (!Number.isInteger(expectedDraftRevision)) {
      return { ok: false, status: 400, body: { error: "expected_draft_revision_required" } };
    }
    if (expectedDraftRevision !== draft.revision) {
      return { ok: false, status: 409, body: { error: "my_template_draft_revision_conflict", currentRevision: draft.revision } };
    }
    if (confirm !== true) {
      return { ok: false, status: 400, body: { error: "my_template_learning_case_confirmation_required" } };
    }
    const item = findOwn(workItemId, actor);
    if (!item || item.projectId !== draft.projectId) return notFound();
    if (!Number.isInteger(expectedWorkItemRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedWorkItemRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const usedBy = state.myTemplateLearningCases.find((entry) =>
      entry.ownerTeamId === actorTeam(actor) && entry.workItemId === item.id && entry.draftId !== draft.id);
    if (usedBy) {
      return { ok: false, status: 409, body: { error: "work_item_already_used_as_my_template_case", draftId: usedBy.draftId } };
    }
    const candidate = similarTaskCandidate(draft, item, actor);
    if (!candidate) {
      return { ok: false, status: 409, body: { error: "work_item_not_similar_to_my_template" } };
    }
    const { snapshot, snapshotHash } = taskTemplateLearningSnapshot(item);
    const timestamp = now();
    const learningCase = {
      id: nextId("mtlc"),
      ownerTeamId: actorTeam(actor),
      projectId: draft.projectId,
      draftId: draft.id,
      workItemId: item.id,
      workItemRevision: item.revision,
      snapshot,
      snapshotHash,
      extracted: { typicalInput: candidate.typicalInput, expectedOutput: candidate.expectedOutput },
      similarity: {
        score: candidate.similarity,
        confidence: candidate.confidence,
        reasons: [...candidate.reasons],
      },
      resultConfirmed: true,
      createdBy: actorUser(actor),
      createdAt: timestamp,
    };
    runTx(() => {
      state.myTemplateLearningCases.unshift(learningCase);
      draft.learningCaseIds = [...(draft.learningCaseIds ?? []), learningCase.id];
      draft.caseCount = draft.learningCaseIds.length;
      draft.state = draft.caseCount >= draft.casesRequired ? "needs_review" : "learning";
      draft.revision += 1;
      draft.updatedBy = actorUser(actor);
      draft.updatedAt = timestamp;
      state.myTemplateLearningCases = state.myTemplateLearningCases.slice(0, 5_000);
      recordActivity(item, actor, "my_template_learning_case_added", {
        draftId: draft.id,
        learningCaseId: learningCase.id,
        similarity: learningCase.similarity,
        caseCount: draft.caseCount,
        state: draft.state,
        affectsOriginalTask: false,
        participatesInMatching: false,
      });
      appendEvent({
        invocationId: null,
        type: "my_template_learning_case_added",
        level: "info",
        message: "A user-confirmed similar task was added to a learning My template.",
        data: {
          draftId: draft.id,
          workItemId: item.id,
          learningCaseId: learningCase.id,
          caseCount: draft.caseCount,
          state: draft.state,
          actorTeamId: actorTeam(actor),
        },
      });
    });
    return {
      ok: true,
      status: 201,
      body: {
        draft: myTemplateDraftView(draft),
        learningCase: myTemplateLearningCaseView(learningCase, actor),
        readyForReview: draft.state === "needs_review",
        replayed: false,
      },
    };
  }

  function activateMyTemplateDraft({
    draftId, expectedDraftRevision, confirm = false, name, typicalInput, expectedOutput,
  } = {}, actor = null) {
    const draft = findOwnMyTemplateDraft(draftId, actor);
    if (!draft) return { ok: false, status: 404, body: { error: "my_template_draft_not_found" } };
    if (draft.state === "ready" && draft.activation?.definitionId) {
      const definition = state.routineDefinitions.find((entry) =>
        entry.id === draft.activation.definitionId
        && entry.ownerTeamId === actorTeam(actor)
        && entry.projectId === draft.projectId
        && entry.state === "published");
      if (!definition) {
        return { ok: false, status: 409, body: { error: "my_template_activation_definition_missing" } };
      }
      return {
        ok: true, status: 200,
        body: { draft: myTemplateDraftView(draft), definition, review: myTemplateDraftReview(draft, actor), replayed: true },
      };
    }
    if (!Number.isInteger(expectedDraftRevision)) {
      return { ok: false, status: 400, body: { error: "expected_draft_revision_required" } };
    }
    if (expectedDraftRevision !== draft.revision) {
      return { ok: false, status: 409, body: { error: "my_template_draft_revision_conflict", currentRevision: draft.revision } };
    }
    if (confirm !== true) {
      return { ok: false, status: 400, body: { error: "my_template_activation_confirmation_required" } };
    }
    const review = myTemplateDraftReview(draft, actor);
    if (!review.readiness.canEnable) {
      return {
        ok: false, status: 409,
        body: { error: "my_template_draft_not_ready_for_activation", state: draft.state, caseCount: review.readiness.caseCount },
      };
    }
    const normalizedName = String(name ?? draft.name).trim().slice(0, 200);
    const normalizedInput = String(typicalInput ?? draft.typicalInput).trim().slice(0, 1_000);
    const normalizedOutput = String(expectedOutput ?? draft.expectedOutput).trim().slice(0, 1_000);
    if (!normalizedName || !normalizedInput || !normalizedOutput) {
      return { ok: false, status: 400, body: { error: "my_template_activation_fields_required" } };
    }
    const familySignature = createHash("sha256").update(JSON.stringify({
      name: compactMatchText(normalizedName),
      input: compactMatchText(normalizedInput),
      output: compactMatchText(normalizedOutput),
    })).digest("hex");
    const duplicate = state.routineDefinitions.find((entry) =>
      entry.ownerTeamId === actorTeam(actor)
      && entry.projectId === draft.projectId
      && entry.state === "published"
      && entry.myTemplateSignature === familySignature);
    if (duplicate) {
      return {
        ok: false, status: 409,
        body: { error: "equivalent_my_template_already_enabled", definitionId: duplicate.id, familyId: duplicate.familyId },
      };
    }
    const timestamp = now();
    const definitionId = nextId("rtd");
    const originStepLabels = (draft.steps ?? []).map((step) => String(step).trim()).filter(Boolean);
    const definition = {
      id: definitionId,
      familyId: definitionId,
      schemaVersion: businessRoutineSchemaVersion,
      ownerTeamId: actorTeam(actor),
      projectId: draft.projectId,
      sourceId: `my-template-draft:${draft.id}`,
      name: normalizedName,
      description: `当收到${normalizedInput}，并希望得到${normalizedOutput}时使用。`,
      version: 1,
      state: "published",
      templateScope: "team",
      templateMaturity: "stable",
      discoveryCandidateId: null,
      historicalCaseIds: [],
      triggerDocumentTypes: ["unknown"],
      steps: [
        {
          key: "understand_input", kind: "extract",
          label: (originStepLabels[0] ?? `理解并检查${normalizedInput}`).slice(0, 200),
          required: true, dependsOn: [], evidenceRefs: [], configuration: {},
        },
        {
          key: "produce_result", kind: "generate",
          label: `生成${normalizedOutput}`.slice(0, 200),
          required: true, dependsOn: ["understand_input"], evidenceRefs: [],
          configuration: { expectedOutput: normalizedOutput },
        },
        {
          key: "verify_result", kind: "human_approval",
          label: (originStepLabels.at(-1) ?? `检查并交付${normalizedOutput}`).slice(0, 200),
          required: true, dependsOn: ["produce_result"], evidenceRefs: [], configuration: {},
        },
      ],
      evidenceRefs: [],
      evidenceFingerprints: {},
      confidence: review.readiness.confidence === "high" ? 0.9 : review.readiness.confidence === "medium" ? 0.75 : 0.6,
      supersedesId: null,
      supersededById: null,
      myTemplateSignature: familySignature,
      myTemplateLearningCaseIds: [...(draft.learningCaseIds ?? [])],
      origin: { kind: "my_template_draft", draftId: draft.id, workItemId: draft.origin?.workItemId ?? null },
      idempotencyKey: `my-template-activation:v1:${draft.id}`,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    const sourceItem = (state.workItems ?? []).find((item) =>
      item.id === draft.origin?.workItemId && item.ownerTeamId === actorTeam(actor) && item.projectId === draft.projectId);
    runTx(() => {
      state.routineDefinitions.push(definition);
      draft.name = normalizedName;
      draft.typicalInput = normalizedInput;
      draft.expectedOutput = normalizedOutput;
      draft.applicability = definition.description.replace(/。$/, "");
      draft.familySignature = familySignature;
      draft.state = "ready";
      draft.activation = {
        definitionId: definition.id,
        familyId: definition.familyId,
        version: definition.version,
        confirmedAt: timestamp,
        confirmedBy: actorUser(actor),
      };
      draft.revision += 1;
      draft.updatedBy = actorUser(actor);
      draft.updatedAt = timestamp;
      if (sourceItem) recordActivity(sourceItem, actor, "my_template_activated", {
        draftId: draft.id,
        definitionId: definition.id,
        familyId: definition.familyId,
        version: definition.version,
        affectsExistingTasks: false,
        participatesInMatching: true,
      });
      appendEvent({
        invocationId: null,
        type: "my_template_activated",
        level: "info",
        message: "A reviewed task-learned My template was enabled for future matching.",
        data: {
          draftId: draft.id, definitionId: definition.id, projectId: draft.projectId,
          caseCount: draft.caseCount, actorTeamId: actorTeam(actor), affectsExistingTasks: false,
        },
      });
    });
    return {
      ok: true, status: 201,
      body: { draft: myTemplateDraftView(draft), definition, review: myTemplateDraftReview(draft, actor), replayed: false },
    };
  }

  function createMyTemplateDraft({
    workItemId, expectedRevision, confirm = false, name, typicalInput, expectedOutput, idempotencyKey = null,
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const existing = taskTemplateDraftFor(item, actor);
    if (existing) {
      return {
        ok: true, status: 200,
        body: { draft: myTemplateDraftView(existing), workItem: workItemView(item, actor), replayed: true },
      };
    }
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    if (confirm !== true) {
      return { ok: false, status: 400, body: { error: "my_template_draft_confirmation_required" } };
    }
    const preview = taskTemplateDraftPreview(item, actor);
    if (!preview.eligible) {
      return { ok: false, status: 409, body: { error: "work_item_not_eligible_for_my_template", reasons: preview.reasons } };
    }
    const normalizedName = String(name ?? preview.suggestion.name).trim().slice(0, 200);
    const normalizedInput = String(typicalInput ?? preview.suggestion.typicalInput).trim().slice(0, 1_000);
    const normalizedOutput = String(expectedOutput ?? preview.suggestion.expectedOutput).trim().slice(0, 1_000);
    if (!normalizedName || !normalizedInput || !normalizedOutput) {
      return { ok: false, status: 400, body: { error: "my_template_draft_fields_required" } };
    }
    const timestamp = now();
    const { snapshot, snapshotHash } = taskTemplateLearningSnapshot(item);
    const familySignature = createHash("sha256").update(JSON.stringify({
      name: compactMatchText(normalizedName),
      input: compactMatchText(normalizedInput),
      output: compactMatchText(normalizedOutput),
    })).digest("hex");
    const draftId = nextId("mtd");
    const learningCase = {
      id: nextId("mtlc"),
      ownerTeamId: actorTeam(actor),
      projectId: item.projectId,
      draftId,
      workItemId: item.id,
      workItemRevision: item.revision,
      snapshot,
      snapshotHash,
      extracted: { typicalInput: normalizedInput, expectedOutput: normalizedOutput },
      similarity: null,
      resultConfirmed: true,
      createdBy: actorUser(actor),
      createdAt: timestamp,
    };
    const draft = {
      id: draftId,
      ownerTeamId: actorTeam(actor),
      projectId: item.projectId,
      name: normalizedName,
      typicalInput: normalizedInput,
      expectedOutput: normalizedOutput,
      applicability: `当收到${normalizedInput.slice(0, 500)}，并希望得到${normalizedOutput.slice(0, 500)}时`,
      steps: [...preview.suggestion.steps],
      state: "needs_review",
      caseCount: 1,
      casesRequired: 1,
      familySignature,
      origin: { kind: "work_item", workItemId: item.id, localRef: item.localRef ?? null, title: item.title },
      learningCaseIds: [learningCase.id],
      createIdempotencyKey: idempotencyKey ? String(idempotencyKey).slice(0, 200) : null,
      revision: 1,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    runTx(() => {
      state.myTemplateDrafts.unshift(draft);
      state.myTemplateLearningCases.unshift(learningCase);
      state.myTemplateDrafts = state.myTemplateDrafts.slice(0, 2_000);
      state.myTemplateLearningCases = state.myTemplateLearningCases.slice(0, 5_000);
      recordActivity(item, actor, "my_template_draft_created", {
        draftId: draft.id,
        learningCaseId: learningCase.id,
        state: draft.state,
        affectsOriginalTask: false,
        participatesInMatching: false,
      });
      appendEvent({
        invocationId: null,
        type: "my_template_draft_created",
        level: "info",
        message: "A completed ordinary task was saved as a learning My template.",
        data: { draftId: draft.id, workItemId: item.id, projectId: item.projectId, actorTeamId: actorTeam(actor) },
      });
    });
    return {
      ok: true, status: 201,
      body: { draft: myTemplateDraftView(draft), workItem: workItemView(item, actor), replayed: false },
    };
  }

  function listMyTemplateOutcomeFeedback({ projectId = null } = {}, actor = null) {
    const selectedProjectId = projectId ? String(projectId) : null;
    if (selectedProjectId && !actorCanAccessProject(state, actor, selectedProjectId)) return notFound();
    const ownerTeamId = actorTeam(actor);
    const interventions = state.myTemplateGovernanceInterventions.filter((entry) =>
      entry.ownerTeamId === ownerTeamId && (!selectedProjectId || entry.projectId === selectedProjectId));
    const feedback = state.myTemplateOutcomeFeedback
      .filter((entry) => entry.ownerTeamId === ownerTeamId
        && (!selectedProjectId || entry.projectId === selectedProjectId))
      .map((entry) => ({
        id: entry.id,
        projectId: entry.projectId,
        workItemId: entry.workItemId,
        definitionId: entry.definitionId,
        familyId: entry.familyId,
        version: entry.version,
        outcome: entry.outcome,
        note: entry.note,
        workItem: (() => {
          const item = (state.workItems ?? []).find((candidate) =>
            candidate.id === entry.workItemId && candidate.ownerTeamId === ownerTeamId);
          return item ? { id: item.id, localRef: item.localRef, title: item.title, status: item.status } : null;
        })(),
        governanceImpact: (() => {
          const latestIntervention = latestMyTemplateGovernanceIntervention(interventions, entry.familyId);
          if ((latestIntervention?.feedbackIds ?? []).includes(entry.id)) return "historical_baseline";
          if (entry.outcome === "wrong_result") return "negative";
          if (entry.outcome === "met_expectations") return "positive";
          return "quality_neutral";
        })(),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }));
    const summaries = [...feedback.reduce((groups, entry) => {
      const current = groups.get(entry.familyId) ?? {
        familyId: entry.familyId,
        total: 0,
        metExpectations: 0,
        wrongResult: 0,
        needsQualityAdjustment: 0,
      };
      current.total += 1;
      if (entry.outcome === "met_expectations") current.metExpectations += 1;
      if (entry.outcome === "wrong_result") current.wrongResult += 1;
      if (entry.outcome === "needs_quality_adjustment") current.needsQualityAdjustment += 1;
      groups.set(entry.familyId, current);
      return groups;
    }, new Map()).values()].map((summary) => ({
      ...summary,
      state: summary.wrongResult > 0 ? "needs_attention"
        : summary.metExpectations >= 3 ? "stable"
          : summary.needsQualityAdjustment > 0 ? "quality_adjustment" : "learning",
      governance: evaluateMyTemplateGovernance({
        outcomeFeedback: feedback, interventions, familyId: summary.familyId,
      }),
    }));
    return { ok: true, status: 200, body: { feedback, summaries, count: feedback.length } };
  }

  function resumeMyTemplateGovernanceObservation({ familyId, projectId, confirm = false } = {}, actor = null) {
    const normalizedFamilyId = String(familyId ?? "");
    const normalizedProjectId = String(projectId ?? "");
    if (!normalizedFamilyId || !normalizedProjectId || !actorCanAccessProject(state, actor, normalizedProjectId)) {
      return notFound();
    }
    const ownerTeamId = actorTeam(actor);
    const definition = (state.routineDefinitions ?? []).find((entry) =>
      entry.familyId === normalizedFamilyId
      && entry.projectId === normalizedProjectId
      && entry.ownerTeamId === ownerTeamId
      && entry.state === "published");
    if (!definition) return notFound();
    if (confirm !== true) {
      return { ok: false, status: 400, body: { error: "my_template_governance_resume_confirmation_required" } };
    }
    const ownedFeedback = state.myTemplateOutcomeFeedback.filter((entry) =>
      entry.ownerTeamId === ownerTeamId
      && entry.projectId === normalizedProjectId
      && entry.familyId === normalizedFamilyId);
    const ownedInterventions = state.myTemplateGovernanceInterventions.filter((entry) =>
      entry.ownerTeamId === ownerTeamId && entry.projectId === normalizedProjectId);
    const current = evaluateMyTemplateGovernance({
      outcomeFeedback: ownedFeedback, interventions: ownedInterventions, familyId: normalizedFamilyId,
    });
    if (current.state !== "paused") {
      return { ok: false, status: 409, body: { error: "my_template_governance_resume_not_needed", governance: current } };
    }
    const timestamp = now();
    const intervention = {
      id: nextId("mtgi"),
      ownerTeamId,
      projectId: normalizedProjectId,
      familyId: normalizedFamilyId,
      definitionId: definition.id,
      action: "resume_observation",
      reason: "user_reviewed_governance_details",
      feedbackIds: ownedFeedback.map((entry) => entry.id),
      priorState: current.state,
      createdBy: actorUser(actor),
      createdAt: timestamp,
    };
    runTx(() => {
      state.myTemplateGovernanceInterventions.unshift(intervention);
      state.myTemplateGovernanceInterventions = state.myTemplateGovernanceInterventions.slice(0, 1_000);
      appendEvent({
        invocationId: null,
        type: "my_template_governance_resumed",
        level: "warning",
        message: "My template automatic matching was manually returned to observation.",
        data: {
          interventionId: intervention.id,
          projectId: normalizedProjectId,
          familyId: normalizedFamilyId,
          priorState: current.state,
          historicalFeedbackCount: intervention.feedbackIds.length,
          actorTeamId: ownerTeamId,
          actorUserId: actorUser(actor),
        },
      });
    });
    const governance = evaluateMyTemplateGovernance({
      outcomeFeedback: ownedFeedback,
      interventions: [intervention, ...ownedInterventions],
      familyId: normalizedFamilyId,
    });
    return {
      ok: true,
      status: 200,
      body: {
        intervention: {
          id: intervention.id,
          familyId: intervention.familyId,
          projectId: intervention.projectId,
          action: intervention.action,
          priorState: intervention.priorState,
          historicalFeedbackCount: intervention.feedbackIds.length,
          createdAt: intervention.createdAt,
        },
        governance,
      },
    };
  }

  function recordMyTemplateOutcomeFeedback({ workItemId, outcome, note = "" } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!item.myTemplateBinding) {
      return { ok: false, status: 409, body: { error: "work_item_my_template_not_used" } };
    }
    if (item.status !== "done") {
      return { ok: false, status: 409, body: { error: "work_item_result_feedback_requires_completion" } };
    }
    const normalizedOutcome = String(outcome ?? "");
    if (!["met_expectations", "wrong_result", "needs_quality_adjustment"].includes(normalizedOutcome)) {
      return { ok: false, status: 400, body: { error: "invalid_my_template_outcome_feedback" } };
    }
    const normalizedNote = String(note ?? "").trim().slice(0, 1_000);
    const timestamp = now();
    let feedback = state.myTemplateOutcomeFeedback.find((entry) =>
      entry.ownerTeamId === actorTeam(actor) && entry.workItemId === item.id);
    if (feedback && feedback.outcome === normalizedOutcome && feedback.note === normalizedNote) {
      return { ok: true, status: 200, body: { feedback: workItemView(item, actor).myTemplateOutcomeFeedback, workItem: workItemView(item, actor), replayed: true } };
    }
    const governanceBefore = evaluateMyTemplateGovernance({
      outcomeFeedback: state.myTemplateOutcomeFeedback.filter((entry) =>
        entry.ownerTeamId === actorTeam(actor) && entry.projectId === item.projectId),
      interventions: state.myTemplateGovernanceInterventions.filter((entry) =>
        entry.ownerTeamId === actorTeam(actor) && entry.projectId === item.projectId),
      familyId: item.myTemplateBinding.familyId,
    });
    runTx(() => {
      if (feedback) {
        feedback.outcome = normalizedOutcome;
        feedback.note = normalizedNote;
        feedback.revision += 1;
        feedback.updatedAt = timestamp;
        feedback.updatedBy = actorUser(actor);
      } else {
        feedback = {
          id: nextId("mtof"),
          ownerTeamId: actorTeam(actor),
          projectId: item.projectId,
          workItemId: item.id,
          definitionId: item.myTemplateBinding.definitionId,
          familyId: item.myTemplateBinding.familyId,
          version: item.myTemplateBinding.version,
          snapshotHash: item.myTemplateBinding.snapshotHash,
          outcome: normalizedOutcome,
          note: normalizedNote,
          source: "user",
          revision: 1,
          createdBy: actorUser(actor),
          updatedBy: actorUser(actor),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        state.myTemplateOutcomeFeedback.unshift(feedback);
        state.myTemplateOutcomeFeedback = state.myTemplateOutcomeFeedback.slice(0, 1_000);
      }
      recordActivity(item, actor, "my_template_outcome_feedback_recorded", {
        feedbackId: feedback.id,
        outcome: feedback.outcome,
        matchingSignal: feedback.outcome === "wrong_result" ? "negative"
          : feedback.outcome === "met_expectations" ? "positive" : "neutral",
        technicalFailure: false,
      });
      const governanceAfter = evaluateMyTemplateGovernance({
        outcomeFeedback: state.myTemplateOutcomeFeedback.filter((entry) =>
          entry.ownerTeamId === actorTeam(actor) && entry.projectId === item.projectId),
        interventions: state.myTemplateGovernanceInterventions.filter((entry) =>
          entry.ownerTeamId === actorTeam(actor) && entry.projectId === item.projectId),
        familyId: item.myTemplateBinding.familyId,
      });
      if (governanceBefore.state !== governanceAfter.state) {
        recordActivity(item, actor, "my_template_governance_changed", {
          familyId: item.myTemplateBinding.familyId,
          from: governanceBefore.state,
          to: governanceAfter.state,
          reason: governanceAfter.reason,
          autoMatchAllowed: governanceAfter.autoMatchAllowed,
          matchingFeedbackCount: governanceAfter.matchingFeedbackCount,
          wrongResultRate: governanceAfter.wrongResultRate,
        });
      }
    });
    notifyWorkItemChanged(item, actor, "my_template_outcome_feedback_recorded");
    const view = workItemView(item, actor);
    return { ok: true, status: 200, body: { feedback: view.myTemplateOutcomeFeedback, workItem: view, replayed: false } };
  }

  function planActualPreferenceValue(planActual, deviation, resolution) {
    const target = deviation.correctionTarget;
    if (target === "template" || target === "result") {
      const actualResult = planActual.actual.resultFiles?.[0] ?? null;
      return resolution === "prefer_actual" ? actualResult : planActual.planned.expectedOutput;
    }
    if (target === "materials") return resolution === "prefer_actual" ? "latest_at_start" : "confirmed_snapshot";
    if (target === "delivery") {
      if (resolution === "prefer_actual") {
        return planActual.planned.deliveryDestination === "channel" && planActual.actual.resultStatus === "available"
          ? "task"
          : null;
      }
      return planActual.planned.deliveryDestination;
    }
    if (target === "scope") {
      if (resolution === "prefer_actual") {
        return ["prepared", "proposed", "applied", "partial", "rolled_back"].includes(planActual.actual.impactStatus)
          ? "write"
          : null;
      }
      return planActual.planned.actionAccessMode;
    }
    if (target === "verification") return "required";
    return null;
  }

  function planActualPreferenceHints({ projectId, intent, actor }) {
    const terms = templateRoutingTerms(intent);
    if (!terms.length) return [];
    const relevant = state.workItemPlanActualFeedback
      .filter((feedback) => feedback.ownerTeamId === actorTeam(actor)
        && feedback.projectId === projectId
        && (feedback.intentTerms ?? []).some((term) => terms.includes(term)))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    const grouped = new Map();
    for (const feedback of relevant) {
      for (const decision of feedback.decisions ?? []) {
        if (!decision.correctionTarget || grouped.has(decision.correctionTarget)) continue;
        grouped.set(decision.correctionTarget, {
          kind: decision.correctionTarget,
          preference: decision.preferredValue,
          resolution: decision.resolution,
          requiresConfirmation: decision.requiresConfirmation === true,
          learnedFrom: "plan_actual_correction",
        });
      }
      if (grouped.size >= 5) break;
    }
    return [...grouped.values()];
  }

  function listPlanActualFeedback({ projectId = null, limit = 2_000 } = {}, actor = null) {
    const selectedProjectId = projectId ? String(projectId) : null;
    if (selectedProjectId && !actorCanAccessProject(state, actor, selectedProjectId)) return notFound();
    const boundedLimit = Math.max(1, Math.min(2_000, Number(limit) || 2_000));
    const feedback = state.workItemPlanActualFeedback
      .filter((entry) => entry.ownerTeamId === actorTeam(actor)
        && actorCanAccessProject(state, actor, entry.projectId)
        && (!selectedProjectId || entry.projectId === selectedProjectId))
      .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
      .slice(0, boundedLimit)
      .map((entry) => {
        const workItem = (state.workItems ?? []).find((item) => item.id === entry.workItemId
          && item.ownerTeamId === actorTeam(actor));
        const detail = workItem ? getWorkItem({ workItemId: workItem.id }, actor) : null;
        const planActual = detail?.body?.observability?.planActual ?? null;
        const deviationCodes = new Set((planActual?.deviations ?? []).map((deviation) => deviation.code));
        const editable = planActual?.digest === entry.planActualDigest
          && planActual.status === "attention"
          && (entry.decisions ?? []).every((decision) => deviationCodes.has(decision.code));
        const visible = planActualFeedbackView(entry);
        return {
          ...visible,
          decisions: visible.decisions.map((decision) => {
            const deviation = (planActual?.deviations ?? []).find((candidate) => candidate.code === decision.code);
            if (!editable || !deviation) return { ...decision, options: [] };
            const keepPlanValue = planActualPreferenceValue(planActual, deviation, "keep_plan");
            const preferActualValue = deviation.correctionTarget === "verification"
              ? null
              : planActualPreferenceValue(planActual, deviation, "prefer_actual");
            return {
              ...decision,
              options: [
                ...(keepPlanValue ? [{ resolution: "keep_plan", preferredValue: keepPlanValue }] : []),
                ...(preferActualValue ? [{ resolution: "prefer_actual", preferredValue: preferActualValue }] : []),
              ],
            };
          }),
          projectId: entry.projectId,
          workItemId: entry.workItemId,
          workItem: workItem ? { id: workItem.id, localRef: workItem.localRef, title: workItem.title } : null,
          intentTerms: [...(entry.intentTerms ?? [])],
          template: entry.template ? { ...entry.template } : null,
          editable,
          editUnavailableReason: editable ? null : "execution_evidence_unavailable",
        };
      });
    return { ok: true, status: 200, body: { feedback, count: feedback.length } };
  }

  function removePlanActualFeedback({ feedbackId } = {}, actor = null) {
    const ownerTeamId = actorTeam(actor);
    const index = state.workItemPlanActualFeedback.findIndex((entry) =>
      entry.id === String(feedbackId ?? "")
      && entry.ownerTeamId === ownerTeamId
      && actorCanAccessProject(state, actor, entry.projectId));
    if (index < 0) return notFound();
    const feedback = state.workItemPlanActualFeedback[index];
    runTx(() => {
      state.workItemPlanActualFeedback.splice(index, 1);
      const workItem = (state.workItems ?? []).find((item) => item.id === feedback.workItemId
        && item.ownerTeamId === ownerTeamId);
      if (workItem) {
        recordActivity(workItem, actor, "plan_actual_feedback_removed", {
          feedbackId: feedback.id,
          affectsFutureMatchesOnly: true,
        });
      }
      appendEvent({
        invocationId: null,
        type: "work_item_plan_actual_feedback_removed",
        level: "info",
        message: "A learned plan/actual preference was removed.",
        data: { feedbackId: feedback.id, projectId: feedback.projectId, actorTeamId: ownerTeamId },
      });
    });
    return {
      ok: true,
      status: 200,
      body: { removed: planActualFeedbackView(feedback), affectsFutureMatchesOnly: true },
    };
  }

  function recordPlanActualFeedback({
    workItemId, expectedPlanActualDigest, expectedFeedbackRevision = null, decisions, note = "",
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const expectedDigest = String(expectedPlanActualDigest ?? "").trim();
    if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
      return { ok: false, status: 400, body: { error: "invalid_plan_actual_digest" } };
    }
    if (!Array.isArray(decisions) || !decisions.length || decisions.length > 20) {
      return { ok: false, status: 400, body: { error: "invalid_plan_actual_feedback" } };
    }
    const detail = getWorkItem({ workItemId }, actor);
    const planActual = detail.body?.observability?.planActual ?? null;
    if (!planActual) return { ok: false, status: 409, body: { error: "plan_actual_not_available" } };
    if (planActual.digest !== expectedDigest) {
      return {
        ok: false, status: 409,
        body: { error: "plan_actual_changed", currentDigest: planActual.digest, planActual },
      };
    }
    if (planActual.status !== "attention" || !(planActual.deviations ?? []).length) {
      return { ok: false, status: 409, body: { error: "plan_actual_has_no_confirmed_deviation", planActual } };
    }
    const deviations = new Map(planActual.deviations.map((deviation) => [deviation.code, deviation]));
    const normalized = [];
    const seen = new Set();
    for (const decision of decisions) {
      const code = String(decision?.code ?? "").trim().slice(0, 120);
      const resolution = String(decision?.resolution ?? "");
      const deviation = deviations.get(code);
      if (!deviation || seen.has(code) || !["keep_plan", "prefer_actual"].includes(resolution)) {
        return { ok: false, status: 400, body: { error: "invalid_plan_actual_feedback_decision", code } };
      }
      const preferredValue = planActualPreferenceValue(planActual, deviation, resolution);
      if (!preferredValue || (resolution === "prefer_actual" && deviation.correctionTarget === "verification")) {
        return { ok: false, status: 400, body: { error: "plan_actual_preference_not_available", code } };
      }
      seen.add(code);
      normalized.push({
        code,
        scope: deviation.scope,
        correctionTarget: deviation.correctionTarget,
        resolution,
        preferredValue: String(preferredValue).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500),
        requiresConfirmation: resolution === "prefer_actual" && ["materials", "scope"].includes(deviation.correctionTarget),
      });
    }
    const normalizedNote = String(note ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 1_000);
    const timestamp = now();
    let feedback = state.workItemPlanActualFeedback.find((candidate) =>
      candidate.ownerTeamId === actorTeam(actor)
      && candidate.workItemId === item.id
      && candidate.runId === planActual.runId
      && candidate.planActualDigest === planActual.digest) ?? null;
    if (expectedFeedbackRevision !== null && expectedFeedbackRevision !== undefined) {
      const expectedRevision = Number(expectedFeedbackRevision);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        return { ok: false, status: 400, body: { error: "invalid_plan_actual_feedback_revision" } };
      }
      if (!feedback || feedback.revision !== expectedRevision) {
        return {
          ok: false, status: 409,
          body: {
            error: "plan_actual_feedback_changed",
            currentFeedback: planActualFeedbackView(feedback),
          },
        };
      }
    }
    const unchanged = feedback
      && JSON.stringify(feedback.decisions) === JSON.stringify(normalized)
      && feedback.note === normalizedNote;
    if (unchanged) {
      return { ok: true, status: 200, body: { feedback: planActualFeedbackView(feedback), planActual, replayed: true } };
    }
    runTx(() => {
      if (feedback) {
        feedback.decisions = normalized;
        feedback.note = normalizedNote;
        feedback.revision += 1;
        feedback.updatedAt = timestamp;
        feedback.updatedBy = actorUser(actor);
      } else {
        feedback = {
          id: nextId("wpaf"),
          ownerTeamId: actorTeam(actor),
          projectId: item.projectId,
          workItemId: item.id,
          runId: planActual.runId,
          planActualDigest: planActual.digest,
          intentTerms: templateRoutingTerms(`${item.title}\n${item.body ?? ""}`),
          template: item.myTemplateBinding ? {
            definitionId: item.myTemplateBinding.definitionId,
            familyId: item.myTemplateBinding.familyId,
            version: item.myTemplateBinding.version,
          } : null,
          decisions: normalized,
          note: normalizedNote,
          source: "user",
          revision: 1,
          createdBy: actorUser(actor),
          updatedBy: actorUser(actor),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        state.workItemPlanActualFeedback.unshift(feedback);
        state.workItemPlanActualFeedback = state.workItemPlanActualFeedback.slice(0, 2_000);
      }
      recordActivity(item, actor, "plan_actual_feedback_recorded", {
        feedbackId: feedback.id,
        runId: planActual.runId,
        planActualDigest: planActual.digest,
        decisions: normalized.map(({ code, correctionTarget, resolution }) => ({ code, correctionTarget, resolution })),
      });
      appendEvent({
        invocationId: null,
        type: "work_item_plan_actual_feedback_recorded",
        level: "info",
        message: `${item.localRef} recorded a plan/actual correction for future similar tasks.`,
        data: { workItemId: item.id, runId: planActual.runId, feedbackId: feedback.id, actorTeamId: actorTeam(actor) },
      });
    });
    notifyWorkItemChanged(item, actor, "plan_actual_feedback_recorded");
    return {
      ok: true,
      status: feedback.revision === 1 ? 201 : 200,
      body: { feedback: planActualFeedbackView(feedback), planActual: { ...planActual, feedback: planActualFeedbackView(feedback) }, replayed: false },
    };
  }

  function prepareExecutionContract({ workItemId, expectedRevision, confirm = true, draftOverride = null } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    const currentGate = executionContractDefinitionGate(item);
    const contractPrepared = (item.acceptanceCriteria ?? []).length > 0
      && (item.verificationSop ?? []).length > 0;
    if (contractPrepared && !confirm) {
      return {
        ok: true,
        status: 200,
        body: {
          workItem: workItemView(item, actor),
          draft: {
            taskUnderstanding: item.body ?? "",
            acceptanceCriteria: [...item.acceptanceCriteria],
            verificationSop: [...item.verificationSop],
            suggestedRoute: null,
            risks: [],
            evidence: null,
            confirmedAt: item.executionContractConfirmedAt ?? null,
          },
          replayed: true,
        },
      };
    }
    if (currentGate.ready && confirm) {
      return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: true } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const assisted = suggestWorkItemDraft({ projectId: item.projectId, title: item.title, body: item.body }, actor);
    if (!assisted.ok) return assisted;
    const assistedDraft = assisted.body?.draft ?? {};
    const override = draftOverride && typeof draftOverride === "object" ? draftOverride : null;
    const draft = override ? {
      ...assistedDraft,
      ...override,
      acceptanceCriteria: Array.isArray(override.acceptanceCriteria) && override.acceptanceCriteria.length
        ? override.acceptanceCriteria
        : assistedDraft.acceptanceCriteria,
      verificationSop: Array.isArray(override.verificationSop) && override.verificationSop.length
        ? override.verificationSop
        : assistedDraft.verificationSop,
      risks: Array.isArray(override.risks) ? override.risks : assistedDraft.risks,
      evidence: {
        ...(assistedDraft.evidence ?? {}),
        ...(override.evidence ?? {}),
      },
    } : assistedDraft;
    const acceptanceCriteria = (item.acceptanceCriteria ?? []).length
      ? [...item.acceptanceCriteria]
      : strings(draft.acceptanceCriteria ?? [], { limit: 30, maxLength: 2_000 });
    const verificationSop = (item.verificationSop ?? []).length
      ? [...item.verificationSop]
      : strings(draft.verificationSop ?? [], { limit: 30, maxLength: 2_000 });
    if (!acceptanceCriteria?.length || !verificationSop?.length) {
      return { ok: false, status: 409, body: { error: "work_item_execution_contract_assistance_incomplete" } };
    }
    const timestamp = now();
    runTx(() => {
      item.acceptanceCriteria = acceptanceCriteria;
      item.verificationSop = verificationSop;
      item.executionContractSource = override ? "agent_assisted" : "assisted";
      item.executionContractConfirmedAt = confirm ? timestamp : null;
      item.revision += 1;
      item.updatedAt = timestamp;
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "execution_contract_prepared", {
        source: item.executionContractSource,
        confirmed: confirm,
        policyVersion: draft.evidence?.policyVersion ?? null,
        confidence: draft.evidence?.confidence ?? null,
        suggestedRoute: draft.suggestedRoute ?? null,
      });
    });
    return {
      ok: true,
      status: 200,
      body: {
        workItem: workItemView(item, actor),
        draft: {
          taskUnderstanding: draft.taskUnderstanding ?? "",
          acceptanceCriteria,
          verificationSop,
          suggestedRoute: draft.suggestedRoute ?? null,
          risks: draft.risks ?? [],
          evidence: draft.evidence ?? null,
          confirmedAt: confirm ? timestamp : null,
        },
      },
    };
  }

  function confirmExecutionContractAndSchedule({ workItemId, expectedRevision } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const alreadyScheduled = executionContractGate(item).ready
      && item.executionPolicy === "auto"
      && item.waitingOn === "ai";
    if (alreadyScheduled) {
      return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: true } };
    }
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    if (!(item.acceptanceCriteria ?? []).length || !(item.verificationSop ?? []).length) {
      return { ok: false, status: 409, body: { error: "work_item_execution_plan_required" } };
    }
    const intentContract = buildWorkItemIntentContract(item);
    if (intentContract.status === "needs_clarification") {
      return {
        ok: false,
        status: 409,
        body: {
          error: "work_item_intent_conflict",
          intentContract,
          clarification: intentContract.clarification,
        },
      };
    }
    if (item.state !== "open" || item.status === "done" || (item.executionBindings ?? []).length) {
      return { ok: false, status: 409, body: { error: "work_item_execution_already_started" } };
    }
    const timestamp = now();
    runTx(() => {
      item.executionContractSource ??= "manual";
      item.executionContractConfirmedAt = timestamp;
      item.executionIntentContractSnapshot = freezeWorkItemIntentContract(item, {
        confirmedAt: timestamp,
        confirmedBy: actorUser(actor),
      });
      item.executionPolicy = "auto";
      item.waitingOn = "ai";
      if (item.status === "backlog") item.status = "ready";
      item.executionStartRequest = {
        schemaVersion: 1,
        id: nextId("wsr"),
        status: "queued",
        requestedAt: timestamp,
        requestedBy: actorUser(actor),
        confirmedRevision: item.revision + 1,
        contractDigest: createHash("sha256").update(JSON.stringify({
          workItemId: item.id,
          acceptanceCriteria: item.acceptanceCriteria,
          verificationSop: item.verificationSop,
          intentContractDigest: item.executionIntentContractSnapshot.digest,
          confirmedAt: timestamp,
        })).digest("hex"),
        updatedAt: timestamp,
        startedAt: null,
        executionKind: null,
        targetId: null,
        agentId: null,
        reasonCode: "waiting_for_turn",
        reasonDetail: null,
        cancelledAt: null,
        cancelledBy: null,
      };
      item.revision += 1;
      item.updatedAt = timestamp;
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "execution_contract_confirmed", {
        executionPolicy: "auto",
        waitingOn: "ai",
        intentContractDigest: item.executionIntentContractSnapshot.digest,
      });
      applyPlanningAutomation(item, actor);
      appendEvent({
        invocationId: null,
        type: "work_item_updated",
        level: "info",
        message: `${item.localRef} execution confirmed.`,
        data: { workItemId: item.id, revision: item.revision, actorTeamId: actorTeam(actor) },
      });
    });
    notifyWorkItemChanged(item, actor, "execution_contract_confirmed");
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: false } };
  }

  function cancelExecutionStart({ workItemId, expectedRevision } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    const receipt = projectExecutionStartReceipt(item, state, { now: now() });
    if (receipt?.status === "cancelled") {
      return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: true } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    if (!item.executionStartRequest || !receipt?.canCancel || item.executionOperation
      || (item.executionBindings ?? []).some((binding) => ["auto_run", "application_invocation"].includes(binding.kind))) {
      return { ok: false, status: 409, body: { error: "work_item_execution_start_cannot_cancel" } };
    }
    const timestamp = now();
    runTx(() => {
      item.executionStartRequest = {
        ...item.executionStartRequest,
        status: "cancelled",
        reasonCode: "cancelled_by_user",
        reasonDetail: null,
        cancelledAt: timestamp,
        cancelledBy: actorUser(actor),
        updatedAt: timestamp,
      };
      item.executionPolicy = "paused";
      item.waitingOn = "none";
      item.revision += 1;
      item.updatedAt = timestamp;
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "execution_start_cancelled", { requestId: item.executionStartRequest.id });
    });
    notifyWorkItemChanged(item, actor, "execution_start_cancelled");
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: false } };
  }

  function recheckExecutionStart({ workItemId, expectedRevision } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const receipt = projectExecutionStartReceipt(item, state, { now: now() });
    if (!item.executionStartRequest || !["queued", "blocked"].includes(receipt?.status ?? "")
      || item.executionOperation || (item.executionBindings ?? []).some((binding) =>
        ["auto_run", "application_invocation"].includes(binding.kind))) {
      return { ok: false, status: 409, body: { error: "work_item_execution_start_cannot_recheck" } };
    }
    if (receipt.status === "queued" && item.executionPolicy === "auto" && item.waitingOn === "ai"
      && item.executionStartRequest.status === "queued" && item.executionStartRequest.reasonCode === "waiting_for_turn") {
      notifyWorkItemChanged(item, actor, "execution_start_rechecked");
      return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: true } };
    }
    const timestamp = now();
    runTx(() => {
      item.executionStartRequest = {
        ...item.executionStartRequest,
        status: "queued",
        reasonCode: "waiting_for_turn",
        reasonDetail: null,
        updatedAt: timestamp,
      };
      item.executionPolicy = "auto";
      item.waitingOn = "ai";
      item.revision += 1;
      item.updatedAt = timestamp;
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "execution_start_rechecked", { requestId: item.executionStartRequest.id });
    });
    notifyWorkItemChanged(item, actor, "execution_start_rechecked");
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: false } };
  }

  function recordExecutionStartOutcome({ workItemId, status, reasonCode, reasonDetail = null } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const request = item.executionStartRequest;
    if (!request || request.status === "cancelled" || (item.executionBindings ?? []).some((binding) =>
      ["auto_run", "application_invocation"].includes(binding.kind))) {
      return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: true } };
    }
    if (!["queued", "blocked"].includes(status)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_execution_start_outcome" } };
    }
    const normalizedCode = String(reasonCode ?? (status === "queued" ? "waiting_for_turn" : "execution_start_failed")).slice(0, 160);
    const normalizedDetail = reasonDetail == null ? null : String(reasonDetail).slice(0, 500);
    if (request.status === status && request.reasonCode === normalizedCode && request.reasonDetail === normalizedDetail) {
      return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: true } };
    }
    const timestamp = now();
    runTx(() => {
      item.executionStartRequest = {
        ...request,
        status,
        reasonCode: normalizedCode,
        reasonDetail: normalizedDetail,
        updatedAt: timestamp,
      };
      item.revision += 1;
      item.updatedAt = timestamp;
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "execution_start_status_changed", {
        requestId: request.id, status, reasonCode: normalizedCode,
      });
    });
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: false } };
  }

  function retryWorkItemAlert({ workItemId, alertId } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const runIds = new Set((item.executionBindings ?? []).filter((binding) => binding.kind === "auto_run").map((binding) => binding.targetId));
    const row = (state.alertOutbox ?? []).find((candidate) => candidate.id === String(alertId));
    const data = row?.alert?.data ?? {};
    if (!row || (data.localIssueId !== item.id && !runIds.has(data.autoRunId))) return notFound();
    if (!["failed", "skipped"].includes(row.status)) {
      return { ok: false, status: 409, body: { error: "alert_not_retryable", status: row.status } };
    }
    const retried = retryAlert(row.id);
    return retried
      ? { ok: true, status: 200, body: { alert: { id: retried.id, status: retried.status, attempts: retried.attempts } } }
      : notFound();
  }

  function githubBinding(item) {
    return externalIssueBinding(item, "github");
  }

  function providerOfBinding(binding) {
    if (["github", "gitlab", "gitea"].includes(binding?.provider)) return binding.provider;
    if (binding?.kind === "github_issue") return "github";
    if (binding?.kind === "gitlab_issue") return "gitlab";
    if (binding?.kind === "gitea_issue") return "gitea";
    return null;
  }

  function externalIssueBinding(item, provider) {
    return (item.externalBindings ?? []).find((binding) =>
      providerOfBinding(binding) === provider
      && (binding.resourceType === "issue" || String(binding.kind).endsWith("_issue"))) ?? null;
  }

  function externalBindingView(binding) {
    const provider = providerOfBinding(binding);
    const resourceType = binding.resourceType ?? (String(binding.kind).endsWith("_issue") ? "issue" : "unknown");
    const externalId = String(binding.externalId ?? binding.number ?? "");
    return {
      ...binding,
      provider,
      resourceType,
      externalId,
      bindingId: binding.bindingId
        ?? [provider ?? "unknown", resourceType, binding.repository ?? "repository", externalId].join(":"),
      relation: EXTERNAL_RELATIONS.has(binding.relation) ? binding.relation : "source",
      isPrimary: binding.isPrimary !== false,
      syncPolicy: EXTERNAL_SYNC_POLICIES.has(binding.syncPolicy) ? binding.syncPolicy : "manual",
      linkedAt: binding.linkedAt ?? null,
      linkedBy: binding.linkedBy ?? null,
    };
  }

  function normalizeGithubSnapshot(input = {}) {
    const number = Number(input.number);
    const title = String(input.title ?? "").trim();
    const body = String(input.body ?? "");
    const remoteState = String(input.state ?? "").toLowerCase();
    const labels = strings(input.labels ?? []);
    const assigneeIds = strings(input.assigneeIds ?? []);
    const milestone = String(input.milestone ?? "").trim();
    const updatedAt = String(input.updatedAt ?? "");
    if (!Number.isInteger(number) || number < 1 || !title || title.length > MAX_TITLE
      || body.length > MAX_BODY || !["open", "closed"].includes(remoteState)
      || !labels || !assigneeIds || milestone.length > MAX_MILESTONE
      || !Number.isFinite(Date.parse(updatedAt))) return null;
    return {
      number, title, body, state: remoteState, labels,
      milestone, assigneeIds,
      url: input.url == null ? null : String(input.url),
      repository: input.repository == null ? null : String(input.repository),
      updatedAt,
    };
  }

  function bindExternalIssue({
    workItemId,
    expectedRevision,
    provider = "github",
    remote,
    relation = "source",
    isPrimary = true,
    syncPolicy = "manual",
  } = {}, actor = null) {
    const normalizedProvider = String(provider).toLowerCase();
    if (!["github", "gitlab", "gitea"].includes(normalizedProvider)) {
      return { ok: false, status: 400, body: { error: "unsupported_external_provider" } };
    }
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const snapshot = normalizeGithubSnapshot(remote);
    if (!snapshot) return { ok: false, status: 400, body: { error: "invalid_external_issue_snapshot", provider: normalizedProvider } };
    const normalizedRelation = String(relation ?? "source").toLowerCase();
    const normalizedSyncPolicy = String(syncPolicy ?? "manual").toLowerCase();
    if (!EXTERNAL_RELATIONS.has(normalizedRelation)) {
      return { ok: false, status: 400, body: { error: "invalid_external_issue_relation", provider: normalizedProvider } };
    }
    if (!EXTERNAL_SYNC_POLICIES.has(normalizedSyncPolicy)) {
      return { ok: false, status: 400, body: { error: "invalid_external_issue_sync_policy", provider: normalizedProvider } };
    }
    const primary = Boolean(isPrimary) && normalizedRelation === "source";
    if (externalIssueBinding(item, normalizedProvider)) {
      return { ok: false, status: 409, body: { error: "external_issue_already_bound", provider: normalizedProvider } };
    }
    if (primary && (item.externalBindings ?? []).some((candidate) => candidate.isPrimary !== false)) {
      return { ok: false, status: 409, body: { error: "external_primary_source_already_bound", provider: normalizedProvider } };
    }
    const duplicate = (state.workItems ?? []).find((candidate) =>
      candidate.ownerTeamId === actorTeam(actor) && candidate.projectId === item.projectId
      && (candidate.externalBindings ?? []).some((binding) =>
        providerOfBinding(binding) === normalizedProvider
        && binding.number === snapshot.number
        && (binding.repository ?? null) === (snapshot.repository ?? null)));
    if (duplicate) return { ok: false, status: 409, body: { error: "external_issue_already_linked", provider: normalizedProvider, workItemId: duplicate.id } };
    const binding = {
      kind: `${normalizedProvider}_issue`,
      provider: normalizedProvider,
      resourceType: "issue",
      externalId: String(snapshot.number),
      bindingId: [normalizedProvider, "issue", snapshot.repository ?? "repository", snapshot.number].join(":"),
      number: snapshot.number, url: snapshot.url, repository: snapshot.repository,
      syncedLocalRevision: item.revision, remoteUpdatedAt: snapshot.updatedAt,
      baseline: Object.fromEntries(GITHUB_SYNC_FIELDS.map((field) => [field, snapshot[field]])),
      conflict: null, lastSyncedAt: now(),
      relation: normalizedRelation,
      isPrimary: primary,
      syncPolicy: normalizedSyncPolicy,
      linkedAt: now(),
      linkedBy: actorUser(actor),
    };
    runTx(() => {
      item.externalBindings.push(binding);
      recordActivity(item, actor, `${normalizedProvider}_linked`, { provider: normalizedProvider, number: snapshot.number, url: snapshot.url });
    });
    return { ok: true, status: 201, body: { workItem: workItemView(item, actor), binding: externalBindingView(binding) } };
  }

  function createWorkItemFromExternal({
    projectId,
    provider = "github",
    remote,
    relation = "source",
    isPrimary = true,
    syncPolicy = "manual",
    ...input
  } = {}, actor = null) {
    const normalizedProvider = String(provider).toLowerCase();
    if (!["github", "gitlab", "gitea"].includes(normalizedProvider)) {
      return { ok: false, status: 400, body: { error: "unsupported_external_provider" } };
    }
    const snapshot = normalizeGithubSnapshot(remote);
    if (!snapshot) {
      return { ok: false, status: 400, body: { error: "invalid_external_issue_snapshot", provider: normalizedProvider } };
    }
    const duplicate = (state.workItems ?? []).find((candidate) =>
      candidate.ownerTeamId === actorTeam(actor)
      && candidate.projectId === projectId
      && (candidate.externalBindings ?? []).some((binding) =>
        providerOfBinding(binding) === normalizedProvider
        && binding.number === snapshot.number
        && (binding.repository ?? null) === (snapshot.repository ?? null)));
    if (duplicate) {
      return {
        ok: false,
        status: 409,
        body: { error: "external_issue_already_linked", provider: normalizedProvider, workItemId: duplicate.id, workItem: workItemView(duplicate, actor) },
      };
    }
    const created = createWorkItem({
      ...input,
      projectId,
      title: input.title ?? snapshot.title,
      body: input.body ?? snapshot.body,
      labels: input.labels ?? snapshot.labels,
      intakeChannel: input.intakeChannel ?? (normalizedProvider === "github" ? "github" : "import"),
      externalReference: input.externalReference ?? snapshot.url,
    }, actor);
    if (!created.ok) return created;
    const linked = bindExternalIssue({
      workItemId: created.body.workItem.id,
      expectedRevision: created.body.workItem.revision,
      provider: normalizedProvider,
      remote: snapshot,
      relation,
      isPrimary,
      syncPolicy,
    }, actor);
    if (!linked.ok) {
      return { ...linked, body: { ...linked.body, workItemId: created.body.workItem.id } };
    }
    return { ok: true, status: 201, body: { ...linked.body, created: true } };
  }

  function bindGithubIssue(input = {}, actor = null) {
    const result = bindExternalIssue({ ...input, provider: "github" }, actor);
    if (result.body?.error === "invalid_external_issue_snapshot") result.body.error = "invalid_github_issue_snapshot";
    if (result.body?.error === "external_issue_already_bound") result.body.error = "github_issue_already_bound";
    if (result.body?.error === "external_issue_already_linked") result.body.error = "github_issue_already_linked";
    return result;
  }

  function syncExternalIssue({
    workItemId, expectedRevision, provider = "github", direction, remote, pushedRemoteUpdatedAt,
  } = {}, actor = null) {
    const normalizedProvider = String(provider).toLowerCase();
    if (!["github", "gitlab", "gitea"].includes(normalizedProvider)) {
      return { ok: false, status: 400, body: { error: "unsupported_external_provider" } };
    }
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const binding = externalIssueBinding(item, normalizedProvider);
    const providerError = (suffix) => normalizedProvider === "github"
      ? `github_${suffix}`
      : `external_${suffix}`;
    const providerActivity = (suffix) => `${normalizedProvider}_${suffix}`;
    if (!binding) return { ok: false, status: 409, body: { error: "external_issue_not_bound", provider: normalizedProvider } };
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    if (["resolve_local", "resolve_remote"].includes(direction)) {
      if (!binding.conflict) return { ok: false, status: 409, body: { error: providerError("sync_conflict_not_found"), provider: normalizedProvider } };
      const conflict = binding.conflict;
      runTx(() => {
        if (direction === "resolve_remote") {
          Object.assign(item, conflict.remote, {
            revision: item.revision + 1, updatedAt: now(), lastModifiedBy: actorUser(actor),
          });
        }
        binding.conflict = null;
        binding.syncedLocalRevision = item.revision;
        recordActivity(item, actor, providerActivity(direction === "resolve_remote" ? "conflict_remote_selected" : "conflict_local_selected"), {
          number: binding.number, fields: conflict.fields,
        });
      });
      if (direction === "resolve_remote") {
        notifyWorkItemChanged(item, actor, `${normalizedProvider}_conflict_remote_selected`);
      }
      const payload = Object.fromEntries(GITHUB_SYNC_FIELDS.map((field) => [field, item[field]]));
      return {
        ok: true, status: 200,
        body: { action: direction === "resolve_remote" ? "resolved_remote" : "push_required", issueNumber: binding.number, payload, workItem: workItemView(item, actor) },
      };
    }
    if (direction === "push") {
      if (binding.conflict) return { ok: false, status: 409, body: { error: providerError("sync_conflict"), provider: normalizedProvider, conflict: binding.conflict } };
      const payload = Object.fromEntries(GITHUB_SYNC_FIELDS.map((field) => [field, item[field]]));
      if (!pushedRemoteUpdatedAt) {
        return { ok: true, status: 200, body: { action: "push_required", issueNumber: binding.number, payload, workItem: workItemView(item, actor) } };
      }
      if (!Number.isFinite(Date.parse(String(pushedRemoteUpdatedAt)))) {
        return { ok: false, status: 400, body: { error: providerError("invalid_sync_confirmation"), provider: normalizedProvider } };
      }
      runTx(() => {
        binding.baseline = structuredClone(payload);
        binding.syncedLocalRevision = item.revision;
        binding.remoteUpdatedAt = String(pushedRemoteUpdatedAt);
        binding.lastSyncedAt = now();
        recordActivity(item, actor, providerActivity("pushed"), { number: binding.number });
      });
      return { ok: true, status: 200, body: { action: "pushed", workItem: workItemView(item, actor) } };
    }
    if (direction !== "pull") return { ok: false, status: 400, body: { error: providerError("invalid_sync_direction"), provider: normalizedProvider } };
    const snapshot = normalizeGithubSnapshot({ ...remote, number: binding.number });
    if (!snapshot) return { ok: false, status: 400, body: { error: providerError("invalid_issue_snapshot"), provider: normalizedProvider } };
    const localChanged = item.revision !== binding.syncedLocalRevision;
    const remoteChanged = snapshot.updatedAt !== binding.remoteUpdatedAt;
    if (!remoteChanged) {
      return { ok: true, status: 200, body: { action: "unchanged", workItem: workItemView(item, actor) } };
    }
    if (localChanged && remoteChanged) {
      const fields = GITHUB_SYNC_FIELDS.filter((field) =>
        JSON.stringify(item[field]) !== JSON.stringify(binding.baseline?.[field])
        && JSON.stringify(snapshot[field]) !== JSON.stringify(binding.baseline?.[field])
        && JSON.stringify(item[field]) !== JSON.stringify(snapshot[field]));
      if (fields.length) {
        const conflict = {
          detectedAt: now(), fields,
          local: Object.fromEntries(fields.map((field) => [field, item[field]])),
          remote: Object.fromEntries(fields.map((field) => [field, snapshot[field]])),
        };
        runTx(() => {
          binding.conflict = conflict;
          recordActivity(item, actor, providerActivity("conflict_detected"), { number: binding.number, fields });
        });
        return { ok: false, status: 409, body: { error: providerError("sync_conflict"), provider: normalizedProvider, conflict } };
      }
    }
    const merged = Object.fromEntries(GITHUB_SYNC_FIELDS.map((field) => [
      field,
      localChanged && JSON.stringify(item[field]) !== JSON.stringify(binding.baseline?.[field])
        ? item[field]
        : snapshot[field],
    ]));
    runTx(() => {
      Object.assign(item, merged, {
        revision: item.revision + 1, updatedAt: now(), lastModifiedBy: actorUser(actor),
      });
      binding.baseline = Object.fromEntries(GITHUB_SYNC_FIELDS.map((field) => [field, snapshot[field]]));
      binding.syncedLocalRevision = item.revision;
      binding.remoteUpdatedAt = snapshot.updatedAt;
      binding.lastSyncedAt = now();
      binding.conflict = null;
      binding.remoteDeletedAt = null;
      recordActivity(item, actor, providerActivity("pulled"), { number: binding.number });
    });
    notifyWorkItemChanged(item, actor, `${normalizedProvider}_pulled`);
    return { ok: true, status: 200, body: { action: "pulled", workItem: workItemView(item, actor) } };
  }

  function syncGithubIssue(input = {}, actor = null) {
    const result = syncExternalIssue({ ...input, provider: "github" }, actor);
    if (result.body?.error === "external_issue_not_bound") result.body.error = "github_issue_not_bound";
    return result;
  }

  function listExternalProviders() {
    const gitlab = externalIssueProviderReadiness("gitlab");
    const gitea = externalIssueProviderReadiness("gitea");
    return {
      ok: true,
      status: 200,
      body: {
        providers: [
          { id: "github", label: "GitHub", binding: true, manualPull: true, apiSync: true, webhook: true, changeRequest: "pull_request" },
          { id: "gitlab", label: "GitLab", binding: true, manualPull: true, apiSync: gitlab.configured, webhook: gitlab.webhookConfigured, changeRequest: "merge_request" },
          { id: "gitea", label: "Gitea", binding: true, manualPull: true, apiSync: gitea.configured, webhook: gitea.webhookConfigured, changeRequest: "pull_request" },
        ],
        authority: {
          planning: "local",
          sourceCode: "git",
          externalCollaboration: "provider",
          conflictPolicy: "manual_resolution",
        },
      },
    };
  }

  function createWorkItem(input = {}, actor = null, { allowPinnedRoutineChild = false } = {}) {
    const projectId = String(input.projectId ?? "");
    if (!projectId || !actorCanAccessProject(state, actor, projectId)) {
      return { ok: false, status: 404, body: { error: "project_not_found" } };
    }
    let idempotencyKey = input.idempotencyKey == null ? null : String(input.idempotencyKey).trim();
    if (idempotencyKey != null && (!idempotencyKey || idempotencyKey.length > 200)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_idempotency_key" } };
    }
    const hasRoutineInput = Object.hasOwn(input, "routineBinding")
      || ROUTINE_BINDING_FIELDS.some((field) => Object.hasOwn(input, field));
    if (idempotencyKey && !hasRoutineInput) {
      const replay = (state.workItems ?? []).find(
        (item) => item.ownerTeamId === actorTeam(actor)
          && item.createdBy === actorUser(actor)
          && item.createIdempotencyKey === idempotencyKey,
      );
      if (replay) {
        return { ok: true, status: 200, body: { workItem: workItemView(replay, actor), replayed: true } };
      }
    }
    const validated = validateDraft(input);
    if (validated.error) return { ok: false, status: 400, body: { error: validated.error } };
    if (validated.value.workGoalId) {
      const goal = (state.workGoals ?? []).find((candidate) =>
        candidate.id === validated.value.workGoalId
        && candidate.ownerTeamId === actorTeam(actor)
        && candidate.projectId === projectId);
      if (!goal) return { ok: false, status: 400, body: { error: "invalid_work_item_goal" } };
    }
    if (!validated.value.myTemplateBinding && !hasRoutineInput) {
      const automaticMatch = matchPublishedMyTemplate({
        definitions: (state.routineDefinitions ?? []).filter(
          (definition) => definition.ownerTeamId === actorTeam(actor),
        ),
        routingFeedback: state.myTemplateRoutingFeedback.filter((feedback) =>
          feedback.ownerTeamId === actorTeam(actor) && feedback.projectId === projectId),
        outcomeFeedback: state.myTemplateOutcomeFeedback.filter((feedback) =>
          feedback.ownerTeamId === actorTeam(actor) && feedback.projectId === projectId),
        planActualFeedback: state.workItemPlanActualFeedback.filter((feedback) =>
          feedback.ownerTeamId === actorTeam(actor) && feedback.projectId === projectId),
        governanceInterventions: state.myTemplateGovernanceInterventions.filter((entry) =>
          entry.ownerTeamId === actorTeam(actor) && entry.projectId === projectId),
        projectId,
        intent: `${validated.value.title}\n${validated.value.body ?? ""}`,
      });
      if (automaticMatch.state === "matched" && automaticMatch.selected) {
        validated.value.myTemplateBinding = {
          definitionId: automaticMatch.selected.definitionId,
          familyId: automaticMatch.selected.templateId,
          version: automaticMatch.selected.version,
          matchReasons: automaticMatch.selected.reasons,
        };
      }
    }
    const templateResultConfirmed = validated.value.myTemplateBinding?.userConfirmedResult === true;
    if (validated.value.myTemplateBinding) {
      const materialized = materializeMyTemplateBinding(validated.value.myTemplateBinding, projectId, actor);
      if (materialized.error) return { ok: false, status: 409, body: { error: materialized.error } };
      validated.value.myTemplateBinding = materialized.value;
    }
    const followUp = resolveFollowUpContext(validated.value, actor, { input });
    if (followUp.error) return { ok: false, status: 400, body: { error: followUp.error } };
    Object.assign(validated.value, followUp.value);
    if (!Object.hasOwn(input, "assigneeIds")) validated.value.assigneeIds = [actorUser(actor)];
    if (!idempotencyKey && validated.value.routineDefinitionId) {
      idempotencyKey = routineIdempotencyKeys({
        ownerTeamId: actorTeam(actor),
        routineDefinitionId: validated.value.routineDefinitionId,
        routineVersion: validated.value.routineVersion,
        businessKey: validated.value.businessKey,
      }).issue;
    }
    const replay = idempotencyKey ? (state.workItems ?? []).find(
      (item) => item.ownerTeamId === actorTeam(actor)
        && (validated.value.routineDefinitionId
          ? item.routineDefinitionId === validated.value.routineDefinitionId
            && item.routineVersion === validated.value.routineVersion
            && item.businessCaseId === validated.value.businessCaseId
          : item.createdBy === actorUser(actor))
        && item.createIdempotencyKey === idempotencyKey,
    ) : null;
    if (replay) return { ok: true, status: 200, body: { workItem: workItemView(replay, actor), replayed: true } };
    const parentId = input.parentId == null || input.parentId === "" ? null : String(input.parentId);
    const parent = parentId ? findOwn(parentId, actor) : null;
    if (parentId && (!parent || parent.projectId !== projectId)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_parent" } };
    }
    const dependencyIds = [...new Set((Array.isArray(input.dependencyIds) ? input.dependencyIds : []).map(String))];
    if (dependencyIds.length > 50 || dependencyIds.some((id) => {
      const dependency = findOwn(id, actor);
      return !dependency || dependency.projectId !== projectId;
    })) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_dependencies" } };
    }
    const pinnedRoutineChild = Boolean(allowPinnedRoutineChild
      && parent
      && validated.value.routineDefinitionId
      && parent.routineDefinitionId === validated.value.routineDefinitionId
      && parent.routineVersion === validated.value.routineVersion
      && parent.businessCaseId === validated.value.businessCaseId);
    const routineContextError = validateRoutineBindingContext(validated.value, projectId, actor, {
      allowPinnedDefinition: pinnedRoutineChild,
    });
    if (routineContextError) {
      return {
        ok: false,
        status: routineContextError.status,
        body: { error: routineContextError.error },
      };
    }
    const teamId = actorTeam(actor);
    const localNumber = 1 + Math.max(0, ...(state.workItems ?? [])
      .filter((item) => item.ownerTeamId === teamId)
      .map((item) => Number(item.localNumber) || 0));
    const timestamp = now();
    const suppliedCriteria = validated.value.acceptanceCriteria ?? [];
    const extractedCriteria = suppliedCriteria.length
      ? []
      : extractAcceptanceCriteriaFromBody(validated.value.body);
    const contractCriteria = suppliedCriteria.length ? suppliedCriteria : extractedCriteria;
    if (contractCriteria.length) {
      validated.value.acceptanceCriteria = contractCriteria;
      validated.value.verificationSop = validated.value.verificationSop?.length
        ? validated.value.verificationSop
        : defaultVerificationSop(validated.value);
      validated.value.executionContractSource = suppliedCriteria.length ? "manual" : "body_extracted";
      validated.value.executionContractConfirmedAt = timestamp;
    } else {
      validated.value.verificationSop = [];
      validated.value.executionContractSource = null;
      validated.value.executionContractConfirmedAt = null;
    }
    if (validated.value.resultVerificationContract) {
      validated.value.resultVerificationContract = resultVerificationContract(validated.value, {
        enforced: contractCriteria.length > 0,
      });
    }
    validated.value.outputAssets = deriveWorkItemOutputMetricsForAssets(validated.value.outputAssets ?? [], {
      ...outputMetricsOptions(projectId),
    });
    const workItem = {
      id: nextId("lwi"),
      localNumber,
      localRef: `LOCAL-${localNumber}`,
      ownerTeamId: teamId,
      projectId,
      terminalId: localTerminalId(),
      ...validated.value,
      dependencyIds,
      parentId,
      createIdempotencyKey: idempotencyKey,
      followUpScheduleRevision: validated.value.nextFollowUpAt ? 1 : 0,
      revision: 1,
      state: "open",
      archivedAt: null,
      completedAt: validated.value.status === "done" ? timestamp : null,
      schedulePlanSource: validated.value.plannedDate ? "manual" : null,
      scheduleReason: validated.value.plannedDate ? "manual_schedule" : null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      lastModifiedBy: actorUser(actor),
      externalBindings: [],
      executionBindings: [],
      localContentRefs: [],
      taskResourceRefs: [],
      materialChangesPending: false,
    };
    const materialDraftId = input.materialDraftId == null ? null : String(input.materialDraftId).trim();
    if (materialDraftId) {
      if (typeof claimTaskMaterialDraft !== "function") {
        return { ok: false, status: 503, body: { error: "task_material_service_unavailable" } };
      }
      const claimed = claimTaskMaterialDraft({
        projectId,
        draftId: materialDraftId,
        expectedRevision: input.materialDraftRevision,
        workItemId: workItem.id,
        terminalId: workItem.terminalId,
        deferPersist: true,
      }, actor);
      if (!claimed.ok) {
        return { ok: false, status: claimed.status ?? 409, body: { error: claimed.error ?? "task_material_claim_failed" } };
      }
      workItem.materialDraftId = materialDraftId;
      workItem.inputAssets = claimed.assets;
    }
    workItem.dataContextSnapshot = buildDataContextSnapshot({
      workItemId: workItem.id,
      workItemRevision: workItem.revision,
      capturedAt: timestamp,
      inputAssets: workItem.inputAssets,
      localContentRefs: workItem.localContentRefs,
      taskResourceRefs: workItem.taskResourceRefs,
      channelTaskContract: workItem.channelTaskContract,
      channelOrigin: workItem.channelOrigin,
      taskContextControl: workItem.taskContextControl,
    });
    workItem.dataContextSnapshotHistory = [];
    const assetReadiness = evaluateAssetRequirements(
      workItem.inputAssets,
      workItem.requiredCapabilities,
      workItem.terminalId,
      { availableResourceClasses: localAssetResourceClasses(workItem.terminalId) },
    );
    if (assetReadiness.state === "refused") {
      return { ok: false, status: 409, body: { error: assetReadiness.reason, terminalId: workItem.terminalId } };
    }
    workItem.assetReadiness = assetReadiness;
    workItem.applicationResolutions = (workItem.requiredCapabilities ?? []).map((assetVerb) =>
      resolveApplicationCapability({
        assetVerb,
        assetFamily: workItem.inputAssets?.find((asset) => asset.capabilities?.includes(assetVerb))?.family ?? null,
        terminalId: workItem.terminalId,
        resourceClass: workItem.inputAssets?.find((asset) => asset.capabilities?.includes(assetVerb))?.resourceClass ?? "small",
      }, actor));
    workItem.queueReadiness = aggregateApplicationReadiness(workItem.applicationResolutions, assetReadiness);
    runTx(() => {
      (state.workItems ??= []).unshift(workItem);
      recordActivity(workItem, actor, "created", {
        title: workItem.title, type: workItem.type, status: workItem.status, priority: workItem.priority,
        followUpContext: workItemFollowUpContextView(workItem),
        ...(workItem.channelTaskContract ? {
          channelTaskContract: {
            schemaVersion: workItem.channelTaskContract.schemaVersion,
            source: workItem.channelTaskContract.source,
            domain: workItem.channelTaskContract.domain,
            riskLevel: workItem.channelTaskContract.riskLevel,
            dataSourceCount: workItem.channelTaskContract.dataSources.length,
            dataPlan: workItem.channelTaskContract.dataPlan
              ? {
                status: workItem.channelTaskContract.dataPlan.status,
                sourceCount: workItem.channelTaskContract.dataPlan.sources.length,
                digest: workItem.channelTaskContract.dataPlan.digest,
              }
              : null,
            dataRelationConfirmation: workItem.channelTaskContract.dataRelationConfirmation
              ? {
                status: workItem.channelTaskContract.dataRelationConfirmation.status,
                confirmationMode: workItem.channelTaskContract.dataRelationConfirmation.confirmationMode,
                objectSnapshotCount: workItem.channelTaskContract.dataRelationConfirmation.objectSnapshotCount,
                id: workItem.channelTaskContract.dataRelationConfirmation.id,
              }
              : null,
            templateMatch: workItem.channelTaskContract.templateMatch
              ? {
                state: workItem.channelTaskContract.templateMatch.state,
                decision: workItem.channelTaskContract.templateMatch.decision,
                definitionId: workItem.channelTaskContract.templateMatch.definitionId,
                familyId: workItem.channelTaskContract.templateMatch.familyId,
                version: workItem.channelTaskContract.templateMatch.version,
              }
              : null,
          },
        } : {}),
        ...(workItem.routineDefinitionId ? {
          routineDefinitionId: workItem.routineDefinitionId,
          routineVersion: workItem.routineVersion,
          businessCaseId: workItem.businessCaseId,
        } : {}),
      });
      if (templateResultConfirmed && workItem.myTemplateBinding) {
        const feedback = {
          id: nextId("mtf"),
          kind: "confirmation",
          ownerTeamId: actorTeam(actor),
          projectId: workItem.projectId,
          workItemId: workItem.id,
          intentTerms: templateRoutingTerms(`${workItem.title}\n${workItem.body ?? ""}`),
          rejectedDefinitionId: null,
          rejectedFamilyId: null,
          rejectedVersion: null,
          rejectedOutput: null,
          selectedDefinitionId: workItem.myTemplateBinding.definitionId,
          selectedFamilyId: workItem.myTemplateBinding.familyId,
          selectedVersion: workItem.myTemplateBinding.version,
          selectedOutput: workItem.myTemplateBinding.expectedOutput,
          reason: "user_confirmed_desired_output",
          createdBy: actorUser(actor),
          createdAt: timestamp,
        };
        state.myTemplateRoutingFeedback.unshift(feedback);
        state.myTemplateRoutingFeedback = state.myTemplateRoutingFeedback.slice(0, 1_000);
        recordActivity(workItem, actor, "my_template_match_confirmed", {
          feedbackId: feedback.id,
          selectedOutput: feedback.selectedOutput,
        });
      }
      applyPlanningAutomation(workItem, actor);
      appendEvent({
        invocationId: null,
        type: "work_item_created",
        level: "info",
        message: `${workItem.localRef} created.`,
        data: {
          workItemId: workItem.id, localRef: workItem.localRef, projectId,
          terminalId: workItem.terminalId, actorTeamId: teamId,
          ...(workItem.channelTaskContract ? {
            channelTaskContract: {
              schemaVersion: workItem.channelTaskContract.schemaVersion,
              source: workItem.channelTaskContract.source,
              domain: workItem.channelTaskContract.domain,
              riskLevel: workItem.channelTaskContract.riskLevel,
              dataSourceCount: workItem.channelTaskContract.dataSources.length,
              dataPlanStatus: workItem.channelTaskContract.dataPlan?.status ?? "not_required",
              dataRelationConfirmation: workItem.channelTaskContract.dataRelationConfirmation
                ? {
                  status: workItem.channelTaskContract.dataRelationConfirmation.status,
                  confirmationMode: workItem.channelTaskContract.dataRelationConfirmation.confirmationMode,
                  objectSnapshotCount: workItem.channelTaskContract.dataRelationConfirmation.objectSnapshotCount,
                  id: workItem.channelTaskContract.dataRelationConfirmation.id,
                }
                : null,
              templateMatchState: workItem.channelTaskContract.templateMatch?.state ?? "missing",
            },
          } : {}),
          ...(workItem.routineDefinitionId ? {
            routineDefinitionId: workItem.routineDefinitionId,
            routineVersion: workItem.routineVersion,
            businessCaseId: workItem.businessCaseId,
          } : {}),
        },
      });
    });
    notifyWorkItemChanged(workItem, actor, "created");
    return { ok: true, status: 201, body: { workItem: workItemView(workItem, actor) } };
  }

  function updateWorkItem({ workItemId, expectedRevision, refreshExecutionContract = false, ...changes } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (typeof refreshExecutionContract !== "boolean") {
      return { ok: false, status: 400, body: { error: "invalid_work_item_execution_contract_refresh" } };
    }
    if (item.deliveryOperation?.status === "in_progress"
      && Date.parse(item.deliveryOperation.expiresAt) > Date.parse(now())) {
      return {
        ok: false,
        status: 409,
        body: { error: "work_item_delivery_in_progress", operationId: item.deliveryOperation.id },
      };
    }
    if (Object.hasOwn(changes, "routineBinding")
      || ROUTINE_BINDING_FIELDS.some((field) => Object.hasOwn(changes, field))) {
      return { ok: false, status: 409, body: { error: "work_item_routine_binding_immutable" } };
    }
    if (Object.hasOwn(changes, "myTemplateBinding")
      && (item.executionBindings ?? []).length) {
      return { ok: false, status: 409, body: { error: "work_item_my_template_binding_immutable" } };
    }
    if (Object.hasOwn(changes, "recordBindings")) {
      return {
        ok: false,
        status: 409,
        body: {
          error: (item.executionBindings ?? []).length
            ? "work_item_record_bindings_immutable"
            : "work_item_record_bindings_require_managed_update",
        },
      };
    }
    if (Object.hasOwn(changes, "terminalId")) {
      return {
        ok: false,
        status: 409,
        body: { error: "work_item_terminal_immutable", terminalId: item.terminalId },
      };
    }
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const validated = validateDraft(changes, { partial: true });
    if (validated.error) return { ok: false, status: 400, body: { error: validated.error } };
    const goalChanged = (Object.hasOwn(validated.value, "title") && validated.value.title !== item.title)
      || (Object.hasOwn(validated.value, "body") && validated.value.body !== item.body);
    if (refreshExecutionContract && !goalChanged) {
      return { ok: false, status: 400, body: { error: "work_item_execution_contract_refresh_requires_goal_change" } };
    }
    const followUpContextChanged = WORK_ITEM_FOLLOW_UP_MUTABLE_FIELDS.some((field) => Object.hasOwn(changes, field));
    if (followUpContextChanged) {
      const followUp = resolveFollowUpContext({
        ...workItemFollowUpContextView(item),
        ...validated.value,
      }, actor, { input: changes });
      if (followUp.error) return { ok: false, status: 400, body: { error: followUp.error } };
      for (const [field, value] of Object.entries(followUp.value)) {
        if (!Object.is(item[field], value)) validated.value[field] = value;
      }
    }
    const nextInputAssets = validated.value.inputAssets ?? item.inputAssets ?? [];
    const nextOutputAssets = validated.value.outputAssets ?? item.outputAssets ?? [];
    if ([...nextInputAssets, ...nextOutputAssets].some((asset) => asset.terminalId !== item.terminalId)) {
      return { ok: false, status: 409, body: { error: "asset_terminal_mismatch", terminalId: item.terminalId } };
    }
    validated.value.outputAssets = deriveWorkItemOutputMetricsForAssets(nextOutputAssets, {
      ...outputMetricsOptions(item.projectId),
    });
    const timestamp = now();
    if (refreshExecutionContract) {
      const assisted = suggestWorkItemDraft({
        projectId: validated.value.projectId ?? item.projectId,
        title: validated.value.title ?? item.title,
        body: validated.value.body ?? item.body,
        ignoreBodyAcceptanceCriteria: true,
      }, actor);
      if (!assisted.ok) return assisted;
      const draft = assisted.body?.draft ?? {};
      const suppliedCriteria = Object.hasOwn(changes, "acceptanceCriteria")
        ? validated.value.acceptanceCriteria
        : null;
      const suppliedVerification = Object.hasOwn(changes, "verificationSop")
        ? validated.value.verificationSop
        : null;
      const refreshedCriteria = suppliedCriteria?.length
        ? suppliedCriteria
        : strings(draft.acceptanceCriteria ?? [], { limit: 100, maxLength: 2_000 });
      const refreshedVerification = suppliedVerification?.length
        ? suppliedVerification
        : strings(draft.verificationSop ?? [], { limit: 30, maxLength: 2_000 });
      if (!refreshedCriteria?.length || !refreshedVerification?.length) {
        return { ok: false, status: 409, body: { error: "work_item_execution_contract_assistance_incomplete" } };
      }
      validated.value.acceptanceCriteria = refreshedCriteria;
      validated.value.verificationSop = refreshedVerification;
      validated.value.executionContractSource = suppliedCriteria?.length ? "manual" : "assisted";
      validated.value.executionContractConfirmedAt = timestamp;
      validated.value.executionContractRefreshedAt = timestamp;
      validated.value.executionContractRefreshRevision = item.revision + 1;
      if (["review", "done"].includes(validated.value.status ?? item.status)) {
        validated.value.status = "ready";
      }
      // Goal revisions start a fresh active evidence set. The update activity
      // below retains the previous values for audit, but they cannot pass the
      // new contract merely because the wording happens to overlap.
      validated.value.acceptanceResults = [];
      validated.value.verificationRecords = [];
      validated.value.resultVerification = null;
    }
    const previousTemplateBinding = item.myTemplateBinding ?? null;
    const templateResultConfirmed = validated.value.myTemplateBinding?.userConfirmedResult === true;
    if (validated.value.myTemplateBinding) {
      const materialized = materializeMyTemplateBinding(
        validated.value.myTemplateBinding,
        validated.value.projectId ?? item.projectId,
        actor,
        timestamp,
      );
      if (materialized.error) return { ok: false, status: 409, body: { error: materialized.error } };
      validated.value.myTemplateBinding = materialized.value;
    }
    const templateCorrection = previousTemplateBinding
      && validated.value.myTemplateBinding
      && (previousTemplateBinding.familyId !== validated.value.myTemplateBinding.familyId
        || previousTemplateBinding.version !== validated.value.myTemplateBinding.version)
      ? {
          id: nextId("mtf"),
          ownerTeamId: actorTeam(actor),
          projectId: item.projectId,
          workItemId: item.id,
          intentTerms: templateRoutingTerms(`${item.title}\n${item.body ?? ""}`),
          rejectedDefinitionId: previousTemplateBinding.definitionId,
          rejectedFamilyId: previousTemplateBinding.familyId,
          rejectedVersion: previousTemplateBinding.version,
          rejectedOutput: previousTemplateBinding.expectedOutput,
          selectedDefinitionId: validated.value.myTemplateBinding.definitionId,
          selectedFamilyId: validated.value.myTemplateBinding.familyId,
          selectedVersion: validated.value.myTemplateBinding.version,
          selectedOutput: validated.value.myTemplateBinding.expectedOutput,
          reason: validated.value.myTemplateBinding.matchReasons.at(-1) ?? "user_corrected_desired_output",
          createdBy: actorUser(actor),
          createdAt: timestamp,
        }
      : null;
    const templateConfirmation = !previousTemplateBinding
      && validated.value.myTemplateBinding
      && templateResultConfirmed
      ? {
          id: nextId("mtf"),
          kind: "confirmation",
          ownerTeamId: actorTeam(actor),
          projectId: item.projectId,
          workItemId: item.id,
          intentTerms: templateRoutingTerms(`${item.title}\n${item.body ?? ""}`),
          rejectedDefinitionId: null,
          rejectedFamilyId: null,
          rejectedVersion: null,
          rejectedOutput: null,
          selectedDefinitionId: validated.value.myTemplateBinding.definitionId,
          selectedFamilyId: validated.value.myTemplateBinding.familyId,
          selectedVersion: validated.value.myTemplateBinding.version,
          selectedOutput: validated.value.myTemplateBinding.expectedOutput,
          reason: "user_confirmed_desired_output",
          createdBy: actorUser(actor),
          createdAt: timestamp,
        }
      : null;
    const contractInputChanged = refreshExecutionContract
      || Object.hasOwn(changes, "acceptanceCriteria")
      || Object.hasOwn(changes, "verificationSop")
      || (Object.hasOwn(changes, "body") && !(item.acceptanceCriteria ?? []).length);
    if (contractInputChanged && !refreshExecutionContract) {
      let nextCriteria = validated.value.acceptanceCriteria ?? item.acceptanceCriteria ?? [];
      if (!Object.hasOwn(changes, "acceptanceCriteria") && !nextCriteria.length && Object.hasOwn(changes, "body")) {
        nextCriteria = extractAcceptanceCriteriaFromBody(validated.value.body);
      }
      if (nextCriteria.length) {
        validated.value.acceptanceCriteria = nextCriteria;
        validated.value.verificationSop = validated.value.verificationSop?.length
          ? validated.value.verificationSop
          : (item.verificationSop?.length ? item.verificationSop : defaultVerificationSop({ ...item, ...validated.value }));
        validated.value.executionContractSource = Object.hasOwn(changes, "acceptanceCriteria")
          ? "manual"
          : "body_extracted";
        validated.value.executionContractConfirmedAt = timestamp;
      } else {
        validated.value.verificationSop = [];
        validated.value.executionContractSource = null;
        validated.value.executionContractConfirmedAt = null;
      }
    }
    if (item.resultVerificationContract && contractInputChanged) {
      validated.value.resultVerificationContract = resultVerificationContract({
        ...item,
        ...validated.value,
      }, {
        enforced: (validated.value.acceptanceCriteria ?? item.acceptanceCriteria ?? []).length > 0,
      });
    }
    if (validated.value.status === "done") {
      const candidate = { ...item, ...validated.value };
      if (candidate.resultVerificationContract?.enforced === true) {
        const resultVerification = verifyWorkItemResult(candidate);
        if (resultVerification.status !== "passed") {
          return {
            ok: false,
            status: 409,
            body: { error: "work_item_result_verification_incomplete", resultVerification },
          };
        }
        validated.value.resultVerification = resultVerification;
      }
      const gate = completionGate({ ...item, ...validated.value });
      if (!gate.ready) return { ok: false, status: 409, body: { error: "work_item_acceptance_incomplete", ...gate } };
    }
    if (Object.hasOwn(changes, "projectId")) {
      const projectId = String(changes.projectId ?? "");
      if (!projectId || !actorCanAccessProject(state, actor, projectId)) {
        return { ok: false, status: 404, body: { error: "project_not_found" } };
      }
      const relatedIds = [item.parentId, ...(state.workItems ?? [])
        .filter((candidate) => candidate.ownerTeamId === actorTeam(actor) && candidate.parentId === item.id)
        .map((candidate) => candidate.id)].filter(Boolean);
      if (relatedIds.some((id) => findOwn(id, actor)?.projectId !== projectId)) {
        return { ok: false, status: 409, body: { error: "work_item_hierarchy_project_conflict" } };
      }
      validated.value.projectId = projectId;
    }
    if (Object.hasOwn(changes, "dependencyIds")) {
      if (!Array.isArray(changes.dependencyIds)) {
        return { ok: false, status: 400, body: { error: "invalid_work_item_dependencies" } };
      }
      const dependencyIds = [...new Set(changes.dependencyIds.map(String))];
      if (dependencyIds.length > 50 || dependencyIds.includes(item.id)
        || dependencyIds.some((id) => !findOwn(id, actor))) {
        return { ok: false, status: 400, body: { error: "invalid_work_item_dependencies" } };
      }
      const reachesItem = (candidateId, visited = new Set()) => {
        if (candidateId === item.id) return true;
        if (visited.has(candidateId)) return false;
        visited.add(candidateId);
        const candidate = findOwn(candidateId, actor);
        return (candidate?.dependencyIds ?? []).some((id) => reachesItem(id, visited));
      };
      if (dependencyIds.some((id) => reachesItem(id))) {
        return { ok: false, status: 409, body: { error: "work_item_dependency_cycle" } };
      }
      validated.value.dependencyIds = dependencyIds;
    }
    if (Object.hasOwn(changes, "parentId")) {
      const parentId = changes.parentId == null || changes.parentId === "" ? null : String(changes.parentId);
      const parent = parentId ? findOwn(parentId, actor) : null;
      if (parentId === item.id || (parentId && (!parent || parent.projectId !== (validated.value.projectId ?? item.projectId)))) {
        return { ok: false, status: 400, body: { error: "invalid_work_item_parent" } };
      }
      let candidate = parent;
      const visited = new Set();
      while (candidate) {
        if (candidate.id === item.id) {
          return { ok: false, status: 409, body: { error: "work_item_parent_cycle" } };
        }
        if (visited.has(candidate.id)) break;
        visited.add(candidate.id);
        candidate = candidate.parentId ? findOwn(candidate.parentId, actor) : null;
      }
      validated.value.parentId = parentId;
    }
    const nextValues = { ...validated.value };
    const followUpScheduleChanged = Object.hasOwn(validated.value, "nextFollowUpAt")
      && validated.value.nextFollowUpAt !== item.nextFollowUpAt;
    if (Object.hasOwn(validated.value, "plannedDate")) {
      nextValues.schedulePlanSource = validated.value.plannedDate ? "manual" : null;
      nextValues.scheduleReason = validated.value.plannedDate ? "manual_schedule" : null;
    }
    if (Object.hasOwn(validated.value, "status") && validated.value.status !== item.status) {
      nextValues.completedAt = validated.value.status === "done" ? timestamp : null;
    }
    const previous = Object.fromEntries(Object.keys(nextValues).map((key) => [key, item[key] ?? null]));
    runTx(() => {
      if (followUpScheduleChanged) {
        followUpReminderService.scheduleChanged(item, actor, {
          reason: validated.value.status === "done"
            ? "completed"
            : validated.value.nextFollowUpAt ? "rescheduled" : "schedule_cleared",
        });
      }
      Object.assign(item, nextValues, {
        revision: item.revision + 1,
        updatedAt: timestamp,
        lastModifiedBy: actorUser(actor),
      });
      if (validated.value.acceptanceCriteria) {
        item.acceptanceResults = (item.acceptanceResults ?? [])
          .filter((result) => validated.value.acceptanceCriteria.includes(result.criterion));
      }
      if (validated.value.status === "done") {
        followUpReminderService.resolveAllDue(item, actor, "completed");
      }
      recordActivity(item, actor, "updated", {
        changes: Object.fromEntries(Object.entries(nextValues).map(([key, value]) => [
          key, { from: previous[key], to: value },
        ])),
        ...(followUpContextChanged ? { followUpContextChanged: true } : {}),
        ...(refreshExecutionContract ? { executionContractRefreshed: true } : {}),
      });
      if (templateCorrection) {
        state.myTemplateRoutingFeedback.unshift(templateCorrection);
        state.myTemplateRoutingFeedback = state.myTemplateRoutingFeedback.slice(0, 1_000);
        recordActivity(item, actor, "my_template_match_corrected", {
          feedbackId: templateCorrection.id,
          from: {
            definitionId: templateCorrection.rejectedDefinitionId,
            version: templateCorrection.rejectedVersion,
            expectedOutput: templateCorrection.rejectedOutput,
          },
          to: {
            definitionId: templateCorrection.selectedDefinitionId,
            version: templateCorrection.selectedVersion,
            expectedOutput: templateCorrection.selectedOutput,
          },
        });
      }
      if (templateConfirmation) {
        state.myTemplateRoutingFeedback.unshift(templateConfirmation);
        state.myTemplateRoutingFeedback = state.myTemplateRoutingFeedback.slice(0, 1_000);
        recordActivity(item, actor, "my_template_match_confirmed", {
          feedbackId: templateConfirmation.id,
          selectedOutput: templateConfirmation.selectedOutput,
        });
      }
      applyPlanningAutomation(item, actor);
      appendEvent({
        invocationId: null,
        type: "work_item_updated",
        level: "info",
        message: `${item.localRef} updated.`,
        data: { workItemId: item.id, revision: item.revision, actorTeamId: actorTeam(actor) },
      });
    });
    if (validated.value.status === "done") propagateCompletedGoalTask(item, actor);
    notifyWorkItemChanged(item, actor, "updated");
    return {
      ok: true,
      status: 200,
      body: {
        workItem: workItemView(item, actor),
        ...(refreshExecutionContract ? { executionContractRefreshed: true } : {}),
      },
    };
  }

  function recordWorkItemProgress({
    workItemId,
    expectedRevision,
    idempotencyKey,
    summary,
    ...changes
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const key = typeof idempotencyKey === "string" ? idempotencyKey.trim() : "";
    const normalizedSummary = typeof summary === "string" ? summary.trim() : "";
    if (!key || key.length > 200) {
      return { ok: false, status: 400, body: { error: "work_item_progress_idempotency_key_required" } };
    }
    if (!normalizedSummary || normalizedSummary.length > 2_000) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_progress_summary" } };
    }
    const allowedFields = new Set(["waitingOn", "nextFollowUpAt"]);
    if (Object.keys(changes).some((field) => !allowedFields.has(field))) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_progress_fields" } };
    }
    const followUpInput = Object.fromEntries(Object.entries(changes)
      .filter(([field]) => allowedFields.has(field)));
    const normalized = normalizeWorkItemFollowUpInput(followUpInput, { partial: true });
    if (normalized.error) return { ok: false, status: 400, body: { error: normalized.error } };
    const progressInput = { summary: normalizedSummary };
    if (Object.hasOwn(normalized.value, "waitingOn")) progressInput.waitingOn = normalized.value.waitingOn;
    if (Object.hasOwn(normalized.value, "nextFollowUpAt")) progressInput.nextFollowUpAt = normalized.value.nextFollowUpAt;
    const replay = (state.workItemActivities ?? []).find((activity) =>
      activity.workItemId === item.id
      && activity.ownerTeamId === actorTeam(actor)
      && activity.actorId === actorUser(actor)
      && activity.action === "progress_recorded"
      && activity.details?.idempotencyKey === key);
    if (replay) {
      if (JSON.stringify(replay.details?.progressInput) !== JSON.stringify(progressInput)) {
        return { ok: false, status: 409, body: { error: "work_item_progress_idempotency_conflict" } };
      }
      return {
        ok: true,
        status: 200,
        body: { workItem: workItemView(item, actor), activity: replay, replayed: true },
      };
    }
    if (item.state === "closed" || item.status === "done" || item.archivedAt) {
      return { ok: false, status: 409, body: { error: "work_item_not_open_for_progress" } };
    }
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const followUp = resolveFollowUpContext({
      ...workItemFollowUpContextView(item),
      ...normalized.value,
    }, actor, { input: followUpInput });
    if (followUp.error) return { ok: false, status: 400, body: { error: followUp.error } };
    const timestamp = now();
    const previous = {
      waitingOn: item.waitingOn ?? "none",
      nextFollowUpAt: item.nextFollowUpAt ?? null,
    };
    const followUpScheduleChanged = Object.hasOwn(normalized.value, "nextFollowUpAt")
      && normalized.value.nextFollowUpAt !== item.nextFollowUpAt;
    let activity;
    runTx(() => {
      if (followUpScheduleChanged) {
        followUpReminderService.scheduleChanged(item, actor, {
          reason: normalized.value.nextFollowUpAt ? "rescheduled" : "schedule_cleared",
        });
      } else {
        followUpReminderService.resolveCurrentDue(item, actor, "progress_recorded");
      }
      Object.assign(item, normalized.value, {
        lastProgressAt: timestamp,
        lastProgressSummary: normalizedSummary,
        revision: item.revision + 1,
        updatedAt: timestamp,
        lastModifiedBy: actorUser(actor),
      });
      activity = recordActivity(item, actor, "progress_recorded", {
        idempotencyKey: key,
        progressInput,
        summary: normalizedSummary,
        changes: Object.fromEntries(Object.keys(normalized.value).map((field) => [
          field,
          { from: previous[field] ?? null, to: item[field] ?? null },
        ])),
      });
      appendEvent({
        invocationId: null,
        type: "work_item_progress_recorded",
        level: "info",
        message: `${item.localRef} progress recorded.`,
        data: { workItemId: item.id, revision: item.revision, activityId: activity.id, actorTeamId: actorTeam(actor) },
      });
    });
    notifyWorkItemChanged(item, actor, "progress_recorded");
    return {
      ok: true,
      status: 201,
      body: { workItem: workItemView(item, actor), activity, replayed: false },
    };
  }

  function bulkUpdateWorkItems({ items, changes } = {}, actor = null) {
    if (!Array.isArray(items) || items.length === 0 || items.length > 100 || !changes || typeof changes !== "object") {
      return { ok: false, status: 400, body: { error: "invalid_work_item_bulk_update" } };
    }
    const unique = new Map();
    for (const row of items) {
      const id = String(row?.id ?? "");
      if (!id || !Number.isInteger(row?.expectedRevision) || unique.has(id)) {
        return { ok: false, status: 400, body: { error: "invalid_work_item_bulk_update" } };
      }
      unique.set(id, row.expectedRevision);
    }
    const allowedChanges = Object.fromEntries(
      Object.entries(changes).filter(([key]) => [
        "status", "priority", "assigneeIds", "dueDate", "plannedDate", "carriedFromDate", "milestone", "estimatePoints",
      ].includes(key)),
    );
    if (Object.keys(allowedChanges).length === 0 || Object.keys(allowedChanges).length !== Object.keys(changes).length) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_bulk_changes" } };
    }
    const validated = validateDraft(allowedChanges, { partial: true });
    if (validated.error) return { ok: false, status: 400, body: { error: validated.error } };
    const targets = [];
    for (const [id, expectedRevision] of unique) {
      const item = findOwn(id, actor);
      if (!item) return notFound();
      if (item.deliveryOperation?.status === "in_progress"
        && Date.parse(item.deliveryOperation.expiresAt) > Date.parse(now())) {
        return {
          ok: false, status: 409,
          body: { error: "work_item_delivery_in_progress", workItemId: item.id, operationId: item.deliveryOperation.id },
        };
      }
      if (item.revision !== expectedRevision) {
        return {
          ok: false, status: 409,
          body: { error: "work_item_revision_conflict", workItemId: item.id, currentRevision: item.revision },
        };
      }
      targets.push(item);
    }
    if (validated.value.status === "done") {
      const blocked = targets.find((item) => !completionGate(item).ready);
      if (blocked) return {
        ok: false, status: 409,
        body: { error: "work_item_acceptance_incomplete", workItemId: blocked.id, ...completionGate(blocked) },
      };
    }
    runTx(() => {
      for (const item of targets) {
        const nextValues = { ...validated.value };
        const timestamp = now();
        if (Object.hasOwn(validated.value, "plannedDate")) {
          nextValues.schedulePlanSource = validated.value.plannedDate ? "manual" : null;
          nextValues.scheduleReason = validated.value.plannedDate ? "manual_schedule" : null;
        }
        if (Object.hasOwn(validated.value, "status") && validated.value.status !== item.status) {
          nextValues.completedAt = validated.value.status === "done" ? timestamp : null;
        }
        const previous = Object.fromEntries(Object.keys(nextValues).map((key) => [key, item[key] ?? null]));
        Object.assign(item, nextValues, {
          revision: item.revision + 1,
          updatedAt: timestamp,
          lastModifiedBy: actorUser(actor),
        });
        if (validated.value.status === "done") {
          followUpReminderService.resolveAllDue(item, actor, "completed");
        }
        recordActivity(item, actor, "bulk_updated", {
          changes: Object.fromEntries(Object.entries(nextValues).map(([key, value]) => [
            key, { from: previous[key], to: value },
          ])),
        });
      }
    });
    for (const item of targets) notifyWorkItemChanged(item, actor, "bulk_updated");
    return {
      ok: true, status: 200,
      body: { workItems: targets.map((item) => workItemView(item, actor)), count: targets.length },
    };
  }

  function transitionWorkItem({ workItemId, expectedRevision, action } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (item.deliveryOperation?.status === "in_progress"
      && Date.parse(item.deliveryOperation.expiresAt) > Date.parse(now())) {
      return {
        ok: false,
        status: 409,
        body: { error: "work_item_delivery_in_progress", operationId: item.deliveryOperation.id },
      };
    }
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    if (!["close", "reopen", "archive", "restore"].includes(action)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_action" } };
    }
    if (action === "close") {
      const gate = completionGate(item);
      if (!gate.ready) return { ok: false, status: 409, body: { error: "work_item_acceptance_incomplete", ...gate } };
    }
    const pastTense = { close: "closed", reopen: "reopened", archive: "archived", restore: "restored" }[action];
    runTx(() => {
      const transitionAt = now();
      if (["close", "archive"].includes(action)) {
        followUpReminderService.resolveAllDue(item, actor, action === "archive" ? "archived" : "completed");
      }
      if (action === "close") {
        item.state = "closed";
        item.completedAt = item.completedAt ?? transitionAt;
        item.waitingOn = "none";
      }
      if (action === "reopen") {
        item.state = "open";
        item.completedAt = null;
      }
      if (action === "archive") item.archivedAt = now();
      if (action === "restore") item.archivedAt = null;
      item.revision += 1;
      item.updatedAt = transitionAt;
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, action, { state: item.state, archivedAt: item.archivedAt });
      appendEvent({
        invocationId: null,
        type: `work_item_${pastTense}`,
        level: "info",
        message: `${item.localRef} ${pastTense}.`,
        data: { workItemId: item.id, revision: item.revision, actorTeamId: actorTeam(actor) },
      });
    });
    notifyWorkItemChanged(item, actor, action);
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor) } };
  }

  function recordVerification({
    workItemId, expectedRevision, kind, status, command = null, summary = "", acceptanceResults = [], evidence = [],
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (item.deliveryOperation?.status === "in_progress"
      && Date.parse(item.deliveryOperation.expiresAt) > Date.parse(now())) {
      return {
        ok: false,
        status: 409,
        body: { error: "work_item_delivery_in_progress", operationId: item.deliveryOperation.id },
      };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    if (!VERIFICATION_KINDS.has(kind) || !VERIFICATION_STATUSES.has(status)
      || typeof summary !== "string" || summary.length > 10_000
      || (command != null && (typeof command !== "string" || command.length > 2_000))
      || !Array.isArray(acceptanceResults) || !Array.isArray(evidence) || evidence.length > 100) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_verification" } };
    }
    const criteria = new Set(item.acceptanceCriteria ?? []);
    const normalizedResults = acceptanceResults.map((result) => ({
      criterion: String(result?.criterion ?? ""),
      status: String(result?.status ?? ""),
      note: String(result?.note ?? ""),
    }));
    if (normalizedResults.some((result) => !criteria.has(result.criterion)
      || !["passed", "failed", "not_tested"].includes(result.status) || result.note.length > 5_000)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_acceptance_result" } };
    }
    const normalizedEvidence = evidence.map((entry) => ({
      kind: String(entry?.kind ?? ""),
      ref: String(entry?.ref ?? ""),
      summary: String(entry?.summary ?? ""),
      assetId: entry?.assetId ? String(entry.assetId).slice(0, 100) : null,
      hash: entry?.hash ? String(entry.hash).slice(0, 100) : null,
      version: entry?.version ? String(entry.version).slice(0, 100) : null,
      terminalId: entry?.terminalId ? String(entry.terminalId).slice(0, 200) : null,
    }));
    if (normalizedEvidence.some((entry) => !["url", "artifact", "commit", "log", "run", "asset"].includes(entry.kind)
      || !entry.ref || entry.ref.length > 2_000 || entry.summary.length > 5_000
      || (entry.kind === "asset" && (entry.terminalId !== item.terminalId
        || !(item.outputAssets ?? []).some((asset) => asset.id === entry.assetId && asset.path === entry.ref))))) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_evidence" } };
    }
    const record = {
      id: nextId("wvr"), kind, status, command, summary,
      evidence: normalizedEvidence, recordedAt: now(), recordedBy: actorUser(actor),
    };
    runTx(() => {
      (item.verificationRecords ??= []).unshift(record);
      const byCriterion = new Map((item.acceptanceResults ?? []).map((result) => [result.criterion, result]));
      for (const result of normalizedResults) byCriterion.set(result.criterion, { ...result, verificationId: record.id, updatedAt: now() });
      item.acceptanceResults = [...byCriterion.values()];
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "verification_recorded", { verificationId: record.id, kind, status });
      for (const entry of normalizedEvidence.filter((candidate) => candidate.kind === "asset")) {
        recordActivity(item, actor, "asset_evidence_attached", {
          verificationId: record.id, assetId: entry.assetId, path: entry.ref,
          hash: entry.hash, version: entry.version, terminalId: item.terminalId,
        });
      }
    });
    notifyWorkItemChanged(item, actor, "verification_recorded");
    return { ok: true, status: 201, body: { verification: record, workItem: workItemView(item, actor) } };
  }

  function recordAssetOperation({
    workItemId, expectedRevision, capability, inputAssetId, outputAsset = null,
    invocationId = null, approvalId = null, summary = "", applicationResolution = null,
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    if (!ASSET_CAPABILITY_VERBS.includes(capability) || typeof summary !== "string" || summary.length > 5_000) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_asset_operation" } };
    }
    const source = [...(item.inputAssets ?? []), ...(item.outputAssets ?? [])]
      .find((asset) => asset.id === String(inputAssetId));
    if (!source || source.terminalId !== item.terminalId) {
      return { ok: false, status: 409, body: { error: "asset_terminal_mismatch", terminalId: item.terminalId } };
    }
    if (!source.capabilities.includes(capability) || source.readiness?.state !== "ready") {
      return { ok: false, status: 409, body: { error: "waiting_capability", capability, terminalId: item.terminalId } };
    }
    const normalizedOutput = outputAsset == null
      ? null
      : deriveWorkItemOutputMetricsForAssets(normalizeAssetRefs([outputAsset]) ?? [], {
        ...outputMetricsOptions(item.projectId),
      })[0] ?? null;
    if (outputAsset != null && (!normalizedOutput || normalizedOutput.terminalId !== item.terminalId
      || !normalizedOutput.id || !normalizedOutput.hash || !normalizedOutput.version)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_output_asset" } };
    }
    const operation = {
      id: nextId("wao"), capability, inputAssetId: source.id,
      input: { id: source.id, path: source.path, hash: source.hash, version: source.version },
      outputAssetId: normalizedOutput?.id ?? null,
      invocationId: invocationId ? String(invocationId).slice(0, 200) : null,
      approvalId: approvalId ? String(approvalId).slice(0, 200) : null,
      terminalId: item.terminalId, traceId: item.id, summary,
      recordedAt: now(), recordedBy: actorUser(actor),
      applicationResolution: normalizeApplicationResolution(applicationResolution, item.terminalId),
    };
    runTx(() => {
      if (normalizedOutput) {
        const otherOutputs = (item.outputAssets ?? []).filter((asset) => asset.id !== normalizedOutput.id);
        item.outputAssets = [normalizedOutput, ...otherOutputs].slice(0, 100);
      }
      (item.assetOperations ??= []).unshift(operation);
      item.assetOperations = item.assetOperations.slice(0, 200);
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "asset_operation_recorded", {
        operationId: operation.id, capability, inputAssetId: source.id,
        outputAssetId: normalizedOutput?.id ?? null, invocationId: operation.invocationId,
          approvalId: operation.approvalId, terminalId: item.terminalId,
          applicationId: operation.applicationResolution?.applicationId ?? null,
          capabilityLabel: operation.applicationResolution?.label ?? null,
          resolutionReason: operation.applicationResolution?.reason ?? null,
      });
      appendEvent({
        invocationId: operation.invocationId,
        type: "work_item_asset_operation_recorded",
        level: "info",
        message: `${item.localRef} recorded an asset operation.`,
        data: {
          executionChainId: item.id, workItemId: item.id, traceId: item.id,
          operationId: operation.id, capability, terminalId: item.terminalId,
          input: operation.input,
          output: normalizedOutput ? {
            id: normalizedOutput.id, path: normalizedOutput.path,
            hash: normalizedOutput.hash, version: normalizedOutput.version,
          } : null,
          approvalId: operation.approvalId,
        },
      });
    });
    notifyWorkItemChanged(item, actor, "asset_operation_recorded");
    return { ok: true, status: 201, body: {
      operation, workItem: workItemView(item, actor),
    } };
  }

  function startApplicationExecution({
    workItemId, expectedRevision, intent = null, assetVerb = null,
    assetFamily = null, resourceClass = "small", parameters = {}, approvalToken = null,
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const blockingBindings = recordBindingExecutionBlock(item);
    if (blockingBindings) {
      return {
        ok: false,
        status: 409,
        body: { error: "work_item_record_bindings_stale", currentRevision: item.revision, blockingBindings },
      };
    }
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)
      || Buffer.byteLength(JSON.stringify(parameters), "utf8") > 256 * 1024
      || ["capability", "capabilityId", "applicationId", "toolName", "command", "argv", "terminalId", "projectId", "worktreeId", "requiresApproval"]
        .some((field) => Object.hasOwn(parameters, field))) {
      return { ok: false, status: 400, body: { error: "invalid_application_execution_parameters" } };
    }
    const resolution = resolveApplicationCapability({
      intent, assetVerb, assetFamily, resourceClass, terminalId: item.terminalId,
    }, actor);
    if (!resolution?.capability || ["waiting_capability", "waiting_capacity", "refusal"].includes(resolution.state)) {
      return { ok: false, status: 409, body: { error: resolution?.reason ?? "capability_not_available", resolution } };
    }
    if (resolution.state === "waiting_approval" && !approvalToken) {
      return { ok: false, status: 409, body: { error: "approval_required", resolution } };
    }
    const invoked = invokeResolvedCapability(resolution.capability.name, {
      ...parameters,
      projectId: item.projectId,
      ...(item.worktreeId ? { worktreeId: item.worktreeId } : {}),
      ...(approvalToken ? { approvalToken } : {}),
    }, actor);
    const invocation = invoked?.body?.invocation ?? null;
    if (!invocation) return { ok: false, status: invoked?.status ?? 409, body: invoked?.body ?? { error: "application_execution_failed" } };
    const contract = createApplicationExecutionContract({
      resolution,
      workItem: item,
      principalId: actorUser(actor),
      approvalId: resolution.approval?.required ? "validated_grant" : null,
      input: parameters,
      inputAssets: (item.inputAssets ?? []).map((asset) => ({ ...asset, projectId: item.projectId })),
      outputContract: resolution.capability.outputContract ?? null,
    });
    invocation.options ??= {};
    invocation.options.metadata = {
      ...(invocation.options.metadata ?? {}),
      ...(item.channelOrigin?.conversationId ? {
        channel: {
          channelId: item.channelOrigin.channelId,
          conversationId: item.channelOrigin.conversationId,
          messageId: item.channelOrigin.messageId,
          principalId: item.channelOrigin.principalId,
          terminalId: item.terminalId,
          projectId: item.projectId,
          workItemId: item.id,
          threadId: item.channelOrigin.threadId ?? null,
          traceId: item.id,
        },
      } : {}),
      applicationExecution: {
        taskId: contract.taskId, queueEntryId: contract.queueEntryId, traceId: contract.traceId,
        terminalId: contract.terminalId, projectId: contract.projectId, worktreeId: contract.worktreeId,
        principalId: contract.principalId, effectiveAuthority: contract.effectiveAuthority,
        applicationId: contract.applicationId, capabilityId: contract.capabilityId,
        approvalId: contract.approvalId, inputAssetIds: contract.inputAssets.map((asset) => asset.id),
        contractFingerprint: contract.fingerprint,
      },
    };
    runTx(() => {
      item.applicationResolutions = [...(item.applicationResolutions ?? []), resolution].slice(-100);
      item.executionBindings = [...(item.executionBindings ?? []), {
        kind: "application_invocation", id: invocation.id, terminalId: item.terminalId,
        applicationId: contract.applicationId, capabilityId: contract.capabilityId,
        traceId: contract.traceId, createdAt: now(),
      }].slice(-200);
      item.queueReadiness = { state: "ready", reason: "application_invocation_created", terminalId: item.terminalId };
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "application_invocation_created", {
        invocationId: invocation.id, applicationId: contract.applicationId,
        capabilityLabel: resolution.capability.displayName, terminalId: item.terminalId,
      });
    });
    return {
      ok: true, status: invoked.status,
      body: { invocation, resolution: normalizeApplicationResolution(resolution, item.terminalId), workItem: workItemView(item, actor) },
    };
  }

  function requestApplicationExecutionApproval({
    workItemId, expectedRevision, intent = null, assetVerb = null,
    assetFamily = null, resourceClass = "small",
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const resolution = resolveApplicationCapability({
      intent, assetVerb, assetFamily, resourceClass, terminalId: item.terminalId,
    }, actor);
    if (resolution?.state !== "waiting_approval" || !resolution.capability?.name || !resolution.capability?.applicationId) {
      return { ok: false, status: 409, body: { error: resolution?.reason ?? "approval_not_required", resolution } };
    }
    if (typeof issueApplicationApprovalGrant !== "function") {
      return { ok: false, status: 503, body: { error: "approval_service_unavailable" } };
    }
    const commandId = String(resolution.capability.name).split(".").at(-1);
    const grant = issueApplicationApprovalGrant({
      action: `wrapper:${commandId}`,
      targetId: resolution.capability.applicationId,
    }, actor);
    if (!grant?.ok) return { ok: false, status: grant?.status ?? 409, body: grant?.body ?? { error: "approval_grant_failed" } };
    runTx(() => {
      recordActivity(item, actor, "application_approval_granted", {
        applicationId: resolution.capability.applicationId,
        capabilityLabel: resolution.capability.displayName,
        terminalId: item.terminalId,
        expiresAt: grant.body.expiresAt,
      });
    });
    return {
      ok: true, status: 201,
      body: {
        approvalToken: grant.body.token,
        expiresAt: grant.body.expiresAt,
        resolution: normalizeApplicationResolution(resolution, item.terminalId),
      },
    };
  }

  function listActivity({ workItemId } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const activities = (state.workItemActivities ?? [])
      .filter((row) => row.workItemId === item.id && row.ownerTeamId === actorTeam(actor))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, status: 200, body: { activities, count: activities.length } };
  }

  function listComments({ workItemId } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const comments = (state.workItemComments ?? [])
      .filter((row) => row.workItemId === item.id && row.ownerTeamId === actorTeam(actor))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { ok: true, status: 200, body: { comments, count: comments.length } };
  }

  function createComment({ workItemId, body } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const content = String(body ?? "").trim();
    if (!content || content.length > MAX_COMMENT) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_comment" } };
    }
    const timestamp = now();
    const comment = {
      id: nextId("wic"),
      workItemId: item.id,
      ownerTeamId: item.ownerTeamId,
      projectId: item.projectId,
      body: content,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      lastModifiedBy: actorUser(actor),
      deletedAt: null,
    };
    runTx(() => {
      (state.workItemComments ??= []).push(comment);
      recordActivity(item, actor, "commented", { commentId: comment.id });
      appendEvent({
        invocationId: null,
        type: "work_item_commented",
        level: "info",
        message: `${item.localRef} received a comment.`,
        data: { workItemId: item.id, commentId: comment.id, actorTeamId: actorTeam(actor) },
      });
    });
    return { ok: true, status: 201, body: { comment } };
  }

  function findOwnComment(item, commentId, actor) {
    return (state.workItemComments ?? []).find(
      (row) => row.id === String(commentId) && row.workItemId === item.id && row.ownerTeamId === actorTeam(actor),
    ) ?? null;
  }

  function updateComment({ workItemId, commentId, expectedRevision, body } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const comment = findOwnComment(item, commentId, actor);
    if (!comment || comment.deletedAt) return commentNotFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== comment.revision) {
      return { ok: false, status: 409, body: { error: "work_item_comment_revision_conflict", currentRevision: comment.revision } };
    }
    const content = String(body ?? "").trim();
    if (!content || content.length > MAX_COMMENT) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_comment" } };
    }
    runTx(() => {
      comment.body = content;
      comment.revision += 1;
      comment.updatedAt = now();
      comment.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "comment_updated", { commentId: comment.id, revision: comment.revision });
    });
    return { ok: true, status: 200, body: { comment } };
  }

  function deleteComment({ workItemId, commentId, expectedRevision } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const comment = findOwnComment(item, commentId, actor);
    if (!comment || comment.deletedAt) return commentNotFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== comment.revision) {
      return { ok: false, status: 409, body: { error: "work_item_comment_revision_conflict", currentRevision: comment.revision } };
    }
    runTx(() => {
      comment.body = null;
      comment.deletedAt = now();
      comment.updatedAt = comment.deletedAt;
      comment.revision += 1;
      comment.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "comment_deleted", { commentId: comment.id });
    });
    return { ok: true, status: 200, body: { comment } };
  }

  function activeExecutionOperation(item, timestamp = now()) {
    const operation = item.executionOperation;
    if (!operation || operation.status !== "starting") return null;
    return Date.parse(operation.expiresAt) > Date.parse(timestamp) ? operation : null;
  }

  function activeBoundAutoRun(item) {
    for (const binding of [...(item.executionBindings ?? [])].reverse()) {
      if (binding.kind !== "auto_run") continue;
      const autoRun = (state.autoRuns ?? []).find((candidate) => candidate.id === binding.targetId);
      if (!autoRun) continue;
      if (ACTIVE_AUTO_RUN_STATUSES.has(autoRun.status)) return autoRun;
      if (autoRun.status === "done" && autoRun.link?.type === "local_issue"
        && autoRun.localDelivery && !autoRun.localDelivery.deliveredAt && !autoRun.localDelivery.promotedAt) {
        return autoRun;
      }
    }
    return null;
  }

  function recordBindingExecutionBlock(item) {
    const blockingBindings = (item.recordBindings ?? [])
      .filter((binding) => binding.direction === "input" && binding.record
        && binding.resolution?.state !== "resolved")
      .map((binding) => ({ bindingId: binding.id, state: binding.resolution?.state ?? "unavailable" }));
    return blockingBindings.length ? blockingBindings : null;
  }

  function beginExecution({
    workItemId, kind, agentId = null,
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!["worktree", "auto_run", "application_invocation"].includes(kind)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_execution_kind" } };
    }
    if (item.state !== "open" || item.archivedAt) {
      return { ok: false, status: 409, body: { error: "work_item_execution_not_open" } };
    }
    const blockingBindings = recordBindingExecutionBlock(item);
    if (blockingBindings) {
      return {
        ok: false,
        status: 409,
        body: { error: "work_item_record_bindings_stale", currentRevision: item.revision, blockingBindings },
      };
    }
    const timestamp = now();
    const currentOperation = activeExecutionOperation(item, timestamp);
    if (currentOperation) {
      return {
        ok: false,
        status: 409,
        body: { error: "work_item_execution_in_progress", operationId: currentOperation.id },
      };
    }
    if (kind === "auto_run") {
      // Handing a task to AI creates the durable Run first. Acceptance criteria
      // and the verification SOP are established during that Run's read-only
      // understanding phase; the hard contract gate lives immediately before
      // worktree materialization instead of blocking Run creation here.
      const activeRun = activeBoundAutoRun(item);
      if (activeRun) {
        return {
          ok: false,
          status: 409,
          body: { error: "work_item_auto_run_active", autoRunId: activeRun.id, autoRunStatus: activeRun.status },
        };
      }
    }
    const currentIntentContract = buildWorkItemIntentContract(item);
    const startRequestActive = Boolean(item.executionStartRequest && item.executionStartRequest.status !== "cancelled");
    if (startRequestActive && item.executionIntentContractSnapshot?.digest
      && item.executionIntentContractSnapshot.digest !== currentIntentContract.digest) {
      return {
        ok: false,
        status: 409,
        body: { error: "work_item_intent_contract_changed", intentContract: currentIntentContract },
      };
    }
    const intentContract = startRequestActive && item.executionIntentContractSnapshot
      ? item.executionIntentContractSnapshot
      : currentIntentContract;
    if (intentContract.status === "needs_clarification") {
      return {
        ok: false,
        status: 409,
        body: {
          error: "work_item_intent_conflict",
          intentContract,
          clarification: intentContract.clarification,
        },
      };
    }
    const holderId = actorUser(actor);
    const claimActive = item.claim?.status === "active"
      && Date.parse(item.claim.leaseExpiresAt) > Date.parse(timestamp);
    if (claimActive && item.claim.claimedBy !== holderId) {
      return { ok: false, status: 409, body: { error: "work_item_already_claimed", claim: item.claim } };
    }
    const operation = {
      id: nextId("weo"),
      kind,
      status: "starting",
      startedBy: holderId,
      agentId: agentId ? String(agentId) : null,
      startedAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + EXECUTION_OPERATION_TTL_MS).toISOString(),
      contextSnapshot: {
        ...buildDataContextSnapshot({
          workItemId: item.id,
          workItemRevision: item.revision,
          capturedAt: timestamp,
          inputAssets: item.inputAssets,
          localContentRefs: item.localContentRefs,
          taskResourceRefs: item.taskResourceRefs,
          channelTaskContract: item.channelTaskContract,
          channelOrigin: item.channelOrigin,
          taskContextControl: item.taskContextControl,
        }),
        confirmedAt: timestamp,
        confirmedBy: holderId,
        intentContract: {
          ...intentContract,
          conflicts: (intentContract.conflicts ?? []).map((conflict) => ({ ...conflict })),
        },
      },
    };
    runTx(() => {
      if (!claimActive) {
        item.claim = {
          id: nextId("wcl"),
          status: "active",
          claimedBy: holderId,
          agentId: operation.agentId,
          idempotencyKey: null,
          claimedAt: timestamp,
          renewedAt: timestamp,
          leaseExpiresAt: operation.expiresAt,
          executionOperationId: operation.id,
        };
        recordActivity(item, actor, "claimed", {
          claimId: item.claim.id, agentId: item.claim.agentId, leaseExpiresAt: item.claim.leaseExpiresAt,
          source: "execution_admission",
        });
      }
      item.executionOperation = operation;
      item.revision += 1;
      item.updatedAt = timestamp;
      item.lastModifiedBy = holderId;
      recordActivity(item, actor, "execution_admitted", {
        operationId: operation.id, kind, agentId: operation.agentId,
      });
    });
    return {
      ok: true,
      status: 201,
      body: { operation, workItem: workItemView(item, actor), claim: item.claim ?? null },
    };
  }

  function abortExecution({ workItemId, operationId, reason = "execution_start_failed" } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!item.executionOperation || item.executionOperation.id !== String(operationId)) {
      return { ok: true, status: 200, body: { aborted: false, workItem: workItemView(item, actor) } };
    }
    runTx(() => {
      const operation = item.executionOperation;
      item.executionOperation = null;
      if (item.executionStartRequest && item.executionStartRequest.status !== "cancelled") {
        const failure = normalizeExecutionStartFailure(reason);
        item.executionStartRequest = {
          ...item.executionStartRequest,
          status: failure.status,
          reasonCode: failure.reasonCode,
          reasonDetail: failure.reasonDetail,
          updatedAt: now(),
        };
      }
      if (item.claim?.status === "active" && item.claim.executionOperationId === operation.id) {
        item.claim = {
          ...item.claim,
          status: "released",
          releasedAt: now(),
          releasedBy: actorUser(actor),
          releaseReason: reason,
        };
      }
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "execution_admission_aborted", {
        operationId: operation.id, kind: operation.kind, reason: String(reason).slice(0, 500),
      });
    });
    return { ok: true, status: 200, body: { aborted: true, workItem: workItemView(item, actor) } };
  }

  function recordExecutionBinding({
    workItemId, kind, targetId, worktreeId = null, operationId = null,
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!["worktree", "auto_run", "application_invocation", "article_import", "article_derivative"].includes(kind) || !targetId) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_execution_binding" } };
    }
    if (operationId != null
      && (item.executionOperation?.id !== String(operationId) || item.executionOperation.kind !== kind)) {
      return { ok: false, status: 409, body: { error: "work_item_execution_operation_conflict" } };
    }
    const bindingCreatedAt = now();
    const binding = {
      kind,
      targetId: String(targetId),
      worktreeId: worktreeId ? String(worktreeId) : null,
      terminalId: item.terminalId,
      createdAt: bindingCreatedAt,
      contextSnapshot: item.executionOperation?.contextSnapshot
        ? structuredClone(item.executionOperation.contextSnapshot)
        : {
          ...buildDataContextSnapshot({
            workItemId: item.id,
            workItemRevision: item.revision,
            capturedAt: bindingCreatedAt,
            inputAssets: item.inputAssets,
            localContentRefs: item.localContentRefs,
            taskResourceRefs: item.taskResourceRefs,
            channelTaskContract: item.channelTaskContract,
            channelOrigin: item.channelOrigin,
            taskContextControl: item.taskContextControl,
          }),
          confirmedAt: bindingCreatedAt,
          confirmedBy: actorUser(actor),
        },
    };
    runTx(() => {
      item.executionBindings = [...(item.executionBindings ?? []), binding];
      if (item.executionStartRequest && item.executionStartRequest.status !== "cancelled"
        && ["auto_run", "application_invocation"].includes(kind)) {
        item.executionStartRequest = {
          ...item.executionStartRequest,
          status: "started",
          startedAt: binding.createdAt,
          executionKind: kind,
          targetId: binding.targetId,
          reasonCode: null,
          reasonDetail: null,
          updatedAt: binding.createdAt,
        };
      }
      if (kind === "worktree" || kind === "auto_run") item.materialChangesPending = false;
      if (operationId != null) {
        item.executionOperation = null;
        if (item.claim?.status === "active" && item.claim.executionOperationId === String(operationId)) {
          item.claim = {
            ...item.claim,
            executionOperationId: null,
            ...(kind === "auto_run" ? { autoRunId: binding.targetId } : {}),
          };
        }
      }
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      const activityType = kind === "worktree" ? "worktree_created"
        : kind === "application_invocation" ? "application_execution_started"
        : kind === "article_import" ? "article_import_started"
          : kind === "article_derivative" ? "article_derivative_started"
          : "auto_run_started";
      recordActivity(item, actor, activityType, binding);
    });
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor), binding } };
  }

  function deliveryContext(item, { mode, autoRunId = null, requireReady = true } = {}) {
    if (!["local_merge", "pull_request"].includes(mode)) {
      return { error: { ok: false, status: 400, body: { error: "invalid_work_item_delivery_mode" } } };
    }
    const binding = [...(item.executionBindings ?? [])].reverse().find(
      (candidate) => candidate.kind === "auto_run" && (!autoRunId || candidate.targetId === autoRunId),
    );
    const autoRun = binding
      ? (state.autoRuns ?? []).find((candidate) => candidate.id === binding.targetId)
      : null;
    if (!autoRun?.localDelivery || autoRun.link?.type !== "local_issue"
      || (requireReady && autoRun.status !== "done")) {
      return { error: { ok: false, status: 409, body: { error: "work_item_delivery_not_ready" } } };
    }
    if (autoRun.localDelivery.deliveredAt || autoRun.localDelivery.promotedAt) {
      return { error: { ok: false, status: 409, body: { error: "work_item_already_delivered" } } };
    }
    return { binding, autoRun };
  }

  function beginDelivery({
    workItemId, expectedRevision, mode, autoRunId = null,
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (item.revision !== expectedRevision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const gate = completionGate(item);
    if (!gate.ready) {
      return { ok: false, status: 409, body: { error: "work_item_acceptance_incomplete", ...gate } };
    }
    const context = deliveryContext(item, { mode, autoRunId });
    if (context.error) return context.error;
    const timestamp = now();
    if (item.deliveryOperation?.status === "in_progress"
      && Date.parse(item.deliveryOperation.expiresAt) > Date.parse(timestamp)) {
      return {
        ok: false,
        status: 409,
        body: { error: "work_item_delivery_in_progress", operationId: item.deliveryOperation.id },
      };
    }
    const operation = {
      id: nextId("wdo"),
      status: "in_progress",
      mode,
      autoRunId: context.autoRun.id,
      startedBy: actorUser(actor),
      startedAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + EXECUTION_OPERATION_TTL_MS).toISOString(),
    };
    runTx(() => {
      item.deliveryOperation = operation;
      item.revision += 1;
      item.updatedAt = timestamp;
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "delivery_started", {
        operationId: operation.id, autoRunId: context.autoRun.id, mode,
      });
    });
    return {
      ok: true,
      status: 201,
      body: {
        operation,
        workItem: workItemView(item, actor),
        autoRun: context.autoRun,
        delivery: context.autoRun.localDelivery,
      },
    };
  }

  function failDelivery({
    workItemId, operationId, error = "delivery_failed",
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!item.deliveryOperation || item.deliveryOperation.id !== String(operationId)) {
      return { ok: true, status: 200, body: { failed: false, workItem: workItemView(item, actor) } };
    }
    const operation = item.deliveryOperation;
    const binding = [...(item.executionBindings ?? [])].reverse().find(
      (candidate) => candidate.kind === "auto_run" && candidate.targetId === operation.autoRunId,
    );
    const autoRun = binding
      ? (state.autoRuns ?? []).find((candidate) => candidate.id === binding.targetId)
      : null;
    runTx(() => {
      item.deliveryOperation = null;
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      if (autoRun?.localDelivery) {
        autoRun.localDelivery = {
          ...autoRun.localDelivery,
          lastDeliveryError: String(error).slice(0, 2_000),
          lastDeliveryFailedAt: item.updatedAt,
        };
        autoRun.updatedAt = item.updatedAt;
      }
      recordActivity(item, actor, "delivery_failed", {
        operationId: operation.id, autoRunId: operation.autoRunId, mode: operation.mode,
        error: String(error).slice(0, 500),
      });
    });
    return { ok: true, status: 200, body: { failed: true, workItem: workItemView(item, actor) } };
  }

  function completeDelivery({
    workItemId, expectedRevision, mode, autoRunId, operationId = null, result = {},
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (operationId == null) {
      if (!Number.isInteger(expectedRevision)) {
        return { ok: false, status: 400, body: { error: "expected_revision_required" } };
      }
      if (item.revision !== expectedRevision) {
        return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
      }
    } else if (item.deliveryOperation?.id !== String(operationId)
      || item.deliveryOperation.status !== "in_progress"
      || item.deliveryOperation.mode !== mode) {
      return { ok: false, status: 409, body: { error: "work_item_delivery_operation_conflict" } };
    }
    const gate = completionGate(item);
    if (!gate.ready) {
      return { ok: false, status: 409, body: { error: "work_item_acceptance_incomplete", ...gate } };
    }
    const context = deliveryContext(item, {
      mode,
      autoRunId: operationId == null ? autoRunId : item.deliveryOperation.autoRunId,
      requireReady: operationId == null,
    });
    if (context.error) return context.error;
    const { autoRun } = context;
    const deliveredAt = result.deliveredAt ?? now();
    runTx(() => {
      item.deliveryOperation = null;
      autoRun.localDelivery = {
        ...autoRun.localDelivery,
        mode,
        lastDeliveryError: null,
        ...(mode === "local_merge"
          ? { baseBranch: result.baseBranch ?? null, deliveredCommit: result.commit ?? null, deliveredAt }
          : { prNumber: result.number ?? null, prUrl: result.url ?? null, promotedAt: deliveredAt }),
      };
      autoRun.updatedAt = deliveredAt;
      if (mode === "pull_request") {
        autoRun.status = "pr_open";
        autoRun.prNumber = result.number ?? null;
        autoRun.prUrl = result.url ?? null;
        item.status = "review";
        item.state = "open";
      } else {
        item.status = "done";
        item.state = "closed";
        item.completedAt = deliveredAt;
        item.waitingOn = "none";
      }
      item.revision += 1;
      item.updatedAt = deliveredAt;
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, mode === "pull_request" ? "delivery_pr_opened" : "delivery_completed", {
        autoRunId: autoRun.id,
        worktreeId: autoRun.localDelivery.worktreeId,
        mode,
        ...(mode === "pull_request" ? { prNumber: result.number ?? null, prUrl: result.url ?? null } : {
          baseBranch: result.baseBranch ?? null, commit: result.commit ?? null,
        }),
      });
      appendEvent({
        invocationId: autoRun.invocationId ?? null,
        type: mode === "pull_request" ? "work_item_delivery_pr_opened" : "work_item_delivery_completed",
        level: "info",
        message: mode === "pull_request"
          ? `${item.localRef} opened pull request #${result.number ?? "?"}.`
          : `${item.localRef} delivered to ${result.baseBranch ?? "base"}.`,
        data: { workItemId: item.id, autoRunId: autoRun.id, mode, result },
      });
    });
    if (mode === "local_merge") propagateCompletedGoalTask(item, actor);
    notifyWorkItemChanged(item, actor, "delivery_completed");
    return {
      ok: true,
      status: 200,
      body: { workItem: workItemView(item, actor), autoRun, delivery: autoRun.localDelivery },
    };
  }

  function claimWorkItem({
    workItemId, agentId = null, leaseMinutes = 30, idempotencyKey = null,
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const minutes = Number(leaseMinutes);
    const key = idempotencyKey == null ? null : String(idempotencyKey).trim();
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1_440 || (key != null && (!key || key.length > 200))) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_claim" } };
    }
    const holderId = actorUser(actor);
    const timestamp = now();
    const previousClaim = item.claim ?? null;
    const active = item.claim?.status === "active" && Date.parse(item.claim.leaseExpiresAt) > Date.parse(timestamp);
    if (active && item.claim.claimedBy !== holderId) {
      return { ok: false, status: 409, body: { error: "work_item_already_claimed", claim: item.claim } };
    }
    const claim = {
      id: active && item.claim.claimedBy === holderId ? item.claim.id : nextId("wcl"),
      status: "active",
      claimedBy: holderId,
      agentId: agentId ? String(agentId) : null,
      idempotencyKey: key,
      claimedAt: active && item.claim.claimedBy === holderId ? item.claim.claimedAt : timestamp,
      renewedAt: timestamp,
      leaseExpiresAt: new Date(Date.parse(timestamp) + minutes * 60_000).toISOString(),
    };
    runTx(() => {
      item.claim = claim;
      item.revision += 1;
      item.updatedAt = timestamp;
      item.lastModifiedBy = holderId;
      recordActivity(item, actor, active ? "claim_renewed" : previousClaim?.claimedBy ? "claim_taken_over" : "claimed", {
        claimId: claim.id, agentId: claim.agentId, leaseExpiresAt: claim.leaseExpiresAt,
      });
    });
    return { ok: true, status: active ? 200 : 201, body: { workItem: workItemView(item, actor), claim } };
  }

  function assignWorkItemToSelf({ workItemId, expectedRevision } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const userId = actorUser(actor);
    const assigneeIds = item.assigneeIds ?? [];
    if (assigneeIds.includes(userId)) {
      return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: true } };
    }
    if (assigneeIds.length > 0) {
      return { ok: false, status: 409, body: { error: "work_item_already_assigned" } };
    }
    return updateWorkItem({
      workItemId,
      expectedRevision,
      assigneeIds: [userId],
    }, actor);
  }

  function releaseWorkItemClaim({ workItemId, idempotencyKey = null } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!item.claim || item.claim.status !== "active") {
      return { ok: true, status: 200, body: { workItem: workItemView(item, actor), released: false } };
    }
    if (item.claim.claimedBy !== actorUser(actor)) {
      return { ok: false, status: 409, body: { error: "work_item_claim_owned_by_other", claim: item.claim } };
    }
    if (idempotencyKey != null && String(idempotencyKey).trim().length > 200) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_claim" } };
    }
    runTx(() => {
      item.claim = { ...item.claim, status: "released", releasedAt: now(), releasedBy: actorUser(actor) };
      item.revision += 1;
      item.updatedAt = item.claim.releasedAt;
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "claim_released", { claimId: item.claim.id });
    });
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor), released: true } };
  }

  function applyLocalSchedulePlan({
    planRevision,
    currentPlanRevision,
    assignments = [],
  } = {}, actor = null) {
    if (typeof planRevision !== "string" || !/^[a-f0-9]{24}$/.test(planRevision)) {
      return { ok: false, status: 400, body: { error: "invalid_schedule_plan_revision" } };
    }
    if (planRevision !== currentPlanRevision) {
      return {
        ok: false,
        status: 409,
        body: { error: "schedule_plan_stale", currentPlanRevision },
      };
    }
    if (!Array.isArray(assignments) || assignments.length > 500) {
      return { ok: false, status: 400, body: { error: "invalid_schedule_assignments" } };
    }
    const ids = new Set();
    const resolved = [];
    for (const assignment of assignments) {
      const workItemId = String(assignment?.workItemId ?? "");
      const sourceKind = assignment?.sourceKind === "auto_run" ? "auto_run" : "work_item";
      const sourceId = String(assignment?.sourceId ?? (sourceKind === "work_item" ? workItemId : ""));
      const expectedRevision = Number(assignment?.expectedRevision);
      const plannedDate = String(assignment?.plannedDate ?? "");
      const scheduleOrder = Number(assignment?.scheduleOrder);
      if (!workItemId || !sourceId || ids.has(workItemId) || !Number.isInteger(expectedRevision)
        || !validDateOnly(plannedDate) || !Number.isInteger(scheduleOrder) || scheduleOrder < 0 || scheduleOrder >= 500) {
        return { ok: false, status: 400, body: { error: "invalid_schedule_assignments" } };
      }
      ids.add(workItemId);
      if (sourceKind === "auto_run") {
        if (workItemId !== `autorun:${sourceId}`) {
          return { ok: false, status: 400, body: { error: "invalid_schedule_assignments" } };
        }
        const run = (state.autoRuns ?? []).find((candidate) => candidate.id === sourceId);
        const schedule = (state.runtimeWorkSchedules ?? []).find((candidate) =>
          candidate.kind === "auto_run"
          && candidate.targetId === sourceId
          && candidate.ownerTeamId === actorTeam(actor)
          && candidate.userId === actorUser(actor)
          && candidate.terminalId === localTerminalId()) ?? null;
        if (!run || !actorCanAccessProject(state, actor, run.projectId)) return notFound();
        if ((run.terminalId && run.terminalId !== localTerminalId())
          || !SCHEDULABLE_RUNTIME_STATES.has(run.status)
          || (Number(schedule?.revision) || 0) !== expectedRevision) {
          return {
            ok: false,
            status: 409,
            body: { error: "schedule_plan_stale", workItemId, currentRevision: Number(schedule?.revision) || 0 },
          };
        }
        resolved.push({ sourceKind, run, schedule, plannedDate, scheduleOrder });
        continue;
      }
      const item = findOwn(workItemId, actor);
      if (!item || item.terminalId !== localTerminalId() || !(item.assigneeIds ?? []).includes(actorUser(actor))) {
        return notFound();
      }
      if (item.revision !== expectedRevision || item.state === "closed" || item.archivedAt
        || !["ready", "in_progress"].includes(item.status)) {
        return {
          ok: false,
          status: 409,
          body: { error: "schedule_plan_stale", workItemId, currentRevision: item.revision },
        };
      }
      resolved.push({ sourceKind, item, plannedDate, scheduleOrder });
    }

    const timestamp = now();
    const changed = resolved.filter((entry) => entry.sourceKind === "auto_run"
      ? entry.schedule?.plannedDate !== entry.plannedDate || entry.schedule?.scheduleOrder !== entry.scheduleOrder
      : entry.item.plannedDate !== entry.plannedDate || entry.item.scheduleOrder !== entry.scheduleOrder);
    runTx(() => {
      for (const entry of changed) {
        if (entry.sourceKind === "auto_run") {
          const previousPlannedDate = entry.schedule?.plannedDate ?? null;
          const schedule = entry.schedule ?? {
            id: nextId("rws"),
            kind: "auto_run",
            targetId: entry.run.id,
            ownerTeamId: actorTeam(actor),
            userId: actorUser(actor),
            terminalId: localTerminalId(),
            createdAt: timestamp,
            revision: 0,
          };
          schedule.projectId = entry.run.projectId ?? null;
          schedule.plannedDate = entry.plannedDate;
          schedule.schedulePlanSource = "auto_plan";
          schedule.scheduleReason = "current_terminal_capacity_plan";
          schedule.scheduleOrder = entry.scheduleOrder;
          schedule.revision = (Number(schedule.revision) || 0) + 1;
          schedule.updatedAt = timestamp;
          if (!entry.schedule) (state.runtimeWorkSchedules ??= []).push(schedule);
          entry.schedule = schedule;
          entry.previousPlannedDate = previousPlannedDate;
          continue;
        }
        const { item, plannedDate, scheduleOrder } = entry;
        const previousPlannedDate = item.plannedDate ?? null;
        item.plannedDate = plannedDate;
        item.schedulePlanSource = "auto_plan";
        item.scheduleReason = "current_terminal_capacity_plan";
        item.scheduleOrder = scheduleOrder;
        item.revision += 1;
        item.updatedAt = timestamp;
        item.lastModifiedBy = actorUser(actor);
        recordActivity(item, actor, "local_schedule_applied", {
          planRevision,
          previousPlannedDate,
          plannedDate,
          scheduleOrder,
        });
      }
      if (changed.length > 0) {
        appendEvent({
          invocationId: null,
          type: "local_schedule_applied",
          level: "info",
          message: `${changed.length} current-terminal work item(s) scheduled.`,
          data: {
            planRevision,
            terminalId: localTerminalId(),
            workItemIds: changed.map((entry) => entry.sourceKind === "auto_run"
              ? `autorun:${entry.run.id}`
              : entry.item.id),
            actorTeamId: actorTeam(actor),
          },
        });
      }
    });
    return {
      ok: true,
      status: 200,
      body: {
        planRevision,
        terminalId: localTerminalId(),
        applied: changed.length,
        workItems: resolved
          .filter((entry) => entry.sourceKind === "work_item")
          .map(({ item }) => workItemView(item, actor)),
        runtimeSchedules: resolved
          .filter((entry) => entry.sourceKind === "auto_run")
          .map((entry) => entry.schedule)
          .filter(Boolean),
      },
    };
  }

  function applyLocalScheduleRollover({
    rolloverRevision,
    currentRolloverRevision,
    sourceDate,
    moves = [],
    confirmationMoves = [],
    confirmPinned = false,
  } = {}, actor = null) {
    const operationKey = `${actorTeam(actor)}:${actorUser(actor)}:${sourceDate}:${rolloverRevision}:${confirmPinned ? "confirmed" : "automatic"}`;
    const replay = (state.localScheduleRollovers ?? []).find((item) => item.operationKey === operationKey);
    if (replay) return { ok: true, status: 200, body: { ...replay.result, replayed: true } };
    if (typeof rolloverRevision !== "string" || !/^[a-f0-9]{24}$/.test(rolloverRevision)
      || !validDateOnly(String(sourceDate ?? ""))) {
      return { ok: false, status: 400, body: { error: "invalid_rollover_revision" } };
    }
    if (rolloverRevision !== currentRolloverRevision) {
      return {
        ok: false,
        status: 409,
        body: { error: "rollover_plan_stale", currentRolloverRevision },
      };
    }
    const selected = [...moves, ...(confirmPinned ? confirmationMoves : [])];
    if (selected.length > 500) {
      return { ok: false, status: 400, body: { error: "invalid_rollover_assignments" } };
    }
    const ids = new Set();
    const resolved = [];
    for (const move of selected) {
      const workItemId = String(move?.workItemId ?? "");
      const targetDate = String(move?.targetDate ?? "");
      const expectedRevision = Number(move?.expectedRevision);
      if (!workItemId || ids.has(workItemId) || !validDateOnly(targetDate) || !Number.isInteger(expectedRevision)) {
        return { ok: false, status: 400, body: { error: "invalid_rollover_assignments" } };
      }
      ids.add(workItemId);
      const item = findOwn(workItemId, actor);
      if (!item || item.terminalId !== localTerminalId() || !(item.assigneeIds ?? []).includes(actorUser(actor))) {
        return notFound();
      }
      const pinned = Boolean(item.plannedDate && (!item.schedulePlanSource || item.schedulePlanSource === "manual"));
      if (item.revision !== expectedRevision || item.plannedDate !== sourceDate || item.status === "done"
        || item.state === "closed" || item.archivedAt || (pinned && !confirmPinned)) {
        return {
          ok: false,
          status: 409,
          body: { error: pinned && !confirmPinned ? "rollover_confirmation_required" : "rollover_plan_stale", workItemId, currentRevision: item.revision },
        };
      }
      resolved.push({ item, targetDate, pinned });
    }

    const timestamp = now();
    const result = {
      rolloverRevision,
      terminalId: localTerminalId(),
      sourceDate,
      applied: resolved.length,
      confirmedPinned: resolved.filter((row) => row.pinned).length,
      workItemIds: resolved.map(({ item }) => item.id),
      replayed: false,
    };
    runTx(() => {
      for (const { item, targetDate, pinned } of resolved) {
        const previousPlanSource = item.schedulePlanSource ?? null;
        item.carriedFromDate ??= sourceDate;
        item.plannedDate = targetDate;
        item.schedulePlanSource = "rollover";
        item.scheduleReason = "unfinished_from_previous_local_day";
        item.revision += 1;
        item.updatedAt = timestamp;
        item.lastModifiedBy = actorUser(actor);
        recordActivity(item, actor, "local_schedule_rolled_over", {
          rolloverRevision,
          sourceDate,
          targetDate,
          previousPlanSource,
          pinnedConfirmed: pinned,
          executionBindingsPreserved: true,
        });
      }
      (state.localScheduleRollovers ??= []).unshift({
        operationKey,
        ownerTeamId: actorTeam(actor),
        actorId: actorUser(actor),
        terminalId: localTerminalId(),
        sourceDate,
        rolloverRevision,
        confirmPinned: Boolean(confirmPinned),
        appliedAt: timestamp,
        result,
      });
      state.localScheduleRollovers = state.localScheduleRollovers.slice(0, 200);
      if (resolved.length > 0) {
        appendEvent({
          invocationId: null,
          type: "local_schedule_rolled_over",
          level: "info",
          message: `${resolved.length} current-terminal work item(s) rolled over from ${sourceDate}.`,
          data: {
            rolloverRevision,
            terminalId: localTerminalId(),
            sourceDate,
            workItemIds: result.workItemIds,
            confirmedPinned: result.confirmedPinned,
            actorTeamId: actorTeam(actor),
          },
        });
      }
    });
    return { ok: true, status: 200, body: result };
  }

  function applyLocalScheduleUrgent({
    urgentRevision,
    currentUrgentRevision,
    date,
    insertions = [],
    displacements = [],
    confirmationRequired = [],
    confirmPinned = false,
  } = {}, actor = null) {
    const operationKey = `${actorTeam(actor)}:${actorUser(actor)}:${date}:${urgentRevision}:${confirmPinned ? "confirmed" : "automatic"}`;
    const replay = (state.localScheduleUrgentInsertions ?? []).find((item) => item.operationKey === operationKey);
    if (replay) return { ok: true, status: 200, body: { ...replay.result, replayed: true } };
    if (typeof urgentRevision !== "string" || !/^[a-f0-9]{24}$/.test(urgentRevision)
      || !validDateOnly(String(date ?? ""))) {
      return { ok: false, status: 400, body: { error: "invalid_urgent_revision" } };
    }
    if (urgentRevision !== currentUrgentRevision) {
      return { ok: false, status: 409, body: { error: "urgent_plan_stale", currentUrgentRevision } };
    }
    const firstConfirmationOrder = Math.min(
      ...insertions.filter((item) => item.requiresPinnedConfirmation).map((item) => item.queueOrder),
      Number.MAX_SAFE_INTEGER,
    );
    const selectedInsertions = insertions.filter((item) =>
      confirmPinned || (!item.requiresPinnedConfirmation && item.queueOrder < firstConfirmationOrder));
    const selectedUrgentIds = new Set(selectedInsertions.map((item) => item.workItemId));
    const selectedDisplacements = [
      ...displacements.filter((item) => selectedUrgentIds.has(item.forWorkItemId)),
      ...(confirmPinned ? confirmationRequired.filter((item) => selectedUrgentIds.has(item.forWorkItemId)) : []),
    ];
    if (selectedInsertions.length + selectedDisplacements.length > 500) {
      return { ok: false, status: 400, body: { error: "invalid_urgent_assignments" } };
    }
    const insertRows = [];
    const displacementRows = [];
    const ids = new Set();
    for (const insertion of selectedInsertions) {
      const item = findOwn(insertion.workItemId, actor);
      if (!item || item.terminalId !== localTerminalId() || !(item.assigneeIds ?? []).includes(actorUser(actor))) {
        return notFound();
      }
      if (ids.has(item.id) || item.revision !== insertion.expectedRevision || item.priority !== "p0"
        || item.status !== "ready" || item.state === "closed" || item.archivedAt) {
        return { ok: false, status: 409, body: { error: "urgent_plan_stale", workItemId: item.id, currentRevision: item.revision } };
      }
      ids.add(item.id);
      insertRows.push({ item, insertion });
    }
    for (const displacement of selectedDisplacements) {
      const item = findOwn(displacement.workItemId, actor);
      if (!item || item.terminalId !== localTerminalId() || !(item.assigneeIds ?? []).includes(actorUser(actor))) {
        return notFound();
      }
      const pinned = Boolean(item.plannedDate && (!item.schedulePlanSource || item.schedulePlanSource === "manual"));
      if (ids.has(item.id) || item.revision !== displacement.expectedRevision || item.priority === "p0"
        || item.status !== "ready" || item.plannedDate !== displacement.sourceDate
        || item.state === "closed" || item.archivedAt || (pinned && !confirmPinned)) {
        return {
          ok: false,
          status: 409,
          body: { error: pinned && !confirmPinned ? "urgent_confirmation_required" : "urgent_plan_stale", workItemId: item.id, currentRevision: item.revision },
        };
      }
      ids.add(item.id);
      displacementRows.push({ item, displacement, pinned });
    }

    const timestamp = now();
    const result = {
      urgentRevision,
      terminalId: localTerminalId(),
      date,
      inserted: insertRows.length,
      displaced: displacementRows.length,
      confirmedPinned: displacementRows.filter((row) => row.pinned).length,
      workItemIds: insertRows.map(({ item }) => item.id),
      displacedWorkItemIds: displacementRows.map(({ item }) => item.id),
      replayed: false,
    };
    runTx(() => {
      for (const { item, insertion } of insertRows) {
        item.plannedDate = insertion.targetDate;
        item.schedulePlanSource = "urgent_insert";
        item.scheduleReason = insertion.reason;
        item.scheduleOrder = -1_000 + insertion.queueOrder;
        item.revision += 1;
        item.updatedAt = timestamp;
        item.lastModifiedBy = actorUser(actor);
        recordActivity(item, actor, "local_schedule_urgent_inserted", {
          urgentRevision,
          activation: insertion.activation,
          queueOrder: insertion.queueOrder,
          worktreeWait: insertion.activation === "head_after_worktree_unlock",
          runningWorkPreempted: false,
        });
      }
      for (const { item, displacement, pinned } of displacementRows) {
        const previousPlanSource = item.schedulePlanSource ?? null;
        item.plannedDate = displacement.targetDate;
        item.schedulePlanSource = "urgent_insert";
        item.scheduleReason = `displaced_by_p0:${displacement.forWorkItemId}`;
        item.scheduleOrder = null;
        item.revision += 1;
        item.updatedAt = timestamp;
        item.lastModifiedBy = actorUser(actor);
        recordActivity(item, actor, "local_schedule_displaced_by_urgent", {
          urgentRevision,
          forWorkItemId: displacement.forWorkItemId,
          sourceDate: displacement.sourceDate,
          targetDate: displacement.targetDate,
          previousPlanSource,
          pinnedConfirmed: pinned,
          runningWorkPreempted: false,
        });
      }
      (state.localScheduleUrgentInsertions ??= []).unshift({
        operationKey,
        ownerTeamId: actorTeam(actor),
        actorId: actorUser(actor),
        terminalId: localTerminalId(),
        date,
        urgentRevision,
        confirmPinned: Boolean(confirmPinned),
        appliedAt: timestamp,
        result,
      });
      state.localScheduleUrgentInsertions = state.localScheduleUrgentInsertions.slice(0, 200);
      if (insertRows.length > 0) {
        appendEvent({
          invocationId: null,
          type: "local_schedule_urgent_inserted",
          level: "warn",
          message: `${insertRows.length} P0 work item(s) inserted into the current-terminal schedule.`,
          data: {
            urgentRevision,
            terminalId: localTerminalId(),
            date,
            workItemIds: result.workItemIds,
            displacedWorkItemIds: result.displacedWorkItemIds,
            confirmedPinned: result.confirmedPinned,
            runningWorkPreempted: false,
            actorTeamId: actorTeam(actor),
          },
        });
      }
    });
    return { ok: true, status: 200, body: result };
  }

  function getExternalIssueFunnel({ projectId } = {}, actor = null) {
    const visible = (state.workItems ?? []).filter((item) =>
      item.ownerTeamId === actorTeam(actor)
      && (!projectId || item.projectId === String(projectId))
      && (item.externalBindings?.length ?? 0) > 0);
    const stages = { notStarted: 0, running: 0, review: 0, completed: 0 };
    const stalls = [];
    const cutoff = Date.parse(now()) - 24 * 60 * 60 * 1_000;
    for (const item of visible) {
      const execution = executionState(item);
      const completed = item.state === "closed" || item.status === "done";
      const review = !completed && (item.status === "review" || execution === "completed" || execution === "awaiting_approval");
      const running = !completed && !review && ["claimed", "running", "verifying"].includes(execution);
      const stage = completed ? "completed" : review ? "review" : running ? "running" : "notStarted";
      stages[stage] += 1;
      const primary = item.externalBindings.find((binding) => binding.isPrimary !== false) ?? item.externalBindings[0];
      const since = primary.linkedAt ?? item.createdAt ?? item.updatedAt;
      const stale = Number.isFinite(Date.parse(since)) && Date.parse(since) < cutoff;
      let kind = null;
      if (execution === "failed") kind = "execution_failed";
      else if (completed && primary.syncPolicy === "manual" && primary.syncedLocalRevision !== item.revision) kind = "writeback_pending";
      else if (stage === "notStarted" && stale) kind = "imported_not_started";
      else if (stage === "review" && stale) kind = "review_waiting";
      if (kind) stalls.push({
        kind,
        workItemId: item.id,
        localRef: item.localRef,
        title: item.title,
        provider: providerOfBinding(primary),
        issueNumber: primary.number,
        since,
      });
    }
    stalls.sort((a, b) => String(a.since).localeCompare(String(b.since)));
    return {
      ok: true,
      status: 200,
      body: { metrics: { total: visible.length, ...stages, stalled: stalls.length }, stalls: stalls.slice(0, 20) },
    };
  }

  function addMaterials({ workItemId, expectedRevision, materialDraftId, materialDraftRevision } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (item.state === "closed" || item.status === "done") {
      return { ok: false, status: 409, body: { error: "work_item_reopen_required_for_materials" } };
    }
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    if (expectedRevision !== item.revision) return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    if ((item.inputAssets ?? []).length > 94) return { ok: false, status: 409, body: { error: "work_item_material_limit_exceeded" } };
    if (typeof claimTaskMaterialDraft !== "function") {
      return { ok: false, status: 503, body: { error: "task_material_service_unavailable" } };
    }
    const claimed = claimTaskMaterialDraft({
      projectId: item.projectId,
      draftId: materialDraftId,
      expectedRevision: materialDraftRevision,
      workItemId: item.id,
      terminalId: item.terminalId,
      deferPersist: true,
    }, actor);
    if (!claimed.ok) return { ok: false, status: claimed.status ?? 409, body: { error: claimed.error ?? "task_material_claim_failed" } };
    const existingIds = new Set((item.inputAssets ?? []).map((asset) => asset.id).filter(Boolean));
    const additions = claimed.assets.filter((asset) => !existingIds.has(asset.id));
    if (!additions.length) return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: true, appliesTo: "next_execution" } };
    const active = ["claimed", "running", "awaiting_approval", "verifying"].includes(executionState(item));
    runTx(() => {
      item.inputAssets = [...(item.inputAssets ?? []), ...additions];
      item.materialDraftIds = [...new Set([...(item.materialDraftIds ?? []), String(materialDraftId)])];
      item.materialChangesPending = true;
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "materials_added", { assetIds: additions.map((asset) => asset.id), appliesTo: active ? "future_execution" : "next_execution" });
    });
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor), appliesTo: active ? "future_execution" : "next_execution" } };
  }

  function removeMaterial({ workItemId, assetId, expectedRevision } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (item.state === "closed" || item.status === "done") {
      return { ok: false, status: 409, body: { error: "work_item_reopen_required_for_materials" } };
    }
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    if (expectedRevision !== item.revision) return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    const asset = (item.inputAssets ?? []).find((candidate) => candidate.id === String(assetId));
    if (!asset) return { ok: false, status: 404, body: { error: "task_material_not_found" } };
    const active = ["claimed", "running", "awaiting_approval", "verifying"].includes(executionState(item));
    runTx(() => {
      item.inputAssets = (item.inputAssets ?? []).filter((candidate) => candidate.id !== asset.id);
      item.materialChangesPending = true;
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "material_removed", { assetId: asset.id, appliesTo: active ? "future_execution" : "next_execution" });
    });
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor), appliesTo: active ? "future_execution" : "next_execution" } };
  }

  function captureDataContextSnapshot({ workItemId, expectedRevision, confirm = false } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const comparison = compareDataContextSnapshot(item);
    if (comparison.requiresConfirmation && confirm !== true) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "data_context_confirmation_required",
          dataContext: {
            status: comparison.status,
            snapshot: comparison.baseline,
            currentDigest: comparison.current.digest,
            changes: comparison.changes,
            requiresConfirmation: true,
          },
        },
      };
    }
    if (item.dataContextSnapshot && comparison.status === "current") {
      return { ok: true, status: 200, body: { refreshed: false, workItem: workItemView(item, actor) } };
    }
    const timestamp = now();
    runTx(() => {
      const previous = item.dataContextSnapshot ?? comparison.baseline;
      item.dataContextSnapshotHistory = [
        previous,
        ...(item.dataContextSnapshotHistory ?? []),
      ].slice(0, 5);
      item.revision += 1;
      item.dataContextSnapshot = {
        ...buildDataContextSnapshot({
          workItemId: item.id,
          workItemRevision: item.revision,
          capturedAt: timestamp,
          inputAssets: item.inputAssets,
          localContentRefs: item.localContentRefs,
          taskResourceRefs: item.taskResourceRefs,
          channelTaskContract: item.channelTaskContract,
          channelOrigin: item.channelOrigin,
          taskContextControl: item.taskContextControl,
        }),
        confirmedAt: confirm === true ? timestamp : null,
        confirmedBy: confirm === true ? actorUser(actor) : null,
      };
      item.updatedAt = timestamp;
      item.lastModifiedBy = actorUser(actor);
      item.materialChangesPending = false;
      recordActivity(item, actor, "data_context_snapshot_captured", {
        snapshotId: item.dataContextSnapshot.id,
        digest: item.dataContextSnapshot.digest,
        sourceCount: item.dataContextSnapshot.sourceCount,
        confirmed: confirm === true,
        changes: comparison.changes,
      });
    });
    return { ok: true, status: 200, body: { refreshed: true, workItem: workItemView(item, actor) } };
  }

  function restoreMaterial({ workItemId, assetId, expectedRevision } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (item.state === "closed" || item.status === "done") {
      return { ok: false, status: 409, body: { error: "work_item_reopen_required_for_materials" } };
    }
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    if (expectedRevision !== item.revision) return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    if ((item.inputAssets ?? []).some((candidate) => candidate.id === String(assetId))) {
      return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: true, appliesTo: "next_execution" } };
    }
    if (typeof resolveClaimedTaskMaterial !== "function") {
      return { ok: false, status: 503, body: { error: "task_material_service_unavailable" } };
    }
    const resolved = resolveClaimedTaskMaterial({ workItemId: item.id, assetId, terminalId: item.terminalId }, actor);
    if (!resolved.ok) return { ok: false, status: resolved.status ?? 404, body: { error: resolved.error ?? "task_material_not_found" } };
    const active = ["claimed", "running", "awaiting_approval", "verifying"].includes(executionState(item));
    runTx(() => {
      item.inputAssets = [...(item.inputAssets ?? []), resolved.asset];
      item.materialChangesPending = true;
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "material_restored", { assetId: resolved.asset.id, appliesTo: active ? "future_execution" : "next_execution" });
    });
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor), appliesTo: active ? "future_execution" : "next_execution" } };
  }

  async function addContentReference({
    workItemId, contentId, expectedRevision, purpose = "required_input", selectedFingerprint = null,
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (item.state === "closed" || item.status === "done") {
      return { ok: false, status: 409, body: { error: "work_item_reopen_required_for_materials" } };
    }
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    if (expectedRevision !== item.revision) return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    if (!/^lc_[a-f0-9]{32}$/.test(String(contentId ?? ""))) {
      return { ok: false, status: 400, body: { error: "local_content_id_invalid" } };
    }
    if (!["reference", "required_input"].includes(purpose)) {
      return { ok: false, status: 400, body: { error: "local_content_reference_purpose_invalid" } };
    }
    if ((item.localContentRefs ?? []).length >= 20) {
      return { ok: false, status: 409, body: { error: "local_content_reference_limit_exceeded" } };
    }
    const existing = (item.localContentRefs ?? []).find((reference) => reference.contentId === String(contentId));
    if (existing) return { ok: true, status: 200, body: { workItem: workItemView(item, actor), reference: contentReferenceView(existing), replayed: true } };
    if (typeof resolveLocalContentReference !== "function") {
      return { ok: false, status: 503, body: { error: "local_content_resolver_unavailable" } };
    }
    const resolved = await resolveLocalContentReference({ contentId, projectId: item.projectId }, actor);
    if (!resolved?.ok) {
      return { ok: false, status: resolved?.status ?? 409, body: { error: resolved?.error ?? "local_content_original_unavailable" } };
    }
    const fingerprint = String(resolved.sha256 ?? "");
    if (selectedFingerprint && String(selectedFingerprint).replace(/^sha256:/, "") !== fingerprint.replace(/^sha256:/, "")) {
      return { ok: false, status: 409, body: { error: "local_content_original_changed" } };
    }
    const reference = {
      id: nextId("wcr"),
      contentId: String(contentId),
      purpose,
      selectedFingerprint: selectedFingerprint ? fingerprint : null,
      title: String(resolved.record?.title ?? resolved.originalName ?? "Local content").slice(0, 500),
      kind: String(resolved.record?.kind ?? "").slice(0, 50),
      addedBy: actorUser(actor),
      createdAt: now(),
    };
    const active = ["claimed", "running", "awaiting_approval", "verifying"].includes(executionState(item));
    runTx(() => {
      item.localContentRefs = [...(item.localContentRefs ?? []), reference];
      item.materialChangesPending = true;
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "local_content_reference_added", {
        referenceId: reference.id,
        contentId: reference.contentId,
        purpose: reference.purpose,
        appliesTo: active ? "future_execution" : "next_execution",
      });
    });
    return { ok: true, status: 201, body: { workItem: workItemView(item, actor), reference: contentReferenceView(reference), appliesTo: active ? "future_execution" : "next_execution" } };
  }

  function removeContentReference({ workItemId, referenceId, expectedRevision } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (item.state === "closed" || item.status === "done") {
      return { ok: false, status: 409, body: { error: "work_item_reopen_required_for_materials" } };
    }
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    if (expectedRevision !== item.revision) return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    const reference = (item.localContentRefs ?? []).find((candidate) => candidate.id === String(referenceId));
    if (!reference) return { ok: false, status: 404, body: { error: "local_content_reference_not_found" } };
    const active = ["claimed", "running", "awaiting_approval", "verifying"].includes(executionState(item));
    runTx(() => {
      item.localContentRefs = (item.localContentRefs ?? []).filter((candidate) => candidate.id !== reference.id);
      item.materialChangesPending = true;
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "local_content_reference_removed", {
        referenceId: reference.id,
        contentId: reference.contentId,
        appliesTo: active ? "future_execution" : "next_execution",
      });
    });
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor), appliesTo: active ? "future_execution" : "next_execution" } };
  }

  async function addResourceReference({
    workItemId, resourceId, expectedRevision, purpose = "reference",
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (item.state === "closed" || item.status === "done") {
      return { ok: false, status: 409, body: { error: "work_item_reopen_required_for_materials" } };
    }
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    if (expectedRevision !== item.revision) return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    if (typeof resolveWorkResourceReference !== "function") {
      return { ok: false, status: 503, body: { error: "work_resource_resolver_unavailable" } };
    }
    const resolved = await resolveWorkResourceReference({ resourceId, projectId: item.projectId }, actor);
    if (resolved?.status >= 400) return { ok: false, status: resolved.status, body: resolved.body };
    const resource = resolved?.body;
    if (!resource || (resource.projectId && resource.projectId !== item.projectId)) {
      return { ok: false, status: 409, body: { error: "work_resource_project_mismatch" } };
    }
    if (!(resource.allowedPurposes ?? []).includes(purpose)) {
      return { ok: false, status: 400, body: { error: "work_resource_reference_purpose_invalid" } };
    }
    const existingLocal = (item.localContentRefs ?? []).find((reference) => reference.resourceId === resource.resourceId);
    const existingResource = (item.taskResourceRefs ?? []).find((reference) => reference.resourceId === resource.resourceId);
    if (existingLocal || existingResource) {
      return { ok: true, status: 200, body: { workItem: workItemView(item, actor), reference: existingLocal ? contentReferenceView(existingLocal) : taskResourceReferenceView(existingResource), replayed: true } };
    }
    if ((item.localContentRefs ?? []).length + (item.taskResourceRefs ?? []).length >= 20) {
      return { ok: false, status: 409, body: { error: "work_resource_reference_limit_exceeded" } };
    }
    let reference;
    let targetCollection;
    if (resource.contentId && purpose !== "change_target") {
      if (typeof resolveLocalContentReference !== "function") {
        return { ok: false, status: 503, body: { error: "local_content_resolver_unavailable" } };
      }
      const original = await resolveLocalContentReference({ contentId: resource.contentId, projectId: item.projectId }, actor);
      if (!original?.ok) return { ok: false, status: original?.status ?? 409, body: { error: original?.error ?? "local_content_original_unavailable" } };
      reference = {
        id: nextId("wcr"),
        contentId: resource.contentId,
        resourceId: resource.resourceId,
        purpose: purpose === "query_source" ? "required_input" : purpose === "change_target" ? "required_input" : purpose,
        selectedFingerprint: original.sha256 ?? null,
        title: resource.title,
        kind: original.record?.kind ?? resource.resourceKind,
        addedBy: actorUser(actor),
        createdAt: now(),
      };
      targetCollection = "localContentRefs";
    } else {
      reference = {
        id: nextId("wrr"),
        resourceId: resource.resourceId,
        purpose,
        title: resource.title,
        resourceKind: resource.resourceKind,
        businessRole: resource.businessRole,
        locality: resource.locality,
        sourceLabel: resource.sourceLabel,
        capabilities: Array.isArray(resource.capabilities) ? resource.capabilities.slice(0, 20) : [],
        allowedPurposes: Array.isArray(resource.allowedPurposes) ? resource.allowedPurposes.slice(0, 10) : [],
        selectedVersion: resource.currentVersion,
        addedBy: actorUser(actor),
        createdAt: now(),
      };
      targetCollection = "taskResourceRefs";
    }
    const active = ["claimed", "running", "awaiting_approval", "verifying"].includes(executionState(item));
    runTx(() => {
      item[targetCollection] = [...(item[targetCollection] ?? []), reference];
      item.materialChangesPending = true;
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "work_resource_reference_added", {
        referenceId: reference.id,
        resourceId: reference.resourceId,
        purpose,
        locality: resource.locality,
        appliesTo: active ? "future_execution" : "next_execution",
      });
    });
    return { ok: true, status: 201, body: { workItem: workItemView(item, actor), reference: targetCollection === "localContentRefs" ? contentReferenceView(reference) : taskResourceReferenceView(reference), appliesTo: active ? "future_execution" : "next_execution" } };
  }

  async function refreshResourceReference({ workItemId, referenceId, expectedRevision } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (item.state === "closed" || item.status === "done") return { ok: false, status: 409, body: { error: "work_item_reopen_required_for_materials" } };
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    if (expectedRevision !== item.revision) return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    const reference = (item.taskResourceRefs ?? []).find((candidate) => candidate.id === String(referenceId));
    if (!reference) return { ok: false, status: 404, body: { error: "work_resource_reference_not_found" } };
    if (typeof resolveWorkResourceReference !== "function") return { ok: false, status: 503, body: { error: "work_resource_resolver_unavailable" } };
    const resolved = await resolveWorkResourceReference({ resourceId: reference.resourceId, projectId: item.projectId }, actor);
    if (resolved?.status >= 400) return { ok: false, status: resolved.status, body: resolved.body };
    const resource = resolved?.body;
    if (!resource || (resource.projectId && resource.projectId !== item.projectId)) {
      return { ok: false, status: 409, body: { error: "work_resource_project_mismatch" } };
    }
    if (resource.availability && resource.availability !== "ready") {
      return { ok: false, status: 409, body: { error: "work_resource_unavailable" } };
    }
    if (!(resource.allowedPurposes ?? []).includes(reference.purpose)) {
      return { ok: false, status: 409, body: { error: "work_resource_reference_purpose_invalid" } };
    }
    const active = ["claimed", "running", "awaiting_approval", "verifying"].includes(executionState(item));
    runTx(() => {
      reference.selectedVersion = resource.currentVersion ?? null;
      reference.title = resource.title;
      reference.resourceKind = resource.resourceKind;
      reference.businessRole = resource.businessRole;
      reference.locality = resource.locality;
      reference.sourceLabel = resource.sourceLabel;
      reference.capabilities = Array.isArray(resource.capabilities) ? resource.capabilities.slice(0, 20) : [];
      reference.allowedPurposes = Array.isArray(resource.allowedPurposes) ? resource.allowedPurposes.slice(0, 10) : [];
      item.materialChangesPending = true;
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "work_resource_reference_refreshed", {
        referenceId: reference.id,
        resourceId: reference.resourceId,
        versionPinned: Boolean(reference.selectedVersion),
        appliesTo: active ? "future_execution" : "next_execution",
      });
    });
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor), reference: taskResourceReferenceView(reference), appliesTo: active ? "future_execution" : "next_execution" } };
  }

  async function inspectResourceReferences({ workItemId } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const normalizeFingerprint = (value) => String(value ?? "").replace(/^sha256:/, "");
    const localChecks = await Promise.all((item.localContentRefs ?? []).map(async (reference) => {
      const blocking = reference.purpose !== "reference";
      if (typeof resolveLocalContentReference !== "function") {
        return { referenceId: reference.id, kind: "local_content", title: reference.title, purpose: reference.purpose, locality: "local", sourceLabel: "本机资料", status: "unknown", blocking, versionPinned: Boolean(reference.selectedFingerprint), canAcceptCurrentVersion: false, canRecheck: true, recovery: "recheck" };
      }
      const resolved = await resolveLocalContentReference({ contentId: reference.contentId, projectId: item.projectId }, actor);
      if (!resolved?.ok) {
        return { referenceId: reference.id, kind: "local_content", title: reference.title, purpose: reference.purpose, locality: "local", sourceLabel: "本机资料", status: "unavailable", blocking, versionPinned: Boolean(reference.selectedFingerprint), canAcceptCurrentVersion: false, canRecheck: true, recovery: "locate_or_replace", reason: resolved?.error ?? "local_content_original_unavailable" };
      }
      const changed = Boolean(reference.selectedFingerprint)
        && normalizeFingerprint(reference.selectedFingerprint) !== normalizeFingerprint(resolved.sha256);
      return { referenceId: reference.id, kind: "local_content", title: reference.title, purpose: reference.purpose, locality: "local", sourceLabel: "本机资料", status: changed ? "changed" : "ready", blocking, versionPinned: Boolean(reference.selectedFingerprint), canAcceptCurrentVersion: false, canRecheck: true, recovery: changed ? "refresh_local_record" : null };
    }));
    const structuredChecks = await Promise.all((item.taskResourceRefs ?? []).map(async (reference) => {
      const blocking = reference.purpose !== "reference";
      if (typeof resolveWorkResourceReference !== "function") {
        return { referenceId: reference.id, kind: "work_resource", title: reference.title, purpose: reference.purpose, locality: reference.locality, sourceLabel: reference.sourceLabel, status: "unknown", blocking, versionPinned: Boolean(reference.selectedVersion), canAcceptCurrentVersion: false, canRecheck: true, recovery: "recheck" };
      }
      const resolved = await resolveWorkResourceReference({ resourceId: reference.resourceId, projectId: item.projectId }, actor);
      if (resolved?.status >= 400 || !resolved?.body) {
        return { referenceId: reference.id, kind: "work_resource", title: reference.title, purpose: reference.purpose, locality: reference.locality, sourceLabel: reference.sourceLabel, status: "unavailable", blocking, versionPinned: Boolean(reference.selectedVersion), canAcceptCurrentVersion: false, canRecheck: true, recovery: "manage_source", reason: resolved?.body?.error ?? "work_resource_unavailable" };
      }
      const resource = resolved.body;
      const unavailable = resource.availability && resource.availability !== "ready";
      const changed = !unavailable && Boolean(reference.selectedVersion) && Boolean(resource.currentVersion)
        && String(reference.selectedVersion) !== String(resource.currentVersion);
      return {
        referenceId: reference.id,
        kind: "work_resource",
        title: reference.title,
        purpose: reference.purpose,
        locality: reference.locality,
        sourceLabel: reference.sourceLabel,
        status: unavailable ? "unavailable" : changed ? "changed" : "ready",
        blocking,
        versionPinned: Boolean(reference.selectedVersion),
        canAcceptCurrentVersion: changed,
        canRecheck: true,
        recovery: unavailable ? "manage_source" : changed ? "accept_current_version" : null,
        ...(unavailable ? { reason: "work_resource_unavailable" } : {}),
      };
    }));
    const references = [...localChecks, ...structuredChecks];
    const counts = references.reduce((summary, reference) => {
      summary[reference.status] += 1;
      if (reference.blocking && reference.status !== "ready") summary.blocking += 1;
      return summary;
    }, { ready: 0, changed: 0, unavailable: 0, unknown: 0, blocking: 0 });
    return { ok: true, status: 200, body: { preflight: { checkedAt: now(), executable: counts.blocking === 0, counts, references } } };
  }

  function removeResourceReference({ workItemId, referenceId, expectedRevision } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (item.state === "closed" || item.status === "done") return { ok: false, status: 409, body: { error: "work_item_reopen_required_for_materials" } };
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    if (expectedRevision !== item.revision) return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    const structured = (item.taskResourceRefs ?? []).find((candidate) => candidate.id === String(referenceId));
    const local = (item.localContentRefs ?? []).find((candidate) => candidate.id === String(referenceId) && candidate.resourceId);
    const reference = structured ?? local;
    if (!reference) return { ok: false, status: 404, body: { error: "work_resource_reference_not_found" } };
    const active = ["claimed", "running", "awaiting_approval", "verifying"].includes(executionState(item));
    runTx(() => {
      if (structured) item.taskResourceRefs = (item.taskResourceRefs ?? []).filter((candidate) => candidate.id !== reference.id);
      else item.localContentRefs = (item.localContentRefs ?? []).filter((candidate) => candidate.id !== reference.id);
      item.materialChangesPending = true;
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "work_resource_reference_removed", { referenceId: reference.id, resourceId: reference.resourceId, appliesTo: active ? "future_execution" : "next_execution" });
    });
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor), appliesTo: active ? "future_execution" : "next_execution" } };
  }

  function updateTaskContext({
    workItemId,
    expectedRevision,
    deliveryDestination,
    materialRoles = [],
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (item.state === "closed" || item.status === "done" || item.archivedAt) {
      return { ok: false, status: 409, body: { error: "work_item_context_reopen_required" } };
    }
    if ((item.executionBindings ?? []).length
      || (item.executionStartRequest && item.executionStartRequest.status !== "cancelled")) {
      return { ok: false, status: 409, body: { error: "work_item_context_locked_after_start" } };
    }
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    if (!Array.isArray(materialRoles) || materialRoles.length > 50) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_context_material_roles" } };
    }
    const normalizedDestination = deliveryDestination == null ? null : String(deliveryDestination);
    if (normalizedDestination && !["task", "channel"].includes(normalizedDestination)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_context_delivery_destination" } };
    }
    if (normalizedDestination === "channel" && !item.channelOrigin?.channelId) {
      return { ok: false, status: 409, body: { error: "work_item_context_channel_unavailable" } };
    }

    const updates = [];
    const seen = new Set();
    for (const candidate of materialRoles) {
      const referenceId = String(candidate?.id ?? "").trim();
      const role = String(candidate?.role ?? "").trim();
      if (!referenceId || referenceId.length > 200 || seen.has(referenceId)) {
        return { ok: false, status: 400, body: { error: "invalid_work_item_context_material_roles" } };
      }
      seen.add(referenceId);
      const local = (item.localContentRefs ?? []).find((reference) => reference.id === referenceId);
      const resource = (item.taskResourceRefs ?? []).find((reference) => reference.id === referenceId);
      if (!local && !resource) {
        return { ok: false, status: 404, body: { error: "work_item_context_material_not_found", referenceId } };
      }
      const allowed = local
        ? ["reference", "required_input"]
        : Array.isArray(resource.allowedPurposes) && resource.allowedPurposes.length
          ? resource.allowedPurposes
          : ["reference", "query_source"];
      if (!allowed.includes(role)) {
        return { ok: false, status: 400, body: { error: "work_item_context_material_role_not_allowed", referenceId, allowed } };
      }
      updates.push({ reference: local ?? resource, role });
    }

    const currentDestination = item.taskContextControl?.deliveryDestination
      ?? (item.channelOrigin?.channelId ? "channel" : "task");
    const nextDestination = normalizedDestination ?? currentDestination;
    const materialChanges = updates
      .filter(({ reference, role }) => reference.purpose !== role)
      .map(({ reference, role }) => ({ reference, from: reference.purpose, role }));
    if (!materialChanges.length && nextDestination === currentDestination) {
      return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: true } };
    }

    const timestamp = now();
    runTx(() => {
      for (const { reference, role } of materialChanges) reference.purpose = role;
      item.taskContextControl = {
        schemaVersion: 1,
        deliveryDestination: nextDestination,
        updatedAt: timestamp,
        updatedBy: actorUser(actor),
      };
      item.materialChangesPending = materialChanges.length > 0 || item.materialChangesPending === true;
      item.revision += 1;
      item.updatedAt = timestamp;
      item.lastModifiedBy = actorUser(actor);
      item.dataContextSnapshotHistory = item.dataContextSnapshot
        ? [item.dataContextSnapshot, ...(item.dataContextSnapshotHistory ?? [])].slice(0, 5)
        : (item.dataContextSnapshotHistory ?? []);
      item.dataContextSnapshot = buildDataContextSnapshot({
        workItemId: item.id,
        workItemRevision: item.revision,
        capturedAt: timestamp,
        inputAssets: item.inputAssets,
        localContentRefs: item.localContentRefs,
        taskResourceRefs: item.taskResourceRefs,
        channelTaskContract: item.channelTaskContract,
        channelOrigin: item.channelOrigin,
        taskContextControl: item.taskContextControl,
      });
      recordActivity(item, actor, "task_context_corrected", {
        delivery: { from: currentDestination, to: nextDestination },
        materials: materialChanges.map(({ reference, from, role }) => ({
          referenceId: reference.id,
          from,
          to: role,
        })),
      });
      appendEvent({
        invocationId: null,
        type: "work_item_context_corrected",
        level: "info",
        message: `${item.localRef} execution context corrected.`,
        data: { workItemId: item.id, revision: item.revision, actorTeamId: actorTeam(actor) },
      });
    });
    notifyWorkItemChanged(item, actor, "context_corrected");
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor) } };
  }

  return {
    listWorkItems, getCompletionMetrics, getHomeWorkbench, listAttention, getWorkItem, createWorkItem, createWorkItemFromExternal, updateWorkItem, recordWorkItemProgress, bulkUpdateWorkItems, transitionWorkItem,
    listReportDrafts: reportDraftService.list,
    getReportDraft: reportDraftService.get,
    generateReportDraft: reportDraftService.generate,
    updateReportDraft: reportDraftService.update,
    confirmReportDraft: reportDraftService.confirm,
    discardReportDraft: reportDraftService.discard,
    listFollowUpReminders: followUpReminderService.list,
    sweepFollowUpReminders: followUpReminderService.sweep,
    listReportDeliveries: reportDraftService.listDeliveries,
    getReportDelivery: reportDraftService.getDelivery,
    previewReportDelivery: reportDraftService.previewDelivery,
    sendReportDelivery: reportDraftService.sendDelivery,
    listActivity, listComments, createComment, updateComment, deleteComment,
    beginExecution, abortExecution, recordExecutionBinding,
    beginDelivery, failDelivery, completeDelivery,
    claimWorkItem, releaseWorkItemClaim, assignWorkItemToSelf,
    bindGithubIssue, syncGithubIssue, bindExternalIssue, syncExternalIssue, listExternalProviders, getExternalIssueFunnel,
    recordVerification, recordAssetOperation, ingestGithubWebhook, replayGithubWebhook, recordGithubWebhookFailure,
    ingestExternalWebhook, replayExternalWebhook, recordExternalWebhookFailure,
    githubSyncDiagnostics, updateAttention, sweepOperationalAlerts, suggestWorkItemDraft, previewIntentTaskPlan, commitIntentTaskPlan, createResultRepairTask, listMyTemplateRoutingFeedback, removeMyTemplateRoutingFeedback, previewMyTemplateDraft, listMyTemplateDrafts, reviewMyTemplateDraft, listSimilarMyTemplateWorkItems, createMyTemplateDraft, addMyTemplateLearningCase, activateMyTemplateDraft, listMyTemplateOutcomeFeedback, recordMyTemplateOutcomeFeedback, listPlanActualFeedback, removePlanActualFeedback, recordPlanActualFeedback, resumeMyTemplateGovernanceObservation, prepareExecutionContract, confirmExecutionContractAndSchedule, cancelExecutionStart, recheckExecutionStart, recordExecutionStartOutcome, retryWorkItemAlert,
    startApplicationExecution, requestApplicationExecutionApproval,
    applyLocalSchedulePlan,
    applyLocalScheduleRollover,
    applyLocalScheduleUrgent,
    addMaterials,
    removeMaterial,
    captureDataContextSnapshot,
    restoreMaterial,
    addContentReference,
    removeContentReference,
    addResourceReference,
    refreshResourceReference,
    inspectResourceReferences,
    removeResourceReference,
    updateTaskContext,
  };
}
