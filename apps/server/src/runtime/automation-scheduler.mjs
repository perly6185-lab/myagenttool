/*
 * The heartbeat main was missing. main has the whole automations model — CRUD
 * routes, persistence, `nextRunAt` stamping, and a web view — but nothing ever
 * read `nextRunAt` to actually fire one; only a manual POST /:id/run did. This
 * adds a plain server-side tick that fires any due automation, mirroring the
 * manual /run handler.
 */

import { isTerminal } from "../services/invocations.mjs";
import { actorCanAccessProject, actorForUser } from "./auth.mjs";
import { computeNextRun, normalizeSchedule } from "../services/automation-schedule.mjs";
import {
  capabilityInvocationInput,
  capabilityTargetProblem,
  isCapabilityTarget,
} from "../services/automation-target.mjs";

const TICK_MS = 30_000;

/**
 * Fire every enabled automation whose next-run time has passed, then roll its
 * schedule forward. Pure function of the injected runtime deps so it's testable
 * without a live server.
 */
export function runDueAutomations({
  state,
  now,
  createInvocation,
  startInvocationIfAllowed,
  findAgent,
  defaultAgent,
  findInvocation,
  persistStateSoon,
  createCapabilityInvocation,
  getCapability,
  appendEvent,
}) {
  const nowMs = Date.now();
  let changed = false;
  for (const automation of state.automations ?? []) {
    if (!automation.enabled || !automation.nextRunAt || Date.parse(automation.nextRunAt) > nowMs) {
      continue;
    }
    // Re-normalize the (possibly legacy/hand-edited) schedule so computeNextRun
    // always yields a real time — a malformed schedule would otherwise return
    // null and wedge the automation forever behind the `!nextRunAt` guard.
    const schedule = normalizeSchedule(automation.schedule);
    automation.schedule = schedule;
    // Don't stack a new run while the previous one is still in flight — otherwise
    // an approval-gated agent (which parks at waiting_for_local_approval) would
    // pile up a fresh unresolved invocation every tick. Roll forward, retry next
    // period.
    const prev = automation.lastInvocationId ? findInvocation(automation.lastInvocationId) : null;
    if (prev && !isTerminal(prev.status)) {
      automation.nextRunAt = computeNextRun(schedule, nowMs);
      changed = true;
      continue;
    }
    if (isCapabilityTarget(automation)) {
      fireCapabilityAutomation(automation, {
        state,
        now,
        createCapabilityInvocation,
        getCapability,
        appendEvent,
      });
      automation.nextRunAt = computeNextRun(schedule, nowMs);
      changed = true;
      continue;
    }
    const agent = findAgent(automation.agentId) ?? defaultAgent();
    if (agent) {
      try {
        const invocation = createInvocation(automation.prompt, agent, {
          requestedBy: automation.createdBy ?? "usr_local",
          metadata: { automationId: automation.id, automationName: automation.name, scheduled: true, projectId: automation.projectId },
        });
        startInvocationIfAllowed(invocation, agent);
        automation.lastInvocationId = invocation.id;
        automation.lastRunAt = now();
        automation.runCount = (automation.runCount ?? 0) + 1;
      } catch {
        // A bad agent/project shouldn't wedge the scheduler; skip and roll forward.
      }
    }
    automation.nextRunAt = computeNextRun(schedule, nowMs);
    changed = true;
  }
  if (changed) persistStateSoon();
}

/**
 * Fire a capability schedule (#847), through the same dispatch the Run panel and
 * the manual /run route use.
 *
 * The scheduler does NOT pass through the HTTP layer, so `denyForeignProject` —
 * the gate protecting the manual path — never runs here. Ownership is therefore
 * re-asserted at FIRE time, against the automation's creator. A schedule outlives
 * the access that created it: without this, a capability keeps running against a
 * project its author can no longer see, on a timer, with nobody watching.
 *
 * A target that has since gone away (disabled, offline, archived, project gone)
 * records WHY on the automation and refuses. It does not fire something
 * approximate, and it does not wedge the tick — the schedule rolls forward, as it
 * already does for a bad agent.
 */
function fireCapabilityAutomation(automation, { state, now, createCapabilityInvocation, getCapability, appendEvent }) {
  const fail = (reason) => {
    automation.lastRunAt = now();
    automation.lastRunError = reason;
    appendEvent?.({
      invocationId: null,
      type: "automation_target_refused",
      level: "warn",
      message: `Scheduled capability ${automation.target?.capability ?? "?"} did not run: ${reason}`,
      data: { automationId: automation.id, capability: automation.target?.capability ?? null, reason },
    });
  };

  const actor = actorForUser(state, automation.createdBy);
  if (!actorCanAccessProject(state, actor, automation.projectId)) {
    fail("The automation's creator can no longer access its project.");
    return;
  }
  if (typeof getCapability !== "function" || typeof createCapabilityInvocation !== "function") {
    fail("Capability dispatch is not available on this control plane.");
    return;
  }
  const problem = capabilityTargetProblem({
    target: automation.target,
    capability: getCapability(automation.target.capability, actor),
    projectId: automation.projectId,
  });
  if (problem) {
    fail(problem);
    return;
  }
  try {
    const result = createCapabilityInvocation(
      automation.target.capability,
      { ...capabilityInvocationInput(automation), automationId: automation.id, scheduled: true },
      actor,
    );
    if (result.status >= 400) {
      fail(result.body?.message ?? result.body?.error ?? `Dispatch refused with ${result.status}.`);
      return;
    }
    automation.lastInvocationId = result.body?.invocationId ?? null;
    automation.lastRunAt = now();
    automation.lastRunError = null;
    automation.runCount = (automation.runCount ?? 0) + 1;
  } catch (error) {
    fail(error?.message ?? "Dispatch threw.");
  }
}

/** Start the 30s scheduler tick. Unref'd so it never keeps the process alive.
 *  Returns the timer so callers can clear it in tests. */
export function startAutomationScheduler(deps) {
  const timer = setInterval(() => runDueAutomations(deps), TICK_MS);
  timer.unref?.();
  return timer;
}
