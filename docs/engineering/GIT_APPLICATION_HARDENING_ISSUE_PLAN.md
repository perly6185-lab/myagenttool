# git Application Hardening — Review & Issue Plan

A four-lens review (global / local / observability / automation) of the git
application (Epic #772) — a `binary`-source governed application projecting a
**read-only** git capability set (status/log/diff/branch/head/show). The
execution machinery (dual server+device allowlist, cwd confinement, degrade-to-null
parsing) is solid; these tasks fix a tenancy leak, silent failures, and a health gap.

## Two important framings

1. **There are two independent git subsystems.** The governed git Application
   (results → `state.applicationResults`, shown only in the Applications inspector)
   and the project file-tree / git-status browser (`gitStatusMap` in
   `projects.mjs`, which shells out to `git` directly, bypassing the Application).
   They never touch — the managed App is inspector-only.
2. **Keystone finding — tenancy leak.** `applicationResults` are scoped only by
   project ([state.mjs:29-30](../../apps/server/src/read-models/state.mjs)), and
   `projectVisible(null) === true`. `app_git` (binary source) has no `projectId`,
   so a git run with an unresolved project stores a `repo_state` row (branch names,
   commit hashes, author emails, changed-file paths) **visible to every team** —
   `applicationResults` has no `ownerTeamId` fallback (unlike `applications` / evidence).

## Issue Tree

| Order | Issue | Priority | Area |
| --- | --- | --- | --- |
| 1 | git Application Hardening Issue Plan (this doc) | — | docs |
| 2 | Scope applicationResults by ownerTeamId (repo_state tenancy leak) | P0 | server / security |
| 3 | computeGitStatusMap: maxBuffer + no silent "clean" tree on error | P1 | server |
| 4 | binary-source health from recent runs (extend #885 to binary) | P1 | server |
| 5 | git command timeouts (declare timeoutSeconds + runner timeout) | P2 | server / desktop |
| 6 | Refresh workspace git facts (branch/remote), not once at registration | P2 | server |
| 7 | Document the two git subsystems; App is inspector-only | P3 | docs |

## Tasks

### PR 2 — applicationResults tenancy scoping (P0)

Fall back to `ownerTeamId` scoping for `applicationResults` in the read-model, so
a `repo_state` row with a null/foreign projectId is not globally visible. Attribute
each result to its owning team (via the app or the requester) and filter like
`applications` / imported evidence already do.

- Accepted: a git result with no projectId is visible only to its owning team, not every team.
- Tests: a foreign team cannot see another team's repo_state.

### PR 3 — status map robustness (P1)

- Give `computeGitStatusMap`'s `execFileSync` a `maxBuffer` matching `worktreeDiff`
  (64 MiB), so a large `git status --ignored` doesn't `ENOBUFS`.
- On error, do not return an empty map that badges the whole tree "clean" — surface
  a status-unavailable signal instead of silent success.

### PR 4 — binary-source health (P1)

Extend the #885 run-derived health to `binary` sources, so the git Application gets
a real health signal (a device that lost `git`, or an app_git that only fails,
shows unhealthy) instead of a permanent `unsupported`.

### PR 5 — git command timeouts (P2)

Declare a `timeoutSeconds` on the git commands and enforce a timeout in the
application-wrapper runner, so a blocking `git` fails fast instead of hanging to
the 120s agent kill.

### PR 6 — fresh workspace git facts (P2)

Refresh `project.git` (branch/remote/default) rather than capturing it once at
registration, so the workspace view doesn't show a stale branch after a checkout.

### PR 7 — document the two subsystems (P3)

A short doc/comment clarifying that the managed git Application is inspector-only
and does not drive the file tree / status browser (which use `gitStatusMap`).

## Non-Goals

- Full-text diff (only `--stat` is in scope, by design).
- Merging the two git subsystems.

## Verification Baseline

```text
pnpm --filter @myagenttool/server test
pnpm typecheck
pnpm test
git diff --check
```
