# Economics on Real Usage — Design & Issue Plan

This plans the next M3 economics batch: turn the **real measured tokens** the
round-telemetry epic (#805) now captures into **real dollars and real control**.
Today the system knows exactly how many tokens each model turn spent, but the
pricing, per-run cost visibility, and usage-based enforcement to act on that are
missing. This epic closes that gap without re-building what already exists.

## Goal

Every run's cost is computed from its measured tokens at configured per-model
rates; the console shows cost per round / per run and a spend dashboard; and
usage-based (token/USD, windowed) quota enforcement finally applies to the
BYOK / bridge runs that are the real-usage source — feeding the existing alert
pipeline when spend spikes.

## What already exists (do NOT rebuild)

Grounded in the current code — this epic builds on, not over, these:

- **Real tokens per run** — `recordInvocationRoundUsage` sums `state.invocationRounds`
  into an `AIUsageRecord` with `derivedFrom: "rounds"` ([m3.mjs:747](../../apps/server/src/services/m3.mjs)).
- **Real-USD ledger (partial)** — `recordInvocationLedgerEntry` uses an agent-reported
  `total_cost_usd`, else a token estimate, but only **codex** has a rate table
  (`estimateCostUsdFromTokens`, [m3.mjs:1636](../../apps/server/src/services/m3.mjs)); every other model falls to `unknown`.
- **Budgets that block** — `budgetGateForProject` blocks `over && policy==="block"`;
  auto-run fail-closes on any `over`. Project + team pools, progress bars, set-budget forms.
- **Chargeback export** — `chargebackExport()` + `GET /api/m3/chargeback-export`, plus a CSV button.
- **Alert pipeline** — `createAlertDispatcher` (webhook) already fires `budget_exceeded`.
- **Ledger rollups** — `ledgerSummary()` (by cost owner / project / agent) and the economics tiles/tables.

## The core gap

Quota is **request-count** based (`policy.used += requestCount`,
[m3.mjs:721](../../apps/server/src/services/m3.mjs)) and only gates
`platform_managed` runs — so the BYOK/rounds path that carries the real usage is
**never metered or blocked by usage**. And the rounds card shows tokens + timing
but **no dollars** — because outside codex there are no rates to price them.

## Data Model additions

### Model pricing table (new)

A configurable per-model rate table, the keystone this epic rests on. ID prefix
`prc_` (add to `common.ts`).

```ts
export interface ModelPrice {
  id: ModelPriceId;              // prc_*
  provider: string;             // "anthropic" | "openai" | "codex" | …
  model: string;                // matched against AIUsageRecord.model
  currency: CurrencyCode;       // "USD"
  inputUsdPerMTok: DecimalString;
  outputUsdPerMTok: DecimalString;
  cachedInputUsdPerMTok: DecimalString;
  reasoningOutputUsdPerMTok: DecimalString;
  source: "config" | "default" | "override";
  updatedAt: IsoDateTime;
}
```

### Changes to existing types

- `AIUsageRecord`: populate `estimatedCost` (a real `DecimalString`) from summed
  round tokens × the matched `ModelPrice`, instead of the current `"unknown"` on
  the rounds path.
- `InvocationRound` (protocol) + the round record: add an optional derived
  `estimatedCostUsd` (per-turn cost) — display only, computed at rollup.
- `QuotaPolicy`: add a `meter: "requests" | "input_tokens" | "total_tokens" | "usd"`
  discriminator and interpret `limit`/`used` in that unit, defaulting to
  `"requests"` for backward compatibility.

### New alert kind

- `cost_anomaly` for the existing `createAlertDispatcher` (spend spike / unusually
  expensive run), alongside `budget_exceeded`.

## Issue Tree

| Order | Issue | Area | First batch? |
| --- | --- | --- | --- |
| 1 | Economics-on-Real-Usage Issue Plan (this doc) | docs | Yes |
| 2 | Model pricing table + price the real-usage path | billing / protocol | Yes |
| 3 | Per-round & per-invocation cost rollup | server | Yes |
| 4 | Cost in the console — round cost + economics cost columns | web | Yes |
| 5 | Spend dashboard — trend + by-model/agent/project | web | No |
| 6 | Usage-based (token/USD, windowed) quota enforcement | billing | No |
| 7 | Cost-anomaly detection → alert | server | No |

## First Batch PRs

### PR 1 — Issue Plan

- This document exists and is linked from the engineering index.
- Names what exists vs the gap; excludes payment/invoice/tax and external SIEM delivery.
- No runtime change.

Verification: `pnpm docs:check`, `git diff --check`.

### PR 2 — Model pricing table + price the real-usage path

The keystone: without rates, the rounds path has tokens but no dollars.

- Add `ModelPrice` protocol type + `prc_` id; seed a config-driven default rate
  table (Claude + OpenAI + codex) from env/config, generalizing the codex-only
  `estimateCostUsdFromTokens`.
- On completion, set the rounds-derived `AIUsageRecord.estimatedCost` from summed
  tokens × the matched rate, and attribute a token-estimated ledger entry when
  the agent reported no USD (so BYOK Claude runs stop being `unknown`).
- Unknown/unmatched models stay `unknown` (never guess) and remain visible.

Accepted scope:

- Rates are data, not code — adding a model is a config change, not a new branch.
- Reported USD still wins over the estimate (no double-count with `recordInvocationLedgerEntry`).
- Tests: a Claude run prices from tokens; an unpriced model stays `unknown`; reported-USD path unchanged.

Suggested files: `packages/protocol/src/economics.ts`, `common.ts`,
`apps/server/src/services/m3.mjs`, `apps/server/src/services/invocations/completion.mjs`.

Verification: `pnpm --filter @myagenttool/protocol test`,
`pnpm --filter @myagenttool/server test`, `pnpm typecheck`.

### PR 3 — Per-round & per-invocation cost rollup

- Compute per-round cost (round tokens × matched rate) and expose it as a derived
  `estimatedCostUsd` on the round read model; sum to a per-invocation cost.
- No new ledger entries — this is display-tier attribution over PR 2's rates.

Accepted scope:

- Deterministic; unpriced rounds report `null`, not `0`.
- Tests: multi-round run sums per-round costs to the invocation total.

Suggested files: `apps/server/src/services/round-telemetry.mjs` or a rollup in
`m3.mjs`, `apps/server/src/read-models/state.mjs`.

Verification: `pnpm --filter @myagenttool/server test`, `pnpm typecheck`.

### PR 4 — Cost in the console

- Add a **Cost** column + run-total to the "Rounds · this run" card.
- Add per-invocation cost to the economics ledger/agent rollups where tokens
  already show.

Accepted scope:

- Reuses existing table/card primitives; `unknown` cost renders as `—`, never `$0`.
- Render test asserts the cost column and run total; visual QA via `pnpm visual:qa:rounds`.

Suggested files: `apps/web/src/features/invocations/invocations-view.tsx`,
`apps/web/src/features/economics/*`, `apps/web/src/lib/money.ts`.

Verification: `pnpm --filter @myagenttool/web test:unit`, `pnpm --filter @myagenttool/web build`, `pnpm visual:qa:rounds`.

## Later Batch

### PR 5 — Spend dashboard

- A spend-over-time trend plus by-model / by-agent / by-project breakdowns —
  turn the tiles+tables economics view into a real dashboard. Use the `dataviz`
  guidance; theme-aware, accessible.

### PR 6 — Usage-based quota enforcement

- Extend `QuotaPolicy` with a `meter` (requests / tokens / usd) and a real window;
  increment `used` by the metered quantity (not just request count); make the
  pre-flight gate apply to BYOK/bridge runs (soft-warn or block per policy) so the
  real-usage path is finally governable. Backward compatible with request-count policies.

### PR 7 — Cost-anomaly detection

- A detector over recent spend (per project/agent) that fires a `cost_anomaly`
  alert through the existing dispatcher on a spike or an unusually expensive run.
  Thresholds are config; no new delivery mechanism.

## Non-Goals

- Payment provider, invoices, tax, or subscription plans.
- External SIEM / immutable-audit delivery (shape only, already deferred).
- Revenue-share / marketplace settlement (M4).
- Guessing a price for an unmatched model — unpriced stays `unknown`.

## Verification Baseline

```text
pnpm docs:check
pnpm typecheck
pnpm test
pnpm smoke:local
git diff --check
```
