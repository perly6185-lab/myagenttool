import type {
  ApplicationScheduleHealth,
  ScheduleHealthRow,
  ScheduleHealthState,
} from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";

/**
 * How a schedule's health reads (#849). Kept out of the JSX because three surfaces
 * render it — Applications, the Inspector, and Automation — and if each phrased it
 * for itself they would eventually disagree about what "failing" means.
 *
 * The server decides the state (#848); nothing here re-derives it.
 */

/**
 * The distinction that costs people days: a PARKED schedule wants a human, a
 * PAUSED one does not. They look identical to every surface that only shows
 * failures — a parked schedule produces no error, no failed run, and no red badge.
 * If this ever collapses "waiting for you" into "idle", the feature is gone.
 */
export function scheduleHealthLabel(state: ScheduleHealthState): string {
  switch (state) {
    case "approval_pending":
      return "Waiting for approval";
    case "failing":
      return "Failing";
    case "paused":
      return "Paused";
    case "healthy":
      return "Healthy";
    default:
      return "Not run yet";
  }
}

export function scheduleHealthTone(state: ScheduleHealthState): Tone {
  if (state === "failing") return "danger";
  if (state === "approval_pending") return "warning";
  if (state === "healthy") return "success";
  return "neutral";
}

export function needsAttention(state: ScheduleHealthState): boolean {
  return state === "failing" || state === "approval_pending";
}

export interface ScheduleFilter {
  key: "all" | "attention" | ScheduleHealthState;
  label: string;
}

export const SCHEDULE_FILTERS: ScheduleFilter[] = [
  { key: "attention", label: "Needs attention" },
  { key: "all", label: "All" },
  { key: "failing", label: "Failing" },
  { key: "approval_pending", label: "Waiting for approval" },
  { key: "paused", label: "Paused" },
  { key: "healthy", label: "Healthy" },
];

export function matchesScheduleFilter(row: ScheduleHealthRow | undefined, filter: ScheduleFilter["key"]): boolean {
  if (filter === "all") return true;
  if (!row) return filter === "unknown";
  if (filter === "attention") return row.needsAttention;
  return row.state === filter;
}

/** The health row for one schedule, or undefined when the server sent none. */
export function healthFor(
  automationId: string,
  rows: ScheduleHealthRow[] | undefined,
): ScheduleHealthRow | undefined {
  return (rows ?? []).find((row) => row.automationId === automationId);
}

/**
 * The one-line reason an application card gives for wanting attention.
 *
 * It must name WHAT is wrong, or an operator is told "something is wrong here" and
 * then made to go find it — which is the state this whole slice exists to end.
 */
export function applicationAttentionSummary(rollup: ApplicationScheduleHealth | null | undefined): string | null {
  if (!rollup?.needsAttention) return null;
  const parts: string[] = [];
  if (rollup.failing > 0) parts.push(`${rollup.failing} failing`);
  if (rollup.approvalPending > 0) {
    parts.push(`${rollup.approvalPending} waiting for approval`);
  }
  const noun = rollup.failing + rollup.approvalPending === 1 ? "schedule" : "schedules";
  return `${parts.join(", ")} ${noun}`;
}

/** The schedule an application card should focus when its attention badge is used. */
export function firstAttentionAutomationId(
  rollup: ApplicationScheduleHealth | null | undefined,
): string | null {
  return rollup?.attentionAutomationIds?.[0] ?? null;
}
