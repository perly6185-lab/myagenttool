import type { WorkItemExecutionReview, WorkItemReviewAction } from "./task-view-types";
import { isReadOnlyReviewAction } from "./execution-review-actions";

type ReviewActionHandler = () => void;

export function createWorkItemReviewActionController({
  review,
  handlers,
  onUnknownAction,
}: {
  review: WorkItemExecutionReview | null;
  handlers: Record<string, ReviewActionHandler | undefined>;
  onUnknownAction?: (kind: string) => void;
}) {
  const availability = review?.actionAvailability ?? null;
  const actionByKind = new Map((availability?.actions ?? []).map((action) => [action.kind, action]));

  const action = (kind: string): WorkItemReviewAction | null => actionByKind.get(kind) ?? null;

  const isEnabled = (kind: string, legacyEnabled = true) => {
    if (!availability) return legacyEnabled;
    const projected = actionByKind.get(kind);
    if (projected) {
      return projected.visible && projected.enabled && (!availability.locked || isReadOnlyReviewAction(kind));
    }
    // Older projections do not include read-only primary navigation actions.
    return availability.primaryActionKind === kind
      && review?.recommendedAction.kind === kind
      && (!availability.locked || isReadOnlyReviewAction(kind));
  };

  const run = (kind: string, legacyEnabled = true) => {
    if (!isEnabled(kind, legacyEnabled)) return false;
    const handler = handlers[kind];
    if (handler) {
      handler();
      return true;
    }
    // Unknown future actions never execute a guessed write. Opening process
    // details is the only forward-compatible fallback supplied by the caller.
    onUnknownAction?.(kind);
    return false;
  };

  return {
    usesProjection: availability != null,
    action,
    isEnabled,
    run,
  };
}
