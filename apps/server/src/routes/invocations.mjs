import { denyForeignProject } from "../runtime/auth.mjs";

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
}) {
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
      sendJson(res, 404, { error: "agent_not_found" });
      return true;
    }
    if (agent.status === "disabled") {
      sendJson(res, 409, { error: "agent_disabled" });
      return true;
    }
    if (agent.health?.status === "unhealthy") {
      sendJson(res, 409, {
        error: "agent_unhealthy",
        message: agent.health.message,
      });
      return true;
    }
    if (agent.location.type === "local_device" && state.device.unlinkState !== "linked") {
      sendJson(res, 409, { error: "device_unlinked" });
      return true;
    }
    // Idempotency key: accept the standard `Idempotency-Key` header or a body
    // field so a retried create returns the same run instead of a duplicate.
    const invocationOptions = invocationOptionsFromBody(body);
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
    try {
      const result = await promoteCompareRun(compareRunId, { actor });
      sendJson(res, 200, { compareRun: result });
    } catch (error) {
      sendJson(res, 400, { error: "promote_failed", message: error instanceof Error ? error.message : String(error) });
    }
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
  return invocation?.projectId ?? invocation?.input?.metadata?.projectId ?? null;
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
  const worktreeId = typeof metadata?.worktreeId === "string" ? metadata.worktreeId : null;
  const worktree = worktreeId ? (state.worktrees ?? []).find((item) => item.id === worktreeId) : null;
  if (!worktree) return false;
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
  return { ...options, metadata };
}
