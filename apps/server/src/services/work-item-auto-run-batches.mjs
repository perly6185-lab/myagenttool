import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { isAgentDisabled } from "./agents.mjs";

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
const DEFAULT_BATCH_AGENT_ID = "agt_codex_cli";
const INITIAL_PUMP_GRACE_MS = 250;

function batchView(batch) {
  const { requestSignature: _requestSignature, ...visibleBatch } = batch;
  const counts = batch.items.reduce((result, item) => {
    result[item.status] = (result[item.status] ?? 0) + 1;
    return result;
  }, {});
  const active = batch.items.filter((item) => ACTIVE_RUN_STATUSES.has(item.status)).length;
  return {
    ...visibleBatch,
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
  schedulePump = (callback, { delayMs = 0 } = {}) => {
    if (delayMs > 0) return setTimeout(() => void callback(), delayMs);
    return setImmediate(() => void callback());
  },
} = {}) {
  const pumping = new Set();
  const scheduled = new Set();
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

  function agentRefusal(agent, terminalIds) {
    if (!agent) return "agent_not_found";
    if (agent.id === "agt_demo_cli") return "demo_agent_not_allowed";
    if (isAgentDisabled(agent)) return "agent_disabled";
    if (agent.health?.status === "unhealthy") return "agent_unhealthy";
    if (agent.adapter?.type !== "cli" || agent.location?.type !== "local_device") {
      return "repository_agent_required";
    }
    const capabilities = new Set((agent.capabilities ?? []).map((capability) => capability?.name));
    if (![...capabilities].some((name) => typeof name === "string" && name.endsWith("_repo_task"))) {
      return "repository_agent_required";
    }
    if (terminalIds.size > 0 && (
      terminalIds.size !== 1
      || !terminalIds.has(agent.location.deviceId ?? null)
    )) {
      return "agent_terminal_mismatch";
    }
    return null;
  }

  function resolveBatchAgent({ requestedAgentId = null, workItems, legacy = false }) {
    const terminalIds = new Set(workItems.map((item) => item.terminalId).filter(Boolean).map(String));
    const agents = state.agents ?? [];
    const eligible = agents.filter((agent) => !agentRefusal(agent, terminalIds));
    if (requestedAgentId) {
      const agent = agents.find((candidate) => candidate.id === requestedAgentId) ?? null;
      const reason = agentRefusal(agent, terminalIds);
      if (reason) {
        return {
          ok: false,
          status: reason === "agent_not_found" ? 404 : 409,
          body: { error: "batch_agent_not_eligible", agentId: requestedAgentId, reason },
        };
      }
      return { ok: true, agent, source: legacy ? "recovered_explicit" : "explicit" };
    }

    const projectIds = [...new Set(workItems.map((item) => item.projectId).filter(Boolean).map(String))];
    const projects = projectIds.map((projectId) =>
      (state.projects ?? []).find((project) => project.id === projectId) ?? null);
    const configuredDefaults = projects.map((project) => project?.defaultAgentId ?? null);
    const uniqueDefaults = [...new Set(configuredDefaults.filter(Boolean))];
    if (uniqueDefaults.length > 0) {
      if (!configuredDefaults.every(Boolean)) {
        return {
          ok: false,
          status: 409,
          body: { error: "batch_agent_required", reason: "incomplete_project_defaults" },
        };
      }
      if (uniqueDefaults.length !== 1) {
        return {
          ok: false,
          status: 409,
          body: { error: "batch_agent_required", reason: "conflicting_project_defaults" },
        };
      }
      const agent = agents.find((candidate) => candidate.id === uniqueDefaults[0]) ?? null;
      const reason = agentRefusal(agent, terminalIds);
      if (reason) {
        return {
          ok: false,
          status: 409,
          body: {
            error: "batch_agent_not_eligible",
            agentId: uniqueDefaults[0],
            reason: `project_default_${reason}`,
          },
        };
      }
      return { ok: true, agent, source: legacy ? "recovered_project_default" : "project_default" };
    }

    const canonical = eligible.find((agent) => agent.id === DEFAULT_BATCH_AGENT_ID) ?? null;
    if (canonical) {
      return { ok: true, agent: canonical, source: legacy ? "recovered_canonical_default" : "canonical_default" };
    }
    if (eligible.length === 1) {
      return { ok: true, agent: eligible[0], source: legacy ? "recovered_unique_candidate" : "unique_candidate" };
    }
    return {
      ok: false,
      status: 409,
      body: {
        error: "batch_agent_required",
        reason: eligible.length > 1 ? "ambiguous_repository_agents" : "repository_agent_unavailable",
      },
    };
  }

  function workItemsForBatch(batch) {
    const actor = actorFor(batch);
    const workItems = [];
    for (const batchItem of batch.items) {
      const detail = getWorkItem({ workItemId: batchItem.workItemId }, actor);
      if (!detail.ok) return detail;
      workItems.push(detail.body.workItem);
    }
    return { ok: true, workItems };
  }

  function ensureBatchAgent(batch) {
    const resolvedItems = workItemsForBatch(batch);
    if (!resolvedItems.ok) return resolvedItems;
    const resolution = resolveBatchAgent({
      requestedAgentId: batch.agentId ?? null,
      workItems: resolvedItems.workItems,
      legacy: true,
    });
    if (!resolution.ok) return resolution;
    if (batch.agentId === resolution.agent.id && batch.agentResolution) return { ok: true };
    runTx(() => {
      batch.agentId = resolution.agent.id;
      batch.agentResolution = resolution.source;
      batch.updatedAt = now();
    });
    return { ok: true };
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
        localIssueId: item.id,
        name,
        agentId: batch.agentId,
        actor,
        issueBody,
        executionChainId: item.id,
        taskMaterialWorkItemId: item.id,
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
        batchItem.error = null;
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

  async function pumpBatch(batch, { maxStarts = Number.POSITIVE_INFINITY } = {}) {
    if (!batch || TERMINAL_BATCH_STATUSES.has(batch.status) || pumping.has(batch.id)) return batch;
    pumping.add(batch.id);
    try {
      // Always reconcile admitted work before evaluating whether the pinned
      // agent may start MORE work. A failed invocation can make the agent
      // unhealthy; checking eligibility first left its batch item permanently
      // showing "running" even though the Auto-run was already terminal.
      runTx(() => {
        syncBatch(batch);
        settleBatch(batch);
        batch.updatedAt = now();
      });
      if (TERMINAL_BATCH_STATUSES.has(batch.status)) return batch;
      const agentReady = ensureBatchAgent(batch);
      if (!agentReady.ok) {
        runTx(() => {
          batch.lastPumpError = agentReady.body?.error ?? "batch_agent_required";
          batch.status = "blocked";
          batch.updatedAt = now();
        });
        return batch;
      }
      let active = batch.items.filter((item) => ACTIVE_RUN_STATUSES.has(item.status)).length;
      let attemptedStarts = 0;
      for (const item of batch.items) {
        if (active >= batch.maxConcurrent) break;
        if (item.status !== "queued") continue;
        if (attemptedStarts >= maxStarts) break;
        attemptedStarts += 1;
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

  function canStartQueuedItem(batch) {
    if (!batch || TERMINAL_BATCH_STATUSES.has(batch.status) || batch.status === "blocked") return false;
    const active = batch.items.filter((item) => ACTIVE_RUN_STATUSES.has(item.status)).length;
    const capacityBackoff = batch.items.some(
      (item) => item.status === "queued" && String(item.error ?? "").startsWith("At capacity:"),
    );
    return !capacityBackoff
      && active < batch.maxConcurrent
      && batch.items.some((item) => item.status === "queued");
  }

  function scheduleBatchPump(batch, { delayMs = 0 } = {}) {
    if (!batch || TERMINAL_BATCH_STATUSES.has(batch.status) || scheduled.has(batch.id) || pumping.has(batch.id)) {
      return false;
    }
    scheduled.add(batch.id);
    try {
      schedulePump(async () => {
        scheduled.delete(batch.id);
        try {
          await pumpBatch(batch, { maxStarts: 1 });
          if (canStartQueuedItem(batch)) scheduleBatchPump(batch);
        } catch (error) {
          runTx(() => {
            batch.lastPumpError = error instanceof Error ? error.message : String(error);
            batch.updatedAt = now();
            appendEvent?.({
              invocationId: null,
              type: "work_item_auto_run_batch_pump_failed",
              level: "error",
              message: `Work-item Auto-run batch ${batch.id} could not start its queued work.`,
              data: { batchId: batch.id, error: batch.lastPumpError },
            });
          });
        }
      }, { delayMs });
      return true;
    } catch (error) {
      scheduled.delete(batch.id);
      runTx(() => {
        batch.lastPumpError = error instanceof Error ? error.message : String(error);
        batch.updatedAt = now();
      });
      return false;
    }
  }

  async function createBatch({
    workItemIds,
    maxConcurrent = 2,
    agentId = null,
    idempotencyKey = null,
  } = {}, actor = null) {
    const ids = [...new Set(Array.isArray(workItemIds) ? workItemIds.map(String) : [])];
    if (!ids.length || ids.length > 100) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_batch" } };
    }
    const limit = Math.max(1, Math.min(10, Number(maxConcurrent) || 2));
    const requestedAgentId = agentId ? String(agentId).trim() : null;
    if (agentId != null && !requestedAgentId) {
      return { ok: false, status: 400, body: { error: "invalid_agent_id" } };
    }
    const rawIdempotencyKey = idempotencyKey == null ? null : String(idempotencyKey);
    const normalizedIdempotencyKey = rawIdempotencyKey?.trim() || null;
    if (rawIdempotencyKey != null && (!normalizedIdempotencyKey || normalizedIdempotencyKey.length > 200)) {
      return { ok: false, status: 400, body: { error: "invalid_idempotency_key" } };
    }
    const teamId = actor?.teamId ?? LOCAL_TEAM_ID;
    const requestSignature = JSON.stringify({
      workItemIds: ids,
      maxConcurrent: limit,
      agentId: requestedAgentId,
    });
    if (normalizedIdempotencyKey) {
      const replay = (state.workItemAutoRunBatches ?? []).find((candidate) =>
        candidate.teamId === teamId
        && candidate.idempotencyKey === normalizedIdempotencyKey);
      if (replay) {
        const replaySignature = replay.requestSignature ?? JSON.stringify({
          workItemIds: replay.items.map((item) => item.workItemId),
          maxConcurrent: replay.maxConcurrent,
          agentId: replay.agentId ?? null,
        });
        if (replaySignature !== requestSignature) {
          return {
            ok: false,
            status: 409,
            body: {
              error: "idempotency_key_conflict",
              batchId: replay.id,
            },
          };
        }
        return {
          ok: true,
          status: 200,
          body: { batch: batchView(replay), replayed: true },
        };
      }
    }
    const workItems = [];
    for (const workItemId of ids) {
      const detail = getWorkItem({ workItemId }, actor);
      if (!detail.ok) return detail;
      if (detail.body.workItem.state !== "open") {
        return { ok: false, status: 409, body: { error: "work_item_execution_not_open", workItemId } };
      }
      workItems.push(detail.body.workItem);
    }
    const agentResolution = resolveBatchAgent({ requestedAgentId, workItems });
    if (!agentResolution.ok) return agentResolution;
    const timestamp = now();
    const batch = {
      id: nextId("wib"),
      teamId,
      createdBy: actor?.userId ?? "usr_local",
      createdByRole: actor?.role ?? "operator",
      status: "queued",
      maxConcurrent: limit,
      agentId: agentResolution.agent.id,
      agentResolution: agentResolution.source,
      idempotencyKey: normalizedIdempotencyKey,
      requestSignature,
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
        data: {
          batchId: batch.id,
          workItemIds: ids,
          maxConcurrent: limit,
          agentId: batch.agentId,
          agentResolution: batch.agentResolution,
        },
      });
    });
    const pumpScheduled = scheduleBatchPump(batch, { delayMs: INITIAL_PUMP_GRACE_MS });
    return {
      ok: true,
      status: 201,
      body: { batch: batchView(batch), replayed: false, pumpScheduled },
    };
  }

  async function sweepBatches() {
    let swept = 0;
    for (const batch of state.workItemAutoRunBatches ?? []) {
      if (TERMINAL_BATCH_STATUSES.has(batch.status)) continue;
      scheduleBatchPump(batch);
      swept += 1;
    }
    return { swept };
  }

  return { createBatch, listBatches, pumpBatch, sweepBatches };
}
