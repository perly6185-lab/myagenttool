# Home Stakeholder And AI Workbench Visual QA

Date: 2026-08-04

Result: pass for the production implementation regression scenario; browser capture is the release gate

## Reviewed viewports

| Viewport | Result | Notes |
| --- | --- | --- |
| Desktop 1366 × 768 | Pass | “My work” and “AI work” render as independent cards with their own status summaries. |
| Mobile 390 × 844 | Pass | Both card summaries collapse to responsive grids; the page has no horizontal overflow. |

## Scenario checks

- My work contains only personal planning, waiting, due-date, and follow-up context.
- AI work contains only AI execution, approval, failure, and review-ready status.
- Selecting a My work status never filters the AI work cards.
- Selecting an AI status never filters the three-day personal plan.
- Both sections keep a card-based empty state instead of collapsing into a row of zero-count pills.
- AI completed appears as “waiting for my review,” not as a completed Local Issue.
- Approval opens a canonical approval action; run history and transcript remain outside Home.

## Responsive checks

- Task title, requester, deadline, human follow-up, AI status, and next action remain readable at 390 px.
- Primary actions become full-width below task context on narrow screens.
- Mobile reading order is My work header, My work status cards, personal work items, AI work header, AI status cards, then AI task cards.
- Long content wraps inside the task card instead of pushing the action outside its container.
- The production scenario uses the real `DashboardView` and `DailyWorkBoard`, not the prototype markup.
- Bound AI statuses render as localized workflow copy; internal values such as `waiting_for_local_approval` and `report_posted` must not appear.
- The scenario contains overdue, approval, failed, completed/review-ready, and long-title work in the same projection.

## Fixes made during review

- Split personal work and AI execution into separate top-level cards.
- Replaced the mixed relationship/status strip with independent card-based status summaries.
- Removed AI agent/status copy from personal task cards while preserving human next actions.

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
