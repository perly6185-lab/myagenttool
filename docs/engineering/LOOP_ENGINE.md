# Loop Engine

This document defines the first concrete loop-engine slice for MyAgentTool.

The loop engine is the task runtime that turns an issue or goal into a
controlled delivery loop:

```text
goal -> plan -> run adapter -> observe evidence -> verify -> review or gate
```

It must be visible, resumable, cancellable, and auditable before it becomes
more autonomous.

The second implementation slice adds a local queue and lease-based scheduler
surface. This lets a run move from a prepared plan into a claimable work item
without requiring a long-lived daemon yet.

## First Slice

The first implementation slice makes every AI work run a registered loop run.
It does not add background scheduling yet.

Required outputs:

- `.myagenttool/runs/registry.json`
- `.myagenttool/runs/<run-id>/events.jsonl`
- `.myagenttool/runs/<run-id>/manifest.md`
- `.myagenttool/runs/<run-id>/code-plan.json`
- `.myagenttool/runs/<run-id>/testing-plan.md`

## Run States

| State | Meaning |
| --- | --- |
| `created` | Run id and directory exist, but no plan has been written. |
| `planning` | The code plan is being generated. |
| `planned` | Plan, manifest, testing plan, and adapter contract are recorded. |
| `applying` | Apply mode started and the runner is preparing the branch. |
| `running_adapter` | A trusted coding adapter is running. |
| `checking_scope` | The runner is comparing planned files with actual changes. |
| `verifying` | Repository verification commands are running. |
| `awaiting_human` | A human gate blocks further progress. |
| `queued` | A prepared run is waiting for a worker claim. |
| `claimed` | A worker owns a temporary lease for the run. |
| `completed` | The loop finished the requested work. |
| `failed` | The loop stopped because a required step failed. |
| `cancelled` | The loop was explicitly cancelled. |
| `timed_out` | A claimed run missed its lease deadline. |

## Registry Entry

Each registry entry records the current state and the evidence paths needed for
CLI, UI, governance, and future resume logic:

```json
{
  "runId": "2026-06-29T00-00-00-000Z-issue-123",
  "issue": "123",
  "repo": "OWNER/REPO",
  "branch": "feat/123-example",
  "adapter": "mock",
  "state": "planned",
  "apply": false,
  "verify": false,
  "openPr": false,
  "runDir": ".myagenttool/runs/...",
  "eventLog": ".myagenttool/runs/.../events.jsonl",
  "createdAt": "2026-06-29T00:00:00.000Z",
  "updatedAt": "2026-06-29T00:00:00.000Z",
  "attempts": 1,
  "workerId": null,
  "heartbeatAt": null,
  "leaseExpiresAt": null,
  "timeoutAt": null,
  "queuePriority": null,
  "prNumber": null,
  "humanApproval": null,
  "humanGate": null,
  "evidence": {
    "manifest": ".myagenttool/runs/.../manifest.md",
    "codePlan": ".myagenttool/runs/.../code-plan.json",
    "testingPlan": ".myagenttool/runs/.../testing-plan.md",
    "testingPlanJson": ".myagenttool/runs/.../testing-plan.json",
    "adapterContract": ".myagenttool/runs/.../coding-adapter-contract.json",
    "adapterResult": null,
    "scopeCheck": null,
    "scopeCheckJson": null,
    "verification": null,
    "prBody": null,
    "workerLog": null,
    "workerResult": null
  },
  "lastError": null
}
```

## Queue Scheduler

The scheduler MVP is intentionally local and explicit. It uses registry state,
append-only events, and leases; it does not start a background service or run
coding adapters by itself.

Lifecycle:

```text
planned -> queued -> claimed -> completed
                    -> timed_out
                    -> queued
                    -> cancelled
```

Scheduler fields:

- `workerId`: the worker that currently owns the lease, or `null`.
- `heartbeatAt`: the last successful heartbeat timestamp.
- `leaseExpiresAt`: the timestamp after which the claim may be timed out.
- `timeoutAt`: an optional absolute deadline for the queued run.
- `queuePriority`: priority label used by claim ordering.

Scheduler events:

- `loop_enqueued`
- `loop_claimed`
- `loop_heartbeat`
- `loop_released`
- `loop_timed_out`

Queue commands must update the registry under the registry lock and append
events that can rebuild the same projection.

First scheduler commands:

```text
pnpm ai:loop-enqueue -- --run <run-id> --priority normal
pnpm ai:loop-claim -- --worker <worker-id>
pnpm ai:loop-heartbeat -- --run <run-id> --worker <worker-id>
pnpm ai:loop-release -- --run <run-id> --worker <worker-id>
pnpm ai:loop-timeout-check
```

## Worker Executor

The worker executor MVP consumes queued runs one at a time. It is deliberately
not a daemon yet: `loop-worker-once` claims a run, records worker evidence, and
then marks the run `completed` or `failed`.

Worker evidence:

- `workerLog`: markdown execution log for the worker attempt.
- `workerResult`: structured JSON result for replay and UI summaries.

Worker result fields:

- `workerId`
- `startedAt`
- `completedAt`
- `status`
- `mode`
- `parentRunId`
- `claimedRunId`
- `childRunId`
- `childState`
- `childEvidence`
- `childApply`
- `approval`
- `dirtyWorktreePolicy`
- `isolatedWorktree`
- `worktreePath`
- `baseRef`
- `cleanupPolicy`
- `childSkipVerify`
- `summary`
- `error`

Worker events:

- `loop_worker_started`
- `loop_worker_completed`
- `loop_worker_failed`

First worker command:

