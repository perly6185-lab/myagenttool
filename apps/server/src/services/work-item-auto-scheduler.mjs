import { resolveWorkItemExecution } from "./work-item-execution.mjs";
import { autoExecutionDateKey, planAutoExecutionQueue } from "./work-item-auto-scheduler-policy.mjs";

const MODES = new Set(["off", "shadow", "enabled"]);
const ACTIVE_RUN_STATUSES = new Set([
  "materializing", "running", "waiting_capacity", "awaiting_approval", "verifying", "publishing",
  "needs_input", "plan_proposed", "pr_open", "report_posted",
]);

function modeFor(state) {
  if (state?.autoRunSettings?.autonomyKillSwitch === true) return "off";
  const configured = state?.autoRunSettings?.workItemAutoSchedulerMode;
  return MODES.has(configured) ? configured : "enabled";
}

function dateOnly(value) {
  return typeof value === "string" ? /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? null : null;
}

function publicDecision(decision) {
  return {
    workItemId: decision.workItemId,
    eligible: decision.eligible,
    reasons: decision.reasons,
    executionPolicy: decision.executionPolicy,
    unresolvedDependencyIds: decision.unresolvedDependencyIds,
    rank: decision.rank,
  };
}

function cancelledByChannelThread(item, state) {
  const threadId = item?.channelOrigin?.threadId;
  if (!threadId) return false;
  return (state.channelTaskThreads ?? []).some((thread) =>
    thread.id === threadId && ["cancelled", "paused"].includes(thread.status));
}

