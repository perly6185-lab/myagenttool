# Work Item Follow-up Reminder Visual QA

Date: 2026-08-04

Result: pass for PR 7 reminder and follow-up loop

## Reviewed viewports

| Viewport | Result | Notes |
| --- | --- | --- |
| Desktop 1366 × 768 | Pass | The due Local Issue row and notification action remain distinct and readable. |
| Mobile 390 × 844 | Pass | The notification sheet fits the viewport and the underlying Follow-up lens remains scrollable. |

## Review target

- One due stakeholder follow-up appears once in the existing Follow-up lens.
- The row keeps the Local Issue title and routes back to that canonical owner surface.
- The notification center counts the reminder as an action and explains that progress or rescheduling resolves it.
- Optional browser delivery remains count-only and exposes no task text, report body, path, credential, or recipient.
- Desktop and mobile layouts remain readable without horizontal overflow.

## Repeatable check

```text
pnpm --filter @myagenttool/web build
pnpm visual:qa:browser
```

Expected screenshots:

```text
.myagenttool/visual-qa/screenshots/follow-up-reminder-desktop.png
.myagenttool/visual-qa/screenshots/follow-up-reminder-mobile.png
```

The 2026-08-04 run captured both screenshots, asserted the reminder and
notification copy, and detected no horizontal overflow.
