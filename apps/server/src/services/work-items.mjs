/*
 * Local-first work items. These records deliberately live beside, rather than
 * inside, repository Projects: a repository is an execution boundary while a
 * work item is planning data that may later bind to GitHub or another tracker.
 */

import { createHash } from "node:crypto";
import { normalizeLocalIssueRoutineBinding } from "@myagenttool/protocol/business-routine";
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
import { resolveWorkItemExecution } from "./work-item-execution.mjs";
import { projectWorkItemOutcome } from "./work-item-outcome.mjs";

const TYPES = new Set(["task", "bug", "feature", "initiative"]);
const STATUSES = new Set(["backlog", "ready", "in_progress", "review", "blocked", "done"]);
const PRIORITIES = new Set(["p0", "p1", "p2", "p3"]);
const EXECUTION_POLICIES = new Set(["inherit", "auto", "manual", "paused"]);
// Friendly aliases normalized to canonical p0–p3 before validation, so callers
// may pass "critical"/"high"/"medium"/"low" etc. (mirrors the alias→canonical
// pattern in normalizeClaudePermissionMode). Invalid values still reject.
const PRIORITY_ALIASES = { critical: "p0", urgent: "p0", high: "p1", medium: "p2", normal: "p2", low: "p3" };
function normalizePriority(value) {
  const candidate = String(value ?? "").toLowerCase().trim();
  return PRIORITY_ALIASES[candidate] ?? candidate;
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
const VERIFICATION_KINDS = new Set(["test", "lint", "typecheck", "manual", "review"]);
const VERIFICATION_STATUSES = new Set(["passed", "failed"]);
const EXECUTION_OPERATION_TTL_MS = 30 * 60_000;
const ACTIVE_AUTO_RUN_STATUSES = new Set([
  "materializing", "running", "waiting_capacity", "awaiting_approval", "verifying", "publishing",
  "pr_open", "report_posted", "needs_input", "plan_proposed",
]);
const SCHEDULABLE_RUNTIME_STATES = new Set([
  "materializing", "running", "waiting_capacity", "verifying", "publishing", "decomposed",
]);

const ACCEPTANCE_HEADING_PATTERN = /^(#{1,6})\s*(acceptance(?:\s+criteria)?|definition\s+of\s+done|验收标准|完成标准)\s*[:：]?\s*$/i;

export function extractAcceptanceCriteriaFromBody(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => ACCEPTANCE_HEADING_PATTERN.test(line.trim()));
  if (headingIndex < 0) return [];
  const headingLevel = lines[headingIndex].trim().match(/^#+/)?.[0].length ?? 6;
  const criteria = [];
  for (const rawLine of lines.slice(headingIndex + 1)) {
    const line = rawLine.trim();
    const nextHeading = line.match(/^(#{1,6})\s+/);
    if (nextHeading && nextHeading[1].length <= headingLevel) break;
    const bullet = line.match(/^(?:[-*+]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s*)?(.+)$/);
    if (!bullet) continue;
    const criterion = bullet[1].trim();
    if (criterion && criterion.length <= 2_000 && !criteria.includes(criterion)) criteria.push(criterion);
    if (criteria.length >= 100) break;
  }
  return criteria;
}

export function defaultVerificationSop({ title = "", body = "" } = {}) {
  const chinese = /[\u3400-\u9fff]/.test(`${title}${body}`);
  return chinese ? [
    "按实际使用方式逐项检查验收标准描述的行为，并记录每一项是否通过。",
    "查看自动测试、类型检查或其他验证证据，确认它们对应当前这版交付。",
    "查看独立代码复核结论，确认不存在阻止交付的问题。",
    "确认变更范围与任务目标一致，并了解应用变更或创建 Pull Request 的影响与风险。",
  ] : [
    "Exercise each acceptance criterion through the real user flow and record whether it passes.",
    "Review automated test, typecheck, or other verification evidence and confirm it belongs to this delivery.",
    "Review the independent code-review conclusion and confirm that no delivery-blocking issue remains.",
    "Confirm that the change stays within the task goal and understand the impact and risk of applying it or creating a pull request.",
  ];
}

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
  if (!partial || Object.hasOwn(input, "requiredCapabilities")) {
    const capabilities = strings(input.requiredCapabilities ?? [], { limit: 20, maxLength: 40 });
    if (!capabilities || capabilities.some((verb) => !ASSET_CAPABILITY_VERBS.includes(verb))) {
      return { error: "invalid_work_item_required_capabilities" };
    }
    value.requiredCapabilities = capabilities;
  }
  if (!partial || Object.hasOwn(input, "outputAssets")) {
    const assets = normalizeAssetRefs(input.outputAssets ?? []);
    if (!assets) return { error: "invalid_work_item_output_assets" };
    value.outputAssets = assets;
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
  return { value };
}

function normalizeAssetRefs(input) {
  if (!Array.isArray(input) || input.length > 100) return null;
  const assets = [];
  for (const candidate of input) {
    if (!candidate || typeof candidate !== "object") return null;
    const path = String(candidate.path ?? "").replaceAll("\\", "/");
    const terminalId = String(candidate.terminalId ?? "");
    if (!path || path.startsWith("/") || path.split("/").includes("..") || path.length > 1_000 || !terminalId) return null;
    const capabilities = strings(candidate.capabilities ?? [], { limit: 20, maxLength: 40 });
    if (!capabilities || capabilities.some((verb) => !ASSET_CAPABILITY_VERBS.includes(verb))) return null;
    assets.push({
      id: String(candidate.id ?? "").slice(0, 100) || null,
      originalName: candidate.originalName ? String(candidate.originalName).replace(/[\r\n\t]/g, " ").slice(0, 200) : undefined,
      path,
      family: String(candidate.family ?? "unknown").slice(0, 40),
      mimeType: candidate.mimeType ? String(candidate.mimeType).slice(0, 120) : null,
      terminalId,
      size: Number.isSafeInteger(candidate.size) && candidate.size >= 0 ? candidate.size : null,
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
  onWorkItemChanged = () => {},
  claimTaskMaterialDraft = null,
  resolveClaimedTaskMaterial = null,
  store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  const actorTeam = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const actorUser = (actor) => actor?.userId ?? LOCAL_USER_ID;
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
    state, now, nextId, runTx, findOwn, recordActivity, actorTeam, actorUser,
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
    if (!(item.acceptanceCriteria ?? []).length) return { ready: true, missingCriteria: [], verificationRequired: false };
    const passed = new Set((item.acceptanceResults ?? [])
      .filter((result) => result.status === "passed")
      .map((result) => result.criterion));
    const missingCriteria = item.acceptanceCriteria.filter((criterion) => !passed.has(criterion));
    const verificationRequired = !(item.verificationRecords ?? []).some((record) => record.status === "passed");
    return { ready: missingCriteria.length === 0 && !verificationRequired, missingCriteria, verificationRequired };
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
    return {
      ready: missing.length === 0,
      missing,
      source: item.executionContractSource ?? null,
      confirmedAt: item.executionContractConfirmedAt ?? null,
      latestAttemptStartedAt,
    };
  }

  function reviewContract(item) {
    const latestRun = [...(item.executionBindings ?? [])].reverse()
      .filter((binding) => binding.kind === "auto_run")
      .map((binding) => (state.autoRuns ?? []).find((candidate) => candidate.id === binding.targetId))
      .find(Boolean) ?? null;
    const contract = latestRun?.executionContract ?? item.executionContractSnapshot ?? null;
    if (!contract) return null;
    return {
      schemaVersion: contract.schemaVersion ?? "execution-contract-v2",
      id: contract.id,
      workItemId: contract.workItemId ?? item.id,
      workItemRevision: contract.workItemRevision ?? null,
      autoRunId: contract.autoRunId ?? latestRun?.id ?? null,
      acceptanceCriteria: [...(contract.acceptanceCriteria ?? [])],
      verificationSop: [...(contract.verificationSop ?? [])],
      confirmedBy: contract.confirmedBy ?? null,
      confirmedAt: contract.confirmedAt ?? null,
      digest: contract.digest ?? null,
      readOnly: true,
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

  function workItemView(item, actor) {
    const { createIdempotencyKey: _createIdempotencyKey, ...publicItem } = item;
    const bodyAcceptanceCriteria = (item.acceptanceCriteria ?? []).length
      ? []
      : extractAcceptanceCriteriaFromBody(item.body);
    const visibleAcceptanceCriteria = (publicItem.acceptanceCriteria ?? []).length
      ? publicItem.acceptanceCriteria
      : bodyAcceptanceCriteria;
    const derivedExecutionState = executionState(item);
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
    return {
      ...publicItem,
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
      statusModel: {
        business: item.state,
        planning: item.status,
        execution: derivedExecutionState,
      },
      completionGate: completionGate({ ...item, acceptanceCriteria: visibleAcceptanceCriteria }),
      executionContractGate: executionContractGate(item),
      reviewContract: frozenReviewContract,
      reviewEvidence: reviewEvidence(item, frozenReviewContract),
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
        return dependency ? {
          id: dependency.id,
          localRef: dependency.localRef,
          title: dependency.title,
          status: dependency.status,
          state: dependency.state,
          resolved: dependency.status === "done" || dependency.state === "closed",
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

  function listWorkItems(query = {}, actor = null) {
    const q = String(query.q ?? "").trim().toLowerCase();
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
      .filter((item) => !q || `${item.localRef} ${item.title} ${item.body} ${item.labels.join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .map((item) => workItemView(item, actor));
    const page = paginateRows(rows, query);
    if (!page.ok) return { ok: false, status: 400, body: { error: page.error } };
    return {
      ok: true, status: 200,
      body: { workItems: page.rows, count: page.rows.length, nextCursor: page.nextCursor, hasMore: page.hasMore },
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
      if (run && ["awaiting_approval", "needs_input"].includes(run.status)) rows.push({
        id: `execution_approval:${item.id}:${run.id}`, kind: "execution_approval", severity: "high",
        workItemId: item.id, localRef: item.localRef, projectId: item.projectId,
        title: item.title, createdAt: run.updatedAt ?? run.createdAt ?? item.updatedAt,
        details: { autoRunId: run.id, status: run.status },
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
        resolution: operation?.resolution ?? null,
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
    const deliveryProject = (state.projects ?? []).find((project) => project.id === item.projectId) ?? null;
    const latestRunBinding = [...(item.executionBindings ?? [])].reverse().find(
      (binding) => binding.kind === "auto_run" && binding.targetId === latestRun?.id,
    ) ?? null;
    const outcomeWorktreeId = latestRun?.localDelivery?.worktreeId ?? latestRunBinding?.worktreeId ?? null;
    const boundWorktreeIds = new Set((item.executionBindings ?? [])
      .map((binding) => binding.worktreeId)
      .filter(Boolean));
    if (outcomeWorktreeId) boundWorktreeIds.add(outcomeWorktreeId);
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
    const deliveryRemoteUrl = deliveryProject?.git?.remoteUrl ?? null;
    const deliveryMode = deliveryRemoteUrl && /github\.com[/:]/i.test(deliveryRemoteUrl)
      ? "pull_request"
      : "local_merge";
    const currentInvocationIds = new Set(boundRuns
      .filter((run) => run.invocationId)
      .map((run) => run.invocationId));
    const relatedInvocations = (state.invocations ?? [])
      .filter((invocation) => {
        const autoRunId = invocation.options?.metadata?.autoRunId;
        return (autoRunId && runIds.has(autoRunId)) || currentInvocationIds.has(invocation.id);
      })
      .sort((left, right) =>
        String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""))
        || String(left.id).localeCompare(String(right.id)));
    const runInvocations = relatedInvocations.filter(
      (invocation) => invocation.options?.metadata?.role !== "delivery_review",
    );
    const latestExecutionInvocation = runInvocations.find((invocation) => invocation.id === latestRun?.invocationId) ?? null;
    const reviewInvocation = latestRun?.deliveryReview?.invocationId
      ? relatedInvocations.find((invocation) => invocation.id === latestRun.deliveryReview.invocationId) ?? null
      : null;
    const projectedDeliveryReview = latestRun?.deliveryReview
      ? {
        ...latestRun.deliveryReview,
        status: latestRun.deliveryReview.status === "queued" && reviewInvocation?.status === "running"
          ? "running"
          : latestRun.deliveryReview.status,
      }
      : null;
    const projectedDeliveryReport = latestRun?.deliveryReport ?? (pendingLocalDelivery ? {
      summary: latestExecutionInvocation?.result?.output?.latestMessage
        ?? latestExecutionInvocation?.result?.output?.summary
        ?? latestExecutionInvocation?.result?.summary
        ?? null,
      verification: latestRun?.verification ? { ...latestRun.verification } : null,
      changedFiles: [],
      completedAt: latestExecutionInvocation?.completedAt ?? latestRun?.updatedAt ?? null,
    } : null);
    const taskOutcome = projectWorkItemOutcome({
      item,
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
        item,
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
      ? runInvocations.map((invocation, index) => ({
        invocationId: invocation.id,
        autoRunId: invocation.options?.metadata?.autoRunId
          ?? boundRuns.find((run) => run.invocationId === invocation.id)?.id
          ?? null,
        attempt: index + 1,
        status: invocation.status,
        createdAt: invocation.createdAt ?? null,
        startedAt: invocation.startedAt ?? null,
        completedAt: invocation.completedAt ?? null,
        errorCode: invocation.result?.errorCode ?? null,
        summary: invocation.result?.summary
          ? String(invocation.result.summary).slice(0, 500)
          : null,
        current: invocation.id === latestRun?.invocationId,
      }))
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
      design: /design|ux|ui|mockup|wireframe/i.test(`${item.title} ${item.body}`) ? "Design/UI language is present." : "No design artifact signal.",
      prototype: /prototype|spike|experiment|proof of concept/i.test(`${item.title} ${item.body}`) ? "Experiment language is present." : "No experiment signal.",
      clarify: latestRun?.decision?.clarifyingQuestions?.length ? "The router identified unresolved questions." : "No unresolved questions were detected.",
      decompose: item.type === "initiative" ? "The item is an initiative and may require decomposition." : "The item is not classified as an initiative.",
    };
    const routeCandidates = ["develop", "design", "prototype", "clarify", "decompose"].map((path, index) => ({
      path,
      selected: path === selectedPath,
      score: path === selectedPath
        ? latestRun?.decision?.confidence ?? null
        : Math.max(0, Number(((latestRun?.decision?.confidence ?? 0.5) - 0.12 - index * 0.04).toFixed(2))),
      reason: path === selectedPath
        ? latestRun?.decision?.rationale ?? routeSignals[path]
        : routeSignals[path],
    }));
    const nextAction = attention.some((row) => row.kind === "execution_approval")
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
    return {
      ok: true,
      status: 200,
      body: {
        workItem: workItemView(item, actor),
        observability: {
          executionChainId: item.id,
          nextAction,
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
          } : null,
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
    const extractedCriteria = extractAcceptanceCriteriaFromBody(body);
    const acceptanceCriteria = extractedCriteria.length ? extractedCriteria : [
      `The requested outcome for “${title}” is demonstrably complete.`,
      "Automated verification covers the primary success path.",
      ...(type === "bug" ? ["A regression test reproduces the prior failure and passes after the fix."] : []),
    ];
    return {
      ok: true, status: 200, body: {
        draft: {
          title, body: body || `Implement ${title} with a user-visible result and documented verification.`,
          type, priority: /urgent|critical|p0|紧急|严重/.test(lower) ? "p0" : "p2",
          acceptanceCriteria,
          verificationSop: defaultVerificationSop({ title, body }),
          executionContractSource: extractedCriteria.length ? "body_extracted" : "assisted",
          suggestedRoute: type === "initiative" ? "decompose" : body.length < 40 ? "clarify" : "develop",
          risks: [
            ...(!body ? ["The problem statement needs more context."] : []),
            "Confirm affected users and rollback expectations before execution.",
          ],
          evidence: {
            generator: "heuristic",
            policyVersion: "local-work-item-draft-v1",
            modelVersion: null,
            inputDigest: createHash("sha256").update(JSON.stringify({ projectId, title, body })).digest("hex"),
            confidence: body.length >= 120 ? 0.78 : body.length >= 40 ? 0.65 : 0.45,
          },
        },
      },
    };
  }

  function prepareExecutionContract({ workItemId, expectedRevision, confirm = true, draftOverride = null } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const currentGate = executionContractDefinitionGate(item);
    if (currentGate.ready && confirm) {
      return { ok: true, status: 200, body: { workItem: workItemView(item, actor), replayed: true } };
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
    const workItem = {
      id: nextId("lwi"),
      localNumber,
      localRef: `LOCAL-${localNumber}`,
      ownerTeamId: teamId,
      projectId,
      terminalId: localTerminalId(),
      ...validated.value,
      dependencyIds: [],
      parentId,
      createIdempotencyKey: idempotencyKey,
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
        ...(workItem.routineDefinitionId ? {
          routineDefinitionId: workItem.routineDefinitionId,
          routineVersion: workItem.routineVersion,
          businessCaseId: workItem.businessCaseId,
        } : {}),
      });
      applyPlanningAutomation(workItem, actor);
      appendEvent({
        invocationId: null,
        type: "work_item_created",
        level: "info",
        message: `${workItem.localRef} created.`,
        data: {
          workItemId: workItem.id, localRef: workItem.localRef, projectId,
          terminalId: workItem.terminalId, actorTeamId: teamId,
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

  function updateWorkItem({ workItemId, expectedRevision, ...changes } = {}, actor = null) {
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
    if (Object.hasOwn(changes, "routineBinding")
      || ROUTINE_BINDING_FIELDS.some((field) => Object.hasOwn(changes, field))) {
      return { ok: false, status: 409, body: { error: "work_item_routine_binding_immutable" } };
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
    const timestamp = now();
    const contractInputChanged = Object.hasOwn(changes, "acceptanceCriteria")
      || Object.hasOwn(changes, "verificationSop")
      || (Object.hasOwn(changes, "body") && !(item.acceptanceCriteria ?? []).length);
    if (contractInputChanged) {
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
    if (validated.value.status === "done") {
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
    if (Object.hasOwn(validated.value, "plannedDate")) {
      nextValues.schedulePlanSource = validated.value.plannedDate ? "manual" : null;
      nextValues.scheduleReason = validated.value.plannedDate ? "manual_schedule" : null;
    }
    if (Object.hasOwn(validated.value, "status") && validated.value.status !== item.status) {
      nextValues.completedAt = validated.value.status === "done" ? timestamp : null;
    }
    const previous = Object.fromEntries(Object.keys(nextValues).map((key) => [key, item[key] ?? null]));
    runTx(() => {
      Object.assign(item, nextValues, {
        revision: item.revision + 1,
        updatedAt: timestamp,
        lastModifiedBy: actorUser(actor),
      });
      if (validated.value.acceptanceCriteria) {
        item.acceptanceResults = (item.acceptanceResults ?? [])
          .filter((result) => validated.value.acceptanceCriteria.includes(result.criterion));
      }
      recordActivity(item, actor, "updated", {
        changes: Object.fromEntries(Object.entries(nextValues).map(([key, value]) => [
          key, { from: previous[key], to: value },
        ])),
        ...(followUpContextChanged ? { followUpContextChanged: true } : {}),
      });
      applyPlanningAutomation(item, actor);
      appendEvent({
        invocationId: null,
        type: "work_item_updated",
        level: "info",
        message: `${item.localRef} updated.`,
        data: { workItemId: item.id, revision: item.revision, actorTeamId: actorTeam(actor) },
      });
    });
    notifyWorkItemChanged(item, actor, "updated");
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor) } };
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
    let activity;
    runTx(() => {
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
    const normalizedOutput = outputAsset == null ? null : normalizeAssetRefs([outputAsset])?.[0] ?? null;
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

  function beginExecution({
    workItemId, kind, agentId = null,
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!["worktree", "auto_run"].includes(kind)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_execution_kind" } };
    }
    if (item.state !== "open" || item.archivedAt) {
      return { ok: false, status: 409, body: { error: "work_item_execution_not_open" } };
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
    if (!["worktree", "auto_run", "article_import", "article_derivative"].includes(kind) || !targetId) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_execution_binding" } };
    }
    if (operationId != null
      && (item.executionOperation?.id !== String(operationId) || item.executionOperation.kind !== kind)) {
      return { ok: false, status: 409, body: { error: "work_item_execution_operation_conflict" } };
    }
    const binding = {
      kind,
      targetId: String(targetId),
      worktreeId: worktreeId ? String(worktreeId) : null,
      terminalId: item.terminalId,
      createdAt: now(),
    };
    runTx(() => {
      item.executionBindings = [...(item.executionBindings ?? []), binding];
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

  return {
    listWorkItems, getHomeWorkbench, listAttention, getWorkItem, createWorkItem, createWorkItemFromExternal, updateWorkItem, recordWorkItemProgress, bulkUpdateWorkItems, transitionWorkItem,
    listReportDrafts: reportDraftService.list,
    getReportDraft: reportDraftService.get,
    generateReportDraft: reportDraftService.generate,
    updateReportDraft: reportDraftService.update,
    confirmReportDraft: reportDraftService.confirm,
    discardReportDraft: reportDraftService.discard,
    listActivity, listComments, createComment, updateComment, deleteComment,
    beginExecution, abortExecution, recordExecutionBinding,
    beginDelivery, failDelivery, completeDelivery,
    claimWorkItem, releaseWorkItemClaim, assignWorkItemToSelf,
    bindGithubIssue, syncGithubIssue, bindExternalIssue, syncExternalIssue, listExternalProviders, getExternalIssueFunnel,
    recordVerification, recordAssetOperation, ingestGithubWebhook, replayGithubWebhook, recordGithubWebhookFailure,
    ingestExternalWebhook, replayExternalWebhook, recordExternalWebhookFailure,
    githubSyncDiagnostics, updateAttention, sweepOperationalAlerts, suggestWorkItemDraft, prepareExecutionContract, retryWorkItemAlert,
    startApplicationExecution, requestApplicationExecutionApproval,
    applyLocalSchedulePlan,
    applyLocalScheduleRollover,
    applyLocalScheduleUrgent,
    addMaterials,
    removeMaterial,
    restoreMaterial,
  };
}
