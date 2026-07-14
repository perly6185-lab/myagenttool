# Web Console Usability — Review & Issue Plan

A usability review of the web console (`apps/web`) against its own stated goal in
[MYAGENTTOOL_DESIGN.md](../design/MYAGENTTOOL_DESIGN.md): *"understandable for
non-professional users, with expert controls behind progressive disclosure."*

**Method.** Real screenshots of Overview / Workspace / Economics / Applications /
Invocations captured at 1440w via injected-state Playwright, read against the design
references. Epic #926.

## What is already good (do not touch)

- A consistent three-pane shell (grouped nav rail, top bar with project/device/
  connection, right inspector) across all 22 sections.
- Model-grade **empty states** — every empty panel says what will appear and offers a
  next action.
- Progressive onboarding ("Getting started 2/4" with completed steps struck through).
- Non-expert framing ("What should your computer do?", "Queue for this computer").
- The **Economics** view (KPI tiles → daily-spend bars → top drivers → budget pools)
  is the house style at its best.

## Two structural framings

1. **Workspace is Overview by composition.**
   [workspace-view.tsx:96](../../apps/web/src/features/workspace/workspace-view.tsx)
   renders the entire `DashboardView`
   ([dashboard-view.tsx:50-298](../../apps/web/src/features/dashboard/dashboard-view.tsx))
   as its center pane — so the Getting-started onboarding checklist and the composer
   appear on both Overview and Workspace with different chrome. Nothing is
   copy-duplicated; the fix is to stop re-showing the *home/onboarding* surface in a
   view whose job is "files, transcript, history".
2. **The nav is a flat wall of 22.** [sections.ts](../../apps/web/src/app/sections.ts)
   groups 22 destinations into 5 intents, but
   [nav-rail.tsx:45-47](../../apps/web/src/components/layout/nav-rail.tsx) renders every
   group open, so a non-expert scans 22 heavily-overlapping names (Task / Auto-runs /
   Automation / Routines / Compare). Progressive disclosure = collapse the expert groups.

## Issue Tree

| Order | Issue | Priority | Area |
| --- | --- | --- | --- |
| 1 | Web console usability issue plan (this doc) | — | docs |
| 2 | [#927] Differentiate Workspace from Overview (drop the duplicated home surface) | P1 | web |
| 3 | [#928] Collapsible nav groups; expert groups collapsed by default | P1 | web |
| 4 | [#929] First-run legibility: one empty-state noun, truncation tooltips, muted contrast | P2 | web |
| 5 | [#930] Suppress controls/scaffolding before there is content | P2 | web |

## Tasks

### #927 — Differentiate Workspace from Overview (P1)

Give `DashboardView` a `surface` prop; when embedded by Workspace it omits the
onboarding `GettingStartedCard` (a first-run/home concern) while keeping the composer
and activity. Overview stays the canonical home. A test asserts the onboarding card is
absent in the Workspace surface.

### #928 — Collapsible nav groups (P1)

Convert the group header `<p>` into a toggling `<button>` with a caret; gate the inner
`<ul>` on per-group open state. Default the expert groups (Configure, Ledgers)
collapsed, Work + Oversee open; always auto-expand the group holding the active
section so deep-links never land hidden. Persist the open set to localStorage.

### #929 — First-run legibility (P2)

- **One empty-state noun.** Five nouns say "nothing has run" today — `No sessions`,
  `No activity yet`, `No invocations yet`, `No result yet`, `Nothing recorded yet`.
  Converge on one ("runs").
- **Truncation tooltips.** Add `title` to the clipped topbar project selector, the
  agent-picker options, and the sidebar branch label.
- **Muted contrast.** Raise the lowest-contrast dark tokens (`text-muted-foreground/60`
  group labels, `opacity-60` sub-labels).

### #930 — Suppress controls/scaffolding before content (P2)

Hide the Applications Status/Kind filter row until at least one application exists;
suppress the Overview right-rail record/result scaffolding until a run exists, so the
first-run rail isn't four rows of empty placeholders.

## Non-goals

- No visual redesign of the working views (Economics, per-run inspector) — they meet
  the bar.
- No renaming or removing destinations — #928 collapses, it does not delete. Deep-links
  and muscle memory are preserved.
