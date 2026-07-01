# Tenancy Route Matrix

Audit of every mutating server route against the project/team tenancy model, so
cross-team write guards stop being applied ad hoc. Snapshot base: `origin/main`
@ `21a0d71`. Companion regression tests: `apps/server/test/tenancy.test.mjs`.

## Model recap

Tenancy only bites when `MYAGENT_REQUIRE_AUTH=1` **and** a second team exists;
in default local dev every check collapses to "allow". But resource ids are
enumerable, so any scoped write left unguarded is reachable cross-tenant once
those two conditions hold. Guards operate on **three different axes** — a route
is only a gap if it is unguarded on the axis its resource actually belongs to:

- **project/team** — resource carries a `projectId` / `ownerTeamId`. Write guard:
  `denyForeignProject({ ..., projectId })` ([runtime/auth.mjs](../../apps/server/src/runtime/auth.mjs)). Read scope: `buildPublicState`.
- **device** — resource belongs to a linked device (terminals, ssh targets).
  Guarded by device ownership, deliberately *not* project-scoped (see #192).
- **bridge** — the desktop bridge posts back over a bridge/device credential;
  not a user-tenancy surface.

## Matrix (mutating endpoints)

Legend: ✅ guarded · ❌ **GAP** · ➖ N/A on this axis · ❓ needs model decision.

| Route file | Endpoint | Axis | Status |
|---|---|---|---|
| invocations | POST `/api/invocations` | project | ✅ `denyForeignProject(body.projectId)` |
| invocations | POST `/api/approvals/:id/(approve\|deny)` | project | ✅ via `invocationProjectId` |
| invocations | POST `/api/invocations/:id/cancel` | project | ✅ |
| invocations | POST `/api/invocations/:id/troubleshoot` | project | ✅ |
| invocations | POST `/api/compare-runs` | agent | ❓ no project scope; reads are scoped by visible child invocations, agents are team/device-level — confirm agent visibility |
| control-plane | POST/DELETE `/api/session` | ➖ auth | ➖ |
| control-plane | PATCH `/api/device` | device | ➖ |
| control-plane | PUT/POST `/api/budgets` | project | ✅ `denyForeignProject(body.projectId)` |
| control-plane | POST `/api/automations` | project | ✅ |
| control-plane | POST `/api/automations/:id/run` | project | ✅ `denyForeignProject(automation.projectId)` |
| control-plane | **PATCH/DELETE `/api/automations/:id`** | project | ❌ **GAP-1 (high)** |
| projects | POST `/api/projects`, `/clone`, `/create` | project (create) | ➖ creation assigns owner |
| projects | POST `/api/worktrees` | project | ✅ (worktree create paths guarded) |
| projects | POST/PATCH/DELETE `/api/projects/:id[/…]` | project | ✅ (9 guarded sites) |
| projects | POST `/api/worktree-name-suggestion` | project | ❓ confirm it never leaks foreign project data |
| codex | POST `/api/codex/hooks` | project/worktree | ❓ **review** — codex sessions bind to worktrees; unguarded write |
| codex | POST `/api/codex/approvals/:id` | project/worktree | ❓ **review** |
| codex | POST `/api/codex/imported-evidence` | project/worktree | ❓ **review** |
| codex | POST `/api/codex/change-reviews` | project/worktree | ❓ **review** |
| agent-skills | POST/PATCH/DELETE `/api/agent-skills[/:id]` | ❓ team? global? | ❓ **review** — decide if skills are a team-scoped library |
| m3 | POST `/api/m3/ai-usage` | invocation | ❓ **review** — usage rolls into ledger/budget; reads scoped, writes unguarded |
| m3 | POST `/api/m3/{private-catalog,signed-bundles,lifecycle-recipes,quota-policies}` | ❓ org/platform? | ❓ **review** — decide the tenancy owner of M3 lifecycle objects |
| m3 | PATCH `/api/m3/private-deployment`, POST `/api/m3/audit-export` | ❓ org | ❓ **review** |
| terminal | POST `/api/ssh-targets`, `/api/terminal/sessions`, input/resize/close | device | ➖ device-scoped by design (#192) |
| terminal | POST `/api/bridge/terminal-events` | bridge | ➖ |
| agents | POST `/api/agents`, `/api/bridge/register`, `/api/device/unlink` | device/agent | ➖ device/agent-scoped |
| bridge | POST `/api/bridge/*` (next/complete/ack/events/…) | bridge | ➖ bridge credential |

## Confirmed gaps and fixes

### GAP-1 (high) — `PATCH`/`DELETE /api/automations/:id` is unguarded

[routes/control-plane.mjs](../../apps/server/src/routes/control-plane.mjs) resolves the automation by enumerable id
and then deletes or mutates it with no ownership check, while the sibling
`POST /api/automations/:id/run` *is* guarded. A second team can delete another
team's scheduled automation, or PATCH its `prompt` / `agentId` / `projectId` /
`enabled` — i.e. repoint and re-enable someone else's scheduler to run an
arbitrary prompt. Reachable cross-tenant with `MYAGENT_REQUIRE_AUTH=1`.

Fix — mirror the `/run` guard right after the not-found check:

```js
if (!automation) { sendJson(res, 404, { error: "automation_not_found" }); return true; }
if (denyForeignProject({ res, sendJson, state, actor, projectId: automation.projectId })) return true;
```

Add a route-level regression test alongside it (two teams, PATCH/DELETE a
foreign automation → 403; note the info-leak decision below).

## Open decisions (not yet gaps, need a call)

- **`denyForeignProject` returns 403, not 404.** 403 "forbidden" confirms the
  resource exists to a cross-team caller; with enumerable ids that leaks
  existence. Decide project-wide: existence-hiding 404 vs explicit 403.
  (Pinned by `denyForeignProject: a foreign team is blocked with 403`.)
- **Unknown/dangling projectId is allowed through.** Fine only because every
  current caller pairs the guard with a not-found check. Any future route that
  scopes a write solely on this guard would have a hole.
  (Pinned by `denyForeignProject: an unknown projectId is currently allowed through`.)
- **codex / agent-skills / m3 tenancy owner is undefined.** These write paths
  have no project guard because their tenancy axis was never decided. Pick the
  owning axis per object (project, team, or global/platform) before adding or
  omitting guards, and record it here.

## Suggested order (P1.2)

1. Fix **GAP-1** (+ route test). Smallest, clearest, highest severity.
2. Decide the **403-vs-404** policy and apply uniformly in `denyForeignProject`.
3. Resolve the **codex** review items — most likely worktree/project-scoped.
4. Decide **agent-skills** and **m3** tenancy ownership; guard or document as global.
