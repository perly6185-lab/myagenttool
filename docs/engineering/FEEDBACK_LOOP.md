# Feedback Loop (L6 first slice)

L6 on the maturity ladder: *feedback automatically becomes tracked bugs/risks/
roadmap updates*. This document designs the first honest slice. Per
[MATURITY_CALIBRATION.md](MATURITY_CALIBRATION.md), L6 is **frontier — local
target only**: no external framework measures feedback automation, so the gate
below is our own bar, stated as such.

## Design constraints (why this shape)

1. **No external users yet.** Real support/telemetry intake stays out of scope
   before launch (FULL_FLOW §7). But the project already generates real,
   recurring, unattended feedback signals internally — starting with the
   scheduled real-agent eval runs (#248): a gate breach at 02:30 with nobody
   watching is exactly the "feedback that silently rots" L6 exists to prevent.
2. **Auto-creating issues is an auto-mutation of the tracker.** It must obey
   the same discipline the product enforces elsewhere: created issues carry
   full label groups + milestone + `## Project Fields` (keeps the L1 gate at
   100% and satisfies pr-governance's dedicated-issue rule), and **high-risk
   feedback is never auto-created** — it queues for human approval, judged by
   the product's own gate (`humanApprovalRequiredReasons`), not a third
   vocabulary (lesson from the #226 review).
3. **Dedupe is load-bearing.** Nightly cron repeats; the same regression must
   not file an issue per night. Every event carries a `dedupeKey`; triage
   skips keys already converted (ledger) or still open (tracker query).

## Pipeline

```text
producers                 intake                triage (ai:feedback-triage)
─────────                 ──────                ───────────────────────────
eval-real-run.mjs   ──►   .myagenttool/feedback/inbox.jsonl
  gate breach                                   ├─ dedupe (ledger + open issues)
  run error                                     ├─ risk gate: high-risk → PENDING
  (future: retro,                               │   (human approves; never auto)
   governance, cron)                            ├─ low/medium → gh issue create
                                                │   (labels+milestone+Project Fields
                                                │    + feedback/auto marker label)
                                                └─ processed ledger (timing recorded)
```

- **Event schema** (one JSON per line in `inbox.jsonl`, gitignored):
  `{source, severity, title, detail, dedupeKey, createdAt}`.
- **Triage command**: `pnpm ai:feedback-triage` is dry-run by default (prints
  the plan); `--apply` creates issues. High-risk items are listed with the gate
  reasons and require a human to file them (or rerun with
  `--human-approved "reason"`, mirroring `ai:issue-tree`).
- **Cron wiring**: `eval-real-cron.sh` runs triage `--apply` after each eval
  run, so the loop is closed unattended for the allowed risk tiers.

## The L6 measurement (local target)

`pnpm ai:feedback-triage -- --report` computes, over the processed ledger:

- **Conversion rate**: share of intake events that became a tracked issue (or
  an explicit pending-approval entry) — target ≥90% within 24h.
- **Auto-latency**: median event→issue time (cron path should be minutes).
- **False-triage rate**: auto-created issues later closed as invalid/wontfix
  (queried by the `feedback/auto` label) — target <20%.
- **Pending-approval queue age** — high-risk items waiting on a human.

Rates carry the producer-set version (which sources are wired) the same way
eval rates carry set versions.

## Deliberately out of this slice

- External intake (support/telemetry) — product launch prerequisite.
- Auto-triage of review findings / retrospectives — episodic and currently
  human-driven; wire as producers once their formats stabilize.
- Any auto-close/auto-fix behavior: this slice files work, humans do it.
