import { resolveWorkItemExecution } from "./work-item-execution.mjs";
import { planAutoExecutionQueue } from "./work-item-auto-scheduler-policy.mjs";

const MODES = new Set(["off", "shadow", "enabled"]);

function modeFor(state) {
  const configured = state?.autoRunSettings?.workItemAutoSchedulerMode;
  return MODES.has(configured) ? configured : "off";
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
} = {}) {
  const signatures = new Map();
  const metrics = {
    sweeps: 0,
    shadowSelections: 0,
    lastSweepAt: null,
    lastEligibleCount: 0,
  };

  function preview({ teamId = null, projectId = null } = {}) {
    const timestamp = now();
    const items = (state.workItems ?? [])
      .filter((item) => !teamId || item.ownerTeamId === teamId)
      .filter((item) => !projectId || item.projectId === projectId)
      .map((item) => ({
        ...item,
        executionState: resolveWorkItemExecution(item, state, { now: timestamp }).executionState,
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

  async function sweep() {
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
    }
    metrics.lastEligibleCount = eligibleCount;
    return { mode, swept: teamIds.length, selected, eligibleCount };
  }

  return { preview, sweep, mode: () => modeFor(state) };
}