```text
pnpm ai:loop-worker-once -- --worker <worker-id>
pnpm ai:loop-worker-once -- --worker <worker-id> --run <run-id>
pnpm ai:loop-worker-once -- --worker <worker-id> --run <run-id> --fail
pnpm ai:loop-worker-once -- --worker <worker-id> --run <run-id> --mode child-run
pnpm ai:loop-worker-once -- --worker <worker-id> --run <run-id> --mode child-run --child-apply --approval "..." --isolate-worktree --base-ref HEAD
pnpm ai:loop-worktree-list
pnpm ai:loop-worktree-show -- --run <parent-run-id>
pnpm ai:loop-worktree-cleanup -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-diff -- --run <parent-run-id>
pnpm ai:loop-worktree-review -- --run <parent-run-id>
pnpm ai:loop-worktree-promote -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-promotion-apply -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-promotion-verify -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-promotion-pr-prep -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-promotion-commit -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-promotion-push-plan -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-promotion-push-preflight -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-promotion-push-execute -- --run <parent-run-id> --approval "..." --confirm-commit <sha>
pnpm ai:loop-worktree-promotion-pr-create-prep -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-promotion-pr-create-execute -- --run <parent-run-id> --approval "..." --confirm-head <branch>
pnpm ai:loop-worktree-promotion-pr-merge-prep -- --run <parent-run-id> --approval "..." --confirm-pr <number>
pnpm ai:loop-worktree-promotion-pr-merge-execute -- --run <parent-run-id> --approval "..." --confirm-pr <number> --confirm-commit <sha> --merge-method squash
```

Executor modes:

| Mode | Meaning |
| --- | --- |
| `mock` | Proves the control loop and replay model without running a coding adapter. |
| `child-run` | Creates a separate child loop run with `run-work`; the parent records the child id and result. |

Parent and child responsibilities:

- The parent run owns queue state, claim/lease state, worker evidence, and
  final worker status.
- The child run owns implementation planning/execution evidence generated by
  `run-work`.
- Child evidence is referenced from parent `worker-result.json`; it does not
  replace parent evidence.
- `child-run` apply mode is allowed only through the child apply gate below.
  Daemon workers and worker pools are later slices.

## Child Apply Gate

Child-run apply is a high-risk execution mode. It is allowed only when the
operator provides explicit approval and the apply attempt can be isolated from
the current workspace.

First apply-gate rules:

1. `--child-apply` must be paired with `--approval "..."`.
2. Without `--isolate-worktree`, a dirty worktree must fail before creating an
   apply child run.
3. With `--isolate-worktree`, the worker creates a detached git worktree under
   `.myagenttool/worktrees/` from `--base-ref` (default `HEAD`) and runs the
   child `run-work --apply` there.
4. The current workspace is never the apply target when `--isolate-worktree` is
   set, even if it is dirty.
5. Isolated worktrees are kept for audit by default. Cleanup is a later,
   explicit operation.
6. The parent run records `isolatedWorktree`, `worktreePath`, `baseRef`,
   `cleanupPolicy`, `childRunId`, `childState`, and child evidence references in
   `worker-result.json`.
7. The parent run records the refusal or execution result in
   `worker-result.json`.
8. The child run owns implementation evidence inside the isolated worktree.

First apply-gate commands:

```text
pnpm ai:loop-worker-once -- --worker <worker-id> --mode child-run --child-apply --approval "..."
pnpm ai:loop-worker-once -- --worker <worker-id> --mode child-run --child-apply --approval "..." --isolate-worktree --base-ref HEAD
```

The apply-gate baseline verifies refusal without approval and refusal on a dirty
non-isolated worktree. The isolated worktree slice verifies that approved child
apply can run while the current workspace remains dirty and unchanged by the
child attempt.

## Isolated Worktree Lifecycle

An isolated child apply creates a loop-owned git worktree that must remain
visible and auditable until a user explicitly removes it.

Lifecycle records are projected from the parent run's `worker-result.json`:

- `parentRunId`
- `childRunId`
- `worktreePath`
- `baseRef`
- `cleanupPolicy`
- `cleanupStatus`
- `exists`
- `dirty`
- `dirtyStatus`

Lifecycle commands:

```text
pnpm ai:loop-worktree-list
pnpm ai:loop-worktree-show -- --run <parent-run-id>
pnpm ai:loop-worktree-cleanup -- --run <parent-run-id> --approval "..."
```

Cleanup rules:

1. Cleanup requires explicit `--approval "..."`.
2. The target path must be absolute, inside `.myagenttool/worktrees/`, and must
   be traceable from the parent run's worker result.
3. Cleanup refuses the worktree root directory itself.
4. Cleanup refuses missing, non-directory, already removed, or dirty worktrees.
5. Cleanup uses `git worktree remove`; it does not use raw recursive deletion.
6. Cleanup writes the result back to `worker-result.json` and appends lifecycle
   events to the parent run.

Lifecycle events:

- `loop_worktree_cleanup_requested`
- `loop_worktree_cleanup_completed`
- `loop_worktree_cleanup_refused`

## Worktree Review And Promotion

Review and promotion turn an isolated worktree result into auditable evidence
without modifying the current workspace.

Review commands:

```text
pnpm ai:loop-worktree-diff -- --run <parent-run-id>
pnpm ai:loop-worktree-diff -- --run <parent-run-id> --patch
pnpm ai:loop-worktree-review -- --run <parent-run-id>
pnpm ai:loop-worktree-promote -- --run <parent-run-id> --approval "..."
```

Review evidence:

