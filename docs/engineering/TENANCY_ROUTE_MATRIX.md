# Tenancy Route Matrix

Audit of every mutating server route against the project/team tenancy model, so
cross-team write guards stop being applied ad hoc. Companion regression tests:
`apps/server/test/{tenancy,control-plane-tenancy,codex-tenancy,m3-tenancy}.test.mjs`.

Status: the P1.2 pass (this stack) closed GAP-1, set the 403→404 policy, and
guarded the codex + m3 invocation/project-scoped writes. Remaining ❓ rows are
recorded decisions or scoped follow-ups, not open holes.

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

Legend: ✅ guarded · ➖ N/A on this axis · 📌 decided (documented, no guard) · 🔭 scoped follow-up.

| Route file | Endpoint | Axis | Status |
|---|---|---|---|
| invocations | POST `/api/invocations` | project | ✅ `denyForeignProject(body.projectId)` |
| invocations | POST `/api/approvals/:id/(approve\|deny)` | project | ✅ via `invocationProjectId` |
| invocations | POST `/api/invocations/:id/cancel` | project | ✅ |
| invocations | POST `/api/invocations/:id/troubleshoot` | project | ✅ |
| invocations | POST `/api/compare-runs` | agent | 🔭 no project scope; reads scoped by visible child invocations — confirm agent visibility |
| control-plane | POST/DELETE `/api/session` | ➖ auth | ➖ |
| control-plane | PATCH `/api/device` | device | ➖ |
| control-plane | PUT/POST `/api/budgets` | project | ✅ `denyForeignProject(body.projectId)` |
| control-plane | POST `/api/automations` | project | ✅ |
| control-plane | POST `/api/automations/:id/run` | project | ✅ `denyForeignProject(automation.projectId)` |
| control-plane | PATCH/DELETE `/api/automations/:id` | project | ✅ **GAP-1 fixed** — guard + regression test |
| projects | POST `/api/projects`, `/clone`, `/create` | project (create) | ➖ creation assigns owner |
| projects | POST `/api/worktrees` | project | ✅ (worktree create paths guarded) |
| projects | POST/PATCH/DELETE `/api/projects/:id[/…]` | project | ✅ (9 guarded sites) |
| projects | POST `/api/worktree-name-suggestion` | project | 🔭 confirm it never leaks foreign project data |
| codex | POST `/api/codex/approval-broker/:id/(approve\|deny)` | invocation | ✅ scoped by `request.invocationId`'s project |
| codex | POST `/api/codex/change-reviews` | invocation | ✅ scoped by evidence → `invocationId`'s project |
| codex | POST `/api/codex/hooks` | bridge | ➖ codex CLI / bridge ingestion, not a user surface |
| codex | POST `/api/codex/imported-evidence` | user | 🔭 free-standing record, hardcodes `usr_local`, no invocation/project link — needs the real per-actor identity pass |
| agent-skills | POST/PATCH/DELETE `/api/agent-skills[/:id]` | global | 📌 **decided: global library** — records carry no `ownerTeamId`; revisit if team-scoped skills are needed (add owner + read scope + write guard) |
| m3 | POST `/api/m3/ai-usage` | project | ✅ `denyForeignProject(body.projectId)` — cost attribution to ledger/budget |
| m3 | POST `/api/m3/{private-catalog,signed-bundles,lifecycle-recipes,quota-policies}` | org/operator | 📌 **decided: operator-level** — no per-team owner today; revisit at M3 team-level cost allocation |
| m3 | PATCH `/api/m3/private-deployment`, POST `/api/m3/audit-export` | org/operator | 📌 **decided: operator-level** |
| terminal | POST `/api/ssh-targets`, `/api/terminal/sessions`, input/resize/close | device | ➖ device-scoped by design (#192) |
| terminal | POST `/api/bridge/terminal-events` | bridge | ➖ |
| agents | POST `/api/agents`, `/api/bridge/register`, `/api/device/unlink` | device/agent | ➖ device/agent-scoped |
| bridge | POST `/api/bridge/*` (next/complete/ack/events/…) | bridge | ➖ bridge credential |

## Resolved in the P1.2 pass

- **GAP-1 (high) — `PATCH`/`DELETE /api/automations/:id`.** Was unguarded while
  the sibling `/run` was guarded, so a foreign team could delete or repoint
  (`prompt`/`agentId`/`projectId`/`enabled`) another team's scheduled automation.
  Fixed by mirroring the `/run` guard; covered by `control-plane-tenancy.test.mjs`.
- **403 → 404 existence-hiding.** `denyForeignProject` now answers a generic
  `404 { error: "not_found" }` instead of `403 { error: "forbidden" }`, so an
  enumerating cross-team caller can't confirm which ids exist. Applied uniformly
  (single choke point); pinned by `tenancy.test.mjs`.
- **codex invocation-scoped writes.** approval-broker approve/deny and
  change-reviews are now guarded by their invocation's project; `codex-tenancy.test.mjs`.
- **m3 ai-usage.** Guarded by `body.projectId` (cost attribution); `m3-tenancy.test.mjs`.

## Open decisions / follow-ups

- **Unknown/dangling projectId is allowed through** `denyForeignProject`. Safe
  today only because every caller pairs the guard with a not-found check; a
  future route that scopes a write solely on this guard would have a hole.
  (Pinned by `denyForeignProject: an unknown projectId is currently allowed through`.)
- **Not-found body standardization.** The 404 the guard emits (`{error:"not_found"}`)
  still differs in shape from each route's own not-found body (e.g.
  `automation_not_found`), a residual existence signal. Standardize not-found
  responses so a foreign resource is byte-for-byte indistinguishable from a
  missing one.
- **codex identity pass.** The codex subsystem hardcodes `usr_local`
  (`reviewedBy`, `userId`); `imported-evidence` has no project link. The two
  guards added here are consistent with the invocations routes, but full codex
  tenancy needs real per-actor identity, not just project scoping.
- **compare-runs / worktree-name-suggestion.** Confirm agent visibility and that
  no foreign project data leaks; guard if needed.

## Remaining order

1. Not-found body standardization (turns the 404 policy into true existence-hiding).
2. codex identity pass (`imported-evidence`, hardcoded `usr_local`).
3. compare-runs / worktree-name-suggestion confirmation.
4. Team-level cost allocation → revisit m3 operator-level objects and agent-skills.
