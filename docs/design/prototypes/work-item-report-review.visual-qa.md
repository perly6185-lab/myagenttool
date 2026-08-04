# Work Item Report Review Visual QA

Date: 2026-08-04

Result: pass for PR 6 report review UI

## Reviewed viewports

| Viewport | Result | Notes |
| --- | --- | --- |
| Desktop 1366 × 768 | Pass | Report metadata, bounded sources, content, history, and review actions retain a clear hierarchy. |
| Mobile 390 × 844 | Pass | Fields and actions wrap without horizontal overflow; the Issue dialog remains the canonical editor. |

## Scenario checks

- An ordinary draft exposes audience, tone, editable content, bounded source summaries, regenerate, discard, save, and explicit confirmation.
- A stale draft clearly identifies the source revision change, disables edit and confirm, and retains regeneration from current progress.
- A confirmed draft is read-only and explains that confirmation neither sends the report nor closes the task.
- The report history can represent draft, confirmed, discarded, and superseded versions without creating another task status.
- No raw transcript, credential, approval internals, recipient send control, or automatic-close control appears.

## Browser artifacts

The browser QA command captured the following repository-local artifacts:

```text
.myagenttool/visual-qa/screenshots/report-draft-desktop.png
.myagenttool/visual-qa/screenshots/report-draft-mobile.png
.myagenttool/visual-qa/screenshots/report-stale-desktop.png
.myagenttool/visual-qa/screenshots/report-stale-mobile.png
.myagenttool/visual-qa/screenshots/report-confirmed-desktop.png
.myagenttool/visual-qa/screenshots/report-confirmed-mobile.png
```

Run the repeatable check with:

```text
pnpm visual:qa:browser
```

The command writes its full report to `.myagenttool/visual-qa/latest.md` and
`.myagenttool/visual-qa/latest.json`.

## Governance boundary

Confirmation saves the server-owned immutable reviewed snapshot only. Reminder
delivery and actual external sending remain separate PR 7 and PR 8 work under
#1608, with their own recipient, credential, preview, and receipt gates.
