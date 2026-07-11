# Application Health Probe (probe v2) — one page

Status: approved design · 2026-07-11 · closes the Applications-line backlog (follow-up to ORCHESTRATION_AUTO_RECOVERY.md)

## Problem

Probe v1 runs once, on demand: it infers capabilities from the source at registration time.
After that, nothing watches the source. A deleted or moved local checkout leaves the
application `active` — its runs and wrapper invocations fail at dispatch time with confusing
runtime errors instead of the honest answer: *the source is gone; the app should be offline*.

## Policy — degrade automatically, promote only by hand

The status transition is the whole risk surface, so it gets the asymmetric rule (same spirit
as ORCHESTRATION_AUTO_RECOVERY.md's "autonomy never crosses an approval gate"):

1. **Auto-degrade only.** After `2` consecutive failed health checks (fixed threshold —
   avoids flapping on transient FS states), an `active` application is transitioned
   `active → offline` through the existing `transitionApplication` path, attributed
   `system_health_probe`. Offline disables execution-like capabilities — the safe direction.
2. **Never auto-online.** Bringing an application back online re-enables execution, which is
   approvalToken-gated for humans; autonomy doesn't get a cheaper path. When a source
   recovers, the probe records health `healthy` and emits an event telling the operator to
   bring it online — it never does so itself.
3. **Opt-in per application, default off**: `application.healthProbe = { enabled,
   intervalMinutes }` (1–60, default 5) via `POST /api/applications/:id/health-probe`,
   approvalToken required — the same write-control convention as auto-recovery.
4. **Honest for unsupported sources.** The check is *source availability*: the materialized
   `application.path` exists on disk (local and git sources). npm/manual sources have no
   local materialization to check — their health reads `unsupported` and they are never
   auto-transitioned; no fabricated verdicts.

Every check writes `application.health = { status: healthy | unhealthy | unsupported,
checkedAt, reason, consecutiveFailures }`; failures, the auto-offline transition, and
recovery each emit an event (`application_health_probe_failed` /
`application_health_auto_offline` / `application_health_recovered`).

## Mechanism

`applicationHealthSweep()` on the composed services, driven by the same slow `setInterval`
tick `index.mjs` already uses for `reapStuckAutoRuns` / `autoMergeSweep` (60s, unref'd,
absent in self-check). The sweep itself throttles per application by its `intervalMinutes`
(`lastCheckedAt`), so the tick stays cheap; it checks only opted-in, non-archived
applications. No timers inside the composer — tests call the sweep directly.

## Non-goals

- Deep health (running the app, hitting endpoints, npm registry reachability) — this slice
  is source *presence*, the failure mode we actually observed.
- Auto-online, auto-archive, or any capability re-probe on a schedule (capability drift is
  a different problem; manual probe already covers it).
- Agent health — already covered by the agent health-check machinery.

## Test/verify plan

Integration (real HTTP + direct sweep calls): config endpoint enforces approvalToken and
interval bounds; default off → sweep is a no-op; healthy path → health recorded, status
untouched; source dir removed → first sweep marks unhealthy (still active), second sweep
auto-offlines with events; dir restored → health recovers but status STAYS offline; a
manual `online` (with token) completes the loop; npm/manual source → `unsupported`, never
transitioned. Live drive mirrors the same script against the running server.
