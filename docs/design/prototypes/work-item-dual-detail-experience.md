# Work Item Dual Detail Experience

Date: 2026-08-05

Status: implemented for Home and the Task Center; browser regression is the release gate

## Product contract

One Work Item has two presentation modes over the same canonical record:

- **Simple details** answer what the task is, its user-facing state, who owns it, when it is due, and the one next action.
- **Expert details** retain execution routing, worktrees and assets, verification, reporting, cost, alerts, synchronization, and audit trace.

The mode is a display preference, not an authorization role. Existing API permissions continue to govern every mutation.

## Entry behavior

| Entry | Default behavior |
| --- | --- |
| Home personal or AI board | Open the detail over Home without changing section, filters, focus session, or scroll context. |
| Home report review | Open Expert details at Report. |
| Task Center row | Open the user's preferred detail mode over the list. |
| Technical or audit deep link | Restore the selected task, Expert mode, and exact expert section from URL state. |

“Open in task center” is explicit. Merely viewing a task never navigates there first.

## Simple-details information order

1. Local reference, title, and one derived user-facing state.
2. One recommended next step and one primary action.
3. Plain-language cause, impact, and remedy when execution failed.
4. Goal and definition of done.
5. Owner, expected completion, AI state, waiting party, and latest progress.
6. Recent comments and related-file count.
7. Secondary entry to Expert details.

The first view must not expose `Auto-run`, revision, routing confidence, trace identifiers, or raw protocol status values.

## User-facing status projection

Canonical business, planning, and execution fields remain unchanged. The simple view derives exactly one of:

- Not started
- Scheduled
- AI working
- Waiting on others
- Needs your action
- Ready for your review
- Blocked
- Completed

Completion wins first; execution failure and approval needs then take attention priority; review-ready, blocked, active AI, waiting, and scheduling follow in that order.

## Expert mode

The existing six-section professional workspace remains available:

- Overview
- Process
- Assets
- Verification
- Report
- Trace

Switching modes preserves the Work Item identity and URL deep link. A mode switch is disabled while the current view contains unsaved changes.

## Responsive behavior

- Simple details use a bounded dialog on desktop and retain a single-column reading order on mobile.
- Expert details use a wide workspace on desktop and a full-screen surface on mobile.
- The underlying Home or Task Center remains mounted, so closing restores the original context.

## Collaboration continuity

- Simple details explain the same-record relationship between My tasks and AI tasks as a three-step handoff: My plan, AI execution, then My confirmation.
- Expected completion and AI execution dates remain distinct; a later AI execution date produces a plain-language delivery-risk warning.
- Recording progress dispatches one shared state-change signal. Home refreshes both board projections from the server instead of patching either board locally.
- A successful update confirms that My tasks and AI tasks are synchronized, so closing the detail does not leave the user guessing whether the board changed.
- Human-only completed tasks do not falsely imply that an AI execution occurred.
- A comment-history failure does not hide the task itself. A task-load failure provides an in-place retry instead of forcing the user to close and reopen the detail.

## Simple action closure

- A review-ready task presents the latest result summary, definition-of-done outcome, and delivered filenames inside Simple details. The primary review action stays in context; the full report is an explicit secondary escalation.
- A failed AI run can be retried from Simple details when the server identifies a retryable failed or blocked run. Confirmation explains additional runtime and cost before any mutation occurs.
- Retry failure keeps the original task unchanged and uses plain-language recovery guidance. Retry success refreshes the canonical task and both Home projections.
- Closing Simple details restores keyboard focus to the exact card action that opened it, preserving keyboard and screen-reader continuity.

## Progressive disclosure review

- Owner, expected completion, and current waiting party sit directly below the title instead of repeating in a separate coordination card.
- Latest progress sits with the recommended next action. The collaboration handoff remains the single explanation of how My tasks and AI tasks relate.
- Review-ready delivery content is revealed by the primary “Review result” action, giving the action a visible consequence without leaving Simple details.
- Comments, author/time metadata, the comment composer, and related-file counts stay behind one expandable discussion row. Reading the task no longer requires scrolling past an empty text area.
- These reductions preserve every capability while shortening the default mobile reading path.

## Release gates

- Home opening does not change `section=dashboard`.
- Browser back can close an in-place task detail through URL navigation state.
- Simple details contain one primary next action and no expert-only terminology.
- Expert mode retains every pre-existing section and unsaved-edit guard.
- Desktop and 390 px mobile captures have no horizontal page overflow.
- Saving progress refreshes both Home projections and provides an accessible synchronization confirmation.
- Review-ready and retryable-failure paths can complete their ordinary-user step without switching presentation modes.

## Planned task-material extension

The ordinary-user attachment flow is specified in [Task Material Inbox Experience](./task-material-inbox-experience.md). It keeps files attached to the task before a worktree exists, then prepares verified private copies automatically when AI execution starts. Simple details expose only reference-file status and recovery actions; storage, hashes, and execution provenance remain in Expert details.
