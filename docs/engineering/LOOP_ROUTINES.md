# Loop Routines

Loop routines are reusable workflow specifications above the Loop Engine. A
routine describes when to run, what to read, which skills to bind, the goal to
pursue, which checks apply, and where local outputs are written.

The first slice is local and manual. It validates a routine file, produces a
plan, and can write routine-run evidence without starting a daemon or changing
remote state.

## Relationship To Loop Runs

A loop run is an implementation attempt with registry state, events, evidence,
queue leases, workers, worktrees, and promotion gates.

A loop routine is an upstream orchestration contract. It may inspect inputs,
produce findings, and fan out approved findings into normal planned loop runs.
Routine-run evidence stays separate under `.myagenttool/routine-runs/` so it
does not mix with `.myagenttool/runs/registry.json`.

```text
routine spec -> routine plan -> routine run evidence -> findings -> loop runs
```

## Spec Location

Routine specs may live in either JSON or YAML form:

```text
.myagenttool/routines/*.json
.myagenttool/routines/*.yaml
docs/examples/loop-routines/*.json
```

JSON is the reference format for the first slice. YAML support is intentionally
limited to the simple object/list/scalar shape used by routine specs.

## First Schema

```json
{
  "apiVersion": "myagenttool.dev/v1",
  "kind": "LoopRoutine",
  "metadata": {
    "id": "morning-triage",
    "name": "Morning Triage",
    "description": "Review recent project activity.",
    "owner": "engineering",
    "enabled": true
  },
  "schedule": {
    "mode": "manual",
    "timezone": "Asia/Shanghai",
    "cron": "0 9 * * 1-5",
    "maxConcurrency": 1,
    "cooldownMs": 3600000,
    "deadlineMs": 1800000
  },
  "inputs": [
    {
      "id": "recent-commits",
      "type": "git.commits",
      "ref": "HEAD",
      "since": "24 hours ago",
      "limit": 20
    }
  ],
  "skills": [
    {
      "id": "triage",
      "path": "skills/morning-triage/SKILL.md",
      "required": false
    }
  ],
  "goal": {
    "summary": "Identify actionable regressions and follow-up tasks.",
    "successCriteria": [
      "Routine writes a triage summary.",
      "Findings include evidence and proposed next action."
    ],
    "fanout": {
      "enabled": true,
      "mode": "one-run-per-finding",
      "priority": "normal",
      "apply": false,
      "verify": true,
      "isolateWorktree": true
    }
  },
  "checks": [
    {
      "id": "registry",
      "type": "command",
      "command": "ai:loop-registry-check",
      "required": true
    }
  ],
  "outputs": {
    "summary": ".myagenttool/state/triage.md",
    "findings": ".myagenttool/state/triage-findings.json",
    "enqueueFindings": false
  },
  "safety": {
    "remoteWrites": "forbidden",
    "githubWrites": "forbidden",
    "requiresApprovalFor": ["apply", "push", "pr-create", "pr-merge"],
    "commandAllowlist": ["ai:loop-registry-check", "ai:check", "docs:check", "typecheck", "test"]
  }
}
```

## Field Semantics

- `metadata.id` is the stable routine id used in evidence paths and summaries.
- `schedule.mode` may be `manual`, `cron`, or `event`; only `manual` execution
  is implemented in the first slice.
- `inputs` declare read-only sources. Local execution currently collects
  `git.commits`, `filesystem.glob`, `loop.registry`, `github.issues`,
  `github.prs`, `github.checks`, and `github.commits`.
- `skills` bind reusable context such as `SKILL.md` files. Required skills must
  exist locally. Routine runs snapshot bound skills with sha256, summary,
  acceptance bullets, and check bullets.
- `goal` describes the routine objective and future fanout behavior.
- `checks` declare validation commands. Command checks must be present in
  `safety.commandAllowlist`.
- `outputs` declare local files written by a routine run.
- `safety` records remote write policy and approval gates.

