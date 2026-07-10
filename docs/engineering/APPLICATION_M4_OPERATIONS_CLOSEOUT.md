# Application M4.3-M4.4 Operations Closeout

Status: delivered as the Application operations and approval baseline.

Date: 2026-07-10

## Objective

This slice turns the guided intake work into an operator loop after
registration:

```text
result operations -> recovery operations -> mixed fleet coverage -> approval verification
```

## Delivered Scope

- Result Center now has a `Result operations` summary on the Application detail
  page. Operators can see visible/total results, active/pinned/archived counts,
  evidence-ready results, render/artifact mix, rerunnable results, exportable
  results, and latest import status before scanning the result list.
- Recovery actions now have a top-level `Recovery operations` panel. It shows
  pending approvals, executed actions, recovered actions, attention count,
  latest recovery guidance, approval request id, direct approval, run routing,
  and result invocation routing without forcing the operator to expand a run
  diagnostics card first.
- Mixed-fleet coverage is part of the M4 readiness gate. The
  `smoke:application-fleet` path covers npm wrapper, stdio MCP, successful HTTP
  MCP live probe and confirmation, blocked HTTP MCP endpoint evidence, manual
  manifest declared capabilities, public read-model health, and restart
  recovery.
- Approval issuance and verification are covered through real approval request
  flows: Web recovery operations call `api.approveApproval`, wrapper policy
  consent still uses approval-before-consent, HTTP MCP confirmation requires a
  live probe and approval retry, and the readiness gate verifies these flows in
  focused tests and smokes.

## Governance Boundary

This slice does not auto-approve descriptors, recovery actions, wrapper
commands, or MCP candidates. Approval remains an explicit API operation, and
generated or discovered execution surfaces still require the existing review,
probe, consent, and bridge checks.

## Verification

Focused Web coverage:

```powershell
pnpm --filter @myagenttool/web test -- applications-inspector
pnpm --filter @myagenttool/web typecheck
```

Mixed-fleet coverage:

```powershell
pnpm smoke:application-fleet
```

Aggregate gate:

```powershell
pnpm smoke:application-m4-readiness
```

## Remaining Follow-up

- Add deep-link targets for individual recovery action ids if operators need
  stable links to a specific recovery request, not just the source run.
- Split the long doocs/md Result Center test if its coverage grows again.
