# Application M5 Productization Closeout

Date: 2026-07-10

M5 closes the first operator-productization pass for Application recovery,
Result Center stability, mixed-fleet operations, and scoped approvals.

## Delivered

- Recovery requests are now URL-addressable with `recovery=` navigation state,
  `applicationRecoveryDeepLink`, copied recovery links, focused recovery history,
  and preserved run-level links.
- Application recovery operations now carry the selected recovery request into
  diagnostics, so a shared URL opens the exact recovery record instead of only
  the parent orchestration run.
- Result Center coverage is split with a focused operations regression for
  metrics, retention policy, filtering, export, evidence save, and governance
  updates, reducing the burden on the long doocs/md end-to-end test.
- Applications now include a fleet overview for npm wrappers, stdio MCP, HTTP
  MCP, manual manifests, blocked live probes, ready MCP signals, and automation
  attention, with each metric acting as an operational filter.
- The Applications inspector now shows an Application-scoped approval queue
  linked by application invocation metadata and recovery approval request ids.
  It exposes requester, risk, target, duplicate guard, latest request, result
  links, and explicit approve buttons without auto-approving anything.
- Added `pnpm smoke:application-m5-productization` as a focused gate for the M5
  web regressions, web typecheck, mixed-fleet smoke, and docs links.

## Verification

- `pnpm --filter @myagenttool/web test -- ui-store deep-links applications-view applications-inspector`
- `pnpm --filter @myagenttool/web typecheck`
- `pnpm smoke:application-fleet`
- `pnpm docs:check`
- `pnpm smoke:application-m5-productization`

## Residual Follow-Up

- Keep shrinking the original long doocs/md result test as more focused Result
  Center regressions land.
- Broaden Application approval queue rows if future server read models add
  richer approval ownership fields beyond invocation metadata and recovery ids.
