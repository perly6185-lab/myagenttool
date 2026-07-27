import type { InvocationSnapshot, PendingDecision } from "@/lib/console-state";

export type HomeWorkState = "idle" | "running" | "approval" | "failed" | "succeeded";
export type HomePrimaryAction =
  | "run"
  | "view_progress"
  | "handle_approval"
  | "review_failure"
  | "view_result";

export interface HomeNextAction {
  state: HomeWorkState;
  action: HomePrimaryAction;
}

const RUNNING_STATES = new Set([
  "queued",
  "dispatching",
  "waiting_for_local_approval",
  "running",
  "cancelling",
]);
const FAILED_STATES = new Set(["failed", "timed_out", "refused"]);
const SUCCEEDED_STATES = new Set(["succeeded", "completed"]);

function decisionTargetsInvocation(
  decision: PendingDecision,
  invocationId: string,
  projectId: string | null,
): boolean {
  const row = decision as PendingDecision & { invocationId?: string | null };
  if (
    row.invocationId === invocationId
    || row.targetId === invocationId
    || row.ref?.invocationId === invocationId
  ) {
    return true;
  }
  return Boolean(projectId && row.projectId === projectId);
}

export function hasPendingDecisionForInvocation(
  decisions: PendingDecision[] | undefined,
  invocation: InvocationSnapshot | null,
  projectId: string | null,
): boolean {
  if (!invocation) return false;
  return (decisions ?? []).some((decision) =>
    decisionTargetsInvocation(decision, invocation.id, projectId));
}

export function deriveHomeNextAction({
  invocation,
  hasPendingDecision = false,
}: {
  invocation: InvocationSnapshot | null;
  hasPendingDecision?: boolean;
}): HomeNextAction {
  const status = invocation?.status ?? "";
  if (invocation && (hasPendingDecision || status === "waiting_for_local_approval")) {
    return { state: "approval", action: "handle_approval" };
  }
  if (invocation && RUNNING_STATES.has(status)) {
    return { state: "running", action: "view_progress" };
  }
  if (invocation && FAILED_STATES.has(status)) {
    return { state: "failed", action: "review_failure" };
  }
  if (invocation && SUCCEEDED_STATES.has(status)) {
    return { state: "succeeded", action: "view_result" };
  }
  return { state: "idle", action: "run" };
}
