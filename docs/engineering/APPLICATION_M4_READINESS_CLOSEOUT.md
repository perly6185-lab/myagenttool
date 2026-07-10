# Application M4.1 Readiness Closeout

Status: delivered as the M4.1 baseline for Application scale-up.

Date: 2026-07-10

## Objective

M4 should not add another isolated integration first. The first deliverable is a
repeatable readiness gate for the Application product line:

```text
can integrate -> can use -> can operate -> can verify again
```

M4.1 turns the current ccusage, doocs/md, Application Evidence Center, and
governed Codex work into a single reviewable baseline before M4.2 adds a guided
intake flow.

## Delivered Scope

### Can integrate

- The ccusage Application baseline is pinned to `ccusage@20.0.16`, matching the
  current published npm version checked by the readiness gate.
- Application registration, descriptor projection, wrapper dispatch, and MCP
  discovery remain covered by focused server tests and live smoke flows.
- The real doocs/md rehearsal proves a local repository Application can expose
  stdio MCP tools, run through the Desktop Bridge, import render results, and
  recover state after restart.

### Can use

- Applications inspector keeps the operator path in one place: descriptor next
  actions, stable ccusage operation case, latest result, result history, MCP
  tools, and Application result modal.
- ccusage remains the reference use case for a stable facade backed by an
  Application wrapper: discover report capabilities, run `ccusage.report`, and
  inspect imported usage evidence.
- Codex remains a governed tool suite, not a synthetic `app_codex`
  Application. The readiness gate verifies `codex.review.diff`,
  `codex.propose.patch`, and `codex.apply.patch` through their governed smokes.

### Can operate

- Application smoke checklist evidence can be saved through the Application
  API and is projected into Evidence Center as `application_smoke_evidence`.
- The Audit view now includes an Evidence Center panel with selectable evidence
  details, so saved smoke evidence is navigable from the operator console.
- The Applications inspector `View evidence` action switches to the Audit view
  and selects the saved evidence id, closing the save-to-review loop.
- Result, audit, public state, and Evidence Center links are still tested by
  the Application registry smoke and doocs/md rehearsal.

## Acceptance Gate

Run the M4.1 readiness gate:

```powershell
pnpm smoke:application-m4-readiness
```

The gate checks:

- current npm `ccusage` version equals the pinned `20.0.16` baseline
- server Application focused tests
- Desktop Bridge Application check
- Web Application, Evidence Center, and Codex UI regressions
- Web and server typechecks
- Application registry smoke, including saved smoke evidence projection
- live Application wrapper and stdio MCP execution
- mixed-fleet HTTP MCP success/blocked and manual manifest coverage
- real doocs/md Application rehearsal
- ccusage compatibility smoke
- governed Codex review, patch proposal, and apply smokes
- engineering docs link check

## Supporting Commands

The aggregate gate intentionally reuses the existing focused commands:

```powershell
pnpm --filter @myagenttool/server exec node --test test/application-descriptors.test.mjs test/application-mcp-agent.test.mjs test/application-wrapper-dispatch.test.mjs test/ccusage-application.test.mjs
node apps/desktop/src/index.mjs --check
pnpm --filter @myagenttool/web test -- audit-view applications-inspector applications-view tools-view
pnpm --filter @myagenttool/web typecheck
pnpm --filter @myagenttool/server typecheck
pnpm smoke:applications
pnpm smoke:application-wrapper
pnpm smoke:application-fleet
pnpm smoke:doocs-md-application
pnpm smoke:ccusage-agent
pnpm smoke:codex-tool
pnpm smoke:codex-patch-proposal
pnpm smoke:codex-apply-patch
pnpm docs:check
```

## Product Boundary

M4.1 is a readiness and closeout slice. It deliberately does not implement the
full M4 guided onboarding experience.

Accepted next scope:

- M4.2: guided Application intake, using the existing integration brief,
  descriptor draft, policy preview, and smoke checklist as one flow. First slice
  delivered in
  [APPLICATION_M4_ONBOARDING_GUIDE_CLOSEOUT.md](./APPLICATION_M4_ONBOARDING_GUIDE_CLOSEOUT.md).
- M4.3-M4.4: Application operations and approval baseline, delivered in
  [APPLICATION_M4_OPERATIONS_CLOSEOUT.md](./APPLICATION_M4_OPERATIONS_CLOSEOUT.md).
  The detail page now summarizes result operations and recovery operations, and
  the aggregate readiness gate covers mixed-fleet HTTP MCP/manual manifests plus
  approval issuance/verification paths.

Non-goals for this closeout:

- converting Codex into an Application
- broadening arbitrary local execution
- adding marketplace, billing settlement, or public app distribution
- replacing existing focused smoke scripts with one monolithic test

## Residual Risks

- The worktree is intentionally broad because it contains several accumulated
  Application and Codex slices. Review should group changes by product line
  before merge: ccusage/Application reference, Evidence Center operations, real
  doocs/md MCP, and governed Codex tools.
- The readiness gate is integration-heavy. It is appropriate before handoff or
  release, while day-to-day development should continue to use the focused
  commands listed above.
- Recovery-action deep links currently target the source run rather than a
  specific recovery request id. Add per-request URLs if operators need to share
  one recovery decision directly.
