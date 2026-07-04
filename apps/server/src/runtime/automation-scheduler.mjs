/*
 * The heartbeat main was missing. main has the whole automations model — CRUD
 * routes, persistence, `nextRunAt` stamping, and a web view — but nothing ever
 * read `nextRunAt` to actually fire one; only a manual POST /:id/run did. This
 * adds a plain server-side tick that fires any due automation, mirroring the
 * manual /run handler.
 */

import { isTerminal } from "../services/invocations.mjs";
import { computeNextRun, normalizeSchedule } from "../services/automation-schedule.mjs";

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

/** Start the 30s scheduler tick. Unref'd so it never keeps the process alive.
 *  Returns the timer so callers can clear it in tests. */
export function startAutomationScheduler(deps) {
  const timer = setInterval(() => runDueAutomations(deps), TICK_MS);
  timer.unref?.();
  return timer;
}
