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

A loop routine is an upstream orchestration contract. It may inspect inputs and
produce findings. Future slices may fan out findings into normal loop runs, but
routine-run evidence stays separate under `.myagenttool/routine-runs/` so it
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
  `git.commits`, `filesystem.glob`, and `loop.registry`.
- `skills` bind reusable context such as `SKILL.md` files. Required skills must
  exist locally.
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
.myagenttool/routine-runs/<routine-run-id>/summary.md
.myagenttool/routine-runs/<routine-run-id>/findings.json
```

It also writes the configured local output files, such as
`.myagenttool/state/triage.md` and `.myagenttool/state/triage-findings.json`.

## Boundaries

- Routine execution is local in this slice.
- Routine execution does not start a daemon.
- Routine execution does not push.
- Routine execution does not create or merge pull requests.
- Routine execution does not enqueue findings yet, even when the spec declares
  future fanout behavior.
- GitHub inputs are valid routine plan inputs, but local collection is a future
  slice.
- Remote or GitHub writes must remain explicit execute commands with human
  approval gates.

## Development Slices

1. Routine schema, validation, planning, and local evidence.
2. Local input collectors for commits, filesystem files, and loop registry.
3. GitHub read-only input collectors.
4. Finding generation and deterministic triage rules.
5. Finding fanout into planned loop runs.
6. Optional enqueue.
7. Long-lived scheduler or daemon.
8. UI for routine history, findings, approvals, and fanout.

## Verification

The routine spec slice is valid when:

```text
pnpm ai:loop-routine-check -- --file docs/examples/loop-routines/morning-triage.json
pnpm ai:loop-routine-plan -- --file docs/examples/loop-routines/morning-triage.json --json
pnpm ai:loop-routine-run -- --file docs/examples/loop-routines/morning-triage.json --dry-run --json
pnpm smoke:loop-routine-check
pnpm smoke:loop-routine-plan
pnpm smoke:loop-routine-run-dry
pnpm ai:check
pnpm typecheck
pnpm test
pnpm docs:check
```
