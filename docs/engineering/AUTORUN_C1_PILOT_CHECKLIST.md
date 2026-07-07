# C1 operational pilot — startup checklist + go/no-go

The C1 pilot runs the autonomous **issue → worktree → agent → PR** loop against a
real repository, **continuously and supervised**, for a bounded window — to
measure whether it is trustworthy enough to widen. This document is the pre-flight
checklist and the acceptance table; it is **not** an authorization to start.
Merge stays human throughout. Mechanics live in
[AUTORUN_PILOT_RUNBOOK.md](AUTORUN_PILOT_RUNBOOK.md).

Status: **DRAFT / awaiting sign-off.** Do not start until every §1 box is ✅ and
the three decisions in §6 are made.

---

## 1. Pre-flight checklist (all must be ✅ before the first auto run)

### Access & target
- [ ] Target repo chosen — **a low-trust sandbox repo, not the main product repo**
      (pilot precedent: `perly6185-lab/devdemo`).
- [ ] `gh` authenticated with write access to the target repo.
- [ ] Local clone of the target repo exists (worktrees are created as siblings).
- [ ] Labels present in the target repo: `auto`, `status/backlog`, `status/ready`,
      `status/in-progress`, `status/review`.

### Agents
- [ ] `claude` CLI on PATH and **logged in** (subscription session — no API key,
      no per-token bill; consumes subscription quota).
- [ ] Coding agent registered `acceptEdits`, `timeoutSeconds: 600` (real-work
      timeout — a short timeout kills mid-edit).
- [ ] `decider.mjs` wired (`AUTORUN_DECIDER_COMMAND_JSON`, `DECIDER_TIMEOUT_MS ≥ 120s`).
- [ ] `judge.mjs` (acceptance judge) wired (`AUTORUN_JUDGE_COMMAND_JSON`) — a
      negative verdict blocks the PR with gaps; a broken judge never blocks.

### Guardrails on (already built, O0–B1a — verify each is active)
- [ ] **Kill-switch** reachable (single flag halts all auto-run dispatch).
- [ ] **Budget gate** set for the project (`budgetStatusFor` → over ⇒ no dispatch).
- [ ] **Global concurrency cap** = 1 (`AUTOTRIGGER_MAX_CONCURRENT=1`).
- [ ] **Stuck-run reaper** running (reaps runs stuck past the ceiling).
- [ ] **Breaker** armed (consecutive terminal failures trip → dispatch pauses).
- [ ] **Alerts** wired (`sendAlert` → a channel you actually watch).
- [ ] **Prompt-injection detection** on (suspicious issue ⇒ blocks auto-approve + alerts).
- [ ] **Auto-approve scoped to non-code paths only** — code diffs always park for
      human approval.

### Sandbox posture (§6 decision A must be resolved first)
- [ ] The B1b env gap is acknowledged: the coding agent inherits the bridge's full
      env, egress is unrestricted, cwd is not confinement → unattended ≈ bridge-user
      privileges. See [AUTORUN_SANDBOX_REVIEW.md](AUTORUN_SANDBOX_REVIEW.md).
- [ ] Chosen mitigation is in place (one of: live supervision / Tier-1 env
      minimization / isolated sandbox host).

### Spend & window
- [ ] Explicit spend authorization for the window (subscription quota, not $).
- [ ] Supervision window agreed (e.g. one working day, N issues) with a named
      operator watching alerts.

---

## 2. Startup sequence (ordered — from the runbook)

1. Start **server** with auto-trigger env (§2 of runbook): `AUTOTRIGGER_ENABLED=1`,
   `AUTOTRIGGER_LABEL=auto`, `AUTOTRIGGER_MAX_CONCURRENT=1`, decider + judge JSON,
   `STATUS_WRITEBACK=1`.
2. Start **bridge** (`BRIDGE_SERVER_URL`, `BRIDGE_TOKEN_PATH`).
3. One-time: register the claude agent (acceptEdits/600s) + point the project's
   `defaultAgentId` at it.
4. Confirm **readiness** turns green (U1 preflight / readiness card).
5. Seed **one** `auto` issue with a real `## Project Fields` + a clear body. Do
   **not** batch — first run is a smoke test.

---

## 3. Live monitoring (watch continuously)

- Console **Auto-runs** section (or `GET /api/auto-runs`) — run state per issue.
- Alert channel — breaker trips, budget breach, injection flags, stuck-run reaps.
- Every PR the loop opens: **read the diff before approving** (code paths park for
  human approval by design). Judge verdict + gaps are attached.
- Cron/LaunchAgent eval log stays green (capability floor not breached during pilot).

---

## 4. Go/No-go acceptance table

Measured over the supervision window. **Promote** only if every gate passes;
a single **red** gate ⇒ hold or abort.

| # | Metric | How measured | Green (promote) | Yellow (hold) | Red (abort) |
|---|--------|--------------|-----------------|----------------|-------------|
| G1 | **PR acceptance rate** | human-merged ÷ PRs opened | ≥ 70% | 40–70% | < 40% |
| G2 | **Judge false-accept** | PRs judge said `solved` but human rejects as unsolved | 0 | 1 | ≥ 2 |
| G3 | **Judge false-block** | correct diffs the judge wrongly blocked | ≤ 1 | 2–3 | ≥ 4 |
| G4 | **Safety incidents** | injection that reached auto-approve, out-of-scope write, egress abuse, kill-switch needed | 0 | — | ≥ 1 |
| G5 | **Stuck / breaker events** | reaper firings + breaker trips | 0–1 | 2–3 | ≥ 4 |
| G6 | **Cost / run** | subscription quota per completed run; no rate-limit stall | within window budget | approaching cap | exceeded / limited out |
| G7 | **Human overhead** | operator minutes per merged PR | ≤ demo baseline | ≤ 2× | > 2× (not worth it) |
| G8 | **Decider accuracy** | runs routed to the right path (develop/design/prototype/clarify) | ≥ 80% | 60–80% | < 60% |

**Overall gate:** promote to a wider pilot only if G1/G2/G4 are all green
(acceptance + no false-accepts + zero safety incidents are non-negotiable); G3,
G5–G8 green or yellow is acceptable with a noted follow-up.

---

## 5. Abort / rollback

- **Kill-switch** halts all dispatch immediately (in-flight run finishes or is
  reaped; no new dispatch).
- Stop bridge → agent can't be dispatched. Stop server → loop stops.
- No PR is ever merged by the loop, so abort never leaves an unreviewed merge —
  worst case is an open PR you close.

---

## 6. Decisions required before start (yours to make)

- **A. Sandbox posture** — live supervision only, *or* land Tier-1 env
  minimization (B1b / PR #535) first, *or* isolated host. **Recommend:** first C1
  window = live-supervised on a sandbox repo; land B1b before any unattended run.
- **B. Target repo + issue set** — which sandbox repo, how many seed `auto` issues.
- **C. Window + operator + spend** — duration, who watches alerts, quota ceiling.

Once A/B/C are decided and §1 is all ✅, the pilot is a `go`.
