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
}) {
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
    const updated = resolveCodexApprovalBrokerRequest(request, approvalMatch[2]);
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

  return false;
}
