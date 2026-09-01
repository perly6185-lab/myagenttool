# Visual QA

This document defines the browser-backed visual QA path for the Web Console.

Use the repo-level [DESIGN.md](../../DESIGN.md) as the visual consistency
baseline for product-facing Web Console changes. Use
[PRODUCT_FLOWS.md](../design/PRODUCT_FLOWS.md) to choose the role flow,
scenario, prototype state, and usability task that the screenshot or visual
artifact must prove.

## Automated Browser Level

The repository uses its project-managed Playwright dependency for repeatable
browser screenshots. Build the Web Console, then run:

Automated checks currently verify:

- The Web Console serves successfully.
- The task workspace includes task, safety, data, cost, activity, result, and
  audit surfaces.
- Mobile layout CSS exists.
- Long text overflow guards exist.
- User-facing state and event mappers exist.

These checks run through:

```text
pnpm --filter @myagenttool/web test
pnpm --filter @myagenttool/web build
pnpm visual:qa
pnpm visual:qa:browser
```

`pnpm visual:qa` writes repeatable local artifacts:

```text
.myagenttool/visual-qa/latest.json
.myagenttool/visual-qa/latest.md
```

`visual:qa:browser` starts an isolated local API and static Web server, injects
deterministic state through the normal `/api/state` boundary, and captures every
selected scenario at 1366 x 768 and 390 x 844. Empty, ready, running, succeeded,
approval, and disconnected are required foundation scenarios; maintained product
flows add further scenarios without requiring a hand-edited screenshot count.
The generated report is the source of truth for the available and selected
scenario catalog, expected screenshot count, actual screenshot count, viewport,
path, and per-screenshot assertions.

The gate fails on a blank page, horizontal overflow, missing primary controls,
or missing scenario-specific owner surfaces. Scenario assertions also protect
collapsed technical detail, result hierarchy, and work-column ownership. A pure
scripted violation fixture must trip the overflow, blank-page, primary-control,
technical-hierarchy, and column-ownership guards, so the failure path remains
covered without checking a broken UI into the application.

Run one state while developing with `pnpm visual:qa:browser -- --scenario=ready`.
The ready and run states use a Codex CLI agent so selector and session-oriented
task controls remain in coverage.

Generated screenshots remain under the gitignored
`.myagenttool/visual-qa/screenshots/` directory. Each run replaces that directory
so its files match the latest manifest and cannot be confused with stale evidence.
Attach the relevant files and `.myagenttool/visual-qa/latest.md` to the PR instead
of committing routine output.

## Manual Screenshot Checklist

Before closing a UI issue, capture or inspect:

- Desktop viewport around 1366 x 768.
- Mobile viewport around 390 x 844.
- The role flow and owner surface from
  [PRODUCT_FLOWS.md](../design/PRODUCT_FLOWS.md).
- Empty/no-result state.
- Running state.
- Succeeded state with result.
- Server-offline state.

Confirm:

- Task input, computer, agent, safety, data, cost, activity, result, and audit
  are visible in the main workflow.
- Primary controls remain reachable.
- Long task text and logs wrap instead of overflowing.
- Technical IDs do not dominate the first screen.
- Safety, data, cost, cancellation, and audit are described in plain language.

## Interactive Review Follow-up

Issue #136 owns the automated screenshot and validation contract. Issue #1834
tracks the separate interactive review page and selected-region feedback flow;
it must consume the generated manifest and keep external Issue creation behind
explicit approval.
