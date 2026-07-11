# Orchestration Auto-Recovery — approval policy (one page)

Status: approved design · 2026-07-11 · phase 2 of APPLICATION_RECOVERY_CONVERGENCE.md (the H1 analog for orchestrations)

## Problem

Deploy failures self-heal (H1 auto-rollback); orchestration failures wait for a human even
when the recovery is the platform's own lowest-risk recommendation (a governed rerun). The
gap is deliberate — auto-executing recovery changes execution behavior, so it needs an
explicit approval policy before any code.

## Approval policy (the core of this design)

**Autonomy never crosses an approval gate.** The recovery model already stamps every action
with `requiresApproval`; auto-recovery inherits that verdict and adds four narrowing rules:

1. **Only the recommended action, and only `rerun`.** The action must be the model's
   `recommended` one AND `type === "rerun"` AND `requiresApproval === false`.
   `select_agent` (a judgment call over agent candidates) and everything approval-gated
   (`regenerate_orchestration`, `relink_device`) are never auto-executed — and never
   auto-*requested* either: an auto-filed approval request would sit in the 5-minute broker
   timeout window and expire unseen, training operators to ignore the queue.
2. **Only failure categories where rerun is the platform's recommendation and no human
   intent is overridden**: `runtime_error` and `dispatch_timeout`. `cancelled` is excluded —
   a human stopped that run; auto-rerunning would override them.
3. **Crash-loop cap.** At most `maxAttempts` (default 2, max 5) consecutive auto-initiated
   recoveries per application+routine stream *without an intervening successful run*. Manual
   recoveries don't count against the cap; a success resets it.
4. **Opt-in per application, default off.** `application.autoRecovery = { enabled,
   maxAttempts }`, set via `POST /api/applications/:id/auto-recovery` — a side-effecting,
   write-control config change, so it requires the explicit `approvalToken` like every other
   application mutation (tenancy remains the real authorization boundary).

Every auto decision is auditable: executed attempts are ordinary recovery action requests
attributed `requestedBy: "system_auto_recovery"` (visible in the inspector timeline, the
Evidence ledger recovery rollup, and `/api/state`); declined ones emit an
`application_orchestration_auto_recovery_skipped` event carrying the reason
(`approval_required` / `attempt_cap` / `category_not_eligible`) — but only for applications
that opted in, so the event stream stays quiet by default.

## Mechanism (small by design)

- Trigger: the existing `onInvocationCompleted` hook (the same seam auto-run uses). On a
  `failed` orchestration run it evaluates the policy above and, when allowed, calls the
  existing `requestApplicationOrchestrationRecoveryAction` with the system actor — reusing
  every guard already there (scoping, action-suggested check, duplicate-action block).
  The hook is fire-and-forget and exception-isolated: completion never fails because
  auto-recovery did.
- No new execution machinery, no new approval machinery, no changes to H1–H3.

## Non-goals

- Auto-approving anything (see rule 1).
- Auto-recovery for `select_agent` — revisit once candidate auto-pick has manual mileage.
- Backoff/scheduling — the rerun fires immediately; the cap bounds the blast radius.
- Project/team-level defaults — per-application only, until real usage argues otherwise.

## Test/verify plan

Integration (real HTTP + bridge protocol): enabled app: fail a run (runtime error) →
auto rerun spawns, attributed to `system_auto_recovery`; fail the rerun → second attempt;
fail again → capped, skip event, no third run; a success resets the cap. Validation-flavored
failure → no auto action, `approval_required` skip event (nothing parked in the broker).
Disabled app (default) → nothing happens. Config endpoint: approvalToken enforced,
maxAttempts bounds validated. Live drive mirrors the same script against the running server.
