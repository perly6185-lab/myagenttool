import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const ACTIVE_RUN_STATUSES = new Set([
  "materializing",
  "running",
  "waiting_capacity",
  "awaiting_approval",
  "verifying",
  "publishing",
]);
const TERMINAL_BATCH_STATUSES = new Set(["completed", "completed_with_failures", "cancelled"]);
const SUCCESS_RUN_STATUSES = new Set(["done", "pr_open", "report_posted", "decomposed"]);

function batchView(batch) {
  const counts = batch.items.reduce((result, item) => {
    result[item.status] = (result[item.status] ?? 0) + 1;
    return result;
  }, {});
  const active = batch.items.filter((item) => ACTIVE_RUN_STATUSES.has(item.status)).length;
  return {
    ...batch,
    counts,
    active,
    completed: batch.items.filter(
      (item) =>
        !["queued", "starting"].includes(item.status)
        && !ACTIVE_RUN_STATUSES.has(item.status)
    ).length,
    total: batch.items.length,
  };
}

export function createWorkItemAutoRunBatchService({
  state,
  now,
  nextId,
  persistStateSoon,
  appendEvent,
  getWorkItem,
  beginExecution,
  abortExecution,
  recordExecutionBinding,
  startAutoRun,
  store,
} = {}) {
  const pumping = new Set();
  const runTx = makeRunTx({ store, persistStateSoon });

  function actorFor(batch) {
    return {
      userId: batch.createdBy,
      teamId: batch.teamId,
      role: batch.createdByRole ?? "operator",
    };
  }

  function canRead(batch, actor) {
    return (actor?.teamId ?? LOCAL_TEAM_ID) === batch.teamId;
  }

  function listBatches(_input = {}, actor = null) {
    const batches = (state.workItemAutoRunBatches ?? [])
      .filter((batch) => canRead(batch, actor))
      .map(batchView);
    return { ok: true, status: 200, body: { batches, count: batches.length } };
  }

  async function startItem(batch, batchItem) {
    const actor = actorFor(batch);
    const detail = getWorkItem({ workItemId: batchItem.workItemId }, actor);
    if (!detail.ok) throw new Error(detail.body?.error ?? "work_item_not_found");
    const item = detail.body.workItem;
    const admission = beginExecution({
      workItemId: item.id,
      kind: "auto_run",
      agentId: batch.agentId,
    }, actor);
    if (!admission.ok) throw new Error(admission.body?.error ?? "work_item_execution_refused");
    const operationId = admission.body.operation.id;
    const slug = String(item.title ?? "work").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "work";
    const name = `local-${item.localNumber}-${slug}`;
    const link = {
      type: "local_issue",
      number: item.localNumber,
      title: item.title,
      url: null,
      state: item.state,
    };
    try {
      const issueBody = [
        item.body,
        item.acceptanceCriteria?.length
          ? `Acceptance criteria:\n${item.acceptanceCriteria.map((value) => `- ${value}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n\n");
      const result = await startAutoRun({
        projectId: item.projectId,
        link,
        name,
        agentId: batch.agentId,
        actor,
        issueBody,
        executionChainId: item.id,
        terminalId: item.terminalId,
        autonomyProfile: item.planningProjects?.some((project) => project.autonomyProfile === "cautious")
          ? "cautious"
          : item.planningProjects?.some((project) => project.autonomyProfile === "high")
            ? "high"
            : "standard",
      });
      const recorded = recordExecutionBinding({
        workItemId: item.id,
        kind: "auto_run",
        targetId: result.autoRun.id,
        worktreeId: result.worktree?.id ?? result.autoRun.worktreeId,
        operationId,
      }, actor);
      if (!recorded.ok) throw new Error(recorded.body?.error ?? "work_item_execution_binding_failed");
      runTx(() => {
        batchItem.autoRunId = result.autoRun.id;
        batchItem.status = result.autoRun.status;
        batchItem.startedAt = now();
        batchItem.updatedAt = now();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      abortExecution({
        workItemId: item.id,
        operationId,
        reason: message,
      }, actor);
      if (message.startsWith("At capacity:")) {
        const capacityError = new Error(message);
        capacityError.code = "batch_capacity";
        throw capacityError;
      }
      throw error;
    }
  }

  function syncBatch(batch) {
    for (const item of batch.items) {
      if (!item.autoRunId && item.status === "starting") {
        const recovered = (state.autoRuns ?? []).find((candidate) =>
          candidate.executionChainId === item.workItemId
          && Date.parse(candidate.createdAt ?? "") >= Date.parse(batch.createdAt));
        if (recovered) {
          item.autoRunId = recovered.id;
          item.startedAt ??= recovered.createdAt ?? now();
        } else {
          // A crash may persist "starting" before admission produces an Auto-run.
          // Put it back in the durable queue so the restart sweep can retry it.
          item.status = "queued";
          item.updatedAt = now();
          continue;
        }
      }
      if (!item.autoRunId) continue;
      const run = (state.autoRuns ?? []).find((candidate) => candidate.id === item.autoRunId);
      if (!run) {
        item.status = "failed";
        item.error = "auto_run_missing";
        item.updatedAt = now();
        continue;
      }
      const nextStatus = run.status;
      if (item.status !== nextStatus) {
        item.status = nextStatus;
        item.updatedAt = now();
        if (!ACTIVE_RUN_STATUSES.has(run.status)) item.finishedAt = now();
      }
    }
  }

  function settleBatch(batch) {
    const finished = batch.items.every(
      (item) =>
        !["queued", "starting"].includes(item.status)
        && !ACTIVE_RUN_STATUSES.has(item.status)
    );
    if (!finished) {
      batch.status = batch.items.some((item) => ACTIVE_RUN_STATUSES.has(item.status))
        ? "running"
        : "queued";
      return;
    }
    const hasFailures = batch.items.some((item) => !SUCCESS_RUN_STATUSES.has(item.status));
    batch.status = hasFailures ? "completed_with_failures" : "completed";
    batch.finishedAt ??= now();
  }

  async function pumpBatch(batch) {
    if (!batch || TERMINAL_BATCH_STATUSES.has(batch.status) || pumping.has(batch.id)) return batch;
    pumping.add(batch.id);
    try {
      runTx(() => syncBatch(batch));
      let active = batch.items.filter((item) => ACTIVE_RUN_STATUSES.has(item.status)).length;
      for (const item of batch.items) {
        if (active >= batch.maxConcurrent) break;
        if (item.status !== "queued") continue;
        runTx(() => {
          item.status = "starting";
          item.updatedAt = now();
        });
        try {
          await startItem(batch, item);
          active += 1;
        } catch (error) {
          if (error?.code === "batch_capacity") {
            runTx(() => {
              item.status = "queued";
              item.error = error.message;
              item.updatedAt = now();
            });
            break;
          }
          runTx(() => {
            item.status = "failed";
            item.error = error instanceof Error ? error.message : String(error);
            item.finishedAt = now();
            item.updatedAt = now();
          });
        }
      }
      runTx(() => {
        settleBatch(batch);
        batch.updatedAt = now();
      });
      return batch;
    } finally {
      pumping.delete(batch.id);
    }
  }

  async function createBatch({ workItemIds, maxConcurrent = 2, agentId = null } = {}, actor = null) {
    const ids = [...new Set(Array.isArray(workItemIds) ? workItemIds.map(String) : [])];
    if (!ids.length || ids.length > 100) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_batch" } };
    }
    const limit = Math.max(1, Math.min(10, Number(maxConcurrent) || 2));
    const workItems = [];
    for (const workItemId of ids) {
      const detail = getWorkItem({ workItemId }, actor);
      if (!detail.ok) return detail;
      if (detail.body.workItem.state !== "open") {
        return { ok: false, status: 409, body: { error: "work_item_execution_not_open", workItemId } };
      }
      workItems.push(detail.body.workItem);
    }
    const timestamp = now();
    const batch = {
      id: nextId("wib"),
      teamId: actor?.teamId ?? LOCAL_TEAM_ID,
      createdBy: actor?.userId ?? "usr_local",
      createdByRole: actor?.role ?? "operator",
      status: "queued",
      maxConcurrent: limit,
      agentId: agentId ? String(agentId) : null,
      items: workItems.map((item) => ({
        workItemId: item.id,
        localRef: item.localRef,
        title: item.title,
        status: "queued",
        autoRunId: null,
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
      createdAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
    };
    runTx(() => {
      state.workItemAutoRunBatches.unshift(batch);
      appendEvent?.({
        invocationId: null,
        type: "work_item_auto_run_batch_created",
        level: "info",
        message: `Work-item Auto-run batch ${batch.id} queued ${batch.items.length} tasks with concurrency ${limit}.`,
        data: { batchId: batch.id, workItemIds: ids, maxConcurrent: limit },
      });
    });
    await pumpBatch(batch);
    return { ok: true, status: 201, body: { batch: batchView(batch) } };
  }

  async function sweepBatches() {
    let swept = 0;
    for (const batch of state.workItemAutoRunBatches ?? []) {
      if (TERMINAL_BATCH_STATUSES.has(batch.status)) continue;
      await pumpBatch(batch);
      swept += 1;
    }
    return { swept };
  }

  return { createBatch, listBatches, pumpBatch, sweepBatches };
}
