# Home Stakeholder And AI Workbench Visual QA

Date: 2026-08-05

Result: pass for the production implementation regression scenario; browser capture is the release gate

## Reviewed viewports

| Viewport | Result | Notes |
| --- | --- | --- |
| Desktop 1366 × 768 | Pass | “My tasks” and “AI tasks” render as independent cards over the same Issue set. |
| Mobile 390 × 844 | Pass | Both card summaries collapse to responsive grids; the page has no horizontal overflow. |

## Scenario checks

- A daily coordination brief derives today's due work, human actions, active AI work, and date conflicts from the same server projection; it appears before the task composer in the first working viewport.
- Home starts with a lightweight tracked-task composer: goal, expected completion, optional completion criteria, and a clear choice between creating only or creating and starting AI.
- Temporary AI runs remain available as a collapsed advanced option and are explicitly distinguished from work that belongs on the task boards.
- “Start first action” opens a bounded focus session with one primary action, expected outcome, position, navigation, and an explicit exit.
- The Dashboard owns focus-session continuity per selected project. Returning from a native surface resumes the same unresolved Issue; only a successful save or a refreshed projection that removes the Issue advances to the next action.
- My tasks groups Issues by task-person category (self, boss, manager, customer, child learning, or other) and expected completion date.
- AI tasks groups the same Issues by AI execution date and canonical execution state.
- An Issue may appear under Today in My tasks and Tomorrow in AI tasks when its expected completion and execution dates differ.
- My task cards summarize the linked AI execution date and human-readable state; both views flag execution scheduled after expected completion.
- A unified action queue deduplicates attention across both views and keeps one next step per Issue. It stays collapsed by default because the brief is the primary summary, and expands only after “Review today's plan.”
- Schedule-conflict actions edit the AI execution date in place and refresh both views after saving.
- Each linked card can locate, reveal, and highlight the same Issue in the other board without clearing the active filter.
- Cross-board location shows a return control so the comparison has an explicit end point.
- Both boards use four chronological columns: Yesterday, Today, Tomorrow, then Other dates; missing dates stay at the end of the fourth column.
- Selecting a My task-person category never filters the AI task cards.
- Selecting an AI status never filters the three-day personal plan.
- Both sections keep a card-based empty state instead of collapsing into a row of zero-count pills.
- AI completed appears as “waiting for my review,” not as a completed Local Issue.
- Approval opens a canonical approval action; run history and transcript remain outside Home.

## Responsive checks

- Task title, requester, deadline, human follow-up, AI status, and next action remain readable at 390 px.
- Each task card gives its primary action a full-width row on narrow screens; locate and report remain visually secondary.
- Mobile reading order is My tasks header, person-category cards, four expected-completion columns, AI tasks header, execution-state cards, then four AI execution-date columns.
- Both mobile boards show a horizontal-swipe cue before their four chronological columns.
- Mobile boards preserve chronological order while initially positioning Today in view.
- Long content wraps inside the task card instead of pushing the action outside its container.
- Cancelling execution-date editing returns focus to the same Issue instead of silently treating it as complete.
- “View task” opens Simple details over Home without navigating to the Task Center; closing restores the board context.
- Simple details expose one user-facing status, one next action, goal, definition of done, coordination, comments, and files without audit terminology.
- Simple details show the My plan → AI execution → My confirmation handoff and explain that both boards are views of the same task.
- When AI execution is scheduled after expected completion, Simple details show a delivery-risk warning without exposing scheduler internals.
- Saving progress refreshes both Home projections and announces that My tasks and AI tasks are synchronized.
- Review-ready tasks expose a readable delivery preview in Simple details; “Review result” does not navigate away from Home.
- Review-ready tasks support both “Request changes” and “Accept and complete” in Simple details, preserving one task identity across revision cycles.
- Accepting a non-code result records the user's completion-criteria confirmation before closing the task; code delivery still requires its technical review gate.
- The delivery preview expands and collapses from the primary action, summarizes completion criteria, and names delivered files before offering the full audit report.
- Comments and related files stay collapsed during normal reading; expanding them reveals recent authors, timestamps, and the comment composer.
- Retryable AI failures require a plain-language runtime/cost confirmation and refresh both board projections after success.
- Closing an in-place task detail restores focus to the exact task-card action that opened it.
- “Technical and audit details” switches to the existing professional workspace, and either mode can be saved as the user's default presentation.
- The production scenario uses the real `DashboardView` and `DailyWorkBoard`, not the prototype markup.
- Bound AI statuses render as localized workflow copy; internal values such as `waiting_for_local_approval` and `report_posted` must not appear.
- The scenario contains overdue, approval, failed, completed/review-ready, and long-title work in the same projection.

## Fixes made during review

- Split the single-terminal Issue set into independent My tasks and AI tasks projections.
- Made `dueDate` the expected-completion grouping for My tasks and `plannedDate` the AI-execution grouping for AI tasks.
- Added child learning as a first-class task-person category.
- Added a compact AI coordination summary to My task cards without exposing agent implementation details there.
- Replaced cross-container visual ordering with a dedicated brief slot, preserving card width constraints on desktop and mobile.
- Removed the duplicate coordination facts card from Simple details and placed owner, due date, waiting party, and latest progress where users scan first.
- Replaced always-visible result and discussion controls with progressive disclosure while keeping the next action in the first viewport.

## Automated production artifacts

- `.myagenttool/visual-qa/screenshots/home-workbench-desktop.png`
- `.myagenttool/visual-qa/screenshots/home-workbench-mobile.png`
- `.myagenttool/visual-qa/screenshots/home-workbench-board-desktop.png`
- `.myagenttool/visual-qa/screenshots/home-workbench-board-mobile.png`
- `.myagenttool/visual-qa/screenshots/work-item-summary-review-desktop.png`
- `.myagenttool/visual-qa/screenshots/work-item-summary-review-mobile.png`
- `.myagenttool/visual-qa/screenshots/work-item-summary-failed-desktop.png`
- `.myagenttool/visual-qa/screenshots/work-item-summary-failed-mobile.png`
- `.myagenttool/visual-qa/latest.json` records no-horizontal-overflow, non-blank, and key-panel assertions.

Run `pnpm --filter @myagenttool/web build` followed by `pnpm visual:qa:browser` to refresh and enforce these artifacts.

## Production invariants

- Attention counts and card reasons must come from the same server projection or they can diverge.
- AI completion must not mutate planning state to `done` without the human review gate.
- Requester relation must not be reused as priority or authorization.
- Existing work must migrate to `unknown`; defaulting old tasks to `self` would create false business history.
- Launching an action is not resolution. Focus progression must use explicit resolved state or the refreshed action projection.
- Coordination branching must use semantic kinds, never translated labels.
