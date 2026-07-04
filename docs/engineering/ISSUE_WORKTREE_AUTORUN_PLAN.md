# Issue → Worktree → Auto-run Plan

This plan defines the development line that turns a GitHub issue into a
worktree, runs a coding agent inside it, and opens a pull request — with a
human still owning merge. It builds on the existing console/bridge execution
path and the loop promotion pipeline rather than adding a third system.

See [AI_DEVELOPMENT_WORKFLOW.md](AI_DEVELOPMENT_WORKFLOW.md) for the governed
end-to-end flow this automates (Layer 5 of [AUTOMATION_PLAN.md](AUTOMATION_PLAN.md),
"AI Development Execution"), and [AUTOMATION_PLAN.md](AUTOMATION_PLAN.md) for the
guardrails (no autonomous merge, no silent local-execution permission).

## Current state: two systems, one gap

Roughly 60-70% of the primitives exist, but the orchestration layer that joins
them is missing. Two execution systems run in parallel and do not talk:

- **System A — Console / Bridge.** A real claude/codex CLI runs live in a
  worktree's checkout (a worktree is modeled as its own project record whose
  `path` is the agent cwd). Triggered manually from the console or by the
  time-based automation scheduler firing a static prompt. It does **not** open a
  PR, and until this plan's Phase 0 the console publish/PR routes were stubbed
  (`skipped:true`).
- **System B — Loop engine (`tools/ai`).** The native issue → branch → verify →
  isolated worktree → push → PR pipeline, with a real `gh pr create` under
  multi-step approval gating. Its built-in coding adapter is a mock/contract
  stub that does **not** edit code; real edits need an external adapter binary.

### Three missing seams

1. **Issue → invocation + prompt.** Creating a worktree from an issue stores the
   `agentId` and an issue `link`, but never creates an invocation, and the issue
   body is never seeded as an agent prompt.
2. **Auto-run the editing agent in the worktree.** System A's bridge can already
   run claude/codex in a worktree cwd; only the trigger and prompt are missing.
3. **Worktree work → PR.** The console publish/PR path was stubbed; the real
   push + `gh pr create` machinery lives only in System B's promotion pipeline.

Note: worktree teardown is intentionally non-destructive (files are kept on
disk; asserted by `apps/server/test/worktree-lifecycle.test.mjs`). That is by
design, not a gap.

## Decisions

- **Engine = hybrid.** System A's bridge does the editing (real claude/codex in
  the worktree); reuse System B's `gh pr create` semantics for the PR. Skip
  System B's non-editing adapter.
- **Autonomy ceiling = auto through PR-open; merge stays human** (autonomy level
  A3; respects the AUTOMATION_PLAN guardrails).
- **Trigger = one-click Auto button first** (Task board issue row), then
  label/status auto-triggers later.

## Target chain (one-click Auto)

```text
Task board [Auto] on an issue
  -> 1. create worktree issue-<n>-<slug>        [done: createWorktree]
  -> 2. issue body -> agent prompt              [new: shared helper]
  -> 3. auto-create bridge invocation(worktreeId)  [new: core seam]
        agent edits code live in the worktree cwd   [done: bridge]
  -> 4. run verification checks (green to proceed)   [new: ai:testing-plan]
  -> 5. publish branch + gh pr create(referencing issue)  [Phase 0]
  x  merge stays human                          [guardrail]
```

## Phases

### Phase 0 — Foundation (enabling; no autonomous behavior)

- **Real publish/PR server routes.** Replace the `skipped:true` stub with
  `publishWorktreeBranch` (real `git push --set-upstream origin <branch>`) and
  `createWorktreePr` (auto-publish if needed, then `gh pr create --base --head
  --title --body`, defaulting title/body from the linked issue with a
  `Closes #N` reference). gh is resolvable via `MYAGENTTOOL_GH_COMMAND(_JSON)`
  so tests and locked-down installs can inject a stand-in. **Status: landed.**
- **Issue metadata + prompt helper.** The worktree record already carries a
  structured issue/PR reference (`link`: type/number/title/url/state). The
  issue → agent-prompt template, previously inline in the Task board's Automate
  action, is now the shared `@myagenttool/protocol/issue-prompt`
  `worktreeAutoRunPrompt(link)` so the server's future auto-run orchestrator and
  the web share one source of truth. **Status: landed.**

