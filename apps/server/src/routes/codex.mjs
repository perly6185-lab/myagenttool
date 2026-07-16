import { denyForeignProject } from "../runtime/auth.mjs";

// Codex records are keyed on an invocation; scope them by that invocation's
// project, matching invocations.mjs (and how buildPublicState already scopes
// codex* reads by visible invocation). Same projectId fallback as that route.
function codexInvocationProjectId(state, invocationId) {
  const invocation = (state.invocations ?? []).find((item) => item.id === invocationId);
  return invocation?.projectId ?? invocation?.input?.metadata?.projectId ?? null;
}

export async function handleCodexRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  actor,
  recordCodexHookEvent,
  expireCodexApprovalBrokerRequests,
  resolveCodexApprovalBrokerRequest,
  createCodexImportedEvidenceRecord,
  createCodexChangeReview,
  createCodexExecReview,
  execRunPromotionGate,
  createWorktreePr,
  findInvocation,
  appendEvent,
  setCodexSessionName,
  resumableCodexSessions,
}) {
  // #123: name a session (user-authored label; tenancy inside the service).
  const nameMatch = url.pathname.match(/^\/api\/codex\/sessions\/([^/]+)\/name$/);
  if (req.method === "POST" && nameMatch && typeof setCodexSessionName === "function") {
    const body = await readJson(req);
    const result = setCodexSessionName(decodeURIComponent(nameMatch[1]), body?.name, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  // #123: the resume picker — sessions the CALLER can continue, safe metadata only.
  if (req.method === "GET" && url.pathname === "/api/codex/sessions/resumable" && typeof resumableCodexSessions === "function") {
    const sessions = resumableCodexSessions({
      repoPath: url.searchParams.get("repoPath") || null,
      userId: actor?.userId ?? null,
    });
    sendJson(res, 200, { sessions });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/codex/hooks") {
    const body = await readJson(req);
    let result;
    try {
      result = recordCodexHookEvent(body);
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_codex_hook_event",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, 202, result);
    return true;
  }

  const approvalReadMatch = url.pathname.match(/^\/api\/codex\/approval-broker\/([^/]+)$/);
  if (req.method === "GET" && approvalReadMatch) {
    expireCodexApprovalBrokerRequests();
    const requestId = decodeURIComponent(approvalReadMatch[1]);
    const request = state.codexApprovalBrokerRequests.find((item) => item.id === requestId);
    if (!request) {
      sendJson(res, 404, { error: "codex_approval_request_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: codexInvocationProjectId(state, request.invocationId), notFound: { error: "codex_approval_request_not_found" } })) {
      return true;
    }
    sendJson(res, 200, { approvalRequest: request });
    return true;
  }

  const approvalMatch = url.pathname.match(/^\/api\/codex\/approval-broker\/([^/]+)\/(approve|deny)$/);
  if (req.method === "POST" && approvalMatch) {
    expireCodexApprovalBrokerRequests();
    const requestId = decodeURIComponent(approvalMatch[1]);
    const request = state.codexApprovalBrokerRequests.find((item) => item.id === requestId);
    if (!request) {
      sendJson(res, 404, { error: "codex_approval_request_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: codexInvocationProjectId(state, request.invocationId), notFound: { error: "codex_approval_request_not_found" } })) {
      return true;
    }
    // #1151: a settled broker request is immutable (the service already no-ops);
    // tell the second operator who decided instead of silently echoing the row.
    if (request.status !== "pending") {
      sendJson(res, 200, {
        approvalRequest: request,
        alreadyDecided: { decidedBy: request.decidedBy ?? null, decidedAt: request.decidedAt ?? null, status: request.status },
      });
      return true;
    }
    const updated = resolveCodexApprovalBrokerRequest(request, approvalMatch[2], actor);
    sendJson(res, 200, { approvalRequest: updated });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/codex/imported-evidence") {
    const body = await readJson(req);
    let record;
    try {
      record = createCodexImportedEvidenceRecord(body, actor);
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_codex_imported_evidence",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, 201, { importedEvidence: record });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/codex/change-reviews") {
    const body = await readJson(req);
    let review;
    try {
      // Tenancy is enforced inside the service: a foreign-team evidence record
      // is rejected with the same "unknown evidenceId" 400 as a missing one, so
      // a cross-team caller can't tell them apart (no existence leak, no write).
      review = createCodexChangeReview(body, actor);
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_codex_change_review",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, 201, { changeReview: review });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/codex-exec/change-reviews") {
    const body = await readJson(req);
    let review;
    try {
      // Tenancy is enforced inside the service: a foreign-team exec change is
      // rejected with the same "unknown execChangeId" 400 as a missing one, so a
      // cross-team caller can't tell them apart (no existence leak, no write).
      review = createCodexExecReview(body, actor);
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_codex_exec_review",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, 201, { execChangeReview: review });
    return true;
  }

  // Phase 3: promote an approved exec changeset by opening a PR from its worktree.
  // The approval gate is enforced BEFORE any PR machinery runs — a partially
  // reviewed changeset never reaches a PR.
  const promoteMatch = url.pathname.match(/^\/api\/codex-exec\/invocations\/([^/]+)\/promote$/);
  if (req.method === "POST" && promoteMatch && typeof execRunPromotionGate === "function") {
    const invocationId = decodeURIComponent(promoteMatch[1]);
    const invocation = typeof findInvocation === "function" ? findInvocation(invocationId) : null;
    if (!invocation) {
      sendJson(res, 404, { error: "invocation_not_found" });
      return true;
    }
    // Tenancy: scope by the invocation's project, same as other codex routes.
    if (denyForeignProject({ res, sendJson, state, actor, projectId: codexInvocationProjectId(state, invocationId), notFound: { error: "invocation_not_found" } })) {
      return true;
    }
    const gate = execRunPromotionGate(invocationId);
    if (!gate.ok) {
      sendJson(res, 409, {
        error: gate.reason === "no_changes" ? "no_exec_changes" : "exec_changes_not_approved",
        message: gate.reason === "no_changes"
          ? "This exec run produced no changes to promote."
          : "Every exec change must be approved before the changeset can be promoted.",
        unapproved: gate.unapproved,
      });
      return true;
    }
    const worktreeId = invocation.options?.metadata?.worktreeId ?? null;
    if (!worktreeId) {
      sendJson(res, 409, { error: "worktree_not_found", message: "The exec invocation has no worktree to promote." });
      return true;
    }
    let body = {};
    try {
      body = (await readJson(req)) ?? {};
    } catch {
      body = {};
    }
    try {
      const result = await createWorktreePr(worktreeId, { title: body.title, body: body.body, base: body.base });
      if (typeof appendEvent === "function") {
        appendEvent({
          invocationId,
          type: "codex_exec_promoted",
          level: "info",
          message: `Promoted approved Codex exec changeset (${gate.changes.length} change(s)) to a pull request.`,
          data: { worktreeId, changeCount: gate.changes.length },
        });
      }
      sendJson(res, 200, { promoted: true, invocationId, worktreeId, result });
    } catch (error) {
      sendJson(res, 400, { error: "worktree_pr_failed", message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  return false;
}
