// Approval-grant issuance (docs/design/APPROVAL_GRANTS.md). The grant is the
// deliberate-intent record behind every approvalToken field: single-use,
// action+target scoped, 10-minute TTL, human actors only.
export async function handleApprovalGrantRoutes({ req, res, url, sendJson, readJson, actor, issueApprovalGrant }) {
  if (req.method === "POST" && url.pathname === "/api/approvals/grants") {
    const body = await readJson(req);
    const result = issueApprovalGrant({ action: body?.action, targetId: body?.targetId }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  return false;
}
