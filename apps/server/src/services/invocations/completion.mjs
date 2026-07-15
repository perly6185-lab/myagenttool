import { runStateTransaction } from "../../runtime/state-transaction.mjs";
import { stampClaudeProposalArtifact } from "../claude-propose-imports.mjs";
import { capClaudePlanResult } from "../claude-plan-imports.mjs";
import { recordRunTranscript } from "../run-transcripts.mjs";

export function createInvocationCompletionRuntime({
  state,
  now,
  appendEvent,
  persistStateSoon,
  persistStateNow,
  namespace,
  protocolVersion,
  findAgent,
  findInvocation,
  closeCodexSession,
  isTerminal,
  recordInvocationLedgerEntry,
  releaseReservationsForInvocation,
  recordInvocationRoundUsage,
  recordCcusageImportedEstimates,
  recordCodexReviewFindings,
  recordClaudeReviewFindings,
  recordClaudeApplyResult,
  recordCodexExecChanges,
  recordApplicationResult,
  capWithArchive,
  onInvocationCompleted,
}) {
  // #890.2: prefer the synchronous barrier so a completion — terminal status,
  // result, and the ledger entry it records — is durable before this returns. A
  // crash in the old 20ms debounce window recovered the run as still running, its
  // lease later expired, and it re-executed AND recorded a second ledger entry
  // (double charge). Falls back to the debounced writer if the barrier is unwired.
  const commitCompletion = persistStateNow ?? persistStateSoon;

  function completeInvocation(invocation, body) {
    if (isTerminal(invocation.status)) {
      return;
    }
    // One unit of work: every mutation below commits together on exit.
    runStateTransaction(commitCompletion, () => completeInvocationWork(invocation, body));
    // Late-bound reaction hook (e.g. auto-run: succeeded -> publish -> open PR).
    // Fire-and-forget AFTER the durable commit, so the reaction always observes a
    // persisted terminal state. The advancer does its own I/O + error handling so
    // a slow git/gh publish never blocks the bridge's completion response.
    if (typeof onInvocationCompleted === "function") {
      onInvocationCompleted(invocation);
    }
  }

  function completeInvocationWork(invocation, body) {
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
    // #913: a succeeded proposal becomes an immutable artifact NOW — stamp its
    // bindings (content hash, validated base commit, descriptor lineage) before
    // anything reads or persists the result. Pure no-op for every other tool.
    if (terminalStatus === "succeeded") {
      stampClaudeProposalArtifact({ invocation, result: invocation.result });
      // #1051: the plan result is server-capped here — the wrapper's own caps
      // are belt, this is the braces the read model actually relies on.
      capClaudePlanResult({ invocation, result: invocation.result });
    }
    // #1072: the wrapper's bounded stream transcript (#1071) moves to its durable
    // per-run home on ANY terminal status — a failed run's transcript is the most
    // valuable one. Re-clamped server-side; the raw payload is stripped off
    // invocation.result so it is stored exactly once and never ships with the
    // /api/state snapshot. Committed by the enclosing transaction.
    // #1084: appendEvent leaves the recorded/superseded trail; capWithArchive
    // spills count-cap evictions to the retention archive.
    recordRunTranscript({ state, invocation, result: invocation.result, now, appendEvent, capWithArchive });
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
    const auditSummary = createAuditSummary(invocation, body.summary ?? null);
    state.auditSummaries.push(auditSummary);
    recordAgentUsage(invocation, terminalStatus);
    // Attribute an agent-reported run cost (e.g. Claude's total_cost_usd, which
    // the bridge surfaces under result.cost) to the ledger + budget. No-ops when
    // the agent reported no USD amount.
    const reportedCost = body.result?.cost ?? body.cost;
    let roundUsageLedgerIds = [];
    if (reportedCost && typeof recordInvocationLedgerEntry === "function") {
      const ledgerEntry = recordInvocationLedgerEntry({ invocation, cost: reportedCost, agent: findAgent(invocation.agentId) });
      if (ledgerEntry) roundUsageLedgerIds = [ledgerEntry.id];
    }
    // Sum this run's per-round telemetry into an authoritative AIUsageRecord
    // (derivedFrom: "rounds") — real measured tokens, linked to the cost ledger
    // entry above. No-op when the run produced no rounds (e.g. non-JSONL agents).
    if (typeof recordInvocationRoundUsage === "function") {
      recordInvocationRoundUsage({ invocation, ledgerEntryIds: roundUsageLedgerIds });
    }
    if (terminalStatus === "succeeded" && typeof recordCcusageImportedEstimates === "function") {
      const records = recordCcusageImportedEstimates({
        invocation,
        result: body.result ?? null,
        agent: findAgent(invocation.agentId),
      });
      attachApplicationResult({ invocation, auditSummary, records, outputCollection: "importedUsageEstimates" });
    }
    if (terminalStatus === "succeeded" && typeof recordCodexReviewFindings === "function") {
      const records = recordCodexReviewFindings({
        invocation,
        result: body.result ?? null,
        agent: findAgent(invocation.agentId),
      });
      attachApplicationResult({ invocation, auditSummary, records, outputCollection: "codexReviewFindings" });
    }
    if (terminalStatus === "succeeded" && typeof recordClaudeReviewFindings === "function") {
      const records = recordClaudeReviewFindings({
        invocation,
        result: body.result ?? null,
        agent: findAgent(invocation.agentId),
      });
      attachApplicationResult({ invocation, auditSummary, records, outputCollection: "claudeReviewFindings" });
    }
    // Apply runs on ANY terminal status: a refused/failed git apply exits non-zero
    // but still reports a result, and the authorization must be marked failed (not
    // left "applying"). recordClaudeApplyResult no-ops for non-apply invocations.
    if (typeof recordClaudeApplyResult === "function") {
      recordClaudeApplyResult({ invocation, result: body.result ?? null, agent: findAgent(invocation.agentId) });
    }
    if (terminalStatus === "succeeded" && typeof recordCodexExecChanges === "function") {
      const records = recordCodexExecChanges({
        invocation,
        result: body.result ?? null,
        agent: findAgent(invocation.agentId),
      });
      attachApplicationResult({ invocation, auditSummary, records, outputCollection: "codexExecChanges" });
    }
    // The generic path (#801): dispatch on the wrapper command's declared
    // `resultImport`, so a new Application imports without another branch here.
    // The three importers above predate it and stay as they are — the point is
    // that this is the LAST per-application `if` in this function, not that they
    // were worth rewriting.
    if (terminalStatus === "succeeded" && typeof recordApplicationResult === "function") {
      const records = recordApplicationResult({ invocation, result: body.result ?? null });
      attachApplicationResult({
        invocation,
        auditSummary,
        records,
        outputCollection: invocation.options?.metadata?.applicationWrapper?.outputCollection
          ?? invocation.options?.metadata?.outputCollection
          ?? "applicationResults",
      });
    }
    attachApplicationResult({ invocation, auditSummary, records: [], outputCollection: "invocations" });
    closeCodexSession(invocation, terminalStatus);
    updateCompareRunForInvocation(invocation);
    // #890.1 tail: a plain-invocation budget hold (manual/API accept) releases now
    // that the run is terminal — its real ledger spend, recorded just above, gates
    // the next admission. No-op for auto-run runs (released by setAutoRunStatus) and
    // when reservations are disabled. Committed by the enclosing transaction.
    if (typeof releaseReservationsForInvocation === "function") {
      releaseReservationsForInvocation(invocation.id, { outcome: "committed" });
    }
    // No barrier here: the enclosing runStateTransaction commits on exit.
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
    // #1085: the audit summary is a sanctioned audit exit — it must state
    // whether a transcript was captured. Summary metadata only, never payload.
    // Runs on the reject/cancel paths too, where no transcript exists → null.
    const transcriptRecord = (state.runTranscripts ?? []).find((item) => item?.invocationId === invocation.id);
    return {
      invocationId: invocation.id,
      requesterId: invocation.requestedBy,
      transcript: transcriptRecord
        ? {
            present: true,
            contentHash: transcriptRecord.contentHash ?? null,
            blocks: transcriptRecord.blocks?.length ?? 0,
            truncated: transcriptRecord.truncated === true,
          }
        : null,
      agentId: invocation.agentId,
      deviceId: invocation.delivery.deviceId,
      status: invocation.status,
      permissionDecision: invocation.status === "rejected" ? "denied" : "allowed",
      traceId: invocation.traceId ?? null,
      // True execution start: the first round's start (set by round telemetry),
      // else the bridge ack, else createdAt. Was conflated with createdAt (queue time).
      startedAt: invocation.startedAt ?? invocation.delivery?.acknowledgedAt ?? invocation.createdAt,
      completedAt: invocation.completedAt ?? now(),
      resultSummary: invocation.status === "succeeded" ? summary : null,
      errorSummary: invocation.status === "succeeded" ? null : summary,
      dataStored: true,
      costSummary: "Demo agent cost is unknown; no billing was performed.",
      metadata: { namespace, protocolVersion }
    };
  }

  function attachApplicationResult({ invocation, auditSummary, records, outputCollection }) {
    const metadata = invocation.options?.metadata;
    if (metadata?.providerType !== "application" || !metadata.applicationId) {
      return;
    }
    const importedRecords = Array.isArray(records) ? records : [];
    if (outputCollection !== "invocations" && importedRecords.length === 0) {
      return;
    }
    const existing = invocation.result?.applicationResult ?? metadata.applicationResult ?? null;
    if (existing?.importedRecordIds?.length && importedRecords.length === 0) {
      return;
    }
    const previous = JSON.stringify(existing ?? null);
    const applicationResult = {
      applicationId: metadata.applicationId,
      capability: metadata.capability ?? null,
      applicationAction: metadata.applicationAction ?? null,
      outputCollection: importedRecords.length > 0
        ? outputCollection
        : existing?.outputCollection ?? metadata.applicationWrapper?.outputCollection ?? metadata.outputCollection ?? outputCollection,
      resultImport: metadata.resultImport ?? metadata.applicationWrapper?.resultImport ?? null,
      importedRecordIds: importedRecords.map((record) => record.id),
      importedRecordCount: importedRecords.length,
      invocationId: invocation.id,
      status: invocation.status,
      completedAt: invocation.completedAt ?? now(),
    };
    invocation.options.metadata.applicationResult = applicationResult;
    if (invocation.result && typeof invocation.result === "object" && !Array.isArray(invocation.result)) {
      invocation.result.applicationResult = applicationResult;
    }
    auditSummary.applicationResult = applicationResult;
    auditSummary.metadata = {
      ...auditSummary.metadata,
      applicationResult,
    };
    const application = (state.applications ?? []).find((item) => item.id === metadata.applicationId);
    if (application) {
      application.latestResult = applicationResult;
      application.updatedAt = invocation.completedAt ?? now();
    }
    if (JSON.stringify(applicationResult) !== previous) {
      appendEvent({
        invocationId: invocation.id,
        type: "application_result_recorded",
        level: invocation.status === "succeeded" ? "info" : "warn",
        message: `Application result recorded for ${metadata.capability ?? metadata.applicationId}.`,
        data: applicationResult,
      });
    }
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
