export function createInvocationCompletionRuntime({
  state,
  now,
  appendEvent,
  persistStateSoon,
  namespace,
  protocolVersion,
  findAgent,
  findInvocation,
  closeCodexSession,
  isTerminal,
  recordInvocationLedgerEntry,
  recordCcusageImportedEstimates,
}) {
  function completeInvocation(invocation, body) {
    if (isTerminal(invocation.status)) {
      return;
    }
    const terminalStatus =
      body.status === "cancelled"
        ? "cancelled"
        : body.status === "timed_out"
          ? "timed_out"
          : body.status === "failed"
            ? "failed"
            : "succeeded";
    invocation.status = terminalStatus;
    invocation.result = body.result ?? null;
    invocation.completedAt = now();
    invocation.updatedAt = now();
    completeRootSpan(invocation, terminalStatus);
    if (terminalStatus === "cancelled") {
      invocation.cancellation.state = "applied";
    }

    appendEvent({
      invocationId: invocation.id,
      type:
        terminalStatus === "succeeded"
          ? "invocation_succeeded"
          : terminalStatus === "cancelled"
            ? "cancel_applied"
            : terminalStatus === "timed_out"
              ? "invocation_timed_out"
              : "invocation_failed",
      level: terminalStatus === "succeeded" ? "info" : "warn",
      message: body.summary ?? `Invocation ${terminalStatus}.`,
      data: body.result ?? null
    });
    state.auditSummaries.push(createAuditSummary(invocation, body.summary ?? null));
    recordAgentUsage(invocation, terminalStatus);
    // Attribute an agent-reported run cost (e.g. Claude's total_cost_usd, which
    // the bridge surfaces under result.cost) to the ledger + budget. No-ops when
    // the agent reported no USD amount.
    const reportedCost = body.result?.cost ?? body.cost;
    if (reportedCost && typeof recordInvocationLedgerEntry === "function") {
      recordInvocationLedgerEntry({ invocation, cost: reportedCost, agent: findAgent(invocation.agentId) });
    }
    if (terminalStatus === "succeeded" && typeof recordCcusageImportedEstimates === "function") {
      recordCcusageImportedEstimates({
        invocation,
        result: body.result ?? null,
        agent: findAgent(invocation.agentId),
      });
    }
    closeCodexSession(invocation, terminalStatus);
    updateCompareRunForInvocation(invocation);
    persistStateSoon();
  }

  function updateCompareRunForInvocation(invocation) {
    if (!invocation.compareRunId) {
      return;
    }
    const compareRun = state.compareRuns.find((item) => item.id === invocation.compareRunId);
    if (compareRun) {
      updateCompareRun(compareRun);
    }
  }

  function updateCompareRun(compareRun) {
    const children = compareRun.childInvocationIds.map((id) => findInvocation(id)).filter(Boolean);
    const terminal = children.filter((child) => isTerminal(child.status));
    compareRun.status = terminal.length === children.length
      ? children.some((child) => child.status === "succeeded") ? "completed" : "failed"
      : "running";
    compareRun.summary = `${terminal.length}/${children.length} agent run(s) finished.`;
    const firstSuccess = children.find((child) => child.status === "succeeded");
    compareRun.preferredInvocationId = compareRun.preferredInvocationId ?? firstSuccess?.id ?? null;
    compareRun.updatedAt = now();
    persistStateSoon();
  }

  function recordAgentUsage(invocation, terminalStatus) {
    const agent = findAgent(invocation.agentId);
    const summary = getAgentUsageSummary(invocation.agentId);
    summary.invocationCount += 1;
    if (terminalStatus === "succeeded") {
      summary.succeededCount += 1;
    } else if (terminalStatus === "failed" || terminalStatus === "timed_out" || terminalStatus === "expired" || terminalStatus === "rejected") {
      summary.failedCount += 1;
    } else if (terminalStatus === "cancelled") {
      summary.cancelledCount += 1;
    }
    summary.lastInvocationId = invocation.id;
    summary.lastInvocationStatus = terminalStatus;
    summary.costOwner = agent?.economics?.costOwner ?? "unknown";
    summary.economicModel = agent?.economics?.model ?? "unknown";
    summary.currency = agent?.economics?.currency ?? "USD";
    summary.unknownCostVisible = summary.economicModel === "unknown";
    summary.updatedAt = now();
    persistStateSoon();
  }

  function getAgentUsageSummary(agentId) {
    let summary = state.agentUsageSummaries.find((item) => item.agentId === agentId);
    if (!summary) {
      const agent = findAgent(agentId);
      summary = {
        agentId,
        invocationCount: 0,
        succeededCount: 0,
        failedCount: 0,
        cancelledCount: 0,
        lastInvocationId: null,
        lastInvocationStatus: null,
        costOwner: agent?.economics?.costOwner ?? "unknown",
        economicModel: agent?.economics?.model ?? "unknown",
        currency: agent?.economics?.currency ?? "USD",
        unknownCostVisible: (agent?.economics?.model ?? "unknown") === "unknown",
        updatedAt: null
      };
      state.agentUsageSummaries.push(summary);
    }
    return summary;
  }

  function createAuditSummary(invocation, summary) {
    return {
      invocationId: invocation.id,
      requesterId: invocation.requestedBy,
      agentId: invocation.agentId,
      deviceId: invocation.delivery.deviceId,
      status: invocation.status,
      permissionDecision: invocation.status === "rejected" ? "denied" : "allowed",
      traceId: invocation.traceId ?? null,
      startedAt: invocation.createdAt,
      completedAt: invocation.completedAt ?? now(),
      resultSummary: invocation.status === "succeeded" ? summary : null,
      errorSummary: invocation.status === "succeeded" ? null : summary,
      dataStored: true,
      costSummary: "Demo agent cost is unknown; no billing was performed.",
      metadata: { namespace, protocolVersion }
    };
  }

  function completeRootSpan(invocation, terminalStatus) {
    const span = state.spans.find((item) => item.id === invocation.rootSpanId);
    if (!span || span.endedAt) {
      return;
    }
    span.status = terminalStatus === "succeeded" ? "succeeded" : terminalStatus === "cancelled" ? "cancelled" : "failed";
    span.endedAt = now();
  }

  return {
    completeInvocation,
    completeRootSpan,
    createAuditSummary,
    getAgentUsageSummary,
    recordAgentUsage,
    updateCompareRun,
    updateCompareRunForInvocation,
  };
}
