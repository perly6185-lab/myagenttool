# Bridge Liveness & Refusal (one page)

Status: DRAFT for review · 2026-07-11 · application-execution robustness: the bridge's
"active" and "refused" mechanics

## Problem — four verified gaps

The dispatch state machine (queued → dispatching[lease 30s] → acknowledged/running →
complete) is solid on the happy path, but the failure paths trust the bridge to stay alive
and to always *finish* what it leased:

1. **A dead bridge stays "online" forever.** `device.status` flips online at bridge
   register and `lastSeenAt` refreshes on every authenticated bridge request — but nothing
   ever *watches* `lastSeenAt`. Kill the bridge and the console shows "Online and ready"
   indefinitely, while new runs queue silently.
2. **A run acknowledged by a bridge that then dies is `running` forever.** The dispatch
   lease is cleared on ack (`leaseExpiresAt: null`), and `options.timeoutSeconds` is only
   enforced by the bridge itself. Only `cancelling` has a reclaim; `running` has none — it
   holds a concurrency slot and its worktree lock until a human notices.
3. **Redelivery is unbounded.** A bridge that leases but never acks (wedged pre-ack) makes
   the lease expire → requeue → re-lease → … forever, one warn event per 30s lease,
   with `dispatchAttempts` counting up and nothing acting on it.
4. **The bridge cannot refuse work.** Its verbs are next/ack/complete/cancel. A bridge that
   *knows* it can't run a delivery (agent binary missing, workspace path gone, unsupported
   adapter) can only fail-after-ack or silently let the lease lapse — both of which read as
   generic failures/timeouts instead of the honest answer.

## Design

**A. Liveness: watch what we already record.** A `bridgeLivenessSweep` on the existing 60s
tick: `device.status === "online"` and `lastSeenAt` older than a staleness threshold
(default 90s — the bridge polls every few seconds; env-overridable) → flip
`status: "offline"`, append `bridge_liveness_lost` (warn), push one operator alert (the
existing webhook). Any authenticated bridge request already refreshes `lastSeenAt`; the
same path now also restores `status: "online"` (+ `bridge_liveness_restored`, info) so
recovery is symmetric and immediate. The console's device pill becomes trustworthy.

**B. Running watchdog, scoped to a dead bridge.** In the same sweep: an invocation
`running` whose delivery device has been liveness-offline (per A) longer than a grace
(default `max(2× timeoutSeconds, 5min)`) → `completeInvocation` with `status: "timed_out"`,
`result.errorCode: "dispatch_timeout"`, and a `delivery_reclaimed` event. Precision matters:
a *live* bridge enforces its own `timeoutSeconds`, so the server reaps only when the bridge
is provably gone — long-running work on a healthy bridge is never guillotined.

**C. Redelivery cap.** `redeliverExpiredDispatches`: when `dispatchAttempts` reaches
`MAX_DISPATCH_ATTEMPTS` (5), stop requeueing — `completeInvocation` failed with
`result.errorCode: "dispatch_timeout"` and a `delivery_exhausted` (warn) event. The
structured errorCode (#697) routes it straight to the `dispatch_timeout` recovery category
(rerun recommended, auto-recovery eligible, crash-loop capped).

**D. A refusal verb.** `POST /api/bridge/refuse { invocationId, reason, errorCode? }` —
same ownership/credential gates as ack/complete, valid only from the leased `dispatching`
state (an acked run must use complete). Marks `delivery.state: "refused"`, appends
`delivery_refused` (warn), and completes the invocation failed with the bridge's reason and
optional errorCode (validated against the recovery-category vocabulary, else dropped).
Refusal is terminal, not requeue: the bridge is saying "this delivery cannot run HERE",
and bouncing it back to the same single-device queue would just loop; the honest failure +
recovery model (select_agent / rerun after fixing) is the right lane.

All four are additive to the state machine: no new states on the happy path, `refused` is a
delivery sub-state that resolves into the existing `failed` terminal, and the sweeps reuse
the health-probe tick + alert dispatcher patterns.

## Non-goals

- Multi-bridge failover / rescheduling to another device (single-device architecture today).
- Queued-run TTL — a durable queue that outlives bridge restarts is intentional; with A,
  the console at least tells the truth about WHY it's waiting. Revisit if real usage shows
  abandoned queues.
- Changing the bridge client itself — the refuse verb is server-side contract first (like
  errorCode was); the desktop bridge adopts when it can detect unrunnable work.

## Test/verify plan

Integration: liveness — stale lastSeenAt → sweep flips offline + event + alert, next bridge
poll flips back online; watchdog — running + device offline past grace → timed_out with
errorCode, running + device online → untouched regardless of age; cap — 5 lease expiries →
failed `delivery_exhausted`, no 6th redelivery; refuse — leased delivery refused → failed
with reason/errorCode + recovery category honors it, refuse after ack → 409, foreign/unowned
→ 403, unknown errorCode dropped. Live drive: real server + real timer ticks — register
bridge, kill it, watch the device pill flip offline and a mid-flight run reap; restart
bridge, watch it flip back.
