# P4 Web URL Navigation

Status: P4-1 lightweight URL-backed navigation.

Objective: make Web control-plane navigation refreshable and shareable without
introducing a routing framework.

## Query Parameters

| Parameter | Meaning |
| --- | --- |
| `section` | Top-level Web console section, such as `dashboard`, `invocations`, or `applications`. |
| `invocation` | Selected invocation id for dashboard, invocations, review, or related inspector flows. |
| `application` | Selected application id for the Applications surface. |
| `routine` | Selected application routine id when deep-linking a run. |
| `run` | Invocation id for the selected application orchestration run. |

When any navigation parameter is present, the URL is treated as the source of
truth for these navigation selections. Missing selection parameters clear stale
values from the persisted UI store. With no navigation parameters, the existing
local UI persistence restores the last workspace view.

## Examples

```text
?section=invocations&invocation=inv_123
?section=applications&application=app_docs&routine=routine_docs_smoke&run=inv_123
```

## Copy Entry Points

- Invocation operator explanations expose a copy action for the selected
  invocation deep link.
- Application orchestration run diagnostics expose a copy action for the
  selected application run deep link.
- Generated links keep the current origin, path, hash, and unrelated query
  parameters, then replace only the Web navigation parameters.

## Server-Generated Links

Troubleshooting reports may include relative Web navigation targets for:

- The failed invocation.
- The platform troubleshooter invocation that generated the report.
- The application orchestration run, when the failed invocation has complete
  `applicationId`, `routineId`, and invocation metadata.

Server-generated links intentionally stay hostless and only carry the relative
query plus structured target fields. The Web control plane or downstream report
renderer owns the current origin, path, and copy/open behavior.

The Web operator explanation surface renders troubleshooting report links as
open/copy actions, using the structured target to update control-plane
selection and the relative query to create shareable links on the current Web
origin.

## Non-Goals

- Full browser history entries for every selection change. P4-1 uses
  `history.replaceState` to avoid noisy back-button behavior.
- A route hierarchy or `react-router`.
- URL routes for auto-run, compare-run, or tool detail panes that do not yet
  have stable owner surfaces.
