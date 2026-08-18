import {
  agentAdapterSupportsModel,
  normalizeAgentModel,
} from "@myagenttool/protocol/agent-models";

import { computeInvocationDispatchHealth } from "../read-models/invocation-dispatch-health.mjs";
import { computeLocalScheduleCapacity } from "../read-models/local-schedule-capacity.mjs";
import { computeLocalSchedulePreview } from "../read-models/local-schedule-preview.mjs";
import { computeLocalScheduleRollover } from "../read-models/local-schedule-rollover.mjs";
import { computeLocalScheduleUrgent } from "../read-models/local-schedule-urgent.mjs";
import { searchTraceRecords } from "../read-models/trace-search.mjs";
import { denyForeignProject } from "../runtime/auth.mjs";
import { currentDeviceTimeZone } from "../runtime/device.mjs";

export async function handleInvocationRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  actor,
  findApprovalRequest,
  findInvocation,
  listInvocationEvents,
  listInvocationRefusals,
  getInvocationTrace,
  approveInvocation,
  denyInvocation,
  findAgent,
  defaultAgent,
  createInvocation,
  startInvocationIfAllowed,
  normalizeStringArray,
  createCompareRun,
  setCompareRunPreferred,
  promoteCompareRun,
  cancelInvocation,
  createTroubleshootingReport,
  claimDecision,
  releaseDecisionClaim,
  applyLocalSchedulePlan,
  applyLocalScheduleRollover,
  applyLocalScheduleUrgent,
}) {
  const schedulePreview = (capacity, generatedAt) => computeLocalSchedulePreview(capacity, {
    now: () => generatedAt,
    timeZone: currentDeviceTimeZone(state),
  });
  if (req.method === "GET" && url.pathname === "/api/traces") {
    sendJson(res, 200, searchTraceRecords({
      state,
      actor,
      query: url.searchParams.get("q") ?? "",
      cursor: url.searchParams.get("cursor"),
      limit: url.searchParams.get("limit"),
    }));
    return true;
  }

  // #1151 decision soft-claims: mark a pending-decision row "I'm handling this".
  // Advisory — a 409 tells the caller who holds the marker, but the decision
  // endpoints themselves are never gated by it. `:id` is the pendingDecisions
  // row id ("<kind>:<record id>").
  const decisionClaimMatch = url.pathname.match(/^\/api\/pending-decisions\/([^/]+)\/(claim|release)$/);
  if (decisionClaimMatch && req.method === "POST") {
    const decisionId = decodeURIComponent(decisionClaimMatch[1]);
    if (decisionClaimMatch[2] === "claim") {
      const result = claimDecision({ decisionId, actor });
      if (!result.ok && result.claim) {
        sendJson(res, 409, { error: "decision_already_claimed", message: result.reason, claim: result.claim });
        return true;
      }
      if (!result.ok) {
        sendJson(res, 400, { error: "invalid_decision_claim", message: result.reason });
        return true;
      }
      sendJson(res, 201, { claim: result.claim, renewed: result.renewed === true });
      return true;
    }
    sendJson(res, 200, { released: releaseDecisionClaim({ decisionId, actor }) });
    return true;
  }

  // Layer-A dispatch observability: why queued invocations aren't running, how
  // long they've waited, device capacity, and dispatch latency. The queue/stats
  // are team-scoped (only this actor's work); device capacity is global infra.
  // Mirrors /api/dispatch-evaluation, which is the Layer-B (issue→worker) view.
  if (req.method === "GET" && url.pathname === "/api/invocation-dispatch-health") {
    const teamId = actor?.teamId ?? null;
    const visibleInvocation = (invocation) => {
      if (teamId == null) return true;
      const projectId = invocationProjectId(invocation);
      if (projectId) {
        const project = (state.projects ?? []).find((p) => p.id === projectId);
        return (project?.ownerTeamId ?? null) === teamId;
      }
      const requester = (state.users ?? []).find((user) => user.id === invocation?.requestedBy);
      return (requester?.teamId ?? "team_local") === teamId;
    };
    const visibleProject = (projectId) => {
      if (teamId == null) return true;
      const project = (state.projects ?? []).find((item) => item.id === projectId);
      return (project?.ownerTeamId ?? null) === teamId;
    };
    sendJson(res, 200, computeInvocationDispatchHealth(state, {
      findAgent,
      now: () => new Date().toISOString(),
      visibleInvocation,
      visibleProject,
    }));
    return true;
  }

  // Planning input for the personal three-day workbench. The read model is
  // intentionally bound to state.device; it never searches for, scores, or
  // assigns work to another terminal.
  if (req.method === "GET" && url.pathname === "/api/local-schedule/capacity") {
    const generatedAt = new Date().toISOString();
    sendJson(res, 200, localScheduleCapacityForActor(state, actor, findAgent, generatedAt));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/local-schedule/preview") {
    const generatedAt = new Date().toISOString();
    const capacity = localScheduleCapacityForActor(state, actor, findAgent, generatedAt);
    sendJson(res, 200, schedulePreview(capacity, generatedAt));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/local-schedule/apply") {
    const body = await readJson(req);
    const generatedAt = new Date().toISOString();
    const capacity = localScheduleCapacityForActor(state, actor, findAgent, generatedAt);
    const preview = schedulePreview(capacity, generatedAt);
    let scheduleOrder = 0;
    const assignments = preview.days.flatMap((day) => day.items.map((item) => ({
      workItemId: item.workItemId,
      sourceKind: item.sourceKind,
      sourceId: item.sourceId,
      expectedRevision: item.expectedRevision,
      plannedDate: day.date,
      scheduleOrder: scheduleOrder++,
    })));
    const result = applyLocalSchedulePlan({
      planRevision: body?.planRevision,
      currentPlanRevision: preview.planRevision,
      assignments,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/local-schedule/rollover-preview") {
    const generatedAt = new Date().toISOString();
    const capacity = localScheduleCapacityForActor(state, actor, findAgent, generatedAt);
    const preview = schedulePreview(capacity, generatedAt);
    sendJson(res, 200, computeLocalScheduleRollover(capacity, preview));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/local-schedule/rollover") {
    const body = await readJson(req);
    const generatedAt = new Date().toISOString();
    const capacity = localScheduleCapacityForActor(state, actor, findAgent, generatedAt);
    const preview = schedulePreview(capacity, generatedAt);
    const rollover = computeLocalScheduleRollover(capacity, preview);
    const result = applyLocalScheduleRollover({
      rolloverRevision: body?.rolloverRevision,
      currentRolloverRevision: rollover.rolloverRevision,
      sourceDate: rollover.sourceDate,
      moves: rollover.moves,
      confirmationMoves: rollover.confirmationRequired,
      confirmPinned: body?.confirmPinned === true,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/local-schedule/urgent-preview") {
    const generatedAt = new Date().toISOString();
    const capacity = localScheduleCapacityForActor(state, actor, findAgent, generatedAt);
    const preview = schedulePreview(capacity, generatedAt);
    sendJson(res, 200, computeLocalScheduleUrgent(capacity, preview));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/local-schedule/urgent") {
    const body = await readJson(req);
    const generatedAt = new Date().toISOString();
    const capacity = localScheduleCapacityForActor(state, actor, findAgent, generatedAt);
    const preview = schedulePreview(capacity, generatedAt);
    const urgent = computeLocalScheduleUrgent(capacity, preview);
    const result = applyLocalScheduleUrgent({
      urgentRevision: body?.urgentRevision,
      currentUrgentRevision: urgent.urgentRevision,
      date: urgent.date,
      insertions: urgent.insertions,
      displacements: urgent.displacements,
      confirmationRequired: urgent.confirmationRequired,
      confirmPinned: body?.confirmPinned === true,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  // The trace tree for one invocation (trace + spans), including the spans the
  // count cap evicted to the durable archive. Same existence-hiding tenancy guard.
  const traceMatch = url.pathname.match(/^\/api\/invocations\/([^/]+)\/trace$/);
  if (req.method === "GET" && traceMatch && typeof getInvocationTrace === "function") {
    const invocationId = decodeURIComponent(traceMatch[1]);
    const invocation = findInvocation(invocationId);
    if (!invocation) {
      sendJson(res, 404, { error: "invocation_not_found" });
      return true;
    }
    if (denyForeignInvocationRead({ res, sendJson, state, actor, invocation })) {
      return true;
    }
    sendJson(res, 200, getInvocationTrace(invocation, { limit: url.searchParams.get("limit") }));
    return true;
  }

  // Refusals for one invocation, including the ones the 200-row cap evicted to the
  // durable archive. Same existence-hiding tenancy guard as the events surface.
  const refusalsMatch = url.pathname.match(/^\/api\/invocations\/([^/]+)\/refusals$/);
  if (req.method === "GET" && refusalsMatch && typeof listInvocationRefusals === "function") {
    const invocationId = decodeURIComponent(refusalsMatch[1]);
    const invocation = findInvocation(invocationId);
    if (!invocation) {
      sendJson(res, 404, { error: "invocation_not_found" });
      return true;
    }
    if (denyForeignInvocationRead({ res, sendJson, state, actor, invocation })) {
      return true;
    }
    sendJson(res, 200, listInvocationRefusals(invocation, { limit: url.searchParams.get("limit") }));
    return true;
  }

  const eventsMatch = url.pathname.match(/^\/api\/invocations\/([^/]+)\/events$/);
  if (req.method === "GET" && eventsMatch) {
    const invocationId = decodeURIComponent(eventsMatch[1]);
    const invocation = findInvocation(invocationId);
    if (!invocation) {
      sendJson(res, 404, { error: "invocation_not_found" });
      return true;
    }
    // Authorize against the durable invocation, never archive row metadata. Read
    // the archive only after the existence-hiding project/team guard succeeds.
    if (denyForeignInvocationRead({ res, sendJson, state, actor, invocation })) {
      return true;
    }
    try {
      sendJson(res, 200, listInvocationEvents(invocation, {
        limit: url.searchParams.get("limit"),
        before: url.searchParams.get("before"),
      }));
    } catch (error) {
      if (error?.code === "invalid_cursor") {
        sendJson(res, 400, { error: "invalid_cursor", message: error.message });
      } else {
        throw error;
      }
    }
    return true;
  }

  const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/);
  if (req.method === "POST" && approvalMatch) {
    const approval = findApprovalRequest(decodeURIComponent(approvalMatch[1]));
    if (!approval) {
      sendJson(res, 404, { error: "approval_not_found" });
      return true;
    }
    const invocation = findInvocation(approval.invocationId);
    if (!invocation) {
      sendJson(res, 404, { error: "invocation_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: invocationProjectId(invocation), notFound: { error: "invocation_not_found" } })) {
      return true;
    }

    // #1151: acting on a settled approval was a silent 200 no-op — the second
    // operator never learned they lost the race. Same 200 + record shape, plus
    // an explicit "already decided by X at T".
    if (approval.status !== "pending") {
      sendJson(res, 200, {
        approval,
        invocation,
        alreadyDecided: { decidedBy: approval.decidedBy ?? null, decidedAt: approval.decidedAt ?? null, status: approval.status },
      });
      return true;
    }
    if (approvalMatch[2] === "approve") {
      approveInvocation(approval, invocation, actor);
    } else {
      denyInvocation(approval, invocation, actor);
    }
    sendJson(res, 200, { approval, invocation });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/invocations") {
    const body = await readJson(req);
    const task = String(body.task ?? "").trim();
    if (!task) {
      sendJson(res, 400, { error: "task_required" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: body.projectId })) {
      return true;
    }
    const agent = body.agentId ? findAgent(body.agentId) : defaultAgent();
    if (!agent) {
      sendJson(res, 404, { error: "agent_not_found", message: "The selected Agent is no longer available." });
      return true;
    }
    if (agent.status === "disabled") {
      sendJson(res, 409, { error: "agent_disabled", message: "The selected Agent is disabled." });
      return true;
    }
    if (agent.health?.status === "unhealthy") {
      sendJson(res, 409, {
        error: "agent_unhealthy",
        message: agent.health.message || "The selected Agent is unhealthy.",
      });
      return true;
    }
    if (agent.location.type === "local_device" && state.device.unlinkState !== "linked") {
      sendJson(res, 409, { error: "device_unlinked", message: "The local device is unlinked." });
      return true;
    }
    // Idempotency key: accept the standard `Idempotency-Key` header or a body
    // field so a retried create returns the same run instead of a duplicate.
    const invocationOptions = invocationOptionsFromBody(body);
    const rawOptions = body.options && typeof body.options === "object" && !Array.isArray(body.options)
      ? body.options
      : {};
    const hasRequestedModel = rawOptions.model != null && String(rawOptions.model).trim() !== "";
    // `invocationOptionsFromBody` deliberately strips unsafe model ids. Treat an
    // explicitly supplied but stripped value as a refusal instead of silently
    // falling back to the Agent default and running a different snapshot.
    if (hasRequestedModel && (!invocationOptions.model || !agentAdapterSupportsModel(agent.adapter, invocationOptions.model))) {
      sendJson(res, 400, {
        error: "model_not_supported",
        message: "The selected model is not supported by this Agent.",
      });
      return true;
    }
    if (denyForeignInvocationScope({ res, sendJson, state, actor, metadata: invocationOptions.metadata })) {
      return true;
    }
    const {
      actor: _clientActor,
      idempotencyKey: _clientIdempotencyKey,
      requestedBy: _clientRequestedBy,
      preApproved: _clientPreApproved, // server-internal only — a client must never skip the local-approval gate
      ...safeInvocationOptions
    } = invocationOptions;
    const idempotencyKey = String(req.headers["idempotency-key"] ?? body.idempotencyKey ?? "").trim() || undefined;
    const invocation = createInvocation(task, agent, { ...safeInvocationOptions, idempotencyKey, actor });
    startInvocationIfAllowed(invocation, agent);
    sendJson(res, 201, { invocation });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/compare-runs") {
    const body = await readJson(req);
    const task = String(body.task ?? "").trim();
    const agentIds = normalizeStringArray(body.agentIds);
    if (!task) {
      sendJson(res, 400, { error: "task_required" });
      return true;
    }
    if (agentIds.length < 2) {
      sendJson(res, 400, { error: "compare_agents_required" });
      return true;
    }
    const agents = agentIds.map((id) => findAgent(id));
    if (agents.some((agent) => !agent)) {
      sendJson(res, 404, { error: "agent_not_found" });
      return true;
    }
    const blocked = agents.find((agent) => agent.status === "disabled" || agent.health?.status === "unhealthy");
    if (blocked) {
      sendJson(res, 409, { error: "agent_not_ready", agentId: blocked.id });
      return true;
    }
    const compareOptions = body.options && typeof body.options === "object" && !Array.isArray(body.options) ? body.options : {};
    const compareMetadata = stripReservedInvocationMetadata(compareOptions.metadata);
    if (denyForeignInvocationScope({ res, sendJson, state, actor, metadata: compareMetadata })) {
      return true;
    }
    // P4.2: an optional projectId isolates each agent in its own worktree. Guard it
    // like any project-scoped action so a foreign actor can't spawn worktrees in
    // another team's project.
    const compareProjectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
    if (compareProjectId && denyForeignProject({ res, sendJson, state, actor, projectId: compareProjectId, notFound: { error: "project_not_found" } })) {
      return true;
    }
    const {
      actor: _clientActor,
      idempotencyKey: _clientIdempotencyKey,
      requestedBy: _clientRequestedBy,
      projectId: _clientProjectId,
      preApproved: _clientPreApproved, // server-internal only
      ...safeCompareOptions
    } = compareOptions;
    const compareRun = createCompareRun(task, agents, {
      ...safeCompareOptions,
      projectId: compareProjectId,
      metadata: compareMetadata,
      actor,
    });
    sendJson(res, 201, {
      compareRun,
      invocations: compareRun.childInvocationIds.map((id) => findInvocation(id)).filter(Boolean),
    });
    return true;
  }

  // P4.2c: a human picks the winning agent for a compare run.
  const preferMatch = url.pathname.match(/^\/api\/compare-runs\/([^/]+)\/prefer$/);
  if (preferMatch && req.method === "POST") {
    const compareRunId = decodeURIComponent(preferMatch[1]);
    const compareRun = state.compareRuns.find((c) => c.id === compareRunId);
    if (!compareRun) { sendJson(res, 404, { error: "compare_run_not_found" }); return true; }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: compareRunProjectId(compareRun, findInvocation), notFound: { error: "compare_run_not_found" } })) return true;
    try {
      const body = await readJson(req);
      const result = setCompareRunPreferred(compareRunId, String(body.invocationId ?? ""), { actor });
      sendJson(res, 200, { compareRun: result });
    } catch (error) {
      sendJson(res, 400, { error: "prefer_failed", message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  // P4.2c: promote the preferred agent's worktree — open its PR.
  const promoteMatch = url.pathname.match(/^\/api\/compare-runs\/([^/]+)\/promote$/);
  if (promoteMatch && req.method === "POST") {
    const compareRunId = decodeURIComponent(promoteMatch[1]);
    const compareRun = state.compareRuns.find((c) => c.id === compareRunId);
    if (!compareRun) { sendJson(res, 404, { error: "compare_run_not_found" }); return true; }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: compareRunProjectId(compareRun, findInvocation), notFound: { error: "compare_run_not_found" } })) return true;
    // #1151: promote is already idempotent in the service (returns the run
    // unchanged); surface who promoted instead of an indistinguishable success.
    if (compareRun.promotion?.prNumber) {
      sendJson(res, 200, {
        compareRun,
        alreadyDecided: { decidedBy: compareRun.promotion.by ?? null, decidedAt: compareRun.promotion.at ?? null, status: "promoted" },
      });
      return true;
    }
    try {
      const result = await promoteCompareRun(compareRunId, { actor });
      sendJson(res, 200, { compareRun: result });
    } catch (error) {
      sendJson(res, 400, { error: "promote_failed", message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  // #1072: per-run stream transcript, guarded exactly like reading the
  // invocation itself. Deliberately NOT part of the /api/state snapshot — a
  // transcript can be 256KB and belongs behind an on-demand fetch.
  const transcriptMatch = url.pathname.match(/^\/api\/invocations\/([^/]+)\/transcript$/);
  if (req.method === "GET" && transcriptMatch) {
    const invocation = findInvocation(decodeURIComponent(transcriptMatch[1]));
    if (!invocation) {
      sendJson(res, 404, { error: "invocation_not_found" });
      return true;
    }
    if (denyForeignInvocationRead({ res, sendJson, state, actor, invocation })) {
      return true;
    }
    const transcript = (state.runTranscripts ?? []).find((item) => item?.invocationId === invocation.id) ?? null;
    sendJson(res, 200, { invocationId: invocation.id, transcript });
    return true;
  }

  const cancelMatch = url.pathname.match(/^\/api\/invocations\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancelMatch) {
    const invocation = findInvocation(cancelMatch[1]);
    if (!invocation) {
      sendJson(res, 404, { error: "invocation_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: invocationProjectId(invocation), notFound: { error: "invocation_not_found" } })) {
      return true;
    }
    cancelInvocation(invocation, actor);
    sendJson(res, 200, { invocation });
    return true;
  }

  const troubleshootMatch = url.pathname.match(/^\/api\/invocations\/([^/]+)\/troubleshoot$/);
  if (req.method === "POST" && troubleshootMatch) {
    const invocation = findInvocation(troubleshootMatch[1]);
    if (!invocation) {
      sendJson(res, 404, { error: "invocation_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: invocationProjectId(invocation), notFound: { error: "invocation_not_found" } })) {
      return true;
    }
    if (!["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation.status)) {
      sendJson(res, 409, { error: "invocation_not_troubleshootable" });
      return true;
    }

    const report = createTroubleshootingReport(invocation, actor);
    sendJson(res, 201, { report });
    return true;
  }

  return false;
}

// The project an invocation belongs to, for tenancy checks. Creation stores it
// top-level (invocation.projectId) and in metadata; fall back through both.
function invocationProjectId(invocation) {
  return invocation?.projectId
    ?? invocation?.options?.metadata?.projectId
    ?? invocation?.input?.metadata?.projectId
    ?? null;
}

function localScheduleCapacityForActor(state, actor, findAgent, generatedAt) {
  const teamId = actor?.teamId ?? null;
  const userId = actor?.userId ?? null;
  const visibleInvocation = (invocation) => {
    if (teamId == null) return true;
    const projectId = invocationProjectId(invocation);
    if (projectId) {
      const project = (state.projects ?? []).find((item) => item.id === projectId);
      return (project?.ownerTeamId ?? null) === teamId;
    }
    const requester = (state.users ?? []).find((user) => user.id === invocation?.requestedBy);
    return (requester?.teamId ?? "team_local") === teamId;
  };
  const visibleProject = (projectId) => {
    if (teamId == null) return true;
    const project = (state.projects ?? []).find((item) => item.id === projectId);
    return (project?.ownerTeamId ?? null) === teamId;
  };
  const visibleWorkItem = (item) =>
    (teamId == null || (item.ownerTeamId ?? "team_local") === teamId)
    && (userId == null || (item.assigneeIds ?? []).includes(userId));
  const visibleAutoRun = (run) => visibleProject(run?.projectId);
  const visibleRuntimeSchedule = (schedule) =>
    (teamId == null || (schedule.ownerTeamId ?? "team_local") === teamId)
    && (userId == null || schedule.userId === userId)
    && (!schedule.terminalId || schedule.terminalId === state.device?.id);
  return computeLocalScheduleCapacity(state, {
    findAgent,
    now: () => generatedAt,
    visibleInvocation,
    visibleProject,
    visibleWorkItem,
    visibleAutoRun,
    visibleRuntimeSchedule,
  });
}

function denyForeignInvocationRead({ res, sendJson, state, actor, invocation }) {
  const projectId = invocationProjectId(invocation);
  if (projectId) {
    return denyForeignProject({
      res,
      sendJson,
      state,
      actor,
      projectId,
      notFound: { error: "invocation_not_found" },
    });
  }
  if (!actor?.teamId) return false;
  const requester = (state.users ?? []).find((user) => user.id === invocation?.requestedBy);
  const ownerTeamId = requester?.teamId ?? "team_local";
  if (ownerTeamId === actor.teamId) return false;
  sendJson(res, 404, { error: "invocation_not_found" });
  return true;
}

// The project a compare run is anchored to for tenancy — its own projectId, or (for
// a shared/answer compare that has none) the first child invocation's project.
// Guarding on compareRun.projectId ALONE skips shared compares, letting a foreign
// actor prefer/promote them; a shared compare's children still carry the creator's
// project (createInvocation's currentProject fallback), so anchor on that.
function compareRunProjectId(compareRun, findInvocation) {
  if (compareRun?.projectId) return compareRun.projectId;
  for (const id of compareRun?.childInvocationIds ?? []) {
    const pid = invocationProjectId(typeof findInvocation === "function" ? findInvocation(id) : null);
    if (pid) return pid;
  }
  return null;
}

function denyForeignInvocationScope({ res, sendJson, state, actor, metadata }) {
  if (denyForeignProject({
    res,
    sendJson,
    state,
    actor,
    projectId: metadata?.projectId,
    notFound: { error: "project_not_found" },
  })) {
    return true;
  }
  const worktreeWasSupplied = metadata?.worktreeId !== undefined && metadata?.worktreeId !== null;
  if (!worktreeWasSupplied) return false;
  const worktreeId = typeof metadata.worktreeId === "string" ? metadata.worktreeId.trim() : "";
  const worktree = worktreeId ? (state.worktrees ?? []).find((item) => item.id === worktreeId) : null;
  if (!worktree) {
    sendJson(res, 404, { error: "worktree_not_found" });
    return true;
  }

  const worktreeProjectId = worktree.workspaceProjectId ?? worktree.projectId;
  return denyForeignProject({
    res,
    sendJson,
    state,
    actor,
    projectId: worktreeProjectId,
    notFound: { error: "worktree_not_found" },
  });
}

// Metadata keys that only the governed application-capability dispatch may set
// (tools.mjs / capabilities.mjs build them server-side from an approved plan).
// A client MUST NOT be able to supply these on /api/invocations: in particular
// `applicationWrapper` carries the exact command the bridge runs, so honoring a
// client-supplied value on an invocation targeting the Application Wrapper Runner
// would be arbitrary command execution on the bridge host.
const RESERVED_INVOCATION_METADATA_KEYS = [
  "applicationWrapper",
  "providerType",
  "applicationId",
  "capability",
  "platformManagedAi",
  "teamId",
  "provider",
  "model",
  "requestCount",
  "estimatedCost",
  "costOwner",
  "allowedModels",
  "credentialState",
  "economicModel",
  "unitPrice",
  "currency",
  "revenueOwner",
  "budgetPoolId",
];

export function stripReservedInvocationMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const clean = { ...metadata };
  for (const key of RESERVED_INVOCATION_METADATA_KEYS) delete clean[key];
  return clean;
}

export function invocationOptionsFromBody(body = {}) {
  const options = body.options && typeof body.options === "object" && !Array.isArray(body.options) ? body.options : {};
  const metadata = stripReservedInvocationMetadata(options.metadata);
  if (body.projectId !== undefined) metadata.projectId = body.projectId;
  if (body.worktreeId !== undefined) metadata.worktreeId = body.worktreeId;
  // The web composer nests permissionLevel inside options; older callers pass it
  // at the top level. Accept both, else metadata.permissionMode never gets set and
  // codex falls back to "ask" — a "Full access" run then stalls on every approval.
  const permissionLevel = body.permissionLevel ?? options.permissionLevel;
  if (permissionLevel !== undefined) metadata.permissionMode = permissionLevel;
  const model = normalizeAgentModel(options.model);
  const { model: _untrustedModel, ...safeOptions } = options;
  return { ...safeOptions, ...(model ? { model } : {}), metadata };
}
