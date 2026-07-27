import type { ConsoleSnapshot } from "@/lib/console-state";

export interface MobileTodoCounts {
  active: number;
  attention: number;
}

const ACTIVE_INVOCATION_STATES = new Set([
  "queued",
  "dispatching",
  "waiting_for_local_approval",
  "running",
  "cancelling",
]);

/** Prefer the server's canonical work board; retain a useful fallback while it loads. */
export function mobileTodoCounts(state: ConsoleSnapshot | null | undefined): MobileTodoCounts {
  const board = state?.workBoard?.states;
  if (board) {
    return {
      active: board.in_progress.count + board.waiting.count,
      attention: board.pending_decision.count + board.follow_up.count,
    };
  }
  return {
    active: (state?.invocations ?? []).filter((item) => ACTIVE_INVOCATION_STATES.has(item.status ?? "")).length,
    attention:
      (state?.pendingDecisions?.length ?? 0)
      + (state?.evidenceLedger?.filter((item) => item.attention).length ?? 0),
  };
}
