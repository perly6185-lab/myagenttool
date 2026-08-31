# Work item summary architecture

`WorkItemSummaryView` is the ordinary-user task surface. Its public props, visible copy, and navigation behavior are intentionally stable while its internal responsibilities are split into bounded modules.

## Current boundaries

- `work-item-summary-view.tsx` owns data loading, presentation state, dialogs, scrolling/focus, and composition of task sections.
- `work-item-execution-controller.ts` owns execution write orchestration: contract preparation and confirmation, start cancellation/recheck, clarification answer/stop, retry, change requests, re-verification, reconciliation, and automatic-execution policy changes.
- `work-item-review-action-controller.ts` interprets the server-projected action availability. It is composed by the execution controller so projected locks remain authoritative and unknown future actions never guess a write.
- `execution-start-*`, `execution-review-*`, `work-item-summary-model.ts`, and `work-item-summary-copy.ts` own focused presentation and pure derivation.
- `work-item-result-review.tsx` owns result summaries, review evidence, changed-file entry points, failed-run files, repair presentation, and the full-report body.
- `work-item-review-decision-section.tsx` owns the review decision and feedback presentation while receiving authority and action availability as explicit inputs.
- `work-item-completed-task-card.tsx` owns completion state, local delivery receipts, reuse actions, and post-completion template feedback.
- `work-item-delivery-recovery-alert.tsx` owns recoverable delivery-error presentation; recovery execution remains in the view/controller boundary.
- `work-item-deliverable-files.tsx` remains the shared changed-file and result-file browser used by the focused result modules.

The execution controller receives the current task snapshot plus explicit UI effects. It may update the task snapshot, pending/error state, receipts, and refresh signal, but it does not render JSX, navigate directly, or own result/delivery presentation.

## Execution invariants

1. Preparation and confirmation remain separate. Preparing a contract may open the existing confirmation, but only `startAiWork` confirms the contract and starts the handoff.
2. Every repeatable execution write uses `actionRequest`, which binds its idempotency key to the task revision, target state, and latest action receipt.
3. `accepted`, `running`, and `unknown` receipts lock repeated mutations until refreshed or reconciled.
4. Server-projected review availability overrides permissive legacy UI checks. Read-only navigation remains available while projected mutations are locked.
5. Uncertain network outcomes produce an `unknown` receipt and refresh the task instead of encouraging a duplicate write.

## Adding an execution action

Add execution writes to `work-item-execution-controller.ts`, including their authority check, idempotency request, receipt/error handling, and refresh event. Expose only the resulting handler to the view. Add action-projection interpretation to `work-item-review-action-controller.ts` only when the server contract changes.

Presentation-only task states belong in the focused card/model modules. Result review, changed-file presentation, delivery recovery, and completion rendering are explicit presentation boundaries; they must not issue writes, derive new authority, or move into the execution controller.

## Regression boundary

- `work-item-execution-controller.test.ts` covers controller invariants and projected action locks.
- `work-item-review-action-controller.test.ts` covers server projection authority and unknown-action behavior.
- `work-item-result-presentation.test.tsx` covers completion receipts, delivery recovery, repair permissions, failed-run files, and authoritative review locks.
- `work-item-summary-view.test.tsx` covers the ordinary component journey and visible behavior.
- The ordinary coding real-server Playwright journey remains the end-to-end delivery boundary.
