/*
 * Schedule health (#848).
 *
 * The question an operator actually has is not "did it run?" — it is "is anything
 * wrong with my schedules, and which application does it belong to?" Nothing
 * answered that: an automation carried `lastRunAt` / `lastInvocationId` /
 * `runCount` and nothing else, so "this has been failing for a week" and "this has
 * been parked on an approval nobody will give" were both derivable only by hand.
 *
 * Everything here is DERIVED from evidence that already exists — the invocations a
 * schedule caused (they name it since #847), and the refusal the scheduler recorded
 * when it could not fire at all. There is deliberately no new bookkeeping field to
 * keep in sync: a health flag that can disagree with the run it describes is worse
 * than no flag, because it will be believed.
 *
 * The state worth caring about most is `approval_pending`, and it is the one that
 * looks like nothing at all. The scheduler's in-flight guard (correctly) will not
 * stack a second run while the previous is unresolved — so a schedule that fires,
 * parks at `waiting_for_local_approval`, and is never approved does not fail, does
 * not retry, and does not complain. It just stops. Forever. Indistinguishable from
 * a schedule with nothing to do. No error will ever tell you about it.
 */

import { slugify } from "../services/applications.mjs";

export const SCHEDULE_HEALTH_STATES = ["healthy", "failing", "approval_pending", "paused", "unknown"];

const FAILED_STATUSES = ["failed", "timed_out", "rejected", "refused"];

/**
 * One schedule's health, from the runs it caused.
 *
 * `runs` are the invocations attributed to this automation, newest first. A run
 * the scheduler never managed to start (target offline, ownership lost) leaves no
 * invocation at all — that is what `lastRunError` records, and why it is read here
 * rather than being treated as decoration.
 */
export function automationHealth(automation, runs = []) {
  const latest = runs[0] ?? null;

  // Disabled is the operator's own choice — it outranks whatever the last run did.
  if (automation?.enabled === false) {
    return summary("paused", "This schedule is turned off.", latest);
  }

  // The scheduler could not fire at all: the target is gone, or the creator's
  // access to the project is. It refused rather than running something
  // approximate (#847), and this is where that reason surfaces.
  if (automation?.lastRunError) {
    // A target that has gone away is "paused" (there is nothing to fix in the
    // schedule itself); anything else is a genuine failure to run.
    const targetGone = /disabled|offline|archived|not available|cannot be invoked/i.test(automation.lastRunError);
    return summary(
      targetGone ? "paused" : "failing",
      automation.lastRunError,
      latest,
    );
  }

  if (!latest) {
    return summary("unknown", "This schedule has not run yet.", null);
  }

  // THE ONE THAT LOOKS LIKE NOTHING. It fired, it parked, and the in-flight guard
  // will now skip every subsequent tick — silently, forever, until a human
  // approves it. It is not failing and it is not idle; it is waiting for you.
  if (latest.status === "waiting_for_local_approval") {
    return summary("approval_pending", "This schedule is waiting for an approval. It will not run again until someone gives it.", latest);
  }

  if (FAILED_STATUSES.includes(latest.status)) {
    return summary("failing", latest.result?.summary ?? `The last run ${latest.status}.`, latest);
  }

  if (latest.status === "succeeded") {
    return summary("healthy", null, latest);
  }

  // queued / dispatching / running — in flight, nothing to report yet.
  return summary("unknown", "A run is in flight.", latest);
}

function summary(state, reason, latest) {
  return {
    state,
    reason: reason ?? null,
    needsAttention: ["failing", "approval_pending"].includes(state),
    latestInvocationId: latest?.id ?? null,
    latestStatus: latest?.status ?? null,
    latestRunAt: latest?.createdAt ?? null,
  };
}

/** The invocations a schedule caused, newest first (they name it since #847). */
export function runsForAutomation(automation, invocations = []) {
  return invocations.filter((invocation) => invocation?.options?.metadata?.automationId === automation?.id);
}

/**
 * The application a capability schedule belongs to, or null.
 *
 * Derived from the capability name using the SAME slug the projection mints it
 * with — an agent-target automation belongs to no application, and a capability
 * whose application is gone belongs to none either (rather than to a guess).
 */
export function applicationIdForAutomation(automation, applications = []) {
  const capability = automation?.target?.kind === "capability" ? automation.target.capability : null;
  if (!capability) return null;
  const owner = applications.find((application) =>
    capability.startsWith(`app.${slugify(application.id || application.name)}.`),
  );
  return owner?.id ?? null;
}

/**
 * Per-automation health, plus the per-application rollup the Applications view
 * needs to say WHY an application wants attention and point at the schedule.
 */
export function scheduleHealthReadModel({ automations = [], invocations = [], applications = [] } = {}) {
  const health = automations.map((automation) => ({
    automationId: automation.id,
    applicationId: applicationIdForAutomation(automation, applications),
    targetKind: automation?.target?.kind ?? "agent",
    capability: automation?.target?.kind === "capability" ? automation.target.capability : null,
    ...automationHealth(automation, runsForAutomation(automation, invocations)),
  }));

  const byApplication = new Map();
  for (const row of health) {
    if (!row.applicationId) continue;
    const current = byApplication.get(row.applicationId) ?? {
      applicationId: row.applicationId,
      total: 0,
      failing: 0,
      approvalPending: 0,
      paused: 0,
      healthy: 0,
      unknown: 0,
      needsAttention: false,
      attentionAutomationIds: [],
    };
    current.total += 1;
    current[countKey(row.state)] += 1;
    if (row.needsAttention) {
      current.needsAttention = true;
      current.attentionAutomationIds.push(row.automationId);
    }
    byApplication.set(row.applicationId, current);
  }

  return { scheduleHealth: health, applicationScheduleHealth: [...byApplication.values()] };
}

function countKey(state) {
  if (state === "approval_pending") return "approvalPending";
  return state;
}
