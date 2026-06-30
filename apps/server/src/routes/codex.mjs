export async function handleCodexRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
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
    const updated = resolveCodexApprovalBrokerRequest(request, approvalMatch[2]);
    sendJson(res, 200, { approvalRequest: updated });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/codex/imported-evidence") {
    const body = await readJson(req);
    let record;
    try {
      record = createCodexImportedEvidenceRecord(body);
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
      review = createCodexChangeReview(body);
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
