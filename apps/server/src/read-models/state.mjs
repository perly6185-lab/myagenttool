import { LOCAL_TEAM_ID, LOCAL_USER_ID, teamOf } from "../runtime/auth.mjs";
import { publicDeviceView } from "../runtime/bridge-auth.mjs";
import { primaryDevice } from "../runtime/device.mjs";
import { channelOperations, channelTaskOperations } from "./channels.mjs";
import { pendingDecisions } from "./pending-decisions.mjs";
import { workBoard } from "./work-board.mjs";
import { workReport, calendarPeriods } from "./work-report.mjs";
import { evidenceLedger } from "./evidence-ledger.mjs";
import { scheduleHealthReadModel } from "./schedule-health.mjs";
import { withLocalApplicationReadiness } from "../services/application-readiness.mjs";
import { deriveGuidedReadiness } from "../services/guided-readiness.mjs";
import { publicInvocationEvent } from "../services/invocation-events.mjs";
import { businessLifecycleSummaries } from "./business-lifecycle.mjs";

export const CONSOLE_STATE_MEDIA_TYPE = "application/vnd.myagenttool.console-state+json";

const CONSOLE_INVOCATION_LIMIT = 300;
const CONSOLE_ATTENTION_INVOCATION_LIMIT = 100;
const CONSOLE_RELATED_LIMITS = Object.freeze({
  events: 500,
  traces: 600,
  spans: 800,
  auditSummaries: 600,
  quotaDecisionRecords: 600,
  aiUsageRecords: 600,
  invocationRounds: 1_200,
  toolInvocationRecords: 1_200,
  approvalRequests: 600,
  policyDecisionRecords: 600,
  troubleshootingReports: 600,
  codexSessions: 600,
  claudeSessions: 600,
  codexWorkspaces: 600,
  codexEvidenceRecords: 1_000,
  codexChangeReviews: 600,
  codexExecChangeReviews: 600,
  codexHookEvents: 1_000,
  evidenceCenterRecords: 1_200,
  evidenceLedger: 500,
  refusals: 600,
});

/**
 * The canonical public state remains intentionally complete for API clients and
 * compatibility tests. The browser polls much more frequently and only renders a
 * recent working set, so it asks for this bounded projection via Accept. Keep
 * active, pending-decision, and attention runs even when they are older than the
 * normal recent window; all invocation-linked collections then follow the same
 * retained id set so a row never opens into an unrelated dossier.
 */
export function buildConsoleState(publicState) {
  const invocations = Array.isArray(publicState?.invocations) ? publicState.invocations : [];
  const recentInvocations = invocations
    .map((invocation, index) => ({ invocation, index }))
    .sort((left, right) => consoleInvocationTimestamp(right.invocation) - consoleInvocationTimestamp(left.invocation) || left.index - right.index)
    .map(({ invocation }) => invocation);
  const protectedInvocationIds = consoleProtectedInvocationIds(publicState);
  const retainedInvocationIds = new Set();

  for (const invocation of recentInvocations) {
    if (!protectedInvocationIds.has(invocation?.id)) continue;
    if (invocation?.id) retainedInvocationIds.add(invocation.id);
  }
  for (const invocation of recentInvocations) {
    if (retainedInvocationIds.size >= CONSOLE_INVOCATION_LIMIT) break;
    if (!invocation?.id || retainedInvocationIds.has(invocation.id)) continue;
    retainedInvocationIds.add(invocation.id);
  }
  const retainedInvocations = recentInvocations.filter((invocation) => retainedInvocationIds.has(invocation?.id));

  const totals = { invocations: invocations.length };
  const truncated = [];
  const result = { ...publicState, invocations: retainedInvocations };
  if (retainedInvocations.length < invocations.length) truncated.push("invocations");

  for (const [key, limit] of Object.entries(CONSOLE_RELATED_LIMITS)) {
    const source = Array.isArray(publicState?.[key]) ? publicState[key] : [];
    const retained = source
      .filter((row) => !row?.invocationId || retainedInvocationIds.has(row.invocationId))
      .slice(0, limit);
    result[key] = retained;
    totals[key] = source.length;
    if (retained.length < source.length) truncated.push(key);
  }

  result.stateWindow = {
    projection: "console",
    invocationLimit: CONSOLE_INVOCATION_LIMIT,
    totals,
    truncated,
  };
  return result;
}

