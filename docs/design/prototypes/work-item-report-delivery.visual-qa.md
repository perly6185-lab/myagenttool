# Work Item Report Delivery Visual QA

Date: 2026-08-04

Result: pass criteria defined for PR 8 controlled external delivery

## Reviewed viewports

| Viewport | Required result |
| --- | --- |
| Desktop 1366 × 768 | Exact target, immutable message, boundary warning, status, and provider receipt remain visually distinct. |
| Mobile 390 × 844 | Selectors, long content, receipt IDs, warnings, and actions wrap without horizontal overflow. |

## Scenario checks

- Only a confirmed report exposes external delivery.
- The preview names the exact channel, provider, and addressable conversation recipient.
- The preview body is the immutable confirmed report snapshot, not a live editor.
- The external-send boundary explicitly says that sending does not complete or close the task.
- A second confirmation is required immediately before the governed send action.
- Delivered, queued, and failed states can show message-part counts, attempts, provider receipt IDs, and provider error codes.
- No credential, approval token, raw channel configuration, task-complete action, or task-close action appears.

## Browser artifacts

Run:

```text
pnpm visual:qa:browser
```

The report-delivery scenario writes:

```text
.myagenttool/visual-qa/screenshots/report-delivery-desktop.png
.myagenttool/visual-qa/screenshots/report-delivery-mobile.png
```

The complete machine-readable report remains in `.myagenttool/visual-qa/latest.json`,
with the human-readable summary in `.myagenttool/visual-qa/latest.md`.

## Governance boundary

Creating a preview performs no external side effect. Sending requires a new
single-use grant scoped to `work_item.report.deliver` and the immutable delivery
preview ID. Provider delivery is recorded independently of Work Item lifecycle;
success, retry, or failure never changes Work Item state or revision.
