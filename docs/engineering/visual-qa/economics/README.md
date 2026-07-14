# Visual QA — Spend dashboard (Epic #851)

Real-browser screenshots of the **Spend dashboard** added to the Economics view
in #855 (Playwright + Chromium).

| Viewport | Screenshot |
| --- | --- |
| Wide (1440) | [spend-1440w.png](spend-1440w.png) |
| Narrow (390) | [spend-390w.png](spend-390w.png) |

The wide capture shows the Economics view as shipped: the **Spend dashboard**
(#855) — a daily-spend bar trend (dated `2026-07-06 → 2026-07-13`) plus
**Top agents** / **Top projects** magnitude bars with direct USD labels
(single-hue marks on the theme's primary token, recessive tracks, dark-mode
correct) — and, lower on the page, the **Imported usage (ccusage)** card showing
the `last imported <time>` freshness label (#883) and the opt-in
**"Enable daily auto-import"** toggle (#901). The cost-ledger table is the table
view.

## How these were captured

The demo seeds no ledger, so the dashboard was rendered against an injected state
snapshot (a real `GET /api/state` base + fabricated `ledgerSummary` /
`ledgerEntries`), served from `apps/web/dist`, with Playwright intercepting
`/api/state` and deep-linking to `/?section=economics`. Same method as
`tools/dev/round-telemetry-shot.mjs` (register the catch-all `**/api/**` route
first and `**/api/state` last).
