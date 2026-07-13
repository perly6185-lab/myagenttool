# Visual QA — Invocation round telemetry (Epic #805)

Real-browser screenshots of the **"Rounds · this run"** card added to the
invocation detail view in #810, captured with Playwright + Chromium.

| Viewport | Screenshot |
| --- | --- |
| Wide (1440×900) | [rounds-1440w.png](rounds-1440w.png) |
| Narrow (390×900) | [rounds-390w.png](rounds-390w.png) |

The wide capture shows the card as shipped: a `3 rounds` badge, the run-level
token summary (`33,750 in / 3,560 out tokens`), and one table row per model turn
— model/provider, in/out/cached tokens (thousands-separated), duration
(`5.0s` / `14s` / `3.4s`), files read, tool count, and a status badge.

## How these were captured

The demo server seeds no invocations, so the card was rendered against an
injected state snapshot rather than a live run:

1. `pnpm --filter @myagenttool/web build` (the console is served from `dist/`).
2. Boot the server once and save a real `GET /api/state` snapshot as a base
   (all read-model arrays present), then inject one `succeeded` invocation plus
   three `invocationRounds` for it.
3. A Playwright script serves `dist/` over HTTP, intercepts `**/api/state` to
   return the injected snapshot (register the catch-all `**/api/**` route first
   and the specific `**/api/state` route last — Playwright runs the
   last-registered matching route first), and deep-links to
   `/?section=invocations&invocation=inv_demo`.
4. Screenshot at desktop and mobile viewports.

Prerequisite: `playwright` (dev dependency) and its Chromium browser
(`pnpm exec playwright install chromium`). See `tools/dev/visual-qa.mjs`, which
attaches screenshots automatically once a browser-automation dependency is
present.
