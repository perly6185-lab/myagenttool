import { resolveWorkItemExecution } from "./work-item-execution.mjs";
import { planAutoExecutionQueue } from "./work-item-auto-scheduler-policy.mjs";

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

function dateKey(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
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
} = {}) {
  const signatures = new Map();
  let sweeping = false;
  const metrics = {
    sweeps: 0,
    shadowSelections: 0,
    lastSweepAt: null,
    lastEligibleCount: 0,
    starts: 0,
    capacityDeferrals: 0,
    startFailures: 0,
  };

  function activeRunFor(item) {
    return (state.autoRuns ?? []).find((run) =>
      ACTIVE_RUN_STATUSES.has(run.status)
      && (run.localIssueId === item.id || run.executionChainId === item.id)) ?? null;
  }

  function preview({ teamId = null, projectId = null } = {}) {
    const timestamp = now();
    const items = (state.workItems ?? [])
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
      today: dateKey(timestamp),
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
        name: `local-${item.localNumber}-${slug}`,
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
          workItemRevision: item.revision,
          selectedAt: now(),
          priority: item.priority,
          rank: decision?.rank?.slice(0, 6) ?? null,
        },
      });
      const recorded = recordExecutionBinding({
        workItemId: item.id,
        kind: "auto_run",
        targetId: result.autoRun.id,
        worktreeId: result.worktree?.id ?? result.autoRun.worktreeId,
        operationId,
      }, actor);
      if (!recorded.ok) throw new Error(recorded.body?.error ?? "work_item_execution_binding_failed");
      enqueueAutoRunUnderstanding(result.autoRun.id);
      metrics.starts += 1;
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

    const teamIds = [...new Set((state.projects ?? [])
      .filter((project) => project.autoExecutionEnabled === true)
      .map((project) => project.ownerTeamId)
      .filter(Boolean))];
    let selected = 0;
    let eligibleCount = 0;
    const starts = [];
    for (const teamId of teamIds) {
      const result = preview({ teamId });
      eligibleCount += result.eligibleWorkItemIds.length;
      const signature = JSON.stringify({ next: result.nextWorkItemId, eligible: result.eligibleWorkItemIds });
      if (signatures.get(teamId) === signature) continue;
      signatures.set(teamId, signature);
      if (!result.nextWorkItemId) continue;
      selected += 1;
      if (mode === "shadow") metrics.shadowSelections += 1;
      appendEvent({
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
      if (mode === "enabled" && result.nextWorkItemId) {
        const candidate = (state.workItems ?? []).find((item) => item.id === result.nextWorkItemId);
        const decision = result.decisions.find((row) => row.workItemId === result.nextWorkItemId) ?? null;
        if (candidate) starts.push(await startCandidate(candidate, decision));
      }
    }
    metrics.lastEligibleCount = eligibleCount;
    return { mode, swept: teamIds.length, selected, eligibleCount, starts };
    } finally {
      sweeping = false;
    }
  }

  return { preview, sweep, mode: () => modeFor(state) };
}