- `.myagenttool/runs/<parent-run-id>/worktree-review.json`
- `.myagenttool/runs/<parent-run-id>/worktree-review.md`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-plan.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-plan.md`
- `.myagenttool/runs/<parent-run-id>/worktree.patch`

Review rules:

1. Diff and review read only the isolated worktree.
2. Review records changed files, diff stat, dirty status, cleanup status, child
   run id, child state, base ref, and worktree path.
3. Promotion requires explicit `--approval "..."`.
4. Promotion writes a plan and patch bundle only. It does not apply patches,
   merge branches, push, open PRs, or modify the current workspace.
5. Promotion includes tracked and untracked worktree changes in the patch
   bundle.
6. Promotion refuses missing, cleaned-up, out-of-boundary, or uninspectable
   worktrees.

Review and promotion events:

- `loop_worktree_review_written`
- `loop_worktree_promotion_requested`
- `loop_worktree_promotion_refused`
- `loop_worktree_promotion_planned`

## Worktree Promotion Apply

Promotion apply turns an approved promotion plan and patch bundle into an
isolated integration worktree. It is still not a merge, push, PR, or production
delivery step.

Apply command:

```text
pnpm ai:loop-worktree-promotion-apply -- --run <parent-run-id> --approval "..."
```

Apply evidence:

- `.myagenttool/runs/<parent-run-id>/worktree-promotion-apply-plan.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-apply-result.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-apply.md`

Apply rules:

1. Apply requires explicit `--approval "..."`.
2. Apply requires existing `worktree-promotion-plan.json` with status
   `planned` and an existing non-empty `worktree.patch`.
3. Apply refuses when the current parent workspace is dirty.
4. Apply runs `git apply --check` before creating integration evidence.
5. Apply creates an isolated integration worktree under
   `.myagenttool/worktrees/` with a traceable `loop/promotion/...` branch.
6. Apply writes evidence and events, but does not merge, push, open PRs, or
   modify the current parent workspace.

Apply events:

- `loop_worktree_promotion_apply_requested`
- `loop_worktree_promotion_apply_checked`
- `loop_worktree_promotion_apply_refused`
- `loop_worktree_promotion_apply_succeeded`
- `loop_worktree_promotion_apply_failed`

## Worktree Promotion Verification

Promotion verification proves the isolated integration worktree produced by
promotion apply before any merge, push, or PR step.

Verify command:

```text
pnpm ai:loop-worktree-promotion-verify -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-promotion-verify -- --run <parent-run-id> --approval "..." --command tools-ai-check
```

Verify evidence:

- `.myagenttool/runs/<parent-run-id>/worktree-promotion-verify-plan.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-verify-result.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-verify.md`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-verify-stdout.txt`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-verify-stderr.txt`

Verify rules:

1. Verify requires explicit `--approval "..."`.
2. Verify requires `worktree-promotion-apply-result.json` with status
   `succeeded`.
3. Verify refuses missing, non-absolute, out-of-boundary, or missing
   integration worktree paths.
4. Verify executes only allowlisted command ids. The first allowlist is
   `git-status`, `tools-ai-check`, `protocol-check`, `repo-typecheck`, and
   `repo-test`.
5. Verify captures stdout, stderr, exit code, and result metadata as evidence.
6. Verify does not merge, push, open PRs, or modify the current parent
   workspace.

Verify events:

- `loop_worktree_promotion_verify_requested`
- `loop_worktree_promotion_verify_started`
- `loop_worktree_promotion_verify_refused`
- `loop_worktree_promotion_verify_succeeded`
- `loop_worktree_promotion_verify_failed`

## Worktree Promotion PR Prep

Promotion PR prep turns a verified integration worktree into a human-reviewable
PR preparation package. It does not push, merge, or open a pull request.

PR prep command:

```text
pnpm ai:loop-worktree-promotion-pr-prep -- --run <parent-run-id> --approval "..."
```

PR prep evidence:

- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-plan.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-body.md`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-checklist.md`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-summary.json`

PR prep rules:

1. PR prep requires explicit `--approval "..."`.
2. PR prep requires `worktree-promotion-apply-result.json` with status
   `succeeded`.
3. PR prep requires `worktree-promotion-verify-result.json` with status
   `succeeded`.
4. PR prep refuses missing, non-absolute, out-of-boundary, or missing
   integration worktree paths.
5. PR prep records integration branch, changed files, diff stat, verification
   command, verification exit code, and evidence refs.
6. PR prep does not commit, merge, push, open PRs, or modify the current parent
   workspace.

PR prep events:

- `loop_worktree_promotion_pr_prep_requested`
- `loop_worktree_promotion_pr_prep_refused`
- `loop_worktree_promotion_pr_prep_written`

## Worktree Promotion Commit

Promotion commit turns a verified, PR-prepared integration worktree into a
local commit. It still does not push, merge, or open a pull request.

Commit command:

```text
pnpm ai:loop-worktree-promotion-commit -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-promotion-commit -- --run <parent-run-id> --approval "..." --message "..."
```

Commit evidence:

- `.myagenttool/runs/<parent-run-id>/worktree-promotion-commit-plan.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-commit-result.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-commit.md`

Commit rules:

1. Commit requires explicit `--approval "..."`.
2. Commit requires successful apply, successful verify, and written PR prep
   evidence.
3. Commit refuses missing, non-absolute, out-of-boundary, or missing
   integration worktree paths.
4. Commit refuses an integration worktree with no pending changes.
5. Commit stages only the changed files recorded by the promotion chain and
   current integration worktree status.
6. Commit writes a local commit only inside the isolated integration worktree.
7. Commit does not push, merge, open PRs, or modify the current parent
   workspace.

Commit events:

- `loop_worktree_promotion_commit_requested`
- `loop_worktree_promotion_commit_refused`
- `loop_worktree_promotion_commit_succeeded`
- `loop_worktree_promotion_commit_failed`

## Worktree Promotion Push Plan

Promotion push plan turns a committed integration worktree into an auditable
push checklist. It still does not push, merge, or open a pull request.

Push plan command:

```text
pnpm ai:loop-worktree-promotion-push-plan -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-promotion-push-plan -- --run <parent-run-id> --approval "..." --remote origin
```

Push plan evidence:

