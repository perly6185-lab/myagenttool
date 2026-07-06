# Auto-run Operations Plan — from functionally-usable to operational

This plan defines the work to take the issue → project → worktree autonomous
delivery line from **functionally complete** (it runs end-to-end when a human
drives it) to **operational** (it runs continuously, largely unattended, as a
service a team relies on).

It builds on:
- [ISSUE_WORKTREE_AUTORUN_PLAN.md](ISSUE_WORKTREE_AUTORUN_PLAN.md) — the delivery
  line itself (issue → worktree → agent edit → PR).
- [ISSUE_DECISION_AGENT_PLAN.md](ISSUE_DECISION_AGENT_PLAN.md) — the triage/routing.
- [AUTOMATION_PLAN.md](AUTOMATION_PLAN.md) — the guardrails (no autonomous merge,
  no silent local-execution permission).
- [AUTORUN_PILOT_RUNBOOK.md](AUTORUN_PILOT_RUNBOOK.md) — the operator runbook.
- [MATURITY_CALIBRATION.md](MATURITY_CALIBRATION.md) — the capability/quality bars.

## Current state (2026-07-06)

The full chain works and was **field-validated once** end-to-end (a real Claude
agent implemented devdemo #3 and the PR was merged from the console):
issue → decision → worktree → agent edit → **human approval** → verify gate →
acceptance judge → PR → **human merge**. Observability (Auto-runs + Capability
panels, metrics, regression alerting), a config panel, informed merge/approval
gates, role-scoped skills, and PR-checks-aware/require-green merge are in place.
All autonomy is opt-in / off-by-default; both the approval gate and merge stay
human.

**The gap to "operational" is not features — it is unattended reliability, cost
control, reducing the human bottleneck, and hardening before volume.** Today the
loop is safe because a human drives and gates every run; operating it means it
keeps running correctly when nobody is watching, without burning quota or
merging bad code, at a throughput one on-call person can supervise.

## Principles (operating constraints)

1. **Merge stays human** (AUTOMATION_PLAN). Operating can graduate *approval*
   trust, but never auto-merge.
2. **Fail closed.** Unknown cost, unknown checks, unknown verification → block,
   don't proceed.
3. **A cost brake before any unattended trigger.** No auto-trigger runs at
   volume without an enforced budget.
4. **Every autonomous surface stays opt-in and reversible**, with a kill switch.
5. **The command trust boundary holds** (verify/decider/judge argv are
   operator-set, never agent-proposed or client-set).

## Operational dimensions (what must exist)

Legend: ✅ exists · 🟡 partial · ❌ missing.

### A. Cost & quota governance
- ❌ **auto-run consumes no budget** — a runaway loop has no cost brake (the
  budgets/economics system exists but auto-run does not consult it).
- ❌ per-run / per-project / per-day spend caps that **halt the loop** on breach.
- ❌ rate-limit backoff + circuit-breaker for the subscription/API.
- 🟡 spend visibility (economics ledger exists; not projected to auto-run / no
  burn alerts).

### B. Unattended reliability & recovery
- 🟡 invocation-level lease/recover exists (creation/dispatch).
- ❌ auto-run-level **stuck-run detection** (hung/timed-out runs auto-reaped).
- ❌ **crash reconcile** — orphaned runs after a server restart resumed or failed
  cleanly.
- ❌ gh/bridge fault handling: retry + circuit-breaker + dead-letter.
- ❌ **global** concurrency / queue + backpressure (only a per-project cap 1–10).
- ❌ bridge is a **single point of failure** — no multi-device / health-routing /
  failover.

### C. Reduce the human bottleneck — graduated approval
- 🟡 approval is risk-based (`high`/`critical` require it) but coding agents are
  hardwired `high`, so **every develop run needs a human** — the throughput cap.
- ❌ per-project / per-change-type / success-history graduated policy
  (auto-approve low-risk: docs, tests, small diffs; require human for high-risk).

### D. Quality gates as the norm, not the exception
- ❌ per-project **verify command** is env-only and usually unconfigured, so
  "unverified PR" is the default rather than the exception.
- ❌ judge thresholds calibrated on **real data** (#250 — needs volume).
- 🟡 require-green-checks exists but is opt-in; make it the default policy once
  trusted.

### E. Security for unattended operation
- ❌ **prompt-injection hardening**: the issue body is attacker-controllable
  input that becomes the agent prompt.
- ❌ per-project sandbox / permission scoping / secrets isolation for the editing
  agent.
- ✅ audit event trail; ✅ tenancy isolation (#195–#205).

### F. Operations-grade observability & alerting
- ✅ metrics (Auto-runs), capability trend, regression feedback events.
- ❌ **SLI/SLO**: targets + alert lines for success rate, time-to-PR,
  cost-per-PR, human-intervention rate, regression rate.
- ❌ **proactive notification channel** (feedback/regression/stuck-run/budget →
  Slack/webhook/push; today nothing is sent outward).

### G. Ops process & onboarding
- ✅ pilot runbook.
- ❌ project **onboarding one-shot** (register + agent + verify command + fields).
- ❌ on-call / triage runbook; ❌ bad-merge rollback procedure.

### H. Validation at scale
- ❌ a real (non-sandbox) repo, N issues, operational metrics measured and tuned.
  This is the paid, held-out validation that earns the trust to raise autonomy.

## Development plan

Phased so each phase is independently shippable and moves one capability from
"human-driven" to "unattended-safe". Earlier phases are hard prerequisites for
later ones (you cannot safely auto-trigger at volume without A + B + C).

### Phase O0 — Cost brake (prerequisite for any unattended volume)
The one thing that must exist before the loop runs unattended.
- **O0.1** Wire the existing budget/ledger into the auto-run path: attribute each
  run's spend to its project.
- **O0.2** Enforce caps: per-run, per-project/day. On breach → the run is
  `blocked` (new terminal reason `budget_exceeded`) and the auto-trigger stops
  starting runs for that project until reset.
- **O0.3** Rate-limit circuit-breaker: on repeated provider rate-limit/auth
  errors, open the breaker (pause auto-trigger) and surface it; auto-close on
  recovery.
- **O0.4** Config-panel + Capability tiles: current spend, projected burn, cap
  status; a global **kill switch** for all autonomous surfaces.

### Phase O1 — Unattended reliability
Keep it running correctly when nobody is watching.
- **O1.1** Stuck-run reaper: a run with no progress past its adapter timeout (or
  a bridge that went away mid-run) transitions to `failed`/`blocked` with a
  reason, freeing its worktree — not left `running` forever.
- **O1.2** Crash reconcile on boot: runs in non-terminal states with no live
  invocation are reconciled (resume if safe, else fail cleanly).
- **O1.3** gh/bridge fault policy: bounded retries + a dead-letter state +
  breaker; no silent stall.
- **O1.4** Global concurrency + queue: a system-wide in-flight cap with a FIFO
  queue and backpressure; auto-trigger enqueues rather than fans out unbounded.

### Phase O2 — Graduated approval (lift the human throughput cap)
- **O2.1** Approval policy model: per-project + per-change-class rules
  (auto-approve `docs`/`tests`/small-diff develop runs; require human for
  source/high-risk), keyed off the decision path + a diff-size/paths signal.
- **O2.2** Success-history input: a project's recent auto-run success/merge rate
  can raise or lower its auto-approve envelope (never past the risk ceiling).
- **O2.3** Merge stays human always — O2 only graduates the *pre-run* approval,
  never the merge.

### Phase O3 — Quality gates as the norm
- **O3.1** Per-project verify command as first-class config (operator-set,
  trust-boundary preserved): onboarding requires one; unconfigured is flagged.
- **O3.2** Make require-green-checks the default policy once O0–O2 are trusted
  (still overridable).
- **O3.3** Judge threshold calibration from real data (depends on H volume /
  #250).

### Phase O4 — Security hardening for volume
- **O4.1** Prompt-injection defenses on the issue-body → prompt seam (delimiting,
  instruction-isolation, and a review step for suspicious bodies).
- **O4.2** Per-project execution scoping / secrets isolation review for the
  editing agent (builds on the tenancy work).

### Phase O5 — SLO + alerting + onboarding
- **O5.1** Define SLIs/SLOs (success rate, time-to-PR, cost-per-PR,
  human-intervention rate, regression rate) with alert lines.
- **O5.2** Outbound notification channel (webhook/Slack/push) for
  regression / stuck-run / budget-breach / breaker-open.
- **O5.3** Project onboarding one-shot + on-call/triage runbook + bad-merge
  rollback procedure.

### Phase O6 — Validation at scale (paid; earns higher autonomy)
- **O6.1** A real non-sandbox repo, a batch of real issues, operational metrics
  measured over time; tune thresholds; ratchet autonomy up only as the metrics
  clear their SLOs. Requires quota budget + owner sign-off (cost decision).

## Sequencing & rationale

```
O0 cost brake ──► O1 reliability ──► O2 graduated approval     (can we run it unattended?)
                                        │
                                        ▼
                        O3 quality-norm + O4 security           (dare we raise volume?)
                                        │
                                        ▼
                        O5 SLO + alerting + onboarding          (can we watch/run it?)
                                        │
                                        ▼
                        O6 validation at scale (paid)           (earn higher autonomy)
```

O0 is the gate: **no unattended auto-trigger at volume until the cost brake
exists.** O1 and O2 are what make continuous operation viable (it doesn't fall
over; the human isn't the throughput cap). O3–O4 are the bar to raise volume.
O5–O6 make it observable, supportable, and progressively more autonomous — always
under the standing guardrail that **merge stays human**.

## Definition of "operational" (exit criteria)

- Auto-trigger can run unattended for a week without a human-caused incident,
  bounded by an enforced budget, with a kill switch.
- A stuck/crashed/rate-limited run always reaches a clean terminal state and
  alerts a human; nothing silently stalls or burns quota.
- Low-risk changes flow without per-run human approval; high-risk changes and
  **all merges** remain human.
- Every onboarded project has a real verify command; unverified PRs are the
  exception, checks-green is the merge default.
- SLOs are defined, measured, and alert on breach.
