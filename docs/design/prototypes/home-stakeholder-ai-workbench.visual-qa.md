# Home Stakeholder And AI Workbench Visual QA

Date: 2026-08-04

Result: pass for the production implementation regression scenario; browser capture is the release gate

## Reviewed viewports

| Viewport | Result | Notes |
| --- | --- | --- |
| Desktop 1366 × 768 | Pass | “My tasks” and “AI tasks” render as independent cards over the same Issue set. |
| Mobile 390 × 844 | Pass | Both card summaries collapse to responsive grids; the page has no horizontal overflow. |

## Scenario checks

- My tasks groups Issues by task-person category (self, boss, manager, customer, child learning, or other) and expected completion date.
- AI tasks groups the same Issues by AI execution date and canonical execution state.
- An Issue may appear under Today in My tasks and Tomorrow in AI tasks when its expected completion and execution dates differ.
- Selecting a My task-person category never filters the AI task cards.
- Selecting an AI status never filters the three-day personal plan.
- Both sections keep a card-based empty state instead of collapsing into a row of zero-count pills.
- AI completed appears as “waiting for my review,” not as a completed Local Issue.
- Approval opens a canonical approval action; run history and transcript remain outside Home.

## Responsive checks

- Task title, requester, deadline, human follow-up, AI status, and next action remain readable at 390 px.
- Primary actions become full-width below task context on narrow screens.
- Mobile reading order is My tasks header, person-category cards, expected-completion groups, AI tasks header, execution-state cards, then AI execution-date groups.
- Long content wraps inside the task card instead of pushing the action outside its container.
- The production scenario uses the real `DashboardView` and `DailyWorkBoard`, not the prototype markup.
- Bound AI statuses render as localized workflow copy; internal values such as `waiting_for_local_approval` and `report_posted` must not appear.
- The scenario contains overdue, approval, failed, completed/review-ready, and long-title work in the same projection.

## Fixes made during review

- Split the single-terminal Issue set into independent My tasks and AI tasks projections.
- Made `dueDate` the expected-completion grouping for My tasks and `plannedDate` the AI-execution grouping for AI tasks.
- Added child learning as a first-class task-person category and removed AI scheduling/status copy from My task cards.

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
