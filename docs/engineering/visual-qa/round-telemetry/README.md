# Visual QA — Invocation round telemetry (Epic #805)

Real-browser screenshots of the **"Rounds · this run"** card added to the
invocation detail view in #810, captured with Playwright + Chromium.

| Viewport | Screenshot |
| --- | --- |
| Wide (1440×900) | [rounds-1440w.png](rounds-1440w.png) |
| Narrow (390×900) | [rounds-390w.png](rounds-390w.png) |

The wide capture shows the card as shipped: a `3 rounds` badge, the run-level
token + cost summary (`33,750 in / 3,560 out tokens · ~$0.3777 est.`), and one
table row per model turn — model/provider, in/out/cached tokens
(thousands-separated), **cost** (`$0.1187` …), duration (`5.0s` / `14s` / `3.4s`),
files read, tool count, and a status badge.

## How to regenerate

The demo server seeds no invocations, so the card is rendered against an injected
state snapshot rather than a live run. That whole flow is scripted in
[tools/dev/round-telemetry-shot.mjs](../../../../tools/dev/round-telemetry-shot.mjs):
it boots the server to obtain a real, complete `GET /api/state` base, injects one
`succeeded` invocation plus three `invocationRounds`, then drives headless
Chromium (intercepting `/api/state`) at both viewports.

```sh
pnpm exec playwright install chromium          # once
pnpm --filter @myagenttool/web build           # produce apps/web/dist
pnpm visual:qa:rounds -- --out docs/engineering/visual-qa/round-telemetry
```

Without `--out` it writes to `.myagenttool/visual-qa/round-telemetry/`
(gitignored). The capture is deterministic, so re-running against this directory
is a no-op unless the card's rendering changes.