### Phase 1 — One-click Auto (manual trigger, full chain to PR)

- **Kickoff — landed.** `services/auto-run.mjs` `startAutoRun()` materializes the
  worktree from the issue, seeds the prompt via `worktreeAutoRunPrompt(link)`,
  creates a bridge invocation targeting the worktree, and starts it, recording
  an `autoRun` (`materializing → running | awaiting_approval → …`). High-risk
  agents land in `awaiting_approval` because the invocation does — Auto never
  bypasses the local-approval gate. `POST /api/projects/:id/auto-runs` +
  `GET /api/auto-runs`; Task board `[Auto]` button drives it.
- **Reaction — landed.** `advanceAutoRunForInvocation()` runs when the auto-run's
  invocation reaches a terminal state: succeeded → `verifying` (Phase 2 gate
  placeholder) → `publishing` → open PR via the Phase 0 routes → `pr_open`;
  failed/timed_out/cancelled → `failed`. Idempotent once settled; never throws.
  Wired via a late-bound `onInvocationCompleted` hook threaded through the
  invocation service into `completion.mjs`, so every completion path advances it.

### Phase 2 — Verification gate + PR governance

- **Gate — landed.** The reaction runs a project-configured verification command
  in the worktree before publishing (`services/worktree-verify.mjs`). Passed →
  publish + open PR with the verification evidence in the PR body; a failed real
  check → `blocked` (no PR); unconfigured → the PR opens but is labelled
  unverified (never fabricates a pass); a throwing verifier → `blocked`. The
  command comes from `MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON` (array form, no
  shell, never agent-proposed) so an editing agent can't choose what runs.
- **PR governance — remaining.** The auto-PR must satisfy `check-pr`'s
  dedicated-linked-issue-with-Project-Fields rule (link an issue that carries
  `## Project Fields`), or it cannot pass pr-governance and merge. The evidence
  body already satisfies the verification-evidence rule.

### Phase 3 — Auto-triggers

- **Landed.** A scan loop (`services/auto-trigger.mjs` +
  `runtime/auto-trigger-scheduler.mjs`) starts an auto-run for each new open
  issue carrying an opt-in label. **Off by default** — enabled only via
  `MYAGENTTOOL_AUTOTRIGGER_ENABLED` (disabled → no timer, no gh calls).
  Per-issue opt-in by label (`MYAGENTTOOL_AUTOTRIGGER_LABEL`, default `auto`);
  dedup so an issue with any existing auto-run (incl. `blocked`) never respawns;
  per-project concurrency cap (`MYAGENTTOOL_AUTOTRIGGER_MAX_CONCURRENT`, 1..10).
  `startAutoRun` still enforces the approval + budget gates; merge stays human.
  Because the trigger source is the issue, the auto-PR now `Closes #N` a real
  issue — addressing the Phase 2 governance leftover when that issue carries
  Project Fields.

### Phase 4 — Project status writeback

- **Landed.** As an auto-run advances it moves the linked issue's status label:
  start → `status/in-progress`, PR opened → `status/review`
  (`services/issue-status.mjs`). **Off by default** — a GitHub write is an
  outward-facing side effect, gated by `MYAGENTTOOL_AUTORUN_STATUS_WRITEBACK`
  (disabled → the orchestrator skips it, no gh writes). Issue-linked runs only;
  best-effort (a gh failure never breaks the run). This moves the label (the
  governance source of truth); syncing the ProjectV2 board field still needs
  `github:sync-project` (project scope).

## Cross-cutting dependencies

- **Durable state.** Worktree and auto-run records are in-memory snapshots
  today; the autonomous flow needs the P1 persistence work to be reliable.
- **Bridge trust boundary.** Auto-dispatch must carry the device-bound bridge
  credential and honor local execution consent — Auto must not silently enable
  local execution.
- **Preconditions.** Auto needs an online bridge and a configured editing agent;
  the auto-PR only helps if it can satisfy pr-governance.
- **Real risk is quality, not plumbing.** Edit quality plus verification
  strength decide whether this line can run unattended; the Phase 2 gate is the
  key control.