## Commands

```text
pnpm ai:loop-routine-check -- --file docs/examples/loop-routines/morning-triage.json
pnpm ai:loop-routine-plan -- --file docs/examples/loop-routines/morning-triage.json
pnpm ai:loop-routine-run -- --file docs/examples/loop-routines/morning-triage.json --dry-run
pnpm ai:loop-routine-run -- --file docs/examples/loop-routines/morning-triage.json
pnpm ai:loop-routine-list
pnpm ai:loop-routine-latest -- --routine morning-triage
pnpm ai:loop-routine-show -- --routine-run <routine-run-id>
pnpm ai:loop-routine-findings -- --routine-run <routine-run-id> --with-suggested-run
pnpm ai:loop-routine-schedule-plan
pnpm ai:loop-routine-schedule-run
pnpm ai:loop-routine-fanout-plan -- --routine-run <routine-run-id>
pnpm ai:loop-routine-fanout-execute -- --routine-run <routine-run-id> --approval "operator approved planning-only fanout"
pnpm ai:loop-routine-fanout-execute -- --routine-run <routine-run-id> --approval "operator approved enqueue" --enqueue
pnpm ai:loop-routine-fanout-execute -- --routine-run <routine-run-id> --approval "operator approved isolated worker" --run-worker --worker routine-fanout --isolate-worktree
```

`loop-routine-check` validates the file.

`loop-routine-plan` reports inputs, skills, checks, outputs, safety policy, and
known risks.

`loop-routine-run --dry-run` returns the plan only.

`loop-routine-run` writes local routine evidence:

```text
.myagenttool/routine-runs/<routine-run-id>/routine.json
.myagenttool/routine-runs/<routine-run-id>/plan.json
.myagenttool/routine-runs/<routine-run-id>/events.jsonl
.myagenttool/routine-runs/<routine-run-id>/input-snapshot.json
.myagenttool/routine-runs/<routine-run-id>/skill-snapshot.json
.myagenttool/routine-runs/<routine-run-id>/checks-result.json
.myagenttool/routine-runs/<routine-run-id>/summary.md
.myagenttool/routine-runs/<routine-run-id>/findings.json
```

It also writes the configured local output files, such as
`.myagenttool/state/triage.md` and `.myagenttool/state/triage-findings.json`.

Routine inspection commands are read-only:

- `loop-routine-list` scans `.myagenttool/routine-runs/` and summarizes recent
  runs, optionally filtered by `--routine`, `--status`, and `--limit`.
- `loop-routine-latest --routine <id>` returns the newest run summary for one
  routine id.
- `loop-routine-show --routine-run <id>` reads the run evidence bundle and
  summarizes inputs, skills, checks, findings, and fanout evidence.
- `loop-routine-findings --routine-run <id>` lists findings and can filter by
  `--severity` or `--with-suggested-run`.

These commands do not create routine runs, loop runs, scheduler state, worktrees,
remote Git state, or GitHub state.

The CLI, local server, and Web Console share the routine read model in
`tools/ai/src/loop/routine-inspect.mjs`. This keeps run summaries, finding
fields, fanout counts, and evidence paths from drifting between surfaces.

The local server exposes dedicated read-only routine APIs:

- `GET /api/loop-routines`
- `GET /api/loop-routines/:runId`
- `GET /api/loop-routines/:runId/findings`

`GET /api/state` only includes compact routine state, such as the latest run id
and API links. It does not include the full routine run list or findings.

Routine checks execute during non-dry-run execution only. Check commands must
resolve to an allowlisted command id. The first local allowlist maps:

- `ai:loop-registry-check` and `loop-registry` to
  `pnpm ai:loop-registry-check`
- `docs:check` and `docs-check` to `pnpm docs:check`
- `typecheck` to `pnpm typecheck`
- `test` to `pnpm test`
- `ai:check` to `pnpm ai:check`