- `.myagenttool/runs/<parent-run-id>/worktree-promotion-push-plan.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-push-checklist.md`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-push.md`

Push plan rules:

1. Push plan requires explicit `--approval "..."`.
2. Push plan requires successful commit evidence and written PR prep evidence.
3. Push plan refuses missing, non-absolute, out-of-boundary, or missing
   integration worktree paths.
4. Push plan refuses when the integration worktree `HEAD` differs from the
   recorded commit SHA.
5. Push plan refuses a dirty integration worktree.
6. Missing remotes or remote URLs are recorded as risks, not hard failures.
7. Push plan writes the intended remote, refspec, push command, risks, and
   checklist only. It does not run `git push`.

Push plan events:

- `loop_worktree_promotion_push_plan_requested`
- `loop_worktree_promotion_push_plan_refused`
- `loop_worktree_promotion_push_plan_written`

## Worktree Promotion Push Preflight

Promotion push preflight validates a written push plan immediately before any
future push execute step. It checks local branch/commit stability and remote
readiness. It still does not perform a real push, merge, or pull request
creation.

Push preflight command:

```text
pnpm ai:loop-worktree-promotion-push-preflight -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-promotion-push-preflight -- --run <parent-run-id> --approval "..." --dry-run
```

Push preflight evidence:

- `.myagenttool/runs/<parent-run-id>/worktree-promotion-push-preflight-plan.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-push-preflight-result.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-push-preflight.md`

Push preflight rules:

1. Push preflight requires explicit `--approval "..."`.
2. Push preflight requires a planned `worktree-promotion-push-plan.json`.
3. Push preflight refuses missing, non-absolute, out-of-boundary, or missing
   integration worktree paths.
4. Push preflight refuses when integration `HEAD`, branch, dirty status, or
   refspec differ from the push plan.
5. Push preflight runs remote read checks and records stdout, stderr, exit
   code, and failed checks as evidence.
6. `--dry-run` adds `git push --dry-run <remote> <refspec>` to the checks.
7. Push preflight does not run a real `git push`.

Push preflight events:

- `loop_worktree_promotion_push_preflight_requested`
- `loop_worktree_promotion_push_preflight_refused`
- `loop_worktree_promotion_push_preflight_succeeded`
- `loop_worktree_promotion_push_preflight_failed`

## Worktree Promotion Push Execute

Promotion push execute is the first promotion command that may change remote
repository state. It is allowed only after a successful dry-run push preflight,
and it only runs the same `git push <remote> <refspec>` recorded by preflight.
It does not merge or create a pull request.

Push execute command:

```text
pnpm ai:loop-worktree-promotion-push-execute -- --run <parent-run-id> --approval "..." --confirm-commit <sha>
```

Push execute evidence:

- `.myagenttool/runs/<parent-run-id>/worktree-promotion-push-execute-plan.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-push-execute-result.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-push-execute.md`

Push execute rules:

1. Push execute requires explicit `--approval "..."`.
2. Push execute requires explicit `--confirm-commit <sha>`.
3. Push execute requires successful `worktree-promotion-push-preflight-result.json`
   evidence produced with `--dry-run`.
4. `--confirm-commit` must match the preflight commit SHA.
5. Integration `HEAD`, branch, dirty status, remote, and refspec must still
   match preflight evidence.
6. Push execute runs only `git push <remote> <refspec>` from the integration
   worktree.
7. Push execute verifies the remote branch head after push and records stdout,
   stderr, exit code, and remote head as evidence.
8. Push execute does not merge or create a pull request.

Push execute events:

- `loop_worktree_promotion_push_execute_requested`
- `loop_worktree_promotion_push_execute_refused`
- `loop_worktree_promotion_push_execute_started`
- `loop_worktree_promotion_push_execute_succeeded`
- `loop_worktree_promotion_push_execute_failed`

## Worktree Promotion PR Create Prep

Promotion PR create prep turns a pushed promotion branch into an auditable PR
creation package. It reuses the previously prepared PR body and checklist,
checks that the remote branch still points at the pushed commit, and writes a
`gh pr create` plan. It does not call GitHub or create a pull request.

PR create prep command:

```text
pnpm ai:loop-worktree-promotion-pr-create-prep -- --run <parent-run-id> --approval "..."
pnpm ai:loop-worktree-promotion-pr-create-prep -- --run <parent-run-id> --approval "..." --base main
```

PR create prep evidence:

- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-create-plan.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-create-summary.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-create.md`

PR create prep rules:

1. PR create prep requires explicit `--approval "..."`.
2. PR create prep requires successful push execute evidence.
3. PR create prep requires written PR body, checklist, and summary evidence.
4. PR create prep refuses when remote branch head differs from the pushed
   commit.
5. PR create prep writes base branch, head branch, title, body file, checklist
   file, and the intended `gh pr create` command.
6. PR create prep does not call `gh pr create`.

PR create prep events:

- `loop_worktree_promotion_pr_create_prep_requested`
- `loop_worktree_promotion_pr_create_prep_refused`
- `loop_worktree_promotion_pr_create_prep_written`

## Worktree Promotion PR Create Execute

Promotion PR create execute is the human-gated boundary that may call GitHub.
It consumes PR create prep evidence, reconfirms the prepared head branch,
checks that the remote branch still points at the prepared commit, and then
runs `gh pr create`. It records the resulting PR number, URL, state, process
exit code, stdout, and stderr. It does not merge.

PR create execute command:

```text
pnpm ai:loop-worktree-promotion-pr-create-execute -- --run <parent-run-id> --approval "..." --confirm-head <branch>
```

PR create execute evidence:

- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-create-execute-plan.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-create-result.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-create-result.md`

PR create execute rules:

1. PR create execute requires explicit `--approval "..."`.
2. PR create execute requires `--confirm-head <branch>` and it must match the
   prepared head branch.
3. PR create execute requires written PR create prep evidence.
4. PR create execute refuses when the remote branch head differs from the
   prepared commit.
5. PR create execute calls `gh pr create --base <base> --head <head> --title
   <title> --body-file <file> --json number,url,state`.
6. PR create execute records PR number, URL, state, command, stdout, stderr,
   and exit code.
7. PR create execute may create a pull request. It does not merge.

PR create execute events:

- `loop_worktree_promotion_pr_create_execute_requested`
- `loop_worktree_promotion_pr_create_execute_refused`
- `loop_worktree_promotion_pr_create_execute_started`
- `loop_worktree_promotion_pr_create_execute_succeeded`
- `loop_worktree_promotion_pr_create_execute_failed`

## Worktree Promotion PR Merge Prep

Promotion PR merge prep turns a created pull request into an auditable merge
readiness package. It consumes PR create execute evidence, reconfirms the PR
number, checks that the remote branch still points at the created commit, and
uses read-only `gh pr view` and `gh pr checks` calls to inspect PR state. It
does not merge.

PR merge prep command:

```text
pnpm ai:loop-worktree-promotion-pr-merge-prep -- --run <parent-run-id> --approval "..." --confirm-pr <number>
pnpm ai:loop-worktree-promotion-pr-merge-prep -- --run <parent-run-id> --approval "..." --confirm-pr <number> --allow-no-checks
```

PR merge prep evidence:

- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-merge-prep-plan.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-merge-prep-result.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-merge-prep.md`

PR merge prep rules:

1. PR merge prep requires explicit `--approval "..."`.
2. PR merge prep requires `--confirm-pr <number>` and it must match the created
   PR number.
3. PR merge prep requires successful PR create execute evidence.
4. PR merge prep refuses when the remote branch head differs from the created
   PR commit.
