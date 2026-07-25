/*
 * Local-first work items. These records deliberately live beside, rather than
 * inside, repository Projects: a repository is an execution boundary while a
 * work item is planning data that may later bind to GitHub or another tracker.
 */

import { createHash } from "node:crypto";
import { actorCanAccessProject, LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { listDevices } from "../runtime/device.mjs";
import { backfillTerminalOwnership } from "../runtime/terminal-ownership.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { normalizedUpdatedSince, paginateRows } from "./cursor-pagination.mjs";
import { externalIssueProviderReadiness } from "./external-issue-provider.mjs";
import { ASSET_CAPABILITY_VERBS, evaluateAssetRequirements } from "./asset-capabilities.mjs";
import { createApplicationExecutionContract } from "./application-execution-contract.mjs";

const TYPES = new Set(["task", "bug", "feature", "initiative"]);
const STATUSES = new Set(["backlog", "ready", "in_progress", "review", "blocked", "done"]);
const PRIORITIES = new Set(["p0", "p1", "p2", "p3"]);
const MAX_TITLE = 300;
const MAX_BODY = 200_000;
const MAX_LABELS = 50;
const MAX_COMMENT = 100_000;
const MAX_MILESTONE = 200;
const GITHUB_SYNC_FIELDS = ["title", "body", "state", "labels", "milestone", "assigneeIds"];
const VERIFICATION_KINDS = new Set(["test", "lint", "typecheck", "manual", "review"]);
const VERIFICATION_STATUSES = new Set(["passed", "failed"]);

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

function validateDraft(input, { partial = false } = {}) {
  const value = {};
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
  ]) {
    if (!partial || Object.hasOwn(input, field)) {
      const candidate = String(input[field] ?? fallback);
      if (!allowed.has(candidate)) return { error: `invalid_work_item_${field}` };
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
  if (!partial || Object.hasOwn(input, "dueDate")) {
    const dueDate = input.dueDate == null || input.dueDate === "" ? null : String(input.dueDate);
    if (dueDate && !validDateOnly(dueDate)) return { error: "invalid_work_item_due_date" };
    value.dueDate = dueDate;
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
      path,
      family: String(candidate.family ?? "unknown").slice(0, 40),
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
  store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  const actorTeam = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const actorUser = (actor) => actor?.userId ?? LOCAL_USER_ID;
  const localTerminalId = () => listDevices(state)[0]?.id ?? null;
  const localAssetResourceClasses = (terminalId) => {
    const device = (state.devices ?? []).find((candidate) => candidate.id === terminalId);
    return Array.isArray(device?.assetResourceClasses) ? device.assetResourceClasses : ["small", "medium"];
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
    const latestBinding = [...(item.executionBindings ?? [])]
      .reverse()
      .find((binding) => binding.kind === "auto_run");
    const run = latestBinding
      ? (state.autoRuns ?? []).find((candidate) => candidate.id === latestBinding.targetId)
      : null;
    if (run) {
      if (["materializing", "running", "publishing"].includes(run.status)) return "running";
      if (["awaiting_approval", "needs_input"].includes(run.status)) return "awaiting_approval";
      if (["verifying", "pr_open", "report_posted", "plan_proposed"].includes(run.status)) return "verifying";
      if (["blocked", "failed"].includes(run.status)) return "failed";
      if (["done", "decomposed"].includes(run.status)) return "completed";
    }
    const claimActive = item.claim?.status === "active"
      && Date.parse(item.claim.leaseExpiresAt) > Date.parse(now());
    return claimActive ? "claimed" : "unclaimed";
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

  function workItemView(item, actor) {
    const { createIdempotencyKey: _createIdempotencyKey, ...publicItem } = item;
    const derivedExecutionState = executionState(item);
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
      completionGate: completionGate(item),
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
      .filter((item) => !query.assigneeId || item.assigneeIds.includes(query.assigneeId))
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
    const latestRun = (state.autoRuns ?? [])
      .filter((run) => runIds.has(run.id))
      .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0] ?? null;
    const invocationIds = new Set((state.autoRuns ?? [])
      .filter((run) => runIds.has(run.id) && run.invocationId)
      .map((run) => run.invocationId));
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
    const acceptanceCriteria = [
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

  function bindExternalIssue({ workItemId, expectedRevision, provider = "github", remote } = {}, actor = null) {
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
    if (externalIssueBinding(item, normalizedProvider)) {
      return { ok: false, status: 409, body: { error: "external_issue_already_bound", provider: normalizedProvider } };
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
    };
    runTx(() => {
      item.externalBindings.push(binding);
      recordActivity(item, actor, `${normalizedProvider}_linked`, { provider: normalizedProvider, number: snapshot.number, url: snapshot.url });
    });
    return { ok: true, status: 201, body: { workItem: workItemView(item, actor), binding: externalBindingView(binding) } };
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

  function createWorkItem(input = {}, actor = null) {
    const projectId = String(input.projectId ?? "");
    if (!projectId || !actorCanAccessProject(state, actor, projectId)) {
      return { ok: false, status: 404, body: { error: "project_not_found" } };
    }
    const idempotencyKey = input.idempotencyKey == null ? null : String(input.idempotencyKey).trim();
    if (idempotencyKey != null && (!idempotencyKey || idempotencyKey.length > 200)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_idempotency_key" } };
    }
    const replay = idempotencyKey ? (state.workItems ?? []).find(
      (item) => item.ownerTeamId === actorTeam(actor)
        && item.createdBy === actorUser(actor)
        && item.createIdempotencyKey === idempotencyKey,
    ) : null;
    if (replay) return { ok: true, status: 200, body: { workItem: workItemView(replay, actor), replayed: true } };
    const validated = validateDraft(input);
    if (validated.error) return { ok: false, status: 400, body: { error: validated.error } };
    const parentId = input.parentId == null || input.parentId === "" ? null : String(input.parentId);
    const parent = parentId ? findOwn(parentId, actor) : null;
    if (parentId && (!parent || parent.projectId !== projectId)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_parent" } };
    }
    const teamId = actorTeam(actor);
    const localNumber = 1 + Math.max(0, ...(state.workItems ?? [])
      .filter((item) => item.ownerTeamId === teamId)
      .map((item) => Number(item.localNumber) || 0));
    const timestamp = now();
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
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      lastModifiedBy: actorUser(actor),
      externalBindings: [],
      executionBindings: [],
    };
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
        },
      });
    });
    return { ok: true, status: 201, body: { workItem: workItemView(workItem, actor) } };
  }

  function updateWorkItem({ workItemId, expectedRevision, ...changes } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
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
    const nextInputAssets = validated.value.inputAssets ?? item.inputAssets ?? [];
    const nextOutputAssets = validated.value.outputAssets ?? item.outputAssets ?? [];
    if ([...nextInputAssets, ...nextOutputAssets].some((asset) => asset.terminalId !== item.terminalId)) {
      return { ok: false, status: 409, body: { error: "asset_terminal_mismatch", terminalId: item.terminalId } };
    }
    if (validated.value.status === "done") {
      const gate = completionGate(item);
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
    const previous = Object.fromEntries(Object.keys(validated.value).map((key) => [key, item[key]]));
    runTx(() => {
      Object.assign(item, validated.value, {
        revision: item.revision + 1,
        updatedAt: now(),
        lastModifiedBy: actorUser(actor),
      });
      if (validated.value.acceptanceCriteria) {
        item.acceptanceResults = (item.acceptanceResults ?? [])
          .filter((result) => validated.value.acceptanceCriteria.includes(result.criterion));
      }
      recordActivity(item, actor, "updated", {
        changes: Object.fromEntries(Object.entries(validated.value).map(([key, value]) => [
          key, { from: previous[key], to: value },
        ])),
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
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor) } };
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
      Object.entries(changes).filter(([key]) => ["status", "priority", "assigneeIds", "dueDate", "milestone", "estimatePoints"].includes(key)),
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
        const previous = Object.fromEntries(Object.keys(validated.value).map((key) => [key, item[key]]));
        Object.assign(item, validated.value, {
          revision: item.revision + 1,
          updatedAt: now(),
          lastModifiedBy: actorUser(actor),
        });
        recordActivity(item, actor, "bulk_updated", {
          changes: Object.fromEntries(Object.entries(validated.value).map(([key, value]) => [
            key, { from: previous[key], to: value },
          ])),
        });
      }
    });
    return {
      ok: true, status: 200,
      body: { workItems: targets.map((item) => workItemView(item, actor)), count: targets.length },
    };
  }

  function transitionWorkItem({ workItemId, expectedRevision, action } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
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
      if (action === "close") item.state = "closed";
      if (action === "reopen") item.state = "open";
      if (action === "archive") item.archivedAt = now();
      if (action === "restore") item.archivedAt = null;
      item.revision += 1;
      item.updatedAt = now();
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
    return { ok: true, status: 200, body: { workItem: item } };
  }

  function recordVerification({
    workItemId, expectedRevision, kind, status, command = null, summary = "", acceptanceResults = [], evidence = [],
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
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

  function recordExecutionBinding({ workItemId, kind, targetId, worktreeId = null } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!["worktree", "auto_run"].includes(kind) || !targetId) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_execution_binding" } };
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
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, kind === "worktree" ? "worktree_created" : "auto_run_started", binding);
    });
    return { ok: true, status: 200, body: { workItem: item, binding } };
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

  return {
    listWorkItems, listAttention, getWorkItem, createWorkItem, updateWorkItem, bulkUpdateWorkItems, transitionWorkItem,
    listActivity, listComments, createComment, updateComment, deleteComment,
    recordExecutionBinding, claimWorkItem, releaseWorkItemClaim,
    bindGithubIssue, syncGithubIssue, bindExternalIssue, syncExternalIssue, listExternalProviders,
    recordVerification, recordAssetOperation, ingestGithubWebhook, replayGithubWebhook, recordGithubWebhookFailure,
    ingestExternalWebhook, replayExternalWebhook, recordExternalWebhookFailure,
    githubSyncDiagnostics, updateAttention, sweepOperationalAlerts, suggestWorkItemDraft, retryWorkItemAlert,
    startApplicationExecution, requestApplicationExecutionApproval,
  };
}
