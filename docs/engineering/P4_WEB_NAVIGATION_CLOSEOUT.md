# P4 Web Navigation Closeout

Status: P4-2B closeout sweep.

Objective: keep Web control-plane navigation refreshable, shareable, and
operator-actionable for the owner surfaces that have stable selection state,
without introducing a router or broadening the product surface.

## Accepted Contract

- URL-backed navigation is intentionally lightweight and store-driven.
- Supported query parameters are `section`, `invocation`, `application`,
  `routine`, and `run`.
- Copy helpers preserve the current origin, path, hash, and unrelated query
  parameters, then replace only Web navigation parameters.
- Server-generated links stay hostless: reports carry a relative query and
  structured target fields, while the Web surface owns open/copy behavior.
- Open actions use structured target fields to update Web selection state; the
  UI does not execute arbitrary URLs from report payloads.

## Coverage Matrix

| Owner surface | Target shape | Open action | Copy action | Status |
| --- | --- | --- | --- | --- |
| URL bootstrap and refresh | `section`, `invocation`, `application`, `routine`, `run` | URL params hydrate the UI store on load/popstate | Store changes replace the current URL search | Covered |
| Invocation operator explanation | Selected invocation | Selects Invocations and the invocation id | Copies an invocation deep link | Covered |
| Application run diagnostics | Application, routine, invocation run | Existing run history selection expands diagnostics | Copies an application run deep link | Covered |
| Troubleshooting report generation | Failed invocation, troubleshooter invocation, optional application run | Server emits structured target fields only | Server emits hostless relative query only | Covered |
| Operator explanation troubleshooting result | Troubleshooting report `webLinks` | Opens failed invocation, troubleshooter invocation, or application run | Copies each report target link | Covered |
| Context inspector troubleshooting report | Troubleshooting report `webLinks` | Opens failed invocation, troubleshooter invocation, or application run | Copies each report target link | Covered |

## No Handling Needed Now

| Surface | Reason |
| --- | --- |
| Dashboard approval focus | It already uses `section=dashboard&invocation=...`; no separate approval id query is needed until approvals get a stable detail pane. |
| Review findings | Findings are read-model rows, not a stable owner surface with a selected finding id. Existing actions route back to source invocation/review section context. |
| Evidence Center rows | Evidence is currently surfaced through imported/read-model cards and inspectors rather than a dedicated URL-addressable evidence detail page. Report links are exposed from the report owner surfaces. |
| Tools facade | Tool descriptors and invocation creation are list/form workflows; individual tool detail panes are not stable owner surfaces. |
| Integrations and discovery | These are setup/configuration flows without durable selected-record navigation in this slice. |
| Terminal sessions | Managed terminal selection is not part of the P4 query contract and should remain separate until terminal replay/detail ownership is defined. |

## Deferred Follow-Ups

| Surface | Follow-up trigger |
| --- | --- |
| Auto-run detail links | Add when auto-runs expose a stable selected run id and detail pane. |
| Compare-run detail links | Add when compare-runs expose a stable selected compare id and owner surface. |
| Tool detail links | Add when tools have durable detail pages instead of descriptor cards/forms. |
| Evidence detail links | Add when Evidence Center has a first-class selected evidence id and detail route/state. |
| Browser history entries | Revisit if operators need back-button traversal through every selection change; P4 currently uses `history.replaceState`. |

## Verification

The closeout sweep verified the contract with:

```text
pnpm --filter @myagenttool/web test
pnpm --filter @myagenttool/web typecheck
pnpm --filter @myagenttool/server typecheck
git diff --check
```

Relevant regression coverage:

- `apps/web/src/store/ui-store.test.ts`
- `apps/web/src/app/url-navigation-sync.test.tsx`
- `apps/web/src/app/deep-links.test.ts`
- `apps/web/src/features/invocations/invocations-view.test.tsx`
- `apps/web/src/features/invocations/run-context-inspector.test.tsx`
- `apps/web/src/features/applications/applications-inspector.test.ts`
- `apps/server/test/web-navigation-read-model.test.mjs`
- `apps/server/test/integration/tools-http.test.mjs`

## Residual Risk

- The navigation contract is query-param based, so unknown future owner surfaces
  need explicit query keys before they become shareable.
- Report links depend on invocation metadata for application run targets; when
  metadata is incomplete, the application run link is intentionally omitted.
- The Web state model still owns selection validity. If a linked record is not
  loaded in the current snapshot, existing surfaces degrade by withholding or
  soft-failing actions instead of fabricating a target.