5. PR merge prep calls only read-only GitHub CLI commands: `gh pr view` and
   `gh pr checks`.
6. PR merge prep is blocked when the PR is not open, is draft, has mismatched
   head/base/commit evidence, or has failing checks.
7. PR merge prep is blocked when there are no checks unless `--allow-no-checks`
   is explicitly provided.
8. PR merge prep does not merge.

PR merge prep events:

- `loop_worktree_promotion_pr_merge_prep_requested`
- `loop_worktree_promotion_pr_merge_prep_refused`
- `loop_worktree_promotion_pr_merge_prep_ready`
- `loop_worktree_promotion_pr_merge_prep_blocked`

## Worktree Promotion PR Merge Execute

Promotion PR merge execute is the human-gated boundary that may merge a pull
request. It consumes ready PR merge prep evidence, reconfirms the PR number and
commit SHA, re-runs read-only PR state/check checks, then runs `gh pr merge`
with the confirmed merge method. It does not delete branches.

PR merge execute command:

```text
pnpm ai:loop-worktree-promotion-pr-merge-execute -- --run <parent-run-id> --approval "..." --confirm-pr <number> --confirm-commit <sha> --merge-method squash
pnpm ai:loop-worktree-promotion-pr-merge-execute -- --run <parent-run-id> --approval "..." --confirm-pr <number> --confirm-commit <sha> --merge-method merge
pnpm ai:loop-worktree-promotion-pr-merge-execute -- --run <parent-run-id> --approval "..." --confirm-pr <number> --confirm-commit <sha> --merge-method rebase
```

PR merge execute evidence:

- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-merge-execute-plan.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-merge-execute-result.json`
- `.myagenttool/runs/<parent-run-id>/worktree-promotion-pr-merge-execute.md`

PR merge execute rules:

1. PR merge execute requires explicit `--approval "..."`.
2. PR merge execute requires `--confirm-pr <number>` and `--confirm-commit
   <sha>`.
3. PR merge execute requires `--merge-method squash|merge|rebase`.
4. PR merge execute requires ready PR merge prep evidence.
5. PR merge execute refuses when the remote branch head differs from the merge
   prep commit.
6. PR merge execute re-runs read-only `gh pr view` and `gh pr checks` before
   calling `gh pr merge`.
7. PR merge execute calls `gh pr merge <number> --squash|--merge|--rebase`.
8. PR merge execute may merge. It does not delete branches.

PR merge execute events:

- `loop_worktree_promotion_pr_merge_execute_requested`
- `loop_worktree_promotion_pr_merge_execute_refused`
- `loop_worktree_promotion_pr_merge_execute_started`
- `loop_worktree_promotion_pr_merge_execute_succeeded`
- `loop_worktree_promotion_pr_merge_execute_failed`

## Event Log

Each run also writes an append-only `events.jsonl` file. Events use the shared
loop event vocabulary from `packages/protocol/src/loop.ts`.

Required event fields:

- `id`
- `runId`
- `type`
- `state`
- `createdAt`
- `message`
- `data`

## Registry Consistency

Loop evidence uses two local files with different responsibilities:

- `events.jsonl` is the append-only source of truth for a single run.
- `registry.json` is a projection used by CLI and UI list/detail commands.

Consistency rules:

1. Every registry mutation must hold `.myagenttool/runs/registry.lock`.
2. Registry writes must use a temporary file followed by atomic rename.
3. Event append must happen before the registry projection relies on that
   event.
4. `registry.json` must be rebuildable from run directories and event logs.
5. A check command must report projection drift instead of silently correcting
   it.
6. Rebuild may skip legacy run folders that do not have `events.jsonl`.

First-slice maintenance commands:

```text
pnpm ai:loop-registry-check
pnpm ai:loop-registry-rebuild
```

## Boundaries

- The loop engine owns state, evidence, gates, and orchestration.
- Coding adapters own the actual implementation attempt inside the trusted
  adapter contract.
- Model output is proposal data until verification and evidence exist.
- Merge, deploy, billing, credentials, and high-risk scope changes remain human
  gates.
- `loop-cancel` in the first control slice updates loop state and evidence. It
  does not terminate already-running operating-system processes.
- `loop-resume` in the first control slice records intent to continue a blocked
  or failed run. It does not replay adapter commands by itself.
- `loop-retry` creates a new work-runner attempt from an existing registry
  entry. It remains dry-run unless `--apply` is provided explicitly.

## Control Commands

The local control layer starts with three explicit commands:

```text
pnpm ai:loop-cancel -- --run <run-id> --reason "..."
pnpm ai:loop-resume -- --run <run-id> --reason "..."
pnpm ai:loop-retry -- --run <run-id>
```

Control commands must append events to the original run log so the user can see
who or what requested the state change. Retry attempts create a new run instead
of mutating prior evidence.

## Human Gates

Human gates are first-class registry data, not only a run state. A gate records:

- `gateId`
- `state`
- `reason`
- `risk`
- `scope`
- `requestedAction`
- `requestedBy`
- `requestedAt`
- `approvedBy`
- `approvedAt`
- `rejectedBy`
- `rejectedAt`
- `expiresAt`
- `evidence`

Gate state values are:

| State | Meaning |
| --- | --- |
| `none` | No gate is active for the run. |
| `requested` | The loop is blocked until a human approves or rejects it. |
| `approved` | A named approver approved the requested scope. |
| `rejected` | A named reviewer rejected the requested scope. |
| `expired` | The approval window expired before a decision. |

First-slice commands:

```text
pnpm ai:loop-gate-request -- --run <run-id> --reason "..." --scope "..." --requested-action "..."
pnpm ai:loop-gate-approve -- --run <run-id> --by "NAME" --evidence "..."
pnpm ai:loop-gate-reject -- --run <run-id> --by "NAME" --reason "..."
```

Approving a gate moves the run back to `planned`. Rejecting a gate leaves the
run in `awaiting_human` with a rejected gate record so reviewers can decide
whether to cancel or retry.

## Closeout Status

Status as of 2026-06-30: the Loop Engine local orchestration and worktree
promotion chain are implemented through the human-gated PR merge execute
boundary. The registry, queue, lease, event replay, and human-gate state
helpers live in `tools/ai/src/loop/registry.mjs`. Structured AI provider
dispatch lives in `tools/ai/src/providers/structured.mjs`. Worktree and
promotion markdown formatters live in `tools/ai/src/loop/formatters.mjs`.
Worktree records, path-boundary checks, worker-result updates, isolated
worktree creation, and git worktree helpers live in
`tools/ai/src/loop/worktree.mjs`.

The routine implementation is now split by domain:

- `tools/ai/src/loop/routine.mjs`: routine orchestration, validation, schedule
  tick, output writing, and index update boundaries.
- `tools/ai/src/loop/routine-inputs.mjs`: local, git, GitHub, filesystem, and
  registry input collection plus input summaries.
- `tools/ai/src/loop/routine-findings.mjs`: morning triage and generic finding
  generation plus skill-to-finding binding.
- `tools/ai/src/loop/routine-skills.mjs`: `SKILL.md` resolution, parsing,
  hashing, and acceptance/check extraction.
- `tools/ai/src/loop/routine-fanout.mjs`: fanout planning, planned child run
  creation, optional enqueue, and optional worker execution.
- `tools/ai/src/loop/routine-runs.mjs`: routine-run paths, JSON reads, and
  routine-run event appends.
- `tools/ai/src/loop/routine-utils.mjs`: shared normalization, path, list, and
  failure helpers.
- `tools/ai/src/loop/routine-inspect.mjs`: compact index and read model.
- `tools/ai/src/loop/routine-formatters.mjs`,
  `tools/ai/src/loop/routine-checks.mjs`, and
  `tools/ai/src/loop/routine-yaml.mjs`: display, check execution, and YAML
  parsing.

The promotion implementation is now split by promotion responsibility:

- `tools/ai/src/loop/promotion.mjs`: thin promotion facade plus runtime
  worktree/git glue for verification commands and integration worktree
  creation.
- `tools/ai/src/loop/promotion-results.mjs`: promotion plan/result builders,
  default commit message, and default PR title helpers.
- `tools/ai/src/loop/promotion-evidence.mjs`: JSON, Markdown, stdout/stderr,
  patch, checklist, and PR evidence writers.
- `tools/ai/src/loop/promotion-inputs.mjs`: promotion artifact readers and
  state/path precondition checks for apply, verify, PR prep, commit, push, PR
  create, and PR merge stages.
- `tools/ai/src/loop/promotion-finish.mjs`: refusal/failure finish
  orchestration, worker-result updates, event appends, and JSON/console output.
- `tools/ai/src/loop/promotion-github.mjs`: GitHub command resolution, PR
  create/merge command execution, GitHub JSON parsing, PR merge readiness
  assessment, and GitHub command result normalization.
- `tools/ai/src/loop/promotion-push.mjs`: push plan risks, push preflight
  checks, push execution command, and remote-head reads.

CLI command handlers are split by surface into
`tools/ai/src/commands/registry.mjs`, `tools/ai/src/commands/worktree.mjs`,
`tools/ai/src/commands/worker.mjs`, `tools/ai/src/commands/promotion.mjs`, and
`tools/ai/src/commands/routine.mjs`.

Legacy AI delivery commands are now split into:

- `tools/ai/src/legacy/help.mjs`: CLI help text.
- `tools/ai/src/legacy/config.mjs`: structured-output schemas, coding adapter
  registry, adapter contract version, and standard verification command list.
- `tools/ai/src/legacy/scope-testing.mjs`: scope drift checks, Product Flow
  plan-gap checks, testing-plan generation, and the `scope-check` /
  `testing-plan` CLI handlers.
- `tools/ai/src/legacy/pm-commands.mjs`: intake brief, PM brief, issue-tree,
  branch-plan, and code-plan command handlers.
- `tools/ai/src/legacy/feedback-commands.mjs`: feedback conversion command
  handler plus issue-tree handoff draft generation.
- `tools/ai/src/legacy/formatters.mjs`: PM brief, issue tree, code plan,
  review, coding-adapter contract, Product Flow, and list/checklist
  formatting helpers.
- `tools/ai/src/legacy/issue-tree.mjs`: PM brief normalization, Markdown brief
  parsing, issue-tree generation, Product Flow gate checks, and human approval
  validation.
- `tools/ai/src/legacy/mock-provider.mjs`: deterministic local structured
  provider fixtures for PM brief, code plan, and PR review flows.
- `tools/ai/src/legacy/pm-helpers.mjs`: branch naming, governance labels,
  target classification, and area/platform/risk inference helpers.
- `tools/ai/src/legacy/review-commands.mjs`: PR review, work-manifest, and
  coding-adapter-contract command handlers.
- `tools/ai/src/legacy/work-runner.mjs`: work-runner orchestration, coding
  adapter execution, adapter contract JSON, verification capture, and PR body
  generation.

`tools/ai/src/index.mjs` now acts as the CLI router plus runtime dependency
composition. It wires command modules to shared repo, GitHub, provider, and
filesystem helpers, while legacy PM/issue-tree/code-plan/scope/review/work-runner
logic lives behind focused modules. As of this split, `index.mjs` is about 874
lines and `tools/ai/src/loop/promotion.mjs` is about 256 lines.

Remaining split plan:

- `apps/server/src/index.mjs`: split into `routes/*`, `state/store`,
  `projects/git`, `agents`, `codex`, `terminal`, and `routine-api` modules.
  Keep the HTTP router thin and leave mutation boundaries explicit.
- `apps/web/public/app.js`: split by surface into task/routine browser,
  workspace/session, evidence center, terminal, project browser, integration,
  and shared API/render utilities.
- `apps/web/public/styles.css`: split by shell, composer, task/routine list,
  evidence, terminal, project browser, and responsive rules.
- `tools/ai/src/loop/routine.mjs`: split the remaining schedule state and
  summary/output writer helpers only after scheduler behavior needs another
  functional slice; the large input/finding/skill/fanout domains are already
  separated.

Implemented command surfaces:

- Run registration and inspection: `ai:loop-list`, `ai:loop-show`,
  `ai:loop-registry-check`, and `ai:loop-registry-rebuild`.
- Run control and gates: `ai:loop-cancel`, `ai:loop-resume`, `ai:loop-retry`,
  `ai:loop-gate-request`, `ai:loop-gate-approve`, and
  `ai:loop-gate-reject`.
- Local queue and leases: `ai:loop-enqueue`, `ai:loop-claim`,
  `ai:loop-heartbeat`, `ai:loop-release`, and `ai:loop-timeout-check`.
- Worker execution: `ai:loop-worker-once` in mock and child-run modes, with
  gated isolated child apply support.
- Isolated worktree lifecycle: `ai:loop-worktree-list`,
  `ai:loop-worktree-show`, `ai:loop-worktree-cleanup`,
  `ai:loop-worktree-diff`, `ai:loop-worktree-review`, and
  `ai:loop-worktree-promote`.
- Promotion chain: `ai:loop-worktree-promotion-apply`,
  `ai:loop-worktree-promotion-verify`,
  `ai:loop-worktree-promotion-pr-prep`,
  `ai:loop-worktree-promotion-commit`,
  `ai:loop-worktree-promotion-push-plan`,
  `ai:loop-worktree-promotion-push-preflight`,
  `ai:loop-worktree-promotion-push-execute`,
  `ai:loop-worktree-promotion-pr-create-prep`,
  `ai:loop-worktree-promotion-pr-create-execute`,
  `ai:loop-worktree-promotion-pr-merge-prep`, and
  `ai:loop-worktree-promotion-pr-merge-execute`.
- Loop routines: `ai:loop-routine-check`, `ai:loop-routine-plan`,
  `ai:loop-routine-run`, `ai:loop-routine-list`,
  `ai:loop-routine-latest`, `ai:loop-routine-show`,
  `ai:loop-routine-findings`, `ai:loop-routine-schedule-plan`,
  `ai:loop-routine-schedule-run`, `ai:loop-routine-fanout-plan`, and
  `ai:loop-routine-fanout-execute`.

Implemented routine capabilities:

- YAML/JSON routine specifications for schedule, inputs, skills, goal, checks,
  outputs, and safety policy.
- Local morning triage execution that writes routine-run evidence under
  `.myagenttool/routine-runs/` and summary/finding outputs under
  `.myagenttool/state/`.
- Read-only input collectors for git commits, filesystem globs, loop registry
  state, GitHub issues, GitHub pull requests, GitHub checks, and GitHub
  commits.
- Skill binding snapshots from `SKILL.md`, including title, summary,
  acceptance bullets, check bullets, sha256, and fanout context injection.
- Routine checks with allowlisted local command ids and `checks-result.json`
  evidence.
- Deterministic findings for failed loop runs, failed checks, failed inputs,
  GitHub issue hygiene, PR review/draft state, and failing or pending checks.
- Fanout planning and explicit fanout execution into normal planned loop runs.
- Optional child enqueue and one-pass child-run worker execution with isolated
  worktree support.
- Local scheduler plan/run ticks for manual first-run, cooldown,
  max-concurrency state, and simple `@hourly` / `@daily` aliases.
- Read-only routine history and findings inspection over local routine-run
  evidence.
- Web/server routine read model over `.myagenttool/routine-runs/`, exposed in
  the local console as a read-only routine run browser with finding and fanout
  inspection prompts.

Implemented verification assets:

- Core checks: `pnpm ai:check`, `pnpm typecheck`, `pnpm test`, and
  `pnpm docs:check`.
- Loop smoke checks: `smoke:loop-registry`, `smoke:loop-scheduler`,
  `smoke:loop-worker`, `smoke:loop-worker-child-run`,
  `smoke:loop-worker-child-apply`,
  `smoke:loop-worker-child-apply-isolated`,
  `smoke:loop-worktree-lifecycle`,
  `smoke:loop-worktree-review-promotion`,
  `smoke:loop-worktree-promotion-apply`,
  `smoke:loop-worktree-promotion-verify`,
  `smoke:loop-worktree-promotion-pr-prep`,
  `smoke:loop-worktree-promotion-commit`,
  `smoke:loop-worktree-promotion-push-plan`,
  `smoke:loop-worktree-promotion-push-preflight`,
  `smoke:loop-worktree-promotion-push-execute`,
  `smoke:loop-worktree-promotion-pr-create-prep`,
  `smoke:loop-worktree-promotion-pr-create-execute`,
  `smoke:loop-worktree-promotion-pr-merge-prep`, and
  `smoke:loop-worktree-promotion-pr-merge-execute`.
- Routine smoke checks: `smoke:loop-routine-check`,
  `smoke:loop-routine-plan`, `smoke:loop-routine-run-dry`,
  `smoke:loop-routine-run-findings`, `smoke:loop-routine-github-inputs`,
  `smoke:loop-routine-schedule-plan`, `smoke:loop-routine-schedule-run`,
  `smoke:loop-routine-inspect`, `smoke:loop-routine-fanout-plan`,
  `smoke:loop-routine-fanout-execute`,
  `smoke:loop-routine-fanout-enqueue`, and
  `smoke:loop-routine-fanout-worker`.

Validation notes:

- Loop smoke commands mutate the shared local registry projection under
  `.myagenttool/runs/registry.json`; run them serially unless a future harness
  gives each smoke an isolated repository root.
- Worktree smoke commands create git worktrees and may need permission to write
  `.git/worktrees` in the parent repository.
- Windows git may report CRLF warnings for fixture repositories during smoke
  runs; these warnings do not fail the validated chain.

Operations that can change only local state:

- Registry, control, gate, queue, worker, worktree review, promotion planning,
  promotion apply, promotion verification, PR prep, commit, and push planning
  commands write local evidence and local git worktrees only.
- `ai:loop-worktree-promotion-commit` creates a commit only inside the isolated
  integration worktree.
- `ai:loop-routine-run` writes local routine-run evidence and configured local
  outputs.
- `ai:loop-routine-schedule-plan` and `ai:loop-routine-schedule-run` write
  local scheduler state/result evidence only.
- `ai:loop-routine-fanout-plan` writes local fanout plan evidence only.
- `ai:loop-routine-fanout-execute` creates planned local loop runs by default.
  With `--enqueue` or `--run-worker`, it can advance those local child runs
  through the queue or one worker pass; with `--isolate-worktree`, that worker
  pass can create local git worktrees.
- `ai:loop-routine-list`, `ai:loop-routine-latest`,
  `ai:loop-routine-show`, and `ai:loop-routine-findings` are read-only local
  inspection commands.
- `ai:loop-routine-index-rebuild` rebuilds the local compact routine history
  index at `.myagenttool/state/routine-runs-index.json`.
- The Web Console routine browser reads local routine-run evidence through
  dedicated read-only endpoints: `GET /api/loop-routines`,
  `GET /api/loop-routines/:runId`, and
  `GET /api/loop-routines/:runId/findings`. `/api/state` now carries only a
  compact routine summary/latest id for the current project.
- CLI inspection, server APIs, and the Web Console use
  `tools/ai/src/loop/routine-inspect.mjs` as the shared routine read model.
  The read model prefers `.myagenttool/state/routine-runs-index.json` and falls
  back to scanning `.myagenttool/routine-runs/` when the index is missing or
  invalid. This API surface does not run routines, enqueue child runs, execute
  workers, push, create pull requests, or merge pull requests.

Operations that can change remote or GitHub state:

- `ai:loop-worktree-promotion-push-preflight --dry-run` asks the configured git
  remote to validate the push but does not update refs.
- `ai:loop-worktree-promotion-push-execute` runs the preflighted
  `git push <remote> <refspec>` and may update the remote branch.
- `ai:loop-worktree-promotion-pr-create-execute` calls `gh pr create` through
  the configured GitHub CLI command and may create a pull request.
- `ai:loop-worktree-promotion-pr-merge-prep` calls read-only `gh pr view` and
  `gh pr checks`.
- `ai:loop-worktree-promotion-pr-merge-execute` re-runs read-only PR checks and
  then calls `gh pr merge`; it may merge the confirmed pull request. It does
  not delete branches.
- Routine GitHub inputs are read-only GitHub CLI calls. Routine fanout and
  worker execution do not push, create pull requests, or merge pull requests.

Future slices:

- Continue reducing the legacy work-runner, review, and document-generation
  sections of the CLI entrypoint into focused command modules as those surfaces
  evolve.
- Full cron parsing, event triggers, and a long-lived routine daemon.
- Routine UI actions for approvals, enqueue, worker execution, and fanout
  mutation. The current Web Console routine surface is read-only.
- A long-lived worker daemon or worker pool.
- UI surfaces for loop run history, worktree evidence, approvals, and promotion
  gates.
- Remote/shared registry storage beyond the local file projection.
- Automatic cleanup policy beyond explicit audited worktree cleanup.
- Production adapters beyond the current trusted command contracts and mock
  smoke coverage.

## Verification

Phase 1 is valid when:

```text
pnpm --filter @myagenttool/protocol test
pnpm --filter @myagenttool/protocol typecheck
pnpm docs:check
```

The scheduler slice is valid when:

```text
pnpm --filter @myagenttool/tools-ai test
pnpm ai:loop-registry-check
pnpm smoke:loop-scheduler
pnpm typecheck
pnpm test
```

The worker executor slice is valid when:

```text
pnpm --filter @myagenttool/protocol test
pnpm --filter @myagenttool/tools-ai test
pnpm ai:loop-registry-check
pnpm smoke:loop-worker
```

The child apply gate is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worker-child-apply
pnpm smoke:loop-worker-child-apply-isolated
```

The isolated worktree lifecycle slice is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worktree-lifecycle
pnpm smoke:loop-worker-child-apply-isolated
```

The worktree review and promotion slice is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worktree-review-promotion
pnpm smoke:loop-worktree-lifecycle
```

The worktree promotion apply slice is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worktree-promotion-apply
pnpm smoke:loop-worktree-review-promotion
pnpm smoke:loop-worktree-lifecycle
```

The worktree promotion verification slice is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worktree-promotion-verify
pnpm smoke:loop-worktree-promotion-apply
pnpm smoke:loop-worktree-review-promotion
```

The worktree promotion PR prep slice is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worktree-promotion-pr-prep
pnpm smoke:loop-worktree-promotion-verify
pnpm smoke:loop-worktree-promotion-apply
```

The worktree promotion commit slice is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worktree-promotion-commit
pnpm smoke:loop-worktree-promotion-pr-prep
pnpm smoke:loop-worktree-promotion-verify
```

The worktree promotion push plan slice is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worktree-promotion-push-plan
pnpm smoke:loop-worktree-promotion-commit
pnpm smoke:loop-worktree-promotion-pr-prep
```

The worktree promotion push preflight slice is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worktree-promotion-push-preflight
pnpm smoke:loop-worktree-promotion-push-plan
pnpm smoke:loop-worktree-promotion-commit
```

The worktree promotion push execute slice is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worktree-promotion-push-execute
pnpm smoke:loop-worktree-promotion-push-preflight
pnpm smoke:loop-worktree-promotion-push-plan
```

The worktree promotion PR create prep slice is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worktree-promotion-pr-create-prep
pnpm smoke:loop-worktree-promotion-push-execute
pnpm smoke:loop-worktree-promotion-push-preflight
```

The worktree promotion PR create execute slice is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worktree-promotion-pr-create-execute
pnpm smoke:loop-worktree-promotion-pr-create-prep
pnpm smoke:loop-worktree-promotion-push-execute
```

The worktree promotion PR merge prep slice is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worktree-promotion-pr-merge-prep
pnpm smoke:loop-worktree-promotion-pr-create-execute
pnpm smoke:loop-worktree-promotion-pr-create-prep
```

The worktree promotion PR merge execute slice is valid when:

```text
pnpm ai:loop-registry-check
pnpm smoke:loop-worktree-promotion-pr-merge-execute
pnpm smoke:loop-worktree-promotion-pr-merge-prep
pnpm smoke:loop-worktree-promotion-pr-create-execute
```

The loop routine slice is valid when:

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
pnpm smoke:loop-routine-index
pnpm smoke:loop-routine-fanout-plan
pnpm smoke:loop-routine-fanout-execute
pnpm smoke:loop-routine-fanout-enqueue
pnpm smoke:loop-routine-fanout-worker
pnpm ai:check
pnpm typecheck
pnpm test
pnpm docs:check
```
