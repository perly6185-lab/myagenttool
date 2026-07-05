# P3 Invocation Explanation Closeout

Status: P3-4 closeout sweep.

Objective: keep invocation explanations operator-actionable across the Web
control plane without introducing a router or new execution-side effects.

## Coverage Matrix

| Scenario | Server explanation | Web display | Action target | Status |
| --- | --- | --- | --- | --- |
| Local approval | `waitingOn.type = approval`, `approval.requestId` | Why, waiting-on, next step, approval badge | Dashboard selected invocation | Covered |
| Application recovery pending approval | `recovery.actionRequestId`, `approvalRequestId`, result pointer when present | Recovery category, state, waiting-on, recovery action | Dashboard approval and Applications recovery timeline | Covered |
| Application recovery executed | `resultLocation.invocationId` or recovery result invocation | Result and source lineage | Result invocation and source invocation | Covered |
| Application recovery orchestration output | `resultLocation.type = orchestration` | Result label | Applications recovery timeline | Covered |
| Troubleshooting report | `resultLocation.type = troubleshooting_report` | Result report label | Source invocation for the report | Covered |
| Troubleshooter invocation | `source.type = troubleshooting` | Source badge and source row | Target failed invocation | Covered |
| Automation and scheduled automation | `source.type = automation` | Source badge and source row | No action required | Covered |
| Auto-run | `source.type = auto_run` | Source badge and source row | No action required in this slice | Covered |
| Compare run | `source.type = compare_run` | Source badge and source row | No action required in this slice | Covered |
| Tool-created invocation | `source.type = tool` | Source badge and source row | No action required in this slice | Covered |
| Missing approval/result/report/source target | Existing explanation points at a record absent from the current snapshot | Explicit "target is not loaded" note | Button withheld until target is loaded | Covered |
| Stale application run selection | Selected run no longer appears in run history | Existing run list remains collapsed | No incorrect diagnostics expansion | Covered |

## Intentional Non-Goals

- URL-addressable deep links for invocation explanations.
- Browser screenshot automation beyond the repository's lightweight
  `visual:qa` check.
- New backend routes, approval mutations, or execution behavior.
- New action buttons for automation, auto-run, compare run, or tool sources
  where the current control plane has no stable owner surface.

## Follow-Ups

- Add URL routing once the Web console has a shared navigation model.
- Add browser screenshot automation when the visual QA dependency is available.
- Consider source-specific actions for auto-run and compare run after those
  surfaces expose stable detail panes.