export function createWorkItemAutoSchedulerService({
  state,
  now = () => new Date().toISOString(),
  appendEvent = () => {},
  getWorkItem = null,
  beginExecution = null,
  abortExecution = null,
  recordExecutionBinding = null,
  reserveAutoRun = null,
  enqueueAutoRunUnderstanding = null,
  failAutoRunUnderstanding = null,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
} = {}) {
  const signatures = new Map();
  let sweeping = false;
  const resolvedTimeZone = () => typeof timeZone === "function" ? timeZone() : timeZone;
  const metrics = {
    sweeps: 0,
    shadowSelections: 0,
    lastSweepAt: null,
    lastEligibleCount: 0,
    starts: 0,
    capacityDeferrals: 0,
    startFailures: 0,
    recoveredBindings: 0,
    recoveryFailures: 0,
    futurePullForwards: 0,
    duplicateStartsPrevented: 0,
    lastStartedAt: null,
    lastDecisionCounts: {},
  };

  function activeRunFor(item) {
    return (state.autoRuns ?? []).find((run) =>
      ACTIVE_RUN_STATUSES.has(run.status)
      && (run.localIssueId === item.id || run.executionChainId === item.id)) ?? null;
  }

  function preview({ teamId = null, projectId = null } = {}) {
    const timestamp = now();
    const items = (state.workItems ?? [])
      .filter((item) => !cancelledByChannelThread(item, state))
      .filter((item) => !teamId || item.ownerTeamId === teamId)
      .filter((item) => !projectId || item.projectId === projectId)
      .map((item) => ({
        ...item,
        executionState: activeRunFor(item)
          ? "running"
          : resolveWorkItemExecution(item, state, { now: timestamp }).executionState,
      }));
    const projects = (state.projects ?? [])
      .filter((project) => !teamId || project.ownerTeamId === teamId)
      .filter((project) => !projectId || project.id === projectId);
    const plan = planAutoExecutionQueue(items, {
      projects,
      today: autoExecutionDateKey(timestamp, { timeZone: resolvedTimeZone() }),
      now: timestamp,
    });
    return {
      mode: modeFor(state),
      generatedAt: timestamp,
      nextWorkItemId: plan.next?.id ?? null,
      eligibleWorkItemIds: plan.eligible.map((item) => item.id),
      decisions: plan.decisions.map(publicDecision),
      metrics: { ...metrics },
    };
  }

  function eligibleAgent(item) {
    const project = (state.projects ?? []).find((candidate) => candidate.id === item.projectId) ?? null;
    const agents = state.agents ?? [];
    const allowed = (agent) => agent
      && agent.status !== "disabled"
      && agent.health?.status !== "unhealthy"
      && agent.id !== "agt_demo_cli"
      && agent.adapter?.type === "cli"
      && agent.location?.type === "local_device"
      && (agent.capabilities ?? []).some((capability) => String(capability?.name ?? "").endsWith("_repo_task"))
      && (!item.terminalId || !agent.location?.deviceId || agent.location.deviceId === item.terminalId);
    const configured = project?.defaultAgentId
      ? agents.find((agent) => agent.id === project.defaultAgentId) ?? null
      : null;
    if (allowed(configured)) return configured;
    const canonical = agents.find((agent) => agent.id === "agt_codex_cli");
    if (allowed(canonical)) return canonical;
    const candidates = agents.filter(allowed);
    return candidates.length === 1 ? candidates[0] : null;
  }

  function actorFor(item) {
    return {
      userId: item.createdBy ?? "usr_local",
      teamId: item.ownerTeamId ?? "team_local",
      role: "operator",
    };
  }

  function recoverOrphanedBindings() {
    if (typeof recordExecutionBinding !== "function") return 0;
    let recovered = 0;
    for (const run of state.autoRuns ?? []) {
      if (!ACTIVE_RUN_STATUSES.has(run.status) || !run.localIssueId) continue;
      const item = (state.workItems ?? []).find((candidate) => candidate.id === run.localIssueId);
      if (!item || (item.executionBindings ?? []).some((binding) => binding.kind === "auto_run" && binding.targetId === run.id)) continue;
      if (run.scheduler?.source !== "work_item_auto_scheduler") continue;
      const operationId = run.scheduler.operationId ?? null;
      const operation = item.executionOperation?.kind === "auto_run"
        && item.executionOperation.id === operationId
        ? item.executionOperation
        : null;
      if (!operation) {
        metrics.recoveryFailures += 1;
        if (typeof failAutoRunUnderstanding === "function") {
          try {
            failAutoRunUnderstanding(run.id, new Error("Automatic scheduler recovery could not verify the original execution admission."));
          } catch {
            // Keep scanning; one failed cleanup must not stop other recoveries.
          }
        }
        continue;
      }
      let result;
      try {
        result = recordExecutionBinding({
          workItemId: item.id,
          kind: "auto_run",
          targetId: run.id,
          worktreeId: run.worktreeId ?? null,
          operationId: operation?.id ?? null,
        }, actorFor(item));
      } catch {
        metrics.recoveryFailures += 1;
        continue;
      }
      if (!result?.ok) metrics.recoveryFailures += 1;
      if (!result?.ok) continue;
      if (typeof enqueueAutoRunUnderstanding === "function") enqueueAutoRunUnderstanding(run.id);
      recovered += 1;
      metrics.recoveredBindings += 1;
      appendEvent({
        invocationId: null,
        type: "work_item_auto_scheduler_binding_recovered",
        level: "info",
        message: `Automatic scheduler recovered the binding for ${item.localRef ?? item.id}.`,
        data: { workItemId: item.id, autoRunId: run.id, operationId: operation?.id ?? null },
      });
    }
    return recovered;
  }

  async function startCandidate(candidate, decision = null) {
    if (![getWorkItem, beginExecution, abortExecution, recordExecutionBinding, reserveAutoRun, enqueueAutoRunUnderstanding]
      .every((dependency) => typeof dependency === "function")) {
      return { started: false, reason: "scheduler_dependencies_unavailable" };
    }
    const actor = actorFor(candidate);
    const detail = getWorkItem({ workItemId: candidate.id }, actor);
    if (!detail.ok) return { started: false, reason: detail.body?.error ?? "work_item_not_found" };
    const item = detail.body.workItem;
    const agent = eligibleAgent(item);
    if (!agent) return { started: false, reason: "repository_agent_unavailable" };
    const admission = beginExecution({ workItemId: item.id, kind: "auto_run", agentId: agent.id }, actor);
    if (!admission.ok) return { started: false, reason: admission.body?.error ?? "execution_refused" };
    const operationId = admission.body.operation.id;
    const slug = String(item.title ?? "work").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "work";
    let reservedAutoRun = null;
    let executionBindingRecorded = false;
    try {
      const result = await reserveAutoRun({
        projectId: item.projectId,
        link: {
          type: "local_issue",
          number: item.localNumber,
          title: item.title,
          url: null,
          state: item.state,
          priority: item.priority,
          dueDate: item.dueDate ?? null,
          plannedDate: item.plannedDate ?? null,
        },
        localIssueId: item.id,
        name: `local-${item.localNumber}-${slug}-autorun-${Number(item.revision) || 0}`,
        agentId: agent.id,
        actor,
        issueBody: item.body,
        executionChainId: item.id,
        taskMaterialWorkItemId: item.id,
        terminalId: item.terminalId,
        autonomyProfile: item.planningProjects?.some((project) => project.autonomyProfile === "cautious")
          ? "cautious"
          : item.planningProjects?.some((project) => project.autonomyProfile === "high") ? "high" : "standard",
        scheduler: {
          source: "work_item_auto_scheduler",
          operationId,
          workItemRevision: item.revision,
          selectedAt: now(),
          priority: item.priority,
          rank: decision?.rank?.slice(0, 6) ?? null,
        },
      });
      reservedAutoRun = result.autoRun;
      const recorded = recordExecutionBinding({
        workItemId: item.id,
        kind: "auto_run",
        targetId: result.autoRun.id,
        worktreeId: result.worktree?.id ?? result.autoRun.worktreeId,
        operationId,
      }, actor);
      if (!recorded.ok) throw new Error(recorded.body?.error ?? "work_item_execution_binding_failed");
      executionBindingRecorded = true;
      enqueueAutoRunUnderstanding(result.autoRun.id);
      metrics.starts += 1;
      metrics.lastStartedAt = now();
      if (dateOnly(item.plannedDate) > autoExecutionDateKey(now(), { timeZone: resolvedTimeZone() })) metrics.futurePullForwards += 1;
      appendEvent({
        invocationId: null,
        type: "work_item_auto_scheduler_started",
        level: "info",
        message: `Automatic scheduler started ${item.localRef ?? item.id}.`,
        data: { workItemId: item.id, autoRunId: result.autoRun.id, agentId: agent.id },
      });
      return { started: true, workItemId: item.id, autoRunId: result.autoRun.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (reservedAutoRun && !executionBindingRecorded && typeof failAutoRunUnderstanding === "function") {
        try {
          failAutoRunUnderstanding(reservedAutoRun.id, error);
        } catch {
          // The admission abort below still releases the task even if Run cleanup fails.
        }
      }
      abortExecution({ workItemId: item.id, operationId, reason: message }, actor);
      if (message.startsWith("At capacity:")) {
        metrics.capacityDeferrals += 1;
        return { started: false, reason: "waiting_capacity" };
      }
      metrics.startFailures += 1;
      appendEvent({
        invocationId: null,
        type: "work_item_auto_scheduler_start_failed",
        level: "warn",
        message: `Automatic scheduler could not start ${item.localRef ?? item.id}.`,
        data: { workItemId: item.id, error: message },
      });
      return { started: false, reason: message };
    }
  }

  async function sweep() {
    if (sweeping) return { mode: modeFor(state), swept: 0, selected: 0, replayed: true };
    sweeping = true;
    try {
    const mode = modeFor(state);
    metrics.sweeps += 1;
    metrics.lastSweepAt = now();
    if (mode === "off") return { mode, swept: 0, selected: 0 };
    const recoveredBindings = mode === "enabled" ? recoverOrphanedBindings() : 0;

    const teamIds = [...new Set([
      ...(state.projects ?? []).map((project) => project.ownerTeamId),
      ...(state.workItems ?? []).map((item) => item.ownerTeamId),
    ].filter(Boolean))];
    let selected = 0;
    let eligibleCount = 0;
    const starts = [];
    for (const teamId of teamIds) {
      const result = preview({ teamId });
      eligibleCount += result.eligibleWorkItemIds.length;
      const signature = JSON.stringify({ next: result.nextWorkItemId, eligible: result.eligibleWorkItemIds });
      const repeated = signatures.get(teamId) === signature;
      signatures.set(teamId, signature);
      if (repeated && mode === "shadow") continue;
      if (!result.nextWorkItemId) continue;
      if (mode === "shadow") {
        selected += 1;
        metrics.shadowSelections += 1;
      }
      if (!repeated) appendEvent({
        invocationId: null,
        type: "work_item_auto_scheduler_decision",
        level: "info",
        message: `Automatic scheduler ${mode === "shadow" ? "would start" : "selected"} ${result.nextWorkItemId}.`,
        data: {
          teamId,
          mode,
          workItemId: result.nextWorkItemId,
          eligibleWorkItemIds: result.eligibleWorkItemIds,
        },
      });
      if (mode === "enabled") {
        for (const workItemId of result.eligibleWorkItemIds.slice(0, 25)) {
          const candidate = (state.workItems ?? []).find((item) => item.id === workItemId);
          const decision = result.decisions.find((row) => row.workItemId === workItemId) ?? null;
          if (!candidate) continue;
          selected += 1;
          const outcome = await startCandidate(candidate, decision);
          starts.push(outcome);
          if (outcome.started || ["waiting_capacity", "scheduler_dependencies_unavailable"].includes(outcome.reason)) break;
        }
      }
    }
    metrics.lastEligibleCount = eligibleCount;
    const decisionCounts = {};
    for (const teamId of teamIds) {
      for (const decision of preview({ teamId }).decisions) {
        for (const reason of decision.reasons) decisionCounts[reason] = (decisionCounts[reason] ?? 0) + 1;
      }
    }
    metrics.lastDecisionCounts = decisionCounts;
    metrics.duplicateStartsPrevented += (decisionCounts.active_execution ?? 0) + (decisionCounts.execution_starting ?? 0);
    return { mode, swept: teamIds.length, selected, eligibleCount, recoveredBindings, starts };
    } finally {
      sweeping = false;
    }
  }

  return { preview, sweep, mode: () => modeFor(state) };
}