Required check failures are written to evidence before the routine command
fails.

`loop-routine-schedule-plan` performs a local scheduler planning tick. It scans
`.myagenttool/routines/*.json|yaml` and, by default,
`docs/examples/loop-routines/*.json|yaml`, then writes:

```text
.myagenttool/state/routine-schedule-plan.json
```

`loop-routine-schedule-run` performs one local scheduler run tick. It is not a
daemon. It runs due routines, writes normal routine-run evidence, and updates:

```text
.myagenttool/state/routine-scheduler.json
.myagenttool/state/routine-schedule-result.json
```

The scheduler MVP supports manual first-run gating, `cooldownMs`,
`maxConcurrency` from local scheduler state, and simple cron aliases `@hourly`
and `@daily`. Full cron parsing, event triggers, and long-lived daemon behavior
remain future slices.

Skill binding snapshots are written during non-dry-run execution. The runner
extracts the skill title, first descriptive paragraph, `Acceptance` bullets, and
`Checks` bullets from each bound `SKILL.md`. Findings include the bound skill
metadata, and fanout child runs copy those bindings into `context.json`,
`code-plan.json`, `testing-plan.json`, and `manifest.md` so downstream workers
can see the routine-specific acceptance rules.

`loop-routine-fanout-plan` reads a completed routine run and writes local fanout
evidence:

```text
.myagenttool/routine-runs/<routine-run-id>/fanout-plan.json
.myagenttool/routine-runs/<routine-run-id>/fanout-plan.md
```

Only findings with `suggestedRun` are fanout candidates.

`loop-routine-fanout-execute` requires `--approval` and creates one normal loop
run per new fanout candidate. The child runs are registry-backed and
rebuildable from events. By default they stop in `planned` state. Passing
`--enqueue` moves eligible child runs to `queued`. Passing `--run-worker
--worker <id>` first enqueues eligible child runs and then runs one child-run
worker pass per child. `--isolate-worktree` forwards to the worker and keeps
child execution evidence in `.myagenttool/worktrees/`.

Execute also writes:

```text
.myagenttool/routine-runs/<routine-run-id>/fanout-result.json
.myagenttool/routine-runs/<routine-run-id>/fanout-result.md
.myagenttool/runs/<child-run-id>/context.json
.myagenttool/runs/<child-run-id>/code-plan.json
.myagenttool/runs/<child-run-id>/testing-plan.json
.myagenttool/runs/<child-run-id>/testing-plan.md
.myagenttool/runs/<child-run-id>/manifest.md
.myagenttool/runs/<child-run-id>/events.jsonl
```

Fanout execute is idempotent for an existing routine run: findings already
listed in `fanout-result.json` are not created again. Re-running with
`--enqueue` or `--run-worker` can still advance existing child runs when their
state allows it.

## Finding Schema

Routine findings are deterministic local facts. They are proposal data until a
human-approved fanout command turns them into normal planned loop runs.

```json
{
  "id": "loop-run-failed-2026-06-29T00-00-00-000Z-issue-123",
  "title": "Loop run failed: 2026-06-29T00-00-00-000Z-issue-123",
  "severity": "high",
  "source": {
    "type": "loop.registry",
    "inputId": "loop-registry",
    "runId": "2026-06-29T00-00-00-000Z-issue-123",
    "state": "failed"
  },
  "evidence": [
    "Run: 2026-06-29T00-00-00-000Z-issue-123",
    "State: failed",
    "Last error: verification failed"
  ],
  "proposedAction": "Inspect the last error, then run loop-resume or loop-retry with an explicit operator decision.",
  "suggestedRun": {
    "mode": "retry",
    "runId": "2026-06-29T00-00-00-000Z-issue-123",
    "priority": "high",
    "apply": false,
    "verify": true,
    "isolateWorktree": true
  },
  "createdAt": "2026-06-29T00:00:00.000Z"
}
```

The current morning triage routine generates findings for:

- failed, timed-out, and awaiting-human loop runs found through `loop.registry`
- failed local routine inputs
- failed routine checks
- GitHub issues without assignees or labels
- GitHub pull requests that are draft or require review
- GitHub checks or workflow runs that are failed or pending

GitHub collectors are read-only and use the GitHub CLI. They honor `GH_PATH`
for smoke tests and alternate installations.

## Boundaries

- Routine execution is local in this slice.
- Routine execution does not start a daemon.
- Routine execution does not push.
- Routine execution does not create or merge pull requests.
- Routine execution snapshots `SKILL.md` files as local evidence; it does not
  execute arbitrary skill instructions as commands.
- Routine fanout execute creates planned child loop runs by default.
- Routine fanout execute enqueues child runs only with `--enqueue` or
  `--run-worker`.
- Routine fanout worker execution runs only with `--run-worker --worker <id>`.
- Routine fanout worker execution can create local isolated worktrees with
  `--isolate-worktree`; it still does not push, create PRs, or merge PRs.
- GitHub inputs are read-only collectors for issues, PRs, checks, and commits.
- The Web Console routine browser is read-only. It exposes routine run history,
  findings, checks, skill snapshots, and fanout evidence as local review
  prompts; it does not run fanout or workers.
- Remote or GitHub writes must remain explicit execute commands with human
  approval gates.

## Development Slices

1. Routine schema, validation, planning, and local evidence. Implemented.
2. Local input collectors for commits, filesystem files, and loop registry.
   Implemented.
3. Local checks execution and checks evidence. Implemented.
4. Finding schema and deterministic morning triage rules. Implemented for local
   loop registry, input failures, unsupported inputs, and check failures.
5. GitHub read-only input collectors. Implemented for issues, PRs, checks, and
   commits.
6. Broader deterministic triage rules for GitHub issues, PRs, and checks.
   Implemented for missing issue owners/labels, draft or review-required PRs,
   and failed or pending checks.
7. Finding fanout into planned loop runs. Implemented.
8. Optional enqueue and child-run worker execution. Implemented with explicit
   `--enqueue` / `--run-worker` gates.
9. Skill binding snapshots and fanout context injection. Implemented for
   `SKILL.md` title, summary, acceptance bullets, check bullets, and sha256.
10. Local routine scheduler plan/run tick. Implemented for manual first-run,
    cooldown, max concurrency state, and simple `@hourly` / `@daily` aliases.
11. Routine history and finding inspection CLI. Implemented as read-only local
    commands over `.myagenttool/routine-runs/`.
12. Read-only Web Console routine browser. Implemented over local routine-run
    evidence exposed by the server read model.
13. Full cron/event scheduler and long-lived daemon.
14. UI actions for routine approvals, enqueue, worker execution, and fanout
    mutation.

## Verification

The routine spec slice is valid when:

```text
pnpm ai:loop-routine-check -- --file docs/examples/loop-routines/morning-triage.json
pnpm ai:loop-routine-plan -- --file docs/examples/loop-routines/morning-triage.json --json
pnpm ai:loop-routine-run -- --file docs/examples/loop-routines/morning-triage.json --dry-run --json
pnpm smoke:loop-routine-check
pnpm smoke:loop-routine-plan
pnpm smoke:loop-routine-run-dry
pnpm smoke:loop-routine-run-findings
pnpm smoke:loop-routine-github-inputs
pnpm smoke:loop-routine-schedule-plan
pnpm smoke:loop-routine-schedule-run
pnpm smoke:loop-routine-inspect
pnpm smoke:loop-routine-fanout-plan
pnpm smoke:loop-routine-fanout-execute
pnpm smoke:loop-routine-fanout-enqueue
pnpm smoke:loop-routine-fanout-worker
pnpm --filter @myagenttool/server test
pnpm --filter @myagenttool/web test
pnpm ai:check
pnpm typecheck
pnpm test
pnpm docs:check
```
