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

## The genuine delta (⇒ port, by module)

Confirmed absent from `main` by unique symbol (`git grep` on `apps/server/src`):

| # | Feature | Absent symbol(s) | Target in `main` | Notes |
|---|---|---|---|---|
| 1 | **Identity: auth + tenancy** | `resolveActor`, `denyForeignProject`, no token/session, no auth gate | NEW `runtime/auth.mjs`; wire into `runtime/http-server.mjs` (session route + gate); scope `read-models/state.mjs buildPublicState` by team; guard mutating route modules | **Highest value, zero conflict** — `main` has users/teams but no enforcement. Do first. |
| 2 | **Worktree diff view** | `worktreeDiff` | `services/projects.mjs` + a `/api/worktrees/:id/diff` case in `routes/projects.mjs` | `main` has `worktree-view.tsx` already; likely references the missing endpoint. Small. |
| 3 | **Task GitHub board (server)** | `projectGithubItems` | `services/projects.mjs` + `/api/projects/:id/github` in `routes/projects.mjs` | Web view already in `main`; only the server route is missing. |
| 4 | **Worktree attachments** | `.agent-attachments` | `routes/projects.mjs` (`/api/worktrees/:id/attachments`) + fs write w/ symlink guard | Independent; carry the hardening (symlink/realpath, body cap, self-gitignore). |
| 5 | **Permission level → Codex sandbox** | `sandboxForPermission` | `services/invocations/dispatch.mjs` (map `permissionLevel` → policy) + `services/codex.mjs` / bridge-next (`--sandbox`) | Slots into existing codex + dispatch modules. |
| 6 | **Concurrency safety** | `reclaimStuckCancellations`, `invocationDirKey`, `isBridgeExecuted` | `services/invocations/dispatch.mjs` (`nextDispatchableInvocation` already lives there) | `main` has `device.maxConcurrency` but not the per-cwd guard / stuck-cancel reclaim / bridge-only counting. Additive hardening. |
| — | **Skills** | `createSkill`, `renderSkill` | ⚠️ COORDINATE | `main` is building its **own** skills (`tools/ai/src/loop/routine-skills.mjs`, `docs/…SKILLS…`). Do NOT port ours blindly. |
| — | **Automation scheduler** | `runDueAutomations` | ⚠️ COORDINATE | `main` has **loop-routines**; our `automations` overlaps. Decide which wins before touching. Note: `main`'s `automation-view.tsx` may still call `/api/automations` — a loose end in `main` itself. |

## `main`'s server pattern (the port target)

`runtime/http-server.mjs` builds the server from injected deps and dispatches by
calling `handleXRoutes({ req, res, url, sendJson, readJson, state, … })` per
domain (control-plane, loop-routines, projects, terminal, agents, codex,
integrations, m3), each returning `true` if it handled the request. State/services
are assembled in `runtime/state-factory.mjs` + `runtime/service-composer.mjs`;
the snapshot is `read-models/state.mjs buildPublicState({ state, … })`. **No auth
context exists yet** — feature #1 introduces `resolveActor(req)` and threads the
actor into the dispatch + `buildPublicState`.

## Recommended order

1. **#1 Identity auth/tenancy** — foundational, non-conflicting; establishes the port pattern + the actor other features attribute to.
2. **#2 Worktree diff**, **#3 Task github route**, **#4 attachments** — small, independent, web already present in `main`.
3. **#5 permission→sandbox**, **#6 concurrency safety** — additive to existing invocation/codex modules.
4. **Coordinate** on **Skills** and **Automation vs loop-routines** before porting either.

Each is one small PR off current `main`. Keep `feat/budgets-and-chargeback` as the
reference spec; nothing is rebased/merged.

## Web delta

`main`'s `apps/web/src` ≈ ours (only ~11 files differ, +336/−41). Net-new to port
**iff the backing feature is adopted**: `features/skills/skills-view.tsx`,
`features/projects/worktree-payload.ts`, plus small diffs in `task-view.tsx`,
`automation-view.tsx`, `console-state.ts`, `routes.tsx`.
