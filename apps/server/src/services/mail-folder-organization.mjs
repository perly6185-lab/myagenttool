import { createHash } from "node:crypto";

import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { listDevices } from "../runtime/device.mjs";

export const MAIL_ORGANIZE_ACTION = "mail.organize";
export const MAIL_ORGANIZE_AUTOMATION_ACTION = "mail.organize.auto";
const MAX_JOBS_PER_TEAM = 200;
const MAX_AUTOMATIONS_PER_TEAM = 100;

export function isMailOrganizationEnabled() {
  return process.env.MYAGENTTOOL_MAIL_ORGANIZE_MANUAL_ENABLED === "1"
    || process.env.MYAGENTTOOL_MAIL_ORGANIZE_ENABLED === "1";
}

export function isMailAutomaticOrganizationEnabled(accountId = null) {
  if (process.env.MYAGENTTOOL_MAIL_CLASSIFICATION_ENABLED === "0" || !isMailOrganizationEnabled()) return false;
  if (process.env.MYAGENTTOOL_MAIL_ORGANIZE_AUTO_ENABLED !== "1") return false;
  const allowlist = String(process.env.MYAGENTTOOL_MAIL_ORGANIZE_AUTO_ACCOUNTS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  return !allowlist.length || (accountId != null && allowlist.includes(String(accountId)));
}

export function createMailFolderOrganizationService({
  state, now, nextId, appendEvent, folderSuggestionService, qualitySummary = null,
  persistStateSoon = () => {}, store,
  enabled = isMailOrganizationEnabled,
  automaticEnabled = isMailAutomaticOrganizationEnabled,
  validateApprovalToken = null,
  createInvocation = null,
  startInvocationIfAllowed = null,
  findAgent = null,
  findApplication = null,
} = {}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  state.mailFolderMoveJobs ??= [];
  state.mailFolderMoveDeduplication ??= [];
  state.mailFolderAutomations ??= [];
  recoverInterruptedJobs();

  function recoverInterruptedJobs() {
    const interrupted = state.mailFolderMoveJobs.filter((job) => job.status === "moving");
    if (!interrupted.length) return;
    runTx(() => {
      for (const job of interrupted) {
        job.status = "unconfirmed";
        job.error = "interrupted_on_restart";
        job.conflictType = "interrupted";
        job.updatedAt = now();
        job.completedAt = job.updatedAt;
        job.revision = Number(job.revision ?? 0) + 1;
        for (const item of job.items ?? []) item.status = "unknown";
        const preview = state.mailFolderMovePreviews?.find((item) => item.id === job.previewId);
        if (preview) { preview.status = "unconfirmed"; preview.revision = Number(preview.revision ?? 0) + 1; }
        pauseAutomationAfterUnconfirmed(job, "interrupted");
      }
    });
  }

  function start({ previewId, approvalToken, messages = [], folders = [], actor = null } = {}) {
    if (!enabled()) return failure(403, "mail_organization_disabled");
    const prepared = folderSuggestionService?.prepareExecution({ previewId, messages, folders, actor, allowedPurposes: ["manual", "recovery"] });
    if (!prepared?.ok) return preparedFailure(prepared);
    if (typeof validateApprovalToken !== "function") return failure(409, "approval_required", { reason: "approval_validator_unavailable" });
    const approval = validateApprovalToken(approvalToken, { action: MAIL_ORGANIZE_ACTION, targetId: prepared.execution.approvalTarget, actor, allowLegacy: false });
    if (!approval.approved) return failure(409, "approval_required", { reason: approval.reason ?? "grant_required" });
    return dispatch({ prepared, actor, mode: prepared.preview.purpose === "recovery" ? "recovery" : "manual", authorizationId: approval.grantId ?? null });
  }

  function enableAutomation({ previewId, approvalToken, confirmed = false, messages = [], folders = [], actor = null } = {}) {
    if (confirmed !== true) return failure(400, "mail_folder_automation_confirmation_required");
    const prepared = folderSuggestionService?.prepareExecution({ previewId, messages, folders, actor, allowedPurposes: ["automatic"] });
    if (!prepared?.ok) return preparedFailure(prepared);
    if (!automaticEnabled(prepared.execution.accountId)) return failure(403, "mail_folder_automation_disabled");
    const quality = automationQuality(messages, actor);
    if (!quality.ok) return failure(409, "mail_folder_automation_quality_gate", { quality: quality.public });
    if (typeof validateApprovalToken !== "function") return failure(409, "approval_required", { reason: "approval_validator_unavailable" });
    const approval = validateApprovalToken(approvalToken, { action: MAIL_ORGANIZE_AUTOMATION_ACTION, targetId: prepared.execution.approvalTarget, actor, allowLegacy: false });
    if (!approval.approved) return failure(409, "approval_required", { reason: approval.reason ?? "grant_required" });
    const timestamp = now();
    const teamId = actor?.teamId ?? "team_local";
    const existing = state.mailFolderAutomations.find((item) => item.ownerTeamId === teamId && item.classificationRuleId === prepared.preview.classificationRuleId && item.status !== "revoked");
    const automation = existing ?? {
      id: nextId("mailfolderauto"), ownerTeamId: teamId,
      classificationRuleId: prepared.preview.classificationRuleId,
      createdAt: timestamp, lastRunAt: null, lastJobId: null,
      lastSuccessfulAt: null, consecutiveSuccessfulBatches: 0, lastCheckedAt: null,
    };
    Object.assign(automation, {
      accountId: prepared.execution.accountId,
      classificationRuleRevision: prepared.preview.classificationRuleRevision,
      suggestionId: prepared.preview.suggestionId,
      destination: prepared.execution.destination,
      status: "active", pauseReason: null,
      batchSize: 10, authorizationGrantId: approval.grantId ?? null,
      enabledBy: actor?.userId ?? null, enabledAt: timestamp,
      updatedAt: timestamp, revision: Number(automation.revision ?? 0) + 1,
    });
    runTx(() => {
      if (!existing) state.mailFolderAutomations.unshift(automation);
      capTeamRows(state.mailFolderAutomations, teamId, MAX_AUTOMATIONS_PER_TEAM);
      prepared.preview.status = "automation_enabled";
      prepared.preview.revision += 1;
      appendEvent?.({ invocationId: null, type: "mail_folder_automation_enabled", level: "info", message: `Mail folder automation ${automation.id} was explicitly enabled.`, data: { automationId: automation.id, accountId: automation.accountId, classificationRuleId: automation.classificationRuleId, grantId: automation.authorizationGrantId } });
    });
    return { ok: true, status: existing ? 200 : 201, body: { automation: publicAutomationForRuntime(automation) } };
  }

  function updateAutomation({ automationId, expectedRevision, action, messages = [], actor = null } = {}) {
    const automation = findAutomation(automationId, actor);
    if (!automation) return failure(404, "mail_folder_automation_not_found");
    if (!Number.isInteger(expectedRevision) || expectedRevision !== automation.revision) return failure(409, "mail_folder_automation_revision_conflict", { automation: publicAutomationForRuntime(automation) });
    if (!["pause", "resume", "revoke"].includes(action)) return failure(400, "mail_folder_automation_action_invalid");
    if (action === "resume") {
      if (!automaticEnabled(automation.accountId)) return failure(403, "mail_folder_automation_disabled", { automation: publicAutomationForRuntime(automation) });
      const quality = automationQuality(messages, actor);
      if (!quality.ok) return failure(409, "mail_folder_automation_quality_gate", { quality: quality.public });
      if (automation.pauseReason && automation.pauseReason !== "user_paused") return failure(409, "mail_folder_automation_reauthorization_required");
    }
    runTx(() => {
      automation.status = action === "pause" ? "paused" : action === "resume" ? "active" : "revoked";
      automation.pauseReason = action === "pause" ? "user_paused" : null;
      automation.updatedAt = now();
      automation.revision += 1;
      appendEvent?.({ invocationId: null, type: `mail_folder_automation_${action}d`, level: "info", message: `Mail folder automation ${automation.id} was ${action}d.`, data: { automationId: automation.id, accountId: automation.accountId } });
    });
    return { ok: true, status: 200, body: { automation: publicAutomationForRuntime(automation) } };
  }

  function listAutomations({ actor = null } = {}) {
    const teamId = actor?.teamId ?? "team_local";
    return { ok: true, status: 200, body: { automations: state.mailFolderAutomations.filter((item) => item.ownerTeamId === teamId).slice(0, 100).map(publicAutomationForRuntime) } };
  }

  function runAutomations({ messages = [], folders = [], actor = null, accountId = null, triggerId = null } = {}) {
    const teamId = actor?.teamId ?? "team_local";
    const quality = automationQuality(messages, actor);
    const active = state.mailFolderAutomations.filter((item) => item.ownerTeamId === teamId
      && item.status === "active"
      && (accountId == null || item.accountId === accountId)
      && automaticEnabled(item.accountId));
    if (!active.length) return { ok: true, status: 200, body: { started: 0, skipped: "disabled_or_no_active_rules" } };
    if (!quality.ok) {
      runTx(() => {
        for (const automation of active) pauseAutomation(automation, "quality_gate");
      });
      return { ok: true, status: 200, body: { started: 0, skipped: "quality_gate" } };
    }
    const started = [];
    let busyAccounts = 0;
    for (const automation of active.slice(0, 10)) {
      if (state.mailFolderMoveJobs.some((job) => job.ownerTeamId === teamId && job.accountId === automation.accountId && job.status === "moving")) {
        busyAccounts += 1;
        continue;
      }
      const scopeKey = automationDeduplicationScope(automation);
      const excludedMessageKeys = new Set(state.mailFolderMoveDeduplication
        .filter((item) => item.ownerTeamId === teamId && item.automationId === automation.id && item.scopeKey === scopeKey)
        .map((item) => item.messageKey));
      const preview = folderSuggestionService?.createAutomaticPreview({
        suggestionId: automation.suggestionId,
        destinationFolderId: automation.destination?.kind === "existing" ? automation.destination.folderId : null,
        messages, folders, actor, excludedMessageKeys,
      });
      if (preview?.status === 404 || preview?.body?.error === "mail_folder_preview_has_no_recoverable_messages") continue;
      if (preview?.status >= 400) {
        runTx(() => pauseAutomation(automation, "rule_or_destination_conflict"));
        continue;
      }
      const prepared = folderSuggestionService.prepareExecution({ previewId: preview.body.preview.id, messages, folders, actor, allowedPurposes: ["automatic"] });
      if (!prepared?.ok || prepared.preview.classificationRuleId !== automation.classificationRuleId || prepared.preview.classificationRuleRevision !== automation.classificationRuleRevision) {
        runTx(() => pauseAutomation(automation, "rule_revision_conflict"));
        continue;
      }
      const operationKey = automationOperationKey(automation, prepared);
      const replay = state.mailFolderMoveJobs.find((job) => job.ownerTeamId === teamId && job.mode === "automatic" && job.operationKey === operationKey);
      if (replay) continue;
      const result = dispatch({ prepared, actor, mode: "automatic", authorizationId: automation.id, automation, operationKey, triggerId, dedupeScope: scopeKey });
      if (result.ok && result.status === 202) started.push(result.body.job);
    }
    return {
      ok: true,
      status: started.length ? 202 : 200,
      body: { started: started.length, jobs: started, ...(busyAccounts && !started.length ? { skipped: "account_busy" } : {}) },
    };
  }

  function dryRunAutomation({ automationId, messages = [], folders = [], actor = null } = {}) {
    const automation = findAutomation(automationId, actor);
    if (!automation) return failure(404, "mail_folder_automation_not_found");
    if (automation.status === "revoked") return failure(409, "mail_folder_automation_revoked");
    const result = folderSuggestionService?.inspectAutomaticPreview({
      suggestionId: automation.suggestionId,
      destinationFolderId: automation.destination?.kind === "existing" ? automation.destination.folderId : null,
      messages, folders, actor,
    });
    if (!result || result.status >= 400) return { ok: false, status: result?.status ?? 503, body: result?.body ?? { error: "mail_folder_dry_run_unavailable" } };
    return {
      ok: true,
      status: 200,
      body: {
        dryRun: {
          automationId: automation.id,
          checkedAt: now(),
          providerCalled: false,
          successCountersChanged: false,
          ...result.body.dryRun,
        },
      },
    };
  }

  function dispatch({ prepared, actor, mode, authorizationId, automation = null, operationKey = null, triggerId = null, dedupeScope = null }) {
    const runtime = organizeRuntime(prepared, actor);
    if (!runtime.ok) return runtime;
    const { application, facade, agent, toolName } = runtime;
    if (typeof createInvocation !== "function") return failure(409, "mail_organize_dispatch_unavailable");
    const timestamp = now();
    const job = {
      id: nextId("mailfolderjob"), ownerTeamId: actor?.teamId ?? "team_local", accountId: prepared.execution.accountId,
      previewId: prepared.preview.id, suggestionId: prepared.preview.suggestionId,
      destination: prepared.execution.destination, requestedCount: prepared.execution.messages.length,
      movedCount: 0, missingCount: 0, conflictCount: 0, pendingCount: prepared.execution.messages.length, unknownCount: 0,
      items: prepared.execution.messages.map((item) => ({ ...item, status: "pending", reason: null })),
      mode, automationId: automation?.id ?? null, recoveryOfJobId: prepared.preview.recoveryOfJobId ?? null,
      operationKey, dedupeScope, triggerId: triggerId ? String(triggerId).slice(0, 200) : null,
      status: "moving", conflictType: null, revision: 1,
      authorizationId, invocationId: null, error: null,
      createdAt: timestamp, updatedAt: timestamp, completedAt: null,
    };
    const toolArguments = {
      destinationFolderPath: prepared.execution.destination.kind === "existing" ? prepared.execution.destination.folderPath : null,
      destinationName: prepared.execution.destination.kind === "new" ? prepared.execution.destinationName : null,
      messages: prepared.execution.messages.map(({ messageId, sourceFolderPath }) => ({ messageId, sourceFolderPath })),
    };
    runTx(() => {
      state.mailFolderMoveJobs.unshift(job);
      capTeamJobRows(state.mailFolderMoveJobs, job.ownerTeamId, MAX_JOBS_PER_TEAM);
      prepared.preview.status = "executing";
      prepared.preview.revision += 1;
      if (automation) {
        automation.lastRunAt = timestamp;
        automation.lastCheckedAt = timestamp;
        automation.lastJobId = job.id;
        automation.updatedAt = timestamp;
        automation.revision += 1;
      }
    });
    let invocation;
    try {
      invocation = createInvocation(`Organize ${mode} mail batch ${job.id}.`, agent, {
        actor, requestedBy: actor?.userId, toolName, toolArguments,
        metadata: { capability: `app.${application.id}.${facade.id}`, providerType: "application", applicationId: application.id, applicationAction: `agent:${agent.id}:${toolName}`, mailFolderMoveJobId: job.id, mailFolderMoveMode: mode },
        timeoutSeconds: 120,
      });
    } catch {
      return markDispatchUnconfirmed(job, prepared.preview, automation, "dispatch_exception");
    }
    job.invocationId = invocation.id;
    return runTx(() => {
      if (["rejected", "failed", "cancelled", "timed_out"].includes(invocation.status)) {
        job.status = "unconfirmed";
        job.error = `dispatch_${invocation.status}`;
        job.conflictType = "dispatch_failure";
        job.completedAt = now();
        for (const item of job.items) item.status = "unknown";
        summarizeItems(job);
      }
      prepared.preview.status = job.status === "moving" ? "executing" : "unconfirmed";
      prepared.preview.revision += 1;
      if (automation) {
        automation.updatedAt = timestamp;
        automation.revision += 1;
        if (job.status === "unconfirmed") pauseAutomation(automation, "dispatch_failure");
      }
      appendEvent?.({ invocationId: invocation.id, type: job.status === "moving" ? "mail_folder_move_dispatched" : "mail_folder_move_unconfirmed", level: job.status === "moving" ? "info" : "warn", message: `Mail folder organization job ${job.id} is ${job.status}.`, data: { jobId: job.id, previewId: job.previewId, accountId: job.accountId, requestedCount: job.requestedCount, mode, authorizationId } });
      if (job.status === "moving") startInvocationIfAllowed?.(invocation, agent);
      return { ok: job.status === "moving", status: job.status === "moving" ? 202 : 409, body: { job: publicJob(job) } };
    });
  }

  function markDispatchUnconfirmed(job, preview, automation, reason) {
    return runTx(() => {
      job.status = "unconfirmed";
      job.error = reason;
      job.conflictType = "dispatch_failure";
      job.completedAt = now();
      job.updatedAt = job.completedAt;
      job.revision += 1;
      for (const item of job.items) item.status = "unknown";
      summarizeItems(job);
      preview.status = "unconfirmed";
      preview.revision += 1;
      if (automation) pauseAutomation(automation, "dispatch_failure");
      return { ok: false, status: 409, body: { job: publicJob(job) } };
    });
  }

  function get({ jobId, actor = null } = {}) {
    const job = findJob(jobId, actor);
    return job ? { ok: true, status: 200, body: { job: publicJob(job) } } : failure(404, "mail_folder_move_job_not_found");
  }

  function list({ actor = null } = {}) {
    const teamId = actor?.teamId ?? "team_local";
    return { ok: true, status: 200, body: { jobs: state.mailFolderMoveJobs.filter((item) => item.ownerTeamId === teamId).slice(0, 50).map(publicJob) } };
  }

  function recordResult({ invocation, result }) {
    const jobId = invocation?.options?.metadata?.mailFolderMoveJobId;
    if (!jobId) return null;
    const job = state.mailFolderMoveJobs.find((item) => item.id === jobId);
    if (!job || job.status !== "moving") return null;
    return runTx(() => {
      const receipt = result?.output?.organization;
      const movedIds = new Set(Array.isArray(receipt?.moved) ? receipt.moved.map(String) : []);
      const missingIds = new Set(Array.isArray(receipt?.missing) ? receipt.missing.map(String) : []);
      const conflicts = new Map((Array.isArray(receipt?.conflicts) ? receipt.conflicts : []).map((item) => [String(item?.messageId ?? ""), String(item?.reason ?? "provider_conflict").slice(0, 80)]));
      for (const item of job.items ?? []) {
        if (movedIds.has(item.messageId)) { item.status = "moved"; item.reason = null; }
        else if (missingIds.has(item.messageId)) { item.status = "missing"; item.reason = "not_found_in_source"; }
        else if (conflicts.has(item.messageId)) { item.status = "conflict"; item.reason = conflicts.get(item.messageId); }
        else { item.status = "unknown"; item.reason = "receipt_missing"; }
      }
      summarizeItems(job);
      job.updatedAt = now();
      job.completedAt = job.updatedAt;
      job.revision += 1;
      if (invocation.status === "succeeded" && receipt?.requestedCount === job.requestedCount && job.movedCount === job.requestedCount && job.missingCount === 0 && job.conflictCount === 0) {
        job.status = "succeeded";
        job.destination = { ...job.destination, folderPath: receipt.destinationFolderPath ?? job.destination.folderPath, name: job.destination.name ?? receipt.destinationFolderPath ?? null };
        rememberMovedMessages(job);
        const automation = job.automationId ? state.mailFolderAutomations.find((item) => item.id === job.automationId) : null;
        if (automation) {
          automation.lastSuccessfulAt = job.completedAt;
          automation.lastCheckedAt = job.completedAt;
          automation.consecutiveSuccessfulBatches = Number(automation.consecutiveSuccessfulBatches ?? 0) + 1;
          automation.updatedAt = job.completedAt;
          automation.revision += 1;
        }
      } else {
        job.status = "unconfirmed";
        job.conflictType = job.conflictCount ? "provider_conflict" : job.missingCount ? "message_missing" : invocation.status === "succeeded" ? "partial_receipt" : "provider_failure";
        job.error = invocation.status === "succeeded" ? "partial_or_missing_receipt" : `invocation_${invocation.status ?? "unknown"}`;
        pauseAutomationAfterUnconfirmed(job, job.conflictType);
      }
      const preview = state.mailFolderMovePreviews?.find((item) => item.id === job.previewId);
      if (preview) { preview.status = job.status; preview.revision += 1; }
      appendEvent?.({ invocationId: invocation.id, type: job.status === "succeeded" ? "mail_folder_move_completed" : "mail_folder_move_unconfirmed", level: job.status === "succeeded" ? "info" : "warn", message: `Mail folder organization job ${job.id} ${job.status}.`, data: { jobId: job.id, previewId: job.previewId, requestedCount: job.requestedCount, movedCount: job.movedCount, missingCount: job.missingCount, conflictCount: job.conflictCount, mode: job.mode } });
      return job;
    });
  }

  function reconcile({ jobId, messages = [], actor = null } = {}) {
    const job = findJob(jobId, actor);
    if (!job) return failure(404, "mail_folder_move_job_not_found");
    if (!job.items?.length) return failure(409, "mail_folder_move_job_not_reconcilable");
    if (!["unconfirmed", "conflict", "recoverable"].includes(job.status)) return failure(409, "mail_folder_move_job_not_reconcilable");
    const destinationPath = String(job.destination?.folderPath ?? "").toLowerCase();
    const destinationId = String(job.destination?.folderId ?? "");
    const byId = new Map(messages.map((message) => [String(message.messageId ?? ""), message]));
    runTx(() => {
      for (const item of job.items) {
        const message = byId.get(item.messageId);
        const folderPath = String(message?.folderPath ?? "").toLowerCase();
        const folderId = String(message?.folderId ?? "");
        if (message && ((destinationPath && folderPath === destinationPath) || (destinationId && folderId === destinationId))) {
          item.status = "moved"; item.reason = null;
        } else if (message && folderPath === String(item.sourceFolderPath ?? "").toLowerCase()) {
          item.status = "pending"; item.reason = "still_in_source";
        } else if (message) {
          item.status = "conflict"; item.reason = "moved_to_different_folder";
        } else {
          item.status = "unknown"; item.reason = "not_visible_after_sync";
        }
      }
      summarizeItems(job);
      job.status = job.movedCount === job.requestedCount ? "succeeded" : job.conflictCount || job.unknownCount ? "conflict" : job.pendingCount ? "recoverable" : "conflict";
      job.conflictType = job.status === "recoverable" ? null : job.status === "succeeded" ? null : "state_conflict";
      job.error = job.status === "recoverable" ? "remaining_messages_ready_for_new_preview" : job.status === "conflict" ? "manual_review_required" : null;
      job.updatedAt = now();
      job.completedAt = job.updatedAt;
      job.revision += 1;
      if (job.automationId) {
        const automation = state.mailFolderAutomations.find((item) => item.id === job.automationId);
        if (automation) automation.lastCheckedAt = job.updatedAt;
        rememberMovedMessages(job);
      }
      appendEvent?.({ invocationId: job.invocationId, type: "mail_folder_move_reconciled", level: job.status === "conflict" ? "warn" : "info", message: `Mail folder organization job ${job.id} was reconciled after sync.`, data: { jobId: job.id, status: job.status, movedCount: job.movedCount, pendingCount: job.pendingCount, conflictCount: job.conflictCount, unknownCount: job.unknownCount } });
    });
    return { ok: true, status: 200, body: { job: publicJob(job) } };
  }

  function createRecoveryPreview({ jobId, messages = [], folders = [], actor = null } = {}) {
    const job = findJob(jobId, actor);
    if (!job) return failure(404, "mail_folder_move_job_not_found");
    if (job.status !== "recoverable" || !job.pendingCount) return failure(409, "mail_folder_move_job_not_recoverable");
    const result = folderSuggestionService?.createRecoveryPreview({ job, messages, folders, actor });
    return { ok: Boolean(result && result.status < 400), ...result };
  }

  function reconcileTermination(invocation) {
    const jobId = invocation?.options?.metadata?.mailFolderMoveJobId;
    if (!jobId) return null;
    const job = state.mailFolderMoveJobs.find((item) => item.id === jobId);
    if (!job || job.status !== "moving") return null;
    return recordResult({ invocation, result: null });
  }

  function automationQuality(messages, actor) {
    const quality = typeof qualitySummary === "function" ? qualitySummary(messages, actor) : null;
    const ok = quality?.status === "healthy" && quality?.organization?.status === "healthy";
    return { ok, public: quality ? { status: quality.status, sampleSize: quality.sampleSize, organization: quality.organization, signals: quality.signals } : null };
  }

  function organizeRuntime(prepared, actor) {
    const teamId = actor?.teamId ?? "team_local";
    const provider = providerForAccount(state.applications ?? [], prepared.execution.accountId, teamId);
    const application = findOrganizeApplication(state.applications ?? [], provider, teamId, findApplication);
    if (!application) return failure(409, "mail_organize_application_not_available");
    if (application.credentialReadiness?.status !== "authorized" && !credentialPresent(state, application)) return failure(409, "mail_organize_credential_not_ready");
    const facade = application.capabilityFacades?.find((item) => (item.agentToolName ?? item.toolName) === "mail_organize_batch" && item.agentId) ?? null;
    const agent = facade && typeof findAgent === "function" ? findAgent(facade.agentId) : null;
    if (!facade || !agent || agent.status === "disabled") return failure(409, "mail_organize_agent_not_available");
    const toolName = facade.agentToolName ?? "mail_organize_batch";
    const allowedTools = Array.isArray(agent.adapter?.allowedTools) ? agent.adapter.allowedTools : [];
    if (allowedTools.length && !allowedTools.includes(toolName)) return failure(409, "mail_organize_tool_not_allowlisted");
    return { ok: true, application, facade, agent, toolName };
  }

  function pauseAutomationAfterUnconfirmed(job, reason) {
    if (!job.automationId) return;
    const automation = state.mailFolderAutomations.find((item) => item.id === job.automationId);
    if (automation) pauseAutomation(automation, reason);
  }

  function pauseAutomation(automation, reason) {
    automation.status = "paused";
    automation.pauseReason = reason;
    automation.consecutiveSuccessfulBatches = 0;
    automation.lastCheckedAt = now();
    automation.updatedAt = now();
    automation.revision = Number(automation.revision ?? 0) + 1;
  }

  function rememberMovedMessages(job) {
    if (job.mode !== "automatic" || !job.automationId || !job.dedupeScope) return;
    for (const item of job.items ?? []) {
      if (item.status !== "moved" || !item.messageKey) continue;
      const exists = state.mailFolderMoveDeduplication.some((row) => row.ownerTeamId === job.ownerTeamId
        && row.automationId === job.automationId && row.scopeKey === job.dedupeScope && row.messageKey === item.messageKey);
      if (!exists) state.mailFolderMoveDeduplication.push({
        ownerTeamId: job.ownerTeamId,
        accountId: job.accountId,
        automationId: job.automationId,
        scopeKey: job.dedupeScope,
        messageKey: item.messageKey,
        jobId: job.id,
        recordedAt: job.completedAt ?? now(),
      });
    }
  }

  function publicAutomationForRuntime(value) {
    return publicAutomation(value, { rolloutEnabled: automaticEnabled(value.accountId) });
  }

  function findJob(jobId, actor) {
    return state.mailFolderMoveJobs.find((item) => item.id === String(jobId ?? "") && item.ownerTeamId === (actor?.teamId ?? "team_local"));
  }

  function findAutomation(automationId, actor) {
    return state.mailFolderAutomations.find((item) => item.id === String(automationId ?? "") && item.ownerTeamId === (actor?.teamId ?? "team_local"));
  }

  return {
    start, get, list, recordResult, reconcileTermination, reconcile, createRecoveryPreview,
    enableAutomation, updateAutomation, listAutomations, runAutomations, dryRunAutomation,
  };
}

function providerForAccount(applications, accountId, teamId) {
  const app = applications.find((item) => item.id === accountId && (item.ownerTeamId ?? "team_local") === teamId);
  return String(app?.source?.credential?.provider ?? app?.provider ?? "").toLowerCase();
}

function findOrganizeApplication(applications, provider, teamId, findApplication) {
  const selected = applications.find((application) => !application.successorApplicationId
    && provider
    && (application.ownerTeamId ?? "team_local") === teamId
    && ["registered", "active"].includes(application.status)
    && String(application.source?.credential?.provider ?? "").toLowerCase() === provider
    && application.capabilityFacades?.some((facade) => (facade.agentToolName ?? facade.toolName) === "mail_organize_batch"));
  return selected && typeof findApplication === "function" ? findApplication(selected.id) : selected ?? null;
}

function publicJob(job) {
  return {
    id: job.id, accountId: job.accountId, previewId: job.previewId, destination: job.destination,
    requestedCount: job.requestedCount, movedCount: job.movedCount, missingCount: job.missingCount,
    conflictCount: Number(job.conflictCount ?? 0), pendingCount: Number(job.pendingCount ?? 0), unknownCount: Number(job.unknownCount ?? 0),
    mode: job.mode ?? "manual", automationId: job.automationId ?? null, recoveryOfJobId: job.recoveryOfJobId ?? null,
    status: job.status, conflictType: job.conflictType ?? null, revision: job.revision, error: job.error,
    items: (job.items ?? []).map((item) => ({ messageId: item.messageId, sourceFolderPath: item.sourceFolderPath, status: item.status, reason: item.reason ?? null })),
    createdAt: job.createdAt, updatedAt: job.updatedAt, completedAt: job.completedAt,
  };
}

function publicAutomation(value, { rolloutEnabled = true } = {}) {
  const rolloutPaused = value.status !== "revoked" && !rolloutEnabled;
  const effective = rolloutPaused ? { ...value, status: "paused", pauseReason: "rollout_disabled" } : value;
  return {
    id: effective.id, accountId: effective.accountId, classificationRuleId: effective.classificationRuleId,
    classificationRuleRevision: effective.classificationRuleRevision, suggestionId: effective.suggestionId,
    destination: effective.destination, status: effective.status, pauseReason: effective.pauseReason,
    batchSize: value.batchSize, revision: value.revision, enabledAt: value.enabledAt,
    lastRunAt: value.lastRunAt, lastJobId: value.lastJobId,
    lastSuccessfulAt: value.lastSuccessfulAt ?? null,
    consecutiveSuccessfulBatches: Number(value.consecutiveSuccessfulBatches ?? 0),
    lastCheckedAt: value.lastCheckedAt ?? null,
    nextAction: automationNextAction(effective),
    createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
}

function automationDeduplicationScope(automation) {
  return createHash("sha256").update(JSON.stringify({
    ownerTeamId: automation.ownerTeamId,
    accountId: automation.accountId,
    automationId: automation.id,
    classificationRuleRevision: automation.classificationRuleRevision,
    destination: automation.destination,
  })).digest("hex");
}

function automationOperationKey(automation, prepared) {
  return createHash("sha256").update(JSON.stringify({
    ownerTeamId: automation.ownerTeamId,
    accountId: automation.accountId,
    automationId: automation.id,
    classificationRuleRevision: prepared.preview.classificationRuleRevision,
    destination: prepared.execution.destination,
    messageKeys: prepared.execution.messages.map((item) => item.messageKey).sort(),
  })).digest("hex");
}

function automationNextAction(value) {
  if (value.status === "active") return "none";
  if (value.status === "revoked") return "create_new_authorization";
  if (value.pauseReason === "user_paused") return "resume_when_ready";
  if (["interrupted", "partial_receipt", "provider_conflict", "message_missing", "provider_failure", "dispatch_failure"].includes(value.pauseReason)) return "sync_and_review";
  if (value.pauseReason === "quality_gate") return "review_classification_quality";
  if (value.pauseReason === "rollout_disabled") return "enable_rollout";
  return "reauthorize";
}

function summarizeItems(job) {
  job.movedCount = (job.items ?? []).filter((item) => item.status === "moved").length;
  job.missingCount = (job.items ?? []).filter((item) => item.status === "missing").length;
  job.conflictCount = (job.items ?? []).filter((item) => item.status === "conflict").length;
  job.pendingCount = (job.items ?? []).filter((item) => item.status === "pending").length;
  job.unknownCount = (job.items ?? []).filter((item) => item.status === "unknown").length;
}

function credentialPresent(state, application) {
  const required = application?.source?.credential;
  if (!required) return false;
  return listDevices(state).some((device) => (device.applicationCredentialReadiness ?? []).some((row) => row.applicationId === application.id
    && row.provider === required.provider && row.scope === required.scope && ["present", "authorized"].includes(row.status)));
}

function preparedFailure(prepared) {
  return { ok: false, status: prepared?.status ?? 503, body: prepared?.body ?? { error: "mail_folder_preview_unavailable" } };
}

function failure(status, error, extra = {}) {
  return { ok: false, status, body: { error, ...extra } };
}

function capTeamRows(rows, teamId, max) {
  const own = rows.filter((row) => row.ownerTeamId === teamId).slice(0, max);
  const other = rows.filter((row) => row.ownerTeamId !== teamId);
  rows.splice(0, rows.length, ...own, ...other);
}

function capTeamJobRows(rows, teamId, maxTerminal) {
  const own = rows.filter((row) => row.ownerTeamId === teamId);
  const protectedRows = own.filter((row) => ["moving", "unconfirmed", "recoverable", "conflict"].includes(row.status));
  const terminalRows = own.filter((row) => !protectedRows.includes(row)).slice(0, maxTerminal);
  const keep = new Set([...protectedRows, ...terminalRows]);
  rows.splice(0, rows.length, ...rows.filter((row) => row.ownerTeamId !== teamId || keep.has(row)));
}
