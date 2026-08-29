function commandError(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function localDate(timezoneOffset, now = Date.now()) {
  const offset = Number(timezoneOffset ?? 0);
  if (!Number.isInteger(offset) || offset < -840 || offset > 840) {
    throw commandError("invalid_terminal_timezone_offset", "The terminal timezone offset is invalid.");
  }
  return new Date(now - offset * 60_000).toISOString().slice(0, 10);
}

function runName(item) {
  const slug = String(item?.title ?? "work")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "work";
  return `local-${item.localNumber}-${slug}-recovery-${Number(item.revision) || 0}`;
}

function recoveryRouteHint(item) {
  const taskKind = String(item?.taskKind ?? item?.intentContract?.taskKind ?? "");
  if (taskKind.startsWith("software_")) return "develop";
  const text = [item?.title, item?.body, item?.intentStatement, item?.intentContract?.goal]
    .filter(Boolean)
    .join("\n");
  const repositoryScoped = /(?:\bgit\b|\brepo(?:sitory)?\b|代码任务|编程任务|仓库|当前\s*(?:Git\s*)?项目)/i.test(text);
  const mutatesFiles = item?.intentContract?.action?.operation === "mutate_files"
    || item?.executionIntentContractSnapshot?.action?.operation === "mutate_files";
  return repositoryScoped && mutatesFiles ? "develop" : null;
}

/**
 * Converts one failed legacy application invocation into the governed Auto-run
 * pipeline. The command service owns idempotency; this service owns the durable
 * execution transition and can resume a partially-created recovery by its
 * request id without creating a second Auto-run.
 */
export function createWorkItemLegacyExecutionRecoveryService({
  state,
  getWorkItem,
  updateWorkItem,
  beginExecution,
  abortExecution,
  recordExecutionBinding,
  reserveAutoRun,
  enqueueAutoRunUnderstanding,
  failAutoRunUnderstanding,
} = {}) {
  async function restartAsAutoRun({
    workItemId,
    actor = null,
    timezoneOffset = 0,
    recoveryRequestId,
    sourceTargetId = null,
    agentId = null,
    baseBranch = null,
  } = {}) {
    const requestId = String(recoveryRequestId ?? "").trim();
    if (!requestId) throw commandError("recovery_request_id_required", "A durable recovery request id is required.");

    const existing = (state.autoRuns ?? []).find((candidate) =>
      candidate.executionRecovery?.requestId === requestId) ?? null;
    if (existing) {
      const detail = getWorkItem({ workItemId }, actor);
      if (!detail?.ok) throw commandError(detail?.body?.error ?? "work_item_not_found", "Work item not found.", detail?.status ?? 404);
      const alreadyBound = (detail.body.workItem.executionBindings ?? []).some((binding) =>
        binding.kind === "auto_run" && binding.targetId === existing.id);
      if (!alreadyBound && existing.executionRecovery?.operationId) {
        const recorded = recordExecutionBinding({
          workItemId,
          kind: "auto_run",
          targetId: existing.id,
          worktreeId: existing.worktreeId ?? null,
          operationId: existing.executionRecovery.operationId,
        }, actor);
        if (!recorded?.ok) throw commandError(recorded?.body?.error ?? "work_item_execution_binding_failed", "The recovery run could not be bound to the task.", recorded?.status ?? 409);
      }
      if (existing.status === "materializing" && existing.phase === "understanding") {
        enqueueAutoRunUnderstanding(existing.id);
      }
      return { autoRun: existing, replayed: true };
    }

    const detail = getWorkItem({ workItemId }, actor);
    if (!detail?.ok) throw commandError(detail?.body?.error ?? "work_item_not_found", "Work item not found.", detail?.status ?? 404);
    let item = detail.body.workItem;
    const review = detail.body.observability?.executionReview ?? null;
    if (item.state === "closed") throw commandError("work_item_closed", "A completed task cannot be restarted.", 409);
    if (review?.executionKind !== "application_invocation" || review?.state !== "failed" || review?.targetStatus !== "failed") {
      throw commandError("legacy_execution_not_restartable", "Only a failed legacy application invocation can be restarted as an Auto-run.", 409);
    }
    if (sourceTargetId && review.targetId !== sourceTargetId) {
      throw commandError("execution_action_stale", "The failed execution changed after this review was loaded.", 409);
    }

    if (!item.plannedDate || item.waitingOn !== "ai") {
      const scheduled = updateWorkItem({
        workItemId,
        expectedRevision: item.revision,
        ...(!item.plannedDate ? { plannedDate: localDate(timezoneOffset) } : {}),
        ...(item.waitingOn !== "ai" ? { waitingOn: "ai" } : {}),
      }, actor);
      if (!scheduled?.ok) throw commandError(scheduled?.body?.error ?? "work_item_schedule_failed", "The recovery run could not be scheduled.", scheduled?.status ?? 409);
      item = scheduled.body.workItem;
    }

    const admission = beginExecution({ workItemId, kind: "auto_run", agentId }, actor);
    if (!admission?.ok) throw commandError(admission?.body?.error ?? "work_item_execution_not_admitted", "The recovery run was not admitted.", admission?.status ?? 409);
    const operationId = admission.body.operation.id;
    let reserved = null;
    try {
      const link = { type: "local_issue", number: item.localNumber, title: item.title, url: null, state: item.state };
      const result = await reserveAutoRun({
        projectId: item.projectId,
        link,
        localIssueId: item.id,
        name: runName(item),
        baseBranch,
        agentId,
        actor,
        issueBody: item.body,
        executionChainId: item.id,
        taskMaterialWorkItemId: item.id,
        terminalId: item.terminalId,
        executionRecovery: {
          requestId,
          operationId,
          sourceKind: "application_invocation",
          sourceTargetId: review.targetId,
          reasonCode: review.attentionCode ?? "legacy_execution_failed",
          routeHint: recoveryRouteHint(item),
        },
      });
      reserved = result.autoRun;
      const recorded = recordExecutionBinding({
        workItemId,
        kind: "auto_run",
        targetId: reserved.id,
        worktreeId: null,
        operationId,
      }, actor);
      if (!recorded?.ok) throw commandError(recorded?.body?.error ?? "work_item_execution_binding_failed", "The recovery run could not be bound to the task.", recorded?.status ?? 409);
      enqueueAutoRunUnderstanding(reserved.id);
      return { autoRun: reserved, replayed: false };
    } catch (error) {
      if (reserved) failAutoRunUnderstanding(reserved.id, error);
      else abortExecution({ workItemId, operationId, reason: error instanceof Error ? error.message : String(error) }, actor);
      throw error;
    }
  }

  return { restartAsAutoRun };
}
