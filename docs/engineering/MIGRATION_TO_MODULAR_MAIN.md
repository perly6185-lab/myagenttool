# Migrating `feat/budgets-and-chargeback` onto modular `main`

Date: 2026-07-01 · Author: integration audit

## TL;DR

`feat/budgets-and-chargeback` is a **monolith** (`apps/server/src/index.mjs`, ~5.9k
lines) that never reached `main` — PR #170 merged it into the now-deleted
`feat/economic-ledger`, not `main`. Meanwhile `main` **refactored the server into
~30 modules** (`routes/ services/ runtime/ read-models/`), rebuilt the web as
React (#171 — it took our console, incl. Task/Automation views), and added M3 /
loop-routines / terminal / SSH.

So this is **not a merge or a rebase** (architectures are incompatible; a rebase
detonates on `index.mjs`). It is a **re-port of the genuine delta** into `main`'s
module structure, as small independent PRs off current `main`.

## What `main` already has (⇒ drop ours)

Verified in `main` (`buildPublicState` + modules): React console incl. **Task &
Automation views**, Worktree/Devices views; **economics** (ledger/budget/
chargeback); **users/teams** state; **projects / worktrees / project targets**;
the **invocation lifecycle** (`services/invocations/*`: creation, dispatch,
approval, cancellation, completion, direct-http, troubleshooting); **codex**;
`device.maxConcurrency` (in `routes/control-plane.mjs`); **loop-routines** (its
own scheduled-agent system).

## The genuine delta — outcomes (all resolved)

> **Note (2026-07-01):** `origin/main` (5d79acf) reimplemented most of these
> surfaces *after* the delta table was first drafted — several as compatibility
> **stubs** (empty/placeholder responses) rather than absent code. A per-feature
> re-scan against current `main` replaced "absent symbol" with "actual gap".
> Status below reflects what was actually done.

| # | Feature | Gap in current `main` | Resolution | Commit |
|---|---|---|---|---|
| 1 | **Identity: auth + tenancy** | users/teams/tokens seeded and control-plane already mints `/api/session` tokens, but nothing resolves an actor, gates the API, scopes reads, or guards writes | NEW `runtime/auth.mjs` (`resolveActor` compatible with control-plane's token shape, `teamOf`, `denyForeignProject`); flag-gated 401 gate + actor threaded into `/api/state` and route bags; `buildPublicState(actor)` team-scopes every project/invocation-derived collection; write-guards on project/worktree/invocation/budget/automation mutations | 929afed, 612eb6a |
| 2 | **Worktree diff view** | route existed but returned the file list with `diff: ""` (stub) | ported real `worktreeDiff` (unified patch vs merge-base, untracked-as-additions, 1 MiB / 200-file bounds) into `services/projects.mjs` | 98db90a |
| 3 | **Task GitHub board** | route returned `{issues, pullRequests, repository}` — **wrong shape** for the Task view `main` shipped (needs `{available, message, items}`), and never called `gh` | ported real `projectGithubItems` (`gh` issue/pr list, graceful `available:false`) | 98db90a |
| 4 | **Worktree attachments** | `saveAttachments` existed but wrote to the base project dir, no size cap, files left untracked | hardened: worktree path, symlink/realpath guard, 5 MiB cap + `skipped`, randomized names, self-`.gitignore` | 1d381f0 |
| 5 | **Permission level → Codex sandbox** | ~~`sandboxForPermission`~~ | **SKIPPED — covered by `main` differently.** `main` routes `permissionLevel → metadata.permissionMode → approvalMode` into its Codex **approval broker** (auto/full auto-approve, "ask" queues, sensitive-pattern manual-review escape). Our `--sandbox` mapping is an *overlapping* enforcement model; bolting it on would double-gate and conflict (read-only hard-blocks writes the broker's auto/full intend to allow). Defense-in-depth via `--sandbox` would be a design change to coordinate, not a port. | — |
| 6 | **Concurrency safety** | `device.maxConcurrency` was advertised but **`nextDispatchableInvocation` ignored it** (cosmetic cap); no per-cwd guard, no bridge-only counting, no stuck-cancel reclaim | ported all four into `services/invocations/dispatch.mjs` (`completeInvocation` threaded via `createInvocationService`) | 552e401 |
| — | **Skills** | `main` is building its **own** skills (`tools/ai/src/loop/routine-skills.mjs`) | ⚠️ COORDINATE — do not port ours blindly | — |
| — | **Automation scheduler** | `main` has **loop-routines** + an `automations` collection; our `runDueAutomations` overlaps | ⚠️ COORDINATE — decide which wins before wiring a scheduler | — |

## `main`'s server pattern (the port target)

`runtime/http-server.mjs` builds the server from injected deps and dispatches by
calling `handleXRoutes({ req, res, url, sendJson, readJson, state, … })` per
domain (control-plane, loop-routines, projects, terminal, agents, codex,
integrations, m3), each returning `true` if it handled the request. State/services
are assembled in `runtime/state-factory.mjs` + `runtime/service-composer.mjs`;
the snapshot is `read-models/state.mjs buildPublicState({ state, … })`. **No auth
context exists yet** — feature #1 introduces `resolveActor(req)` and threads the
actor into the dispatch + `buildPublicState`.

## Status

**Server delta done** on `integrate/budgets-onto-main` (off `origin/main`
5d79acf): #1–#4 and #6 ported, #5 deliberately skipped (covered by `main`'s
Codex approval broker). Every step carries a unit and/or live verification and
the startup self-check passes. Still open, both requiring coordination with
`main`'s direction, not a mechanical port:

- **Skills** — `main` is building its own; don't port ours blindly.
- **Automation vs loop-routines** — overlapping schedulers; decide which wins.
- **Web delta** (below) — reconcile only once the backing feature is settled.

Keep `feat/budgets-and-chargeback` as the reference spec; nothing is
rebased/merged.

## Web delta

`main`'s `apps/web/src` ≈ ours (only ~11 files differ, +336/−41). Net-new to port
**iff the backing feature is adopted**: `features/skills/skills-view.tsx`,
`features/projects/worktree-payload.ts`, plus small diffs in `task-view.tsx`,
`automation-view.tsx`, `console-state.ts`, `routes.tsx`.
