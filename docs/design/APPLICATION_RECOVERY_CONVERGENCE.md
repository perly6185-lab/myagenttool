# Application Recovery ⇄ Self-Healing Convergence (one page)

Status: approved design · 2026-07-11 · follow-up to #685/#688 (cockpit integration items 1–2)

## Problem

Two failure→recovery mechanisms shipped independently and don't share semantics or metrics:

| | Deploy self-healing (H1–H3) | Application orchestration recovery |
|---|---|---|
| Object | `deployments` rows | orchestration-run invocations |
| Failure | deploy `status: "failed"` | run `status: "failed"` |
| Recovery | auto-rollback (H1) / next successful deploy | operator-driven action (rerun / select_agent / regenerate, approval-gated) |
| Metrics | `summarizeDeployments` → CFR, recovery median → **feeds L5** | **none** — recoveries happen but are never measured |

Maturity L5 ("deploy recovery <1h") reads only the deploy signal. A project with no deploy
target but real, measured orchestration recoveries stays **indeterminate** — honest per the
letter of the gate, but we hold a second genuine time-to-restore signal and discard it.

## Decision

**Converge at the metric layer, not the mechanism layer.** The two mechanisms operate on
different objects with different actuators (rollback vs. governed recovery actions); merging
them buys nothing and risks both. What they share is the DORA shape: *failure → first later
restore on the same stream*. We reuse exactly that.

1. **`summarizeOrchestrationRecovery(invocations)`** (new, pure — `services/application-recovery-metrics.mjs`):
   filter to orchestration runs (`options.metadata.source === "application_orchestration"`),
   group by `applicationId + routineId` (the stream), and for each `failed` run take the gap
   to the first later `succeeded` run of the same stream — mirror of `summarizeDeployments`'
   recovery calc, same `{ median, count }` output, all-null when no data.
2. **L5 feed with explicit provenance.** `loadMaturityInputs` computes
   `release.recoveryHours` as: deploy median when present (unchanged), **else** orchestration
   median, stamped `release.source: "deploy" | "orchestration"`. The scorecard's `measured`
   string names the source (`"orchestration recovery 0.4h (no deploy data — orchestration proxy)"`),
   so L5 moves indeterminate→measured without pretending the proxy is a deploy. When both
   exist, deploy wins (it is the gate's anchor); orchestration stays visible in `inputs`.
3. **No change to either mechanism's behavior.** H1–H3 and the recovery action flow are
   untouched.

## Explicitly deferred (phase 2, own slice + design)

Auto-recovery for orchestrations (the H1 analog): per-application opt-in flag
(mirroring `deployOnMerge`), auto-execute only non-approval actions (`rerun`,
`select_agent`) with an attempt cap, and an H3-style badge on the run. Deferred because it
changes execution behavior (auto-spawning runs) and needs its own approval-policy review;
the metric layer above needs none of it.

## Non-goals

- Merging `deployments` and recovery actions into one collection or one UI.
- Feeding orchestration recovery into the **DORA CLI** artifacts (those stay GitHub/deploy-anchored; see MATURITY_CALIBRATION.md).
- Counting `regenerate_orchestration` execution as "restored" — restore is only a later
  **successful run**, same as a deploy recovery is only a later successful deploy.

## Test/verify plan

Pure-function tests mirroring `summarizeDeployments`' (stream isolation: a success in
routine B does not recover routine A; unrecovered failure → count 0; median across
multiple failures). Scorecard tests: deploy-wins precedence, orchestration fallback with
`source` stamp, both-absent stays indeterminate. Live drive: fail a run via the bridge,
rerun-recover it, then `GET /api/maturity` shows L5 measured with the orchestration proxy.
