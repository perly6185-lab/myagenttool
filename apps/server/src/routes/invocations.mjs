export async function handleInvocationRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
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

    if (approvalMatch[2] === "approve") {
      approveInvocation(approval, invocation);
    } else {
      denyInvocation(approval, invocation);
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
    const invocation = createInvocation(task, agent, body.options ?? {});
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
    const compareRun = createCompareRun(task, agents, body.options ?? {});
    sendJson(res, 201, {
      compareRun,
      invocations: compareRun.childInvocationIds.map((id) => findInvocation(id)).filter(Boolean),
    });
    return true;
  }

  const cancelMatch = url.pathname.match(/^\/api\/invocations\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancelMatch) {
    const invocation = findInvocation(cancelMatch[1]);
    if (!invocation) {
      sendJson(res, 404, { error: "invocation_not_found" });
      return true;
    }
    cancelInvocation(invocation);
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
    if (!["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation.status)) {
      sendJson(res, 409, { error: "invocation_not_troubleshootable" });
      return true;
    }

    const report = createTroubleshootingReport(invocation);
    sendJson(res, 201, { report });
    return true;
  }

  return false;
}