function consoleInvocationTimestamp(invocation) {
  for (const value of [invocation?.updatedAt, invocation?.completedAt, invocation?.createdAt]) {
    const timestamp = Date.parse(value ?? "");
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function consoleProtectedInvocationIds(state) {
  const protectedIds = new Set();
  const activeStatuses = new Set([
    "queued",
    "dispatching",
    "waiting_for_local_approval",
    "running",
    "cancelling",
  ]);
  for (const invocation of state?.invocations ?? []) {
    if (invocation?.id && activeStatuses.has(invocation.status)) protectedIds.add(invocation.id);
  }
  for (const decision of state?.pendingDecisions ?? []) {
    const invocationId = decision?.ref?.invocationId ?? decision?.invocationId;
    if (invocationId) protectedIds.add(invocationId);
  }
  let attentionCount = 0;
  for (const row of state?.evidenceLedger ?? []) {
    if (!row?.attention || !row?.invocationId) continue;
    protectedIds.add(row.invocationId);
    attentionCount += 1;
    if (attentionCount >= CONSOLE_ATTENTION_INVOCATION_LIMIT) break;
  }
  return protectedIds;
}

export function buildPublicState({
  namespace,
  protocolVersion,
  state,
  defaultProjectPath,
  currentProject,
  defaultAgent,
  loopRoutineReadModel,
  codexApprovalQueue,
  evidenceCenterRecords,
  ledgerSummary,
  budgetStatuses,
  teamBudgetStatuses,
  channelReadiness = null,
  channelRuntimeAccount = null,
  actor = null,
}) {
  // Tenancy scoping. With no actor (or one whose team owns everything, i.e.
  // single-team local dev) this is a pass-through; it only filters once a
  // second team exists. A row is visible when it carries no owning key (global)
  // or its project/invocation belongs to the actor's team.
  const teamId = actor?.teamId ?? null;
  const userTeam = new Map((state.users ?? []).map((user) => [user.id, user.teamId ?? LOCAL_TEAM_ID]));
  const projectTeam = new Map((state.projects ?? []).map((p) => [p.id, teamOf(p)]));
  const sshTargetTeam = new Map((state.sshTargets ?? []).map((target) => [target.id, target.ownerTeamId ?? LOCAL_TEAM_ID]));
  const projectVisible = (projectId) => {
    if (teamId == null || !projectId) return true; // unscoped, or a global/unowned row
    const owner = projectTeam.get(projectId);
    // An unknown/dangling projectId is NOT visible when scoped — defaulting to
    // the viewer's own team would leak every orphaned row to every team.
    return owner !== undefined && owner === teamId;
  };
  const sshTargetVisible = (target) =>
    teamId == null || (target?.ownerTeamId ?? LOCAL_TEAM_ID) === teamId;
  const sshTargetIdVisible = (targetId) => {
    if (teamId == null || !targetId) return true;
    const owner = sshTargetTeam.get(targetId);
    return owner !== undefined && owner === teamId;
  };
  const eventVisible = (event) => {
    if (!String(event?.type ?? "").startsWith("ssh.target.")) return true;
    return sshTargetIdVisible(event?.data?.targetId);
  };
  const projects = (state.projects ?? []).filter((p) => projectVisible(p.id) && p.hiddenFromNavigation !== true);
  const profileVisible = (row) => {
    if (teamId != null && (row?.ownerTeamId ?? LOCAL_TEAM_ID) !== teamId) return false;
    return !actor?.userId || (row?.userId ?? LOCAL_USER_ID) === actor.userId;
  };
  const workProfileInferences = (state.workProfileInferences ?? [])
    .filter(profileVisible)
    .map((row) => ({
      ...row,
      evidence: (row.evidence ?? []).filter((item) => projectVisible(item?.projectId)),
    }));
  const workProfileAuditEvents = (state.workProfileAuditEvents ?? [])
    .filter(profileVisible);
  const visibleInvocations = (state.invocations ?? []).filter((inv) => projectVisible(inv.projectId));
  const visibleInvIds = new Set(visibleInvocations.map((inv) => inv.id));
  const visibleInvocationsById = new Map(visibleInvocations.map((invocation) => [invocation.id, invocation]));
  const invVisible = (invocationId) =>
    teamId == null || !invocationId || visibleInvIds.has(invocationId);
  const byInvocation = (rows) => (rows ?? []).filter((r) => invVisible(r?.invocationId));
  const publicClaudeSessions = byInvocation(state.claudeSessions).map(
    ({ claudeSessionId: _claudeSessionId, ...session }) => session,
  );
  const publicCodexSessions = byInvocation(state.codexSessions).map(
    ({ codexSessionId: _codexSessionId, codexThreadId: _codexThreadId, ...session }) => session,
  );
  const publicCodexEvidenceRecords = byInvocation(state.codexEvidenceRecords).map(
    ({ sessionId: _sessionId, threadId: _threadId, ...record }) => record,
  );
  const byProject = (rows) => (rows ?? []).filter((r) => projectVisible(r?.projectId));
  // #969: ledger rows carry an explicit owning `teamId` (stamped at write time).
  // Scope by the SAME project gate as before, then ADD the team check — this can
  // only NARROW visibility, never broaden it: a scoped viewer still needs the
  // project to be theirs, and a stamped team must match. This closes the leak
  // where a null-projectId ledger row (projectVisible(null) === true) was visible
  // to every scoped team; a mismatched (inconsistent) stamp hides it from both,
  // the conservative choice. Unscoped/local-dev (teamId == null) is unchanged.
  const ledgerEntryVisible = (entry) => {
    if (teamId == null) return true;
    if (!projectVisible(entry?.projectId)) return false;
    const stamped = entry?.teamId ?? null;
    return stamped == null || stamped === teamId;
  };
  const visibleEvents = byInvocation(state.events).filter(eventVisible).map(publicInvocationEvent);
  const eventsByInvocationId = groupRowsByKey(visibleEvents, (event) => event?.invocationId);
  const recoveryEventsByRequestId = groupRecoveryEventsByRequestId(visibleEvents);
  const applications = (state.applications ?? []).filter((application) => {
    if (application?.projectId) return projectVisible(application.projectId);
    return teamId == null || (application?.ownerTeamId ?? LOCAL_TEAM_ID) === teamId;
  });
  const importedUsagePublic = (rows) => byInvocation(rows).map(({ raw, ...row }) => row);
  // #868: surface the parsed repo_state the git result importer stores (branch /
  // ahead-behind / commits / changed files) so the web can render it instead of
  // raw porcelain. Scope by PROJECT — durable, unlike the capped invocation list,
  // so a result outlives its invocation aging out of state. Cap the count and trim
  // the raw `text` to a preview to keep the snapshot small; the full 500-row ledger
  // stays server-side for a detail endpoint.
  // Scope by project when the result has one, else fall back to the owning team
  // (#904) — a repo_state row with a null projectId must NOT be globally visible
  // via projectVisible(null), same fallback `applications` uses above.
  const applicationResultVisible = (row) => {
    if (row?.projectId) return projectVisible(row.projectId);
    return teamId == null || (row?.ownerTeamId ?? LOCAL_TEAM_ID) === teamId;
  };
  const applicationResultPublic = (rows) =>
    (rows ?? [])
      .filter(applicationResultVisible)
      .slice(0, 100)
      .map((row) => ({ ...row, text: typeof row.text === "string" ? row.text.slice(0, 2000) : row.text }));
  const codexReviewFindings = byInvocation(state.codexReviewFindings).map(({ raw, ...row }) => row);
  const claudeReviewFindings = byInvocation(state.claudeReviewFindings).map(({ raw, ...row }) => row);
  const reviewFindings = [...codexReviewFindings, ...claudeReviewFindings].sort(compareReviewFindings);
  // Governed codex.exec changesets — same invocation-scoped visibility + raw strip
  // as review findings (the git porcelain preview stays out of public state).
  const codexExecChanges = byInvocation(state.codexExecChanges).map(({ raw, ...row }) => row);
  // Claude apply authorizations (Phase 4a): invocation-scoped. The full patch stays
  // server-side; public rows carry a bounded preview so a client can see what an
  // authorized apply would touch without shipping the whole diff.
  const claudeApplyAuthorizations = byInvocation(state.claudeApplyAuthorizations).map(({ patch, ...row }) => ({
    ...row,
    patchPreview: typeof patch === "string" ? patch.slice(0, 2000) : null,
  }));
  // Imported evidence has no invocation, so it can't ride byInvocation (a null
  // invocationId reads as globally visible). Scope it by its stamped owning team
  // instead; rows written before that stamp existed belong to the local team.
  const importedVisible = (r) => teamId == null || (r?.teamId ?? LOCAL_TEAM_ID) === teamId;
  const visibleImported = (state.codexImportedEvidenceRecords ?? []).filter(importedVisible);
  const visibleImportedIds = new Set(visibleImported.map((r) => r.id));
  const terminalSessionTeamId = (session) => {
    if (session?.ownerTeamId) return session.ownerTeamId;
    const owner = (state.users ?? []).find((user) => user.id === session?.userId);
    return owner?.teamId ?? LOCAL_TEAM_ID;
  };
  const terminalSessionVisible = (session) =>
    teamId == null || terminalSessionTeamId(session) === teamId;
  const terminalSessions = (state.terminalSessions ?? []).filter(terminalSessionVisible);
  const visibleTerminalSessionIds = new Set(terminalSessions.map((session) => session.terminalSessionId));
  const terminalEvidenceRecords = (state.terminalEvidenceRecords ?? []).filter((evidence) =>
    teamId == null || visibleTerminalSessionIds.has(evidence?.terminalSessionId),
  );
  const visibleTerminalEvidenceIds = new Set(terminalEvidenceRecords.map((evidence) => evidence.id));
  const terminalBridgeActions = (state.terminalBridgeActions ?? []).filter((action) =>
    teamId == null || visibleTerminalSessionIds.has(action?.terminalSessionId),
  );
  const sshTargets = (state.sshTargets ?? []).filter(sshTargetVisible);
  const visibleSshTargetIds = new Set(sshTargets.map((target) => target.id));
  const sshConnectionTests = (state.sshConnectionTests ?? []).filter((test) =>
    teamId == null || visibleSshTargetIds.has(test?.targetId),
  );
  // Channels (S2, #1090): owner-team scoped; child rows follow their channel's
  // visibility so a foreign team's channel never leaks through events/deliveries.
  const channelVisible = (row) =>
    teamId == null || (row?.ownerTeamId ?? LOCAL_TEAM_ID) === teamId;
  const channels = (state.channels ?? []).filter(channelVisible);
  const visibleChannelIds = new Set(channels.map((channel) => channel.id));
  const byChannel = (rows) =>
    (rows ?? []).filter((row) => teamId == null || visibleChannelIds.has(row?.channelId));
  const channelIdentities = byChannel(state.channelIdentities);
  const channelEvents = byChannel(state.channelEvents);
  const channelConversations = byChannel(state.channelConversations);
  const channelDeliveries = byChannel(state.channelDeliveries);
  const channelNotificationPolicies = byChannel(state.channelNotificationPolicies);
  const channelNotificationBatches = byChannel(state.channelNotificationBatches);
  const channelIntakeGroups = byChannel(state.channelIntakeGroups);
  const channelTaskThreads = byChannel(state.channelTaskThreads);
  const channelTaskRevisions = byChannel(state.channelTaskRevisions);
  const channelObjectRecords = (state.channelObjectRecords ?? []).filter((record) =>
    (teamId == null || (record?.ownerTeamId ?? LOCAL_TEAM_ID) === teamId) && projectVisible(record?.projectId));
  const channelObjectFileSources = (state.channelObjectFileSources ?? []).filter((source) =>
    (teamId == null || (source?.ownerTeamId ?? LOCAL_TEAM_ID) === teamId) && projectVisible(source?.projectId));
  const channelLifecycleSummaries = businessLifecycleSummaries({
    records: channelObjectRecords,
    sources: channelObjectFileSources,
  });
  // A compare run is visible when it spans at least one invocation the team can
  // see; unscoped mode passes everything through.
  const byCompareRun = (rows) =>
    (rows ?? []).filter(
      (r) => teamId == null || (r?.childInvocationIds ?? []).some((id) => visibleInvIds.has(id)),
    );
  const compareRuns = byCompareRun(state.compareRuns);
  const compareRunsById = new Map(compareRuns.map((compareRun) => [compareRun.id, compareRun]));
  const applicationRecoveryActions = byInvocation(state.applicationRecoveryActions)
    .map((request) => applicationRecoveryActionReadModel(
      request,
      visibleInvocationsById,
      recoveryEventsByRequestId.get(request.id) ?? [],
    ));
  const applicationRecoveryActionsByInvocationId = groupRowsByKey(
    applicationRecoveryActions,
    (request) => request?.invocationId,
  );
  const applicationRecoveryActionsByResultInvocationId = groupRowsByKey(
    applicationRecoveryActions.filter((request) => request?.resultInvocationId),
    (request) => request?.resultInvocationId,
  );
  const approvalRequests = byInvocation(state.approvalRequests);
  const approvalRequestsById = new Map(approvalRequests.map((approval) => [approval.id, approval]));
  const approvalRequestsByInvocationId = groupRowsByKey(approvalRequests, (approval) => approval?.invocationId);
  const policyDecisionRecords = byInvocation(state.policyDecisionRecords);
  const policyDecisionRecordsById = new Map(policyDecisionRecords.map((record) => [record.id, record]));
  const policyDecisionRecordsByInvocationId = groupRowsByKey(policyDecisionRecords, (record) => record?.invocationId);
  const auditSummaries = byInvocation(state.auditSummaries);
  const auditSummariesByInvocationId = groupRowsByKey(auditSummaries, (audit) => audit?.invocationId);
  const troubleshootingReports = byInvocation(state.troubleshootingReports);
  const troubleshootingReportsByInvocationId = groupRowsByKey(
    troubleshootingReports,
    (report) => report?.invocationId,
  );
  const visibleAutomations = byProject(state.automations);
  const autoRuns = byProject(state.autoRuns);
  const channelTaskRequests = channelTaskOperations({
    requests: byChannel(state.channelTaskRequests),
    autoRuns,
    invocations: visibleInvocations,
    deliveries: channelDeliveries,
  });
  // #1143 issue claims carry a projectId; project-team scoping is the boundary.
  const issueClaims = byProject(state.issueClaims);
  // Work Items keep their own cursor-paginated endpoint. Publish only bounded,
  // tenant-scoped totals here so /api/state consumers do not confuse an omitted
  // large collection with an empty backlog.
  const visibleWorkItems = (state.workItems ?? []).filter(
    (item) => teamId == null || (item.ownerTeamId ?? LOCAL_TEAM_ID) === teamId,
  );
  const boundAutoRunIds = new Set();
  const boundInvocationIds = new Set();
  for (const item of visibleWorkItems) {
    for (const binding of item.executionBindings ?? []) {
      if (binding.kind === "auto_run" && binding.targetId) boundAutoRunIds.add(binding.targetId);
      if (binding.kind === "application_invocation" && (binding.id ?? binding.targetId)) {
        boundInvocationIds.add(binding.id ?? binding.targetId);
      }
    }
  }
  const boundAutoRuns = autoRuns.filter((run) => boundAutoRunIds.has(run.id));
  for (const run of boundAutoRuns) {
    if (run.invocationId) boundInvocationIds.add(run.invocationId);
  }
  const boundInvocations = visibleInvocations.filter((invocation) => boundInvocationIds.has(invocation.id));
  const boundApprovals = approvalRequests.filter((approval) => boundInvocationIds.has(approval.invocationId));
  const workbenchVersionTimestamps = [
    ...visibleWorkItems.map((item) => item.updatedAt),
    ...boundAutoRuns.map((run) => run.updatedAt ?? run.createdAt),
    ...boundInvocations.map((invocation) => invocation.updatedAt ?? invocation.completedAt ?? invocation.createdAt),
    ...boundApprovals.map((approval) => approval.updatedAt ?? approval.decidedAt ?? approval.createdAt),
  ].filter(Boolean);
  const workItemSummary = {
    total: visibleWorkItems.length,
    open: visibleWorkItems.filter((item) => (item.businessState ?? item.state) === "open").length,
    blocked: visibleWorkItems.filter((item) => (item.planningStatus ?? item.status) === "blocked").length,
    activeExecutions: visibleWorkItems.filter((item) =>
      ["claimed", "running", "awaiting_approval", "verifying"].includes(item.executionState),
    ).length,
    updatedAt: visibleWorkItems.reduce(
      (latest, item) => item.updatedAt > latest ? item.updatedAt : latest,
      "",
    ) || null,
    homeWorkbenchUpdatedAt: workbenchVersionTimestamps.reduce(
      (latest, value) => value > latest ? value : latest,
      "",
    ) || null,
  };
  const workItemIds = new Set(visibleWorkItems.map((item) => item.id));
  const visibleWorkItemsById = new Map(visibleWorkItems.map((item) => [item.id, item]));
  const visibleFollowUpReminders = (state.workItemFollowUpReminders ?? []).flatMap((row) => {
    if (row.status !== "due") return [];
    if (teamId != null && (row.ownerTeamId ?? LOCAL_TEAM_ID) !== teamId) return [];
    const item = visibleWorkItemsById.get(row.workItemId);
    if (!item) return [];
    return [{
      id: row.id,
      workItemId: row.workItemId,
      projectId: item.projectId ?? null,
      localRef: item.localRef,
      workItemTitle: item.title,
      status: row.status,
      scheduledFor: row.scheduledFor,
      sourceRevision: row.sourceRevision,
      scheduleRevision: row.scheduleRevision,
      createdAt: row.createdAt,
    }];
  });
  const workItemByAutoRunId = new Map();
  for (const item of visibleWorkItems) {
    for (const binding of item.executionBindings ?? []) {
      if (binding.kind === "auto_run") workItemByAutoRunId.set(binding.targetId, item.id);
    }
  }
  const visibleWorkItemAlerts = (state.alertOutbox ?? []).flatMap((row) => {
    const data = row.alert?.data ?? {};
    const localIssueId = workItemIds.has(data.localIssueId)
      ? data.localIssueId
      : workItemByAutoRunId.get(data.autoRunId) ?? null;
    const teamAlert = teamId != null && data.teamId === teamId;
    if (!localIssueId && !teamAlert) return [];
    return [{ localIssueId, status: row.status, attempts: row.attempts, lastError: row.lastError, createdAt: row.createdAt, sentAt: row.sentAt }];
  });
  const workItemAlertSummary = {
    queued: visibleWorkItemAlerts.filter((row) => row.status === "queued").length,
    failed: visibleWorkItemAlerts.filter((row) => row.status === "failed").length,
    sent: visibleWorkItemAlerts.filter((row) => row.status === "sent").length,
    skipped: visibleWorkItemAlerts.filter((row) => row.status === "skipped").length,
    byLocalIssue: visibleWorkItemAlerts.filter((row) => row.localIssueId).slice(0, 100),
  };
  // #1152: their durable lifecycle history, scoped the same way.
  const issueClaimEvents = byProject(state.issueClaimEvents ?? []);
  const autoRunsByInvocationId = groupRowsByKey(
    autoRuns.filter((autoRun) => visibleInvIds.has(autoRun?.invocationId)),
    (autoRun) => autoRun?.invocationId,
  );
  // #776/#869: the invocation stores its resolved wrapper plan — including the
  // exact `execCommand` + `execArgs` the bridge runs — because the delivery channel
  // needs it. The web console must NOT receive that argv (the descriptor rule is
  // that discovery/observability never exposes local commands or argv). Strip it
  // from the /api/state projection only; the bridge gets its copy via delivery, not
  // this read-model. The rest of the wrapper (capability, cwdPolicy, policies,
  // resultImport) is the public contract and stays.
  const sanitizeInvocationOptions = (options) => {
    const metadata = options?.metadata;
    // The Phase 4b apply invocation carries the full patch so the bridge can write
    // it to a temp file. The bridge gets it over its own work channel; keep the
    // (up to 100 KB) blob out of every public state fetch — the authorization row
    // already exposes a bounded patchPreview.
    const hasApplyPatch = typeof metadata?.applyPatch === "string";
    const wrapper = metadata?.applicationWrapper;
    const hasWrapperExec = wrapper && (wrapper.execCommand !== undefined || wrapper.execArgs !== undefined);
    if (!hasApplyPatch && !hasWrapperExec) return options;
    const nextMetadata = { ...metadata };
    if (hasApplyPatch) delete nextMetadata.applyPatch;
    if (hasWrapperExec) {
      const { execCommand, execArgs, ...safeWrapper } = wrapper;
      nextMetadata.applicationWrapper = safeWrapper;
    }
    return { ...options, metadata: nextMetadata };
  };
  // A claude.propose.patch result carries the full proposed diff (up to 100 KB).
  // Shipping it verbatim in every /api/state poll is pure bandwidth — the console
  // only ever needs a preview to display and the invocation id to apply. Bound it
  // here; a detail view can fetch the full patch on demand later.
  const PROPOSAL_PATCH_PREVIEW = 8000;
  // #913: an artifact's apply-validity must be VISIBLE in the read model, not
  // discovered when the apply gate refuses it. Structural checks only — the gate
  // recomputes the content hash authoritatively at authorize time; re-hashing a
  // 100 KB patch on every state poll would be wasted CPU. `descriptor_stale`
  // mirrors the gate's lineage refusal (#897).
  const proposalApplyValidity = (invocation) => {
    const output = invocation.result?.output ?? {};
    const reasons = [];
    if (invocation.status !== "succeeded") reasons.push("not_succeeded");
    if (output.patchRedacted === true) reasons.push("payload_reaped");
    else if (typeof output.patch !== "string" || !output.patch.trim()) reasons.push("no_patch");
    if (!output.contentHash) reasons.push("bindings_missing");
    if (output.applicationId) {
      const app = (state.applications ?? []).find((item) => item.id === output.applicationId) ?? null;
      const revisionMoved = output.descriptorRevision != null && Number(app?.descriptorRevision ?? 1) !== Number(output.descriptorRevision);
      if (!app || app.successorApplicationId || revisionMoved) reasons.push("descriptor_stale");
    }
    return { applyReady: reasons.length === 0, reasons };
  };
  const sanitizeInvocationResult = (invocation) => {
    const result = invocation.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) return result;
    const {
      claudeSessionId: _claudeSessionId,
      sessionId: _sessionId,
      threadId: _threadId,
      turnId: _turnId,
      ...safeResult
    } = result;
    if (invocation.options?.metadata?.tool !== "claude.propose.patch" || !safeResult.output) {
      return safeResult;
    }
    const output = { ...safeResult.output };
    if (typeof output.patch === "string" && output.patch.length > PROPOSAL_PATCH_PREVIEW) {
      output.patch = `${output.patch.slice(0, PROPOSAL_PATCH_PREVIEW)}\n... (patch truncated; ${output.patch.length} chars — apply does not need the full patch)`;
      output.patchTruncated = true;
    }
    output.applyValidity = proposalApplyValidity(invocation);
    return { ...safeResult, output };
  };
  const invocations = visibleInvocations.map((invocation) => ({
    ...invocation,
    options: sanitizeInvocationOptions(invocation.options),
    result: sanitizeInvocationResult(invocation),
    explanation: buildInvocationExplanation(invocation, {
      applicationRecoveryActionsByInvocationId,
      applicationRecoveryActionsByResultInvocationId,
      approvalRequestsById,
      approvalRequestsByInvocationId,
      auditSummariesByInvocationId,
      autoRunsByInvocationId,
      compareRunsById,
      eventsByInvocationId,
      invocationsById: visibleInvocationsById,
      policyDecisionRecordsById,
      policyDecisionRecordsByInvocationId,
      troubleshootingReportsByInvocationId,
    }),
  }));

  // Schedule health (#848), computed server-side from the runs a schedule caused —
  // never re-derived by each client, which is how three clients end up with three
  // different opinions about whether something is broken.
  //
  // Built from the already team-scoped locals, so it inherits tenancy: a schedule
  // the viewer cannot see must not leak through its health row, and an
  // application's rollup counts only the schedules in that same set.
  const schedules = scheduleHealthReadModel({
    automations: visibleAutomations,
    invocations: visibleInvocations,
    applications,
  });
  const scheduleHealthByApplicationId = new Map(
    schedules.applicationScheduleHealth.map((row) => [row.applicationId, row]),
  );
  // An application whose capability schedules are failing is not healthy. Without
  // this, the Applications view keeps calling it healthy while the thing it
  // schedules has been broken for a week — the sweep only ever checked the
  // application's own source, never what it was asked to do on a timer.
  const applicationsWithSchedules = applications.map((application) => withLocalApplicationReadiness({
    ...application,
    scheduleHealth: scheduleHealthByApplicationId.get(application.id) ?? null,
  }, primaryDevice(state)));

  // Consolidated pending-decision queue (the Approvals section). Built from the
  // already team-scoped locals so it inherits tenancy; this also surfaces the
  // auto-run lifecycle gates in /api/state for the first time.
  const codexApprovalBrokerRequests = byInvocation(state.codexApprovalBrokerRequests);
  // #1151: advisory soft-claims on queue rows — active, unexpired, and only the
  // viewer's own team's markers (a foreign team's "handling this" must not leak).
  const softClaimCutoff = Date.now();
  const decisionSoftClaims = (state.decisionSoftClaims ?? []).filter(
    (claim) =>
      claim?.status === "active" &&
      (!claim.expiresAt || Date.parse(claim.expiresAt) > softClaimCutoff) &&
      (teamId == null || (claim.teamId ?? LOCAL_TEAM_ID) === teamId),
  );
  const pendingDecisionQueue = pendingDecisions({
    approvalRequests,
    autoRuns,
    compareRuns,
    codexApprovalBrokerRequests,
    lifecycleLocalApprovals: state.lifecycleLocalApprovals ?? [],
    lifecycleRollbackRequests: state.lifecycleRollbackRequests ?? [],
    channelTaskRequests,
    applicationRecoveryActions,
    applicationsById: new Map(applications.map((application) => [application.id, application])),
    invocationsById: visibleInvocationsById,
    decisionSoftClaims,
  });

  // The Status board (#1215-follow-up): six lenses over the same team-scoped
  // locals — 待决策 reuses pendingDecisionQueue verbatim, the lifecycle lenses
  // classify auto-runs, 要跟进 rolls up failed runs + recent refusals. Pure and
  // derived, so it inherits tenancy like everything else here.
  const digestNow = Date.now();
  const visibleRefusals = byInvocation(state.refusals);
  const workStatusBoard = workBoard({
    autoRuns,
    pendingDecisions: pendingDecisionQueue,
    refusals: visibleRefusals,
    followUpReminders: visibleFollowUpReminders,
    schedules: (state.runtimeWorkSchedules ?? []).filter((schedule) =>
      (teamId == null || (schedule.ownerTeamId ?? LOCAL_TEAM_ID) === teamId)
      && (!actor?.userId || schedule.userId === actor.userId)
      && (!schedule.terminalId || schedule.terminalId === state.device?.id)),
    now: digestNow,
  });

  // Work report — day / week / month / quarter rollups over the same board.
  // Windows are calendar-aligned in UTC (start of today / ISO-week Monday /
  // month-1st / quarter-start). Runs come from the (team-scoped) auto-run
  // snapshot; refusals from the durable per-day rollup, shown only to the
  // admin/local scope since that rollup carries no per-team attribution.
  // `teamId == null` alone is unreachable in a live server (resolveActor always
  // stamps a team, defaulting to LOCAL_TEAM_ID) — the local owner IS team_local,
  // so the admin scope must include it or the figures never render for anyone.
  const isAdminScope = teamId == null || teamId === LOCAL_TEAM_ID;
  const workReportPeriods = calendarPeriods(digestNow);
  const workReportSummary = workReport({
    board: workStatusBoard,
    autoRuns,
    refusalDailyStats: state.refusalDailyStats ?? [],
    refusalStatsSince: state.refusalStatsMeta?.since ?? null,
    refusalsAvailable: isAdminScope,
    periods: workReportPeriods,
    now: digestNow,
  });

  // Per-run trust ledger (the Evidence section). Scope the Codex/terminal evidence
  // aggregate ONCE and reuse it for both the ledger and the snapshot emit below.
  const evidenceCenterVisible = evidenceCenterRecords().filter((r) =>
    r?.type === "imported_evidence"
      ? visibleImportedIds.has(r.id)
      : r?.source === "managed_terminal_runtime"
        ? visibleTerminalEvidenceIds.has(r.id)
        : invVisible(r?.invocationId),
  );
  const evidenceLedgerRows = evidenceLedger({
    invocations: visibleInvocations,
    reviewFindings,
    auditSummaries,
    troubleshootingReports,
    evidenceCenterRecords: evidenceCenterVisible,
    applicationRecoveryActions,
    // #1085: transcript summary metadata joins the trust ledger. Scoped by
    // invocation visibility; the ledger row carries hash/counts, never blocks.
    runTranscripts: byInvocation(state.runTranscripts ?? []),
  });

  const devices = (state.devices ?? [state.device])
    .filter(Boolean)
    .filter((device) => teamId == null || userTeam.get(device.ownerUserId) === teamId)
    .map((device) => publicDeviceReadinessView(device));
  const visibleDevice = devices.find((device) => device.id === state.device?.id) ?? devices[0] ?? null;
  const guidedSetupRun = (state.guidedSetupRuns ?? []).find((run) =>
    (teamId == null || (run.ownerTeamId ?? LOCAL_TEAM_ID) === teamId)
    && (!actor?.userId || run.ownerUserId === actor.userId)) ?? null;
  const guidedSetup = deriveGuidedReadiness({
    device: visibleDevice,
    projects,
    projectTargets: byProject(state.projectTargets),
    agents: state.agents ?? [],
    applications: applicationsWithSchedules,
    applicationInstallRuns: (state.applicationInstallRuns ?? []).filter((run) =>
      (teamId == null || (run.ownerTeamId ?? LOCAL_TEAM_ID) === teamId)
      && (!run.projectId || projectVisible(run.projectId))),
    run: guidedSetupRun,
  });

  return {
    namespace,
    protocolVersion,
    defaults: {
      cloneParentDir: defaultProjectPath,
    },
    device: visibleDevice,
    devices,
    guidedSetup,
    // Never expose password hashes to any client.
    users: (state.users ?? []).map(({ passwordHash, ...user }) => user),
    teams: (state.teams ?? []).map(({ alertWebhookUrl, ...team }) => ({
      ...team,
      alertWebhookConfigured: Boolean(alertWebhookUrl),
    })),
    projects,
    workProfileInferences,
    workProfileAuditEvents,
    applications: applicationsWithSchedules,
    applicationRecoveryActions,
    // Sweep self-observability (admin-plane, like healthChecks): when the probe
    // last ran, how many apps it checked, and the last per-app error it swallowed.
    applicationHealthSweepStatus: state.applicationHealthSweepStatus ?? null,
    // Durable per-app daily counters (survive the invocation cap) — scoped to
    // the applications the viewer can see, like the applications list itself.
    applicationDailyStats: (state.applicationDailyStats ?? []).filter((row) =>
      applications.some((application) => application.id === row.applicationId),
    ),
    // Legacy-approvalToken usage counter (APPROVAL_GRANTS.md phase 1): the
    // migration gauge — phase 2 flips strict once this stops moving. Grants
    // themselves are never exposed (server-side hashes only).
    approvalTokenLegacyUses: state.approvalTokenLegacyUses ?? null,
    projectTargets: byProject(state.projectTargets),
    currentProjectId: state.currentProjectId,
    currentProject: currentProject(),
    loopRoutines: loopRoutineReadModel(),
    worktrees: byProject(state.worktrees),
    worktreeReviews: byProject(state.worktreeReviews),
    deployments: byProject(state.deployments ?? []),
    // Per-decision dispatch routing (#routing-observability): who was chosen, why,
    // the ranked candidates, and the ineligible-with-reasons — the "why routed
    // here" the Dispatch panel renders. Team-scoped by the assignment's project.
    dispatchAssignments: byProject(state.dispatchAssignments ?? []),
    issueClaims,
    issueClaimEvents,
    workItemSummary,
    workItemAlertSummary,
    agent: defaultAgent(),
    agents: state.agents,
    invocations,
    compareRuns,
    events: visibleEvents,
    traces: byInvocation(state.traces),
    spans: byInvocation(state.spans),
    auditSummaries,
    healthChecks: state.healthChecks,
    lifecycleAuditRecords: state.lifecycleAuditRecords,
    lifecycleRecipes: state.lifecycleRecipes,
    lifecyclePolicyDecisions: state.lifecyclePolicyDecisions,
    lifecycleLocalApprovals: state.lifecycleLocalApprovals,
    lifecycleQueuedActions: state.lifecycleQueuedActions,
    lifecycleRollbackRequests: state.lifecycleRollbackRequests,
    privateCatalogEntries: state.privateCatalogEntries,
    signedBundleManifests: state.signedBundleManifests,
    discoveryRuns: state.discoveryRuns,
    integrationArtifacts: state.integrationArtifacts,
    integrationProbeRuns: state.integrationProbeRuns,
    quotaDecisionRecords: byInvocation(state.quotaDecisionRecords),
    quotaPolicies: state.quotaPolicies,
    aiUsageRecords: byInvocation(state.aiUsageRecords),
    invocationRounds: byInvocation(state.invocationRounds),
    toolInvocationRecords: byInvocation(state.toolInvocationRecords),
    ledgerEntries: (state.ledgerEntries ?? []).filter(ledgerEntryVisible),
    importedUsageEstimates: importedUsagePublic(state.importedUsageEstimates),
    applicationResults: applicationResultPublic(state.applicationResults),
    codexReviewFindings,
    claudeReviewFindings,
    reviewFindings,
    codexExecChanges,
    claudeApplyAuthorizations,
    // Scope the economics rollup to the viewer's team: an unscoped viewer
    // (teamId == null, local dev/admin) gets the platform total; a scoped viewer
    // gets only its own entries, mirroring the `ledgerEntries` filter above (#969:
    // same narrow-only project-gate + stamped-team check, so the rollup can't
    // leak a foreign null-projectId row's cost either). Passing the global summary
    // here leaks foreign totals + project names (#891).
    ledgerSummary:
      typeof ledgerSummary === "function"
        ? ledgerSummary(teamId == null ? undefined : ledgerEntryVisible)
        : null,
    // Project budgets scope by project; team pools (rows with teamId, no
    // projectId) scope by the viewer's team — byProject alone would treat them
    // as global and leak every team's pool to every viewer.
    budgets: (state.budgets ?? []).filter((b) =>
      b?.teamId ? teamId == null || b.teamId === teamId : projectVisible(b?.projectId),
    ),
    budgetStatuses: byProject(typeof budgetStatuses === "function" ? budgetStatuses() : []),
    // Team cost rollup — a team sees only its own row (unscoped mode sees all).
    teamBudgetStatuses: (typeof teamBudgetStatuses === "function" ? teamBudgetStatuses() : []).filter(
      (row) => teamId == null || row.teamId === teamId,
    ),
    automations: visibleAutomations,
    ...schedules,
    agentSkills: state.agentSkills ?? [],
    privateDeploymentConfig: state.privateDeploymentConfig,
    auditExportRequests: state.auditExportRequests,
    retentionSettings: state.retentionSettings,
    approvalRequests,
    policyDecisionRecords,
    troubleshootingReports,
    agentUsageSummaries: state.agentUsageSummaries,
    codexSessions: publicCodexSessions,
    claudeSessions: publicClaudeSessions,
    codexWorkspaces: byInvocation(state.codexWorkspaces),
    codexEvidenceRecords: publicCodexEvidenceRecords,
    codexChangeReviews: byInvocation(state.codexChangeReviews),
    codexExecChangeReviews: byInvocation(state.codexExecChangeReviews),
    codexHookEvents: byInvocation(state.codexHookEvents),
    codexApprovalQueue: codexApprovalQueue().filter((q) => invVisible(q?.invocationId)),
    // The evidence center aggregates raw codex/terminal state, so re-apply
    // scoping here: invocation-linked rows by invVisible, imported rows by
    // owning team, and terminal rows by their owning terminal session.
    evidenceCenterRecords: evidenceCenterVisible,
    evidenceLedger: evidenceLedgerRows,
    // Refusal model Phase 2 (#760): the device's veto, scoped like every other
    // invocation-linked collection (null-invocation refusals stay owner-visible).
    refusals: byInvocation(state.refusals),
    codexApprovalBrokerRequests,
    pendingDecisions: pendingDecisionQueue,
    workBoard: workStatusBoard,
    workReport: workReportSummary,
    // Scheduled-report config is a single global admin-plane singleton (it names a
    // channel target) — expose it to the admin/local scope (which the local owner
    // belongs to), like the report's own refusal figures. A genuine foreign tenant
    // still gets null.
    reportSchedule: isAdminScope ? state.reportSchedule ?? null : null,
    codexImportedEvidenceRecords: visibleImported,
    terminalRuntimeCapability: state.terminalRuntimeCapability,
    terminalSessions,
    terminalEvidenceRecords,
    terminalBridgeActions,
    sshTargets,
    sshConnectionTests,
    channels,
    channelIdentities,
    channelEvents,
    channelConversations,
    channelDeliveries,
    channelNotificationPolicies,
    channelNotificationBatches,
    channelIntakeGroups,
    channelTaskThreads,
    channelTaskRevisions,
    channelTaskRequests,
    channelLifecycleSummaries,
    channelIntentMetrics: isAdminScope ? state.channelIntentMetrics ?? null : null,
    channelOperations: channelOperations({
      channels,
      channelIdentities,
      channelEvents,
      channelConversations,
      channelDeliveries,
      channelTaskThreads,
      readinessForChannel: channelReadiness,
      runtimeAccountForChannel: channelRuntimeAccount,
    }),
  };
}

const APPLICATION_BINARY_READINESS_TTL_MS = 10 * 60 * 1000;

function publicDeviceReadinessView(device) {
  const view = publicDeviceView(device);
  if (!view) return view;
  const nowMs = Date.now();
  const readiness = view.runtimeReadiness ?? view.applicationBinaryReadiness ?? [];
  const runtimeReadiness = readiness.map((row) => {
    const checkedAtMs = Date.parse(row.checkedAt ?? "");
    const stale = view.status !== "online" || !Number.isFinite(checkedAtMs) || nowMs - checkedAtMs > APPLICATION_BINARY_READINESS_TTL_MS;
    return stale ? { ...row, status: "stale" } : row;
  });
  return {
    ...view,
    runtimeReadiness,
    applicationBinaryReadiness: runtimeReadiness,
  };
}

function groupRecoveryEventsByRequestId(events) {
  const grouped = new Map();
  for (const event of events ?? []) {
    const requestId = typeof event?.data?.recoveryActionRequestId === "string"
      ? event.data.recoveryActionRequestId
      : null;
    if (!requestId) continue;
    const items = grouped.get(requestId) ?? [];
    items.push(event);
    grouped.set(requestId, items);
  }
  return grouped;
}

function groupRowsByKey(rows, keyFor) {
  const grouped = new Map();
  for (const row of rows ?? []) {
    const key = keyFor(row);
    if (!key) continue;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  return grouped;
}

export function buildInvocationExplanation(invocation, context = {}) {
  const status = invocation?.status ?? "unknown";
  const metadata = objectValue(invocation?.options?.metadata);
  const recoveryRequest = latestRow([
    ...(context.applicationRecoveryActionsByInvocationId?.get(invocation.id) ?? []),
    ...(context.applicationRecoveryActionsByResultInvocationId?.get(invocation.id) ?? []),
  ]);
  const recovery = invocationRecoveryExplanation(recoveryRequest, invocation);
  const approval = invocationApprovalExplanation(invocation, context);
  const source = invocationSourceExplanation(invocation, context, metadata, recoveryRequest);
  const report = latestRow(context.troubleshootingReportsByInvocationId?.get(invocation.id) ?? []);
  const policy = invocationPolicyRecord(invocation, context);
  const audit = latestRow(context.auditSummariesByInvocationId?.get(invocation.id) ?? []);
  const event = latestOperatorEvent(context.eventsByInvocationId?.get(invocation.id) ?? []);

  const summary = recovery?.summary
    ?? statusSummary(invocation, { approval, audit, event, policy, report });
  const reason = recovery?.reasonText
    ?? statusReason(invocation, { approval, audit, event, policy, report });
  const reasonCode = recovery?.reasonCode
    ?? statusReasonCode(invocation, { approval, audit, event, policy, report });
  const waitingOn = recovery?.waitingOn
    ?? statusWaitingOn(invocation, { approval, source });
  const resultLocation = recovery?.resultLocation
    ?? statusResultLocation(invocation, { audit, report });
  const nextAction = recovery?.nextAction
    ?? statusNextAction(invocation, { approval, report });

  return {
    state: invocationExplanationState(status, recovery, approval),
    reason,
    reasonCode,
    summary,
    waitingOn,
    resultLocation,
    nextAction,
    recovery: recovery?.request ?? null,
    approval: approval?.request ?? null,
    source,
  };
}

function invocationRecoveryExplanation(request, invocation) {
  if (!request) return null;
  const explanation = request.explanation ?? {};
  const outcome = request.outcome ?? {};
  const isResultInvocation = request.resultInvocationId === invocation?.id;
  const actionLabel = request.actionType ?? explanation.selectedAction ?? "recovery";
  const requestSummary = explanation.summary ?? outcome.summary ?? request.reason ?? null;
  const summary = isResultInvocation
    ? `This invocation is the result of ${actionLabel} recovery for ${request.invocationId}.`
    : requestSummary ?? `Recovery action ${actionLabel} is ${request.status ?? "recorded"}.`;
  const reasonCode = explanation.reason ?? outcome.reason ?? request.error ?? request.status ?? null;
  const reasonText = recoveryReasonText(request, isResultInvocation, reasonCode);
  const waitingOn = request.status === "approval_pending" || request.approvalRequestId
    ? {
        type: "approval",
        id: request.approvalRequestId ?? null,
        status: request.status === "approval_pending" ? "pending" : request.status ?? null,
        label: request.approvalRequestId
          ? `${request.approvalRequestId} (${request.status === "approval_pending" ? "pending approval" : request.status ?? "recorded"})`
          : "Recovery approval",
      }
    : null;
  const resultLocation = request.resultInvocationId
    ? {
        type: "invocation",
        invocationId: request.resultInvocationId,
        label: request.resultInvocationId,
      }
    : request.resultOrchestrationId
      ? {
          type: "orchestration",
          orchestrationId: request.resultOrchestrationId,
          relativePath: request.resultOrchestrationRelativePath ?? null,
          label: request.resultOrchestrationRelativePath ?? request.resultOrchestrationId,
        }
      : null;
  return {
    reasonCode,
    reasonText,
    summary,
    waitingOn,
    resultLocation,
    nextAction: explanation.nextStep ?? outcome.nextStep ?? recoveryNextAction(request),
    request: {
      category: request.recoveryCategory ?? explanation.recoveryCategory ?? null,
      actionType: request.actionType ?? explanation.selectedAction ?? null,
      actionRequestId: request.id ?? explanation.recoveryActionRequestId ?? null,
      status: request.status ?? null,
      sourceInvocationId: request.invocationId ?? null,
      approvalRequestId: request.approvalRequestId ?? explanation.approvalRequestId ?? null,
      resultInvocationId: request.resultInvocationId ?? explanation.resultInvocationId ?? null,
      resultOrchestrationId: request.resultOrchestrationId ?? explanation.resultOrchestrationId ?? null,
      resultOrchestrationRelativePath: request.resultOrchestrationRelativePath ?? explanation.resultOrchestrationRelativePath ?? null,
    },
  };
}

function recoveryReasonText(request, isResultInvocation, reasonCode) {
  if (isResultInvocation) return `Recovery result for ${request.invocationId}.`;
  if (request.status === "approval_pending") return "Recovery action is waiting for approval.";
  if (request.status === "executing") return "Recovery action is executing.";
  if (request.status === "executed") return "Recovery action executed.";
  if (request.status === "failed") return request.error ?? "Recovery action failed.";
  if (request.status === "approval_denied") return "Recovery approval was denied.";
  if (request.status === "approval_timed_out") return "Recovery approval timed out.";
  return reasonCode ? String(reasonCode).replaceAll("_", " ") : "Recovery action recorded.";
}

function recoveryNextAction(request) {
  if (request.status === "approval_pending") return "Resolve the linked approval request before this recovery can execute.";
  if (request.resultInvocationId) return "Inspect the recovery result invocation.";
  if (request.status === "failed") return "Review the failure details and choose another recovery action.";
  return "Review the recovery action audit trail.";
}

function invocationApprovalExplanation(invocation, context) {
  const request = invocation?.approvalRequestId
    ? context.approvalRequestsById?.get(invocation.approvalRequestId) ?? null
    : latestRow(context.approvalRequestsByInvocationId?.get(invocation?.id) ?? []);
  if (!request) return null;
  return {
    request: {
      requestId: request.id,
      status: request.status ?? null,
      riskLevel: request.riskLevel ?? null,
      riskTags: request.riskTags ?? [],
      decidedBy: request.decidedBy ?? null,
      decidedAt: request.decidedAt ?? null,
    },
  };
}

function invocationPolicyRecord(invocation, context) {
  return invocation?.policyDecisionId
    ? context.policyDecisionRecordsById?.get(invocation.policyDecisionId) ?? null
    : latestRow(context.policyDecisionRecordsByInvocationId?.get(invocation?.id) ?? []);
}

function invocationSourceExplanation(invocation, context, metadata, recoveryRequest) {
  const compareRunId = invocation?.compareRunId ?? stringOrNull(metadata.compareRunId);
  const autoRun = latestRow(context.autoRunsByInvocationId?.get(invocation?.id) ?? []);
  if (recoveryRequest?.resultInvocationId === invocation?.id) {
    return {
      type: "recovery_result",
      invocationId: recoveryRequest.invocationId ?? null,
      recoveryActionRequestId: recoveryRequest.id ?? null,
      actionType: recoveryRequest.actionType ?? null,
    };
  }
  if (stringOrNull(metadata.targetInvocationId)) {
    return {
      type: "troubleshooting",
      targetInvocationId: stringOrNull(metadata.targetInvocationId),
    };
  }
  // A run that originated from a channel message (/run or a routed /task) — so the
  // Invocations ledger can identify + filter channel-originated work instead of
  // labeling it "direct".
  if (metadata.channel?.channelId) {
    return {
      type: "channel",
      channelId: stringOrNull(metadata.channel.channelId),
      conversationId: stringOrNull(metadata.channel.conversationId),
      channelTaskRequestId: stringOrNull(metadata.channel.channelTaskRequestId),
    };
  }
  if (metadata.source === "application_orchestration" || stringOrNull(metadata.applicationId)) {
    return {
      type: "application_orchestration",
      applicationId: stringOrNull(metadata.applicationId),
      applicationName: stringOrNull(metadata.applicationName),
      routineId: stringOrNull(metadata.routineId),
      routineName: stringOrNull(metadata.routineName),
      orchestrationRelativePath: stringOrNull(metadata.orchestrationRelativePath),
      recoveryOfInvocationId: stringOrNull(metadata.recoveryOfInvocationId),
      recoveryActionType: stringOrNull(metadata.recoveryActionType),
    };
  }
  if (stringOrNull(metadata.automationId)) {
    return {
      type: "automation",
      automationId: stringOrNull(metadata.automationId),
      automationName: stringOrNull(metadata.automationName),
      scheduled: Boolean(metadata.scheduled),
    };
  }
  if (autoRun) {
    return {
      type: "auto_run",
      autoRunId: autoRun.id ?? null,
      status: autoRun.status ?? null,
      worktreeId: autoRun.worktreeId ?? null,
      link: autoRun.link ?? null,
    };
  }
  if (compareRunId) {
    const compareRun = context.compareRunsById?.get(compareRunId) ?? null;
    return {
      type: "compare_run",
      compareRunId,
      status: compareRun?.status ?? null,
      preferredInvocationId: compareRun?.preferredInvocationId ?? null,
      siblingInvocationIds: (compareRun?.childInvocationIds ?? []).filter((id) => id !== invocation?.id),
    };
  }
  if (metadata.source === "tool" || stringOrNull(metadata.toolName)) {
    return {
      type: "tool",
      toolName: stringOrNull(metadata.toolName),
      outputCollection: stringOrNull(metadata.outputCollection),
    };
  }
  return { type: "direct" };
}

function statusSummary(invocation, { approval, audit, event, policy, report }) {
  const status = invocation?.status;
  if (status === "waiting_for_local_approval") return policy?.reason ?? "Invocation is blocked until local approval is resolved.";
  if (status === "rejected") return audit?.errorSummary ?? policy?.reason ?? "Invocation was rejected before execution.";
  if (status === "failed" || status === "timed_out") {
    return audit?.errorSummary ?? invocation?.result?.summary ?? event?.message ?? `Invocation ${status}.`;
  }
  if (status === "cancelled") return invocation?.cancellation?.reason ?? audit?.errorSummary ?? "Invocation was cancelled.";
  if (status === "cancelling") return "Cancellation was requested and is waiting for the runner to stop.";
  if (status === "succeeded") return invocation?.result?.summary ?? "Invocation completed successfully.";
  if (status === "queued") return "Invocation is queued for execution.";
  if (status === "dispatching") return "Invocation is being dispatched to the runner.";
  if (status === "running") return "Invocation is running.";
  if (report?.summary) return report.summary;
  if (approval?.request?.status === "denied") return "Local approval was denied.";
  return `Invocation status is ${status ?? "unknown"}.`;
}

function statusReason(invocation, { approval, audit, event, policy }) {
  const status = invocation?.status;
  if (status === "waiting_for_local_approval") return policy?.reason ?? "Local approval is required before this invocation can run.";
  if (status === "rejected") {
    if (approval?.request?.status === "denied") return "Local approval was denied before execution.";
    return audit?.errorSummary ?? policy?.reason ?? "Invocation was rejected before execution.";
  }
  if (status === "failed" || status === "timed_out") return audit?.errorSummary ?? event?.message ?? `Invocation ${status}.`;
  if (status === "cancelled") return invocation?.cancellation?.reason ?? "Invocation was cancelled before completion.";
  if (status === "queued") return "Waiting for an eligible runner.";
  if (status === "running" || status === "dispatching" || status === "cancelling") return "Work is still in progress.";
  if (status === "succeeded") return "Invocation succeeded.";
  return "No blocking reason is recorded.";
}

function statusReasonCode(invocation, { approval }) {
  const status = invocation?.status;
  if (status === "waiting_for_local_approval") return "local_approval_pending";
  if (status === "rejected" && approval?.request?.status === "denied") return "local_approval_denied";
  if (status === "rejected") return "rejected";
  if (status === "failed") return "failed";
  if (status === "timed_out") return "timed_out";
  if (status === "cancelled") return "cancelled";
  if (status === "queued") return "queued";
  if (status === "running" || status === "dispatching") return "in_progress";
  if (status === "succeeded") return "succeeded";
  return status ?? "unknown";
}

function statusWaitingOn(invocation, { approval, source }) {
  if (invocation?.status === "waiting_for_local_approval" && approval?.request) {
    return {
      type: "approval",
      id: approval.request.requestId,
      status: approval.request.status,
      label: `${approval.request.requestId} (${approval.request.status ?? "pending"})`,
    };
  }
  if (invocation?.status === "queued") {
    return {
      type: "runner",
      id: invocation.delivery?.deviceId ?? null,
      status: invocation.delivery?.state ?? "queued",
      label: invocation.delivery?.deviceId
        ? `${invocation.delivery.deviceId} (${invocation.delivery?.state ?? "queued"})`
        : "eligible runner",
    };
  }
  if (invocation?.status === "cancelling") {
    return {
      type: "runner",
      id: invocation.delivery?.deviceId ?? null,
      status: invocation.cancellation?.state ?? "requested",
      label: "runner cancellation acknowledgement",
    };
  }
  if (source?.type === "compare_run" && source.status === "running") {
    return {
      type: "compare_run",
      id: source.compareRunId,
      status: source.status,
      label: `${source.compareRunId} sibling results`,
    };
  }
  return null;
}

function statusResultLocation(invocation, { audit, report }) {
  if (report?.id) {
    return {
      type: "troubleshooting_report",
      reportId: report.id,
      label: report.id,
    };
  }
  if (invocation?.result) {
    return {
      type: "invocation_result",
      invocationId: invocation.id,
      label: invocation.result?.summary ?? invocation.id,
    };
  }
  if (audit) {
    return {
      type: "audit_summary",
      invocationId: invocation.id,
      label: audit.errorSummary ?? audit.resultSummary ?? "audit summary",
    };
  }
  return null;
}

function statusNextAction(invocation, { approval, report }) {
  const status = invocation?.status;
  if (status === "waiting_for_local_approval") return "Approve or deny the local approval request.";
  if (status === "rejected") return "Review the policy or approval decision, then retry only if the risk is acceptable.";
  if (status === "failed" || status === "timed_out") {
    return report?.id
      ? "Open the troubleshooting report and choose an approved remediation path."
      : "Review the timeline, run troubleshooting, or retry with adjusted inputs.";
  }
  if (status === "cancelled") return "Retry the invocation only if the work is still needed.";
  if (status === "cancelling") return "Wait for cancellation acknowledgement before starting replacement work.";
  if (status === "queued") return "Keep the target runner available and wait for dispatch.";
  if (status === "dispatching" || status === "running") return "Wait for the invocation to finish, then inspect the result.";
  if (status === "succeeded") return "Review the result and any generated evidence.";
  if (approval?.request?.status === "pending") return "Resolve the pending approval request.";
  return "Review the invocation timeline for the latest operator action.";
}

function invocationExplanationState(status, recovery, approval) {
  if (recovery?.request?.status === "approval_pending") return "approval_pending";
  if (recovery?.request?.status) return `recovery_${recovery.request.status}`;
  if (status === "waiting_for_local_approval") return "approval_pending";
  if (status === "rejected" && approval?.request?.status === "denied") return "approval_denied";
  return status ?? "unknown";
}

function latestOperatorEvent(events) {
  return latestRow((events ?? []).filter((event) =>
    ["invocation_failed", "invocation_timed_out", "invocation_rejected", "local_approval_denied", "cancel_applied", "cancel_failed"].includes(event?.type),
  ));
}

function latestRow(rows) {
  const items = (rows ?? []).filter(Boolean);
  if (items.length === 0) return null;
  return items.slice().sort(compareUpdatedDesc)[0];
}

function compareUpdatedDesc(left, right) {
  const rightTime = Date.parse(right?.updatedAt ?? right?.createdAt ?? right?.completedAt ?? "");
  const leftTime = Date.parse(left?.updatedAt ?? left?.createdAt ?? left?.completedAt ?? "");
  if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
    return rightTime - leftTime;
  }
  return String(right?.id ?? "").localeCompare(String(left?.id ?? ""));
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function applicationRecoveryActionReadModel(request, invocationsById, events = []) {
  const sourceInvocation = invocationsById.get(request.invocationId) ?? null;
  const resultInvocation = request.resultInvocationId
    ? invocationsById.get(request.resultInvocationId) ?? null
    : null;
  const outcome = applicationRecoveryOutcome(request, resultInvocation);
  const explanation = applicationRecoveryExplanation(request, outcome);
  return {
    ...request,
    outcome,
    outcomeReason: outcome.reason,
    explanation,
    sourceInvocation: sourceInvocation ? invocationBrief(sourceInvocation) : null,
    resultInvocation: resultInvocation ? invocationBrief(resultInvocation) : null,
    timeline: applicationRecoveryTimeline(request, events),
  };
}

function applicationRecoveryTimeline(request, events) {
  const entries = (events ?? [])
    .map((event) => ({
      id: event.id,
      type: event.type,
      status: recoveryTimelineStatus(event, request),
      level: event.level ?? "info",
      message: event.message ?? "",
      createdAt: event.createdAt,
    }))
    .sort(compareTimelineEntries);
  if (entries.length > 0) return entries;
  return [{
    id: `${request.id}:created`,
    type: "application_orchestration_recovery_action_created",
    status: request.status ?? "requested",
    level: request.status === "failed" ? "warn" : "info",
    message: `Application orchestration recovery action ${request.actionType} recorded.`,
    createdAt: request.createdAt,
  }];
}

function recoveryTimelineStatus(event, request) {
  const type = event?.type ?? "";
  const eventStatus = typeof event?.data?.status === "string" ? event.data.status : null;
  if (type === "application_orchestration_recovery_action_requested") {
    return eventStatus === "approval_pending" ? "approval_pending" : "requested";
  }
  if (type === "application_orchestration_recovery_approval_requested") return "approval_pending";
  if (type === "application_orchestration_recovery_approval_resolved") {
    return eventStatus ? `approval_${eventStatus}` : "approval_resolved";
  }
  if (type === "application_orchestration_recovery_action_executing") return "executing";
  if (type === "application_orchestration_recovery_action_executed") return "executed";
  if (type === "application_orchestration_recovery_action_failed") return "failed";
  if (type === "application_orchestration_recovery_action_rejected") return "rejected";
  return eventStatus ?? request.status ?? "recorded";
}

function compareTimelineEntries(left, right) {
  const leftTime = Date.parse(left?.createdAt ?? "");
  const rightTime = Date.parse(right?.createdAt ?? "");
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

function applicationRecoveryOutcome(request, resultInvocation) {
  if (request.status === "failed" || request.status === "unsupported") {
    return {
      state: "needs_attention",
      reason: request.error ?? "execution_failed_before_result",
      severity: "danger",
      summary: request.error ? `Recovery failed: ${request.error}.` : "Recovery failed before a result invocation was created.",
      nextStep: "Review the failure details and choose another recovery action.",
    };
  }
  if (["approval_pending", "approval_approved", "requested", "executing"].includes(request.status)) {
    return {
      state: "pending",
      reason: pendingRecoveryReason(request.status),
      severity: "info",
      summary: "Recovery is still pending or executing.",
      nextStep: request.status === "approval_pending"
        ? "Resolve the linked approval request before this recovery can execute."
        : "Wait for the recovery action to finish, then inspect the result invocation.",
    };
  }
  if (["approval_denied", "approval_timed_out"].includes(request.status)) {
    return {
      state: "needs_attention",
      reason: request.status,
      severity: "warning",
      summary: "Recovery approval did not complete.",
      nextStep: "Request approval again or choose a different recovery action.",
    };
  }
  if (!request.resultInvocationId) {
    const noop = request.status === "noop";
    return {
      state: noop ? "pending" : "needs_attention",
      reason: noop ? "no_result_expected" : "missing_result_invocation",
      severity: noop ? "info" : "warning",
      summary: noop ? "Recovery action did not create a new invocation." : "Recovery executed without a linked result invocation.",
      nextStep: noop ? "Inspect the source invocation evidence." : "Review the recovery action audit trail and retry if needed.",
    };
  }
  if (!resultInvocation) {
    return {
      state: "needs_attention",
      reason: "result_invocation_not_visible",
      severity: "warning",
      summary: "Recovery result invocation is no longer visible.",
      nextStep: "Check tenancy scope or retention before deciding whether to retry.",
    };
  }
  if (["succeeded", "completed"].includes(resultInvocation.status)) {
    return {
      state: "recovered",
      reason: "result_succeeded",
      severity: "success",
      summary: "Recovered invocation completed successfully.",
      nextStep: "No immediate action is required.",
    };
  }
  if (["failed", "cancelled", "denied"].includes(resultInvocation.status)) {
    return {
      state: "still_failed",
      reason: `result_${resultInvocation.status}`,
      severity: "danger",
      summary: `Recovered invocation ended as ${resultInvocation.status}.`,
      nextStep: "Open the recovered invocation, review the failure, and choose another recovery path.",
    };
  }
  return {
    state: "pending",
    reason: "result_in_progress",
    severity: "info",
    summary: `Recovered invocation is ${resultInvocation.status ?? "in progress"}.`,
    nextStep: "Wait for the recovered invocation to complete.",
  };
}

function applicationRecoveryExplanation(request, outcome) {
  return {
    selectedAction: request.actionType ?? null,
    state: recoveryExplanationState(request),
    reason: request.error ?? outcome.reason,
    summary: outcome.summary,
    nextStep: outcome.nextStep,
    outcomeState: outcome.state,
    recoveryCategory: request.recoveryCategory ?? null,
    recoveryActionRequestId: request.id ?? null,
    approvalRequestId: request.approvalRequestId ?? null,
    requestedAgentId: request.requestedAgentId ?? null,
    selectedAgentId: request.selectedAgentId ?? null,
    resultInvocationId: request.resultInvocationId ?? null,
    resultOrchestrationId: request.resultOrchestrationId ?? null,
    resultOrchestrationRelativePath: request.resultOrchestrationRelativePath ?? null,
  };
}

function recoveryExplanationState(request) {
  if (request.status === "noop") return "no_result_expected";
  if (request.status === "approval_pending") return "approval_pending";
  if (request.status === "approval_denied" || request.status === "approval_timed_out") return request.status;
  if (request.status === "unsupported") return "unsupported";
  if (request.status === "failed") return "failed";
  if (request.status === "executed") return "executed";
  if (request.status === "executing") return "executing";
  return request.status ?? "requested";
}

function pendingRecoveryReason(status) {
  if (status === "approval_pending") return "approval_pending";
  if (status === "approval_approved") return "approval_approved";
  if (status === "executing") return "recovery_executing";
  return "recovery_requested";
}

function invocationBrief(invocation) {
  return {
    id: invocation.id,
    status: invocation.status ?? null,
    agentId: invocation.agentId ?? null,
    createdAt: invocation.createdAt ?? null,
    updatedAt: invocation.updatedAt ?? null,
    completedAt: invocation.completedAt ?? null,
  };
}

function compareReviewFindings(left, right) {
  const rightTime = Date.parse(right?.createdAt ?? "");
  const leftTime = Date.parse(left?.createdAt ?? "");
  if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
    return rightTime - leftTime;
  }
  return String(right?.id ?? "").localeCompare(String(left?.id ?? ""));
}
