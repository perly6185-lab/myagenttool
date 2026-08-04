# Home Stakeholder And AI Workbench Visual QA

Date: 2026-08-04

Result: pass for the production implementation regression scenario; browser capture is the release gate

## Reviewed viewports

| Viewport | Result | Notes |
| --- | --- | --- |
| Desktop 1366 × 768 | Pass | Attention summary, workbench, and AI rail retain clear hierarchy. |
| Mobile 390 × 844 | Pass | Attention and relation filters scroll within their own rows; the page has no horizontal overflow. |

## Scenario checks

- Needs my attention shows the three sample tasks whose next action belongs to the current user.
- Selecting AI failed leaves the failed task visible and exposes its Run records action.
- All work disables the implicit “needs my action” restriction and restores waiting tasks.
- Clear state hides the active AI rail and shows one compact actionable empty state.
- Requester filters do not change planning or AI execution status.
- AI completed appears as “waiting for my review,” not as a completed Local Issue.
- Approval opens a canonical approval action; run history and transcript remain outside Home.

## Responsive checks

- Task title, requester, deadline, human follow-up, AI status, and next action remain readable at 390 px.
- Primary actions become full-width below task context on narrow screens.
- Mobile reading order is attention summary, filters, work items, then active AI.
- Long content wraps inside the task card instead of pushing the action outside its container.
- The production scenario uses the real `DashboardView` and `DailyWorkBoard`, not the prototype markup.
- Bound AI statuses render as localized workflow copy; internal values such as `waiting_for_local_approval` and `report_posted` must not appear.
- The scenario contains overdue, approval, failed, completed/review-ready, and long-title work in the same projection.

## Fixes made during review

- Added the failed AI task to the current-user attention queue.
- Ensured the active AI rail respects its hidden state.
- Kept the requester filter label on one line while the chips scroll independently.

## Automated production artifacts

- `.myagenttool/visual-qa/screenshots/home-workbench-desktop.png`
- `.myagenttool/visual-qa/screenshots/home-workbench-mobile.png`
- `.myagenttool/visual-qa/screenshots/home-workbench-board-desktop.png`
- `.myagenttool/visual-qa/screenshots/home-workbench-board-mobile.png`
- `.myagenttool/visual-qa/latest.json` records no-horizontal-overflow, non-blank, and key-panel assertions.

Run `pnpm --filter @myagenttool/web build` followed by `pnpm visual:qa:browser` to refresh and enforce these artifacts.

## Production invariants

- Attention counts and card reasons must come from the same server projection or they can diverge.
- AI completion must not mutate planning state to `done` without the human review gate.
- Requester relation must not be reused as priority or authorization.
- Existing work must migrate to `unknown`; defaulting old tasks to `self` would create false business history.
