# Tenancy Route Matrix

Audit of every mutating server route against the project/team tenancy model, so
cross-team write guards stop being applied ad hoc. Companion regression tests:
`apps/server/test/{tenancy,control-plane-tenancy,codex-tenancy,m3-tenancy}.test.mjs`.

Status: the P1.2 pass (this stack) closed GAP-1, set the 403→404 policy, and
guarded the codex + m3 invocation/project-scoped writes. Remaining ❓ rows are
recorded decisions or scoped follow-ups, not open holes.

## End-to-end validation

`apps/server/test/integration/tenancy-http.test.mjs` boots the real http server
(the `src/index.mjs` composition) with `MYAGENT_REQUIRE_AUTH=1` and a hand-seeded
second team, then drives it over actual HTTP as team B against team A's
resources. It proves the guards and read-scoping hold through the whole dispatch
stack — not just the pure-function unit tests: the auth gate (401), read scoping
(projects + imported evidence hidden), and every guarded write path (automations,
m3 ai-usage, budgets, invocation cancel/troubleshoot, codex approval-broker) all
refuse the foreign team, while the owner succeeds. Run:
`pnpm --filter @myagenttool/server test:integration`.

> **Reachability.** The server-side multi-user plumbing now exists and is
> validated end-to-end: `POST /api/teams`, `POST /api/users`, multi-user login
> (`POST /api/session {userId}`), and project creation defaulting `ownerTeamId`
> to the creator's team. `multi-user-plumbing.test.mjs` provisions two tenants
> through these real APIs and confirms isolation holds. **Credential check (9A)
> landed:** users can carry a scrypt `passwordHash`; `/api/session` verifies the
> password before minting a token (wrong/missing → 401), closing login-as-anyone
> for credentialed users; the passwordless seeded dev user stays frictionless;
> hashes are never exposed (session response + public state stripped). **Web
> login (9B) landed:** the client already carried a bearer token with transparent
> dev auto-login; the Topbar now has a credentialed sign-in/sign-out control
> (`loginWithCredentials`/`logout` in `api-client.ts`) so you can authenticate as
> a specific user with a password. **Provisioning RBAC (9C) landed:** only an
> owner/admin may `POST /api/teams|users` (operator/viewer → 403); the seeded
> local owner keeps single-user dev working. **M2 (real auth) is complete** —
> tenancy now engages end-to-end for real, credentialed users.

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
| invocations | POST `/api/compare-runs` | invocation | ➖ reviewed — no hole: child invocations inherit the creator's current project (own team), reads scoped `byCompareRun` (#192), agents are device-level (not team-partitioned) |
| control-plane | POST/DELETE `/api/session` | ➖ auth | ➖ |
| control-plane | PATCH `/api/device` | device | ➖ |
| control-plane | PUT/POST `/api/budgets` | project | ✅ `denyForeignProject(body.projectId)` |
| control-plane | POST `/api/automations` | project | ✅ |
| control-plane | POST `/api/automations/:id/run` | project | ✅ `denyForeignProject(automation.projectId)` |
| control-plane | PATCH/DELETE `/api/automations/:id` | project | ✅ **GAP-1 fixed** — guard + regression test |
| projects | POST `/api/projects`, `/clone`, `/create` | project (create) | ➖ creation assigns owner |
| projects | POST `/api/worktrees` | project | ✅ (worktree create paths guarded) |
| projects | POST/PATCH/DELETE `/api/projects/:id[/…]` | project | ✅ (9 guarded sites) |
| projects | POST `/api/worktree-name-suggestion` | none | ➖ reviewed — only slugifies `body.description`, reads no project state |
| codex | POST `/api/codex/approval-broker/:id/(approve\|deny)` | invocation | ✅ scoped by `request.invocationId`'s project |
| codex | POST `/api/codex/change-reviews` | invocation | ✅ foreign evidence rejected with the same 400 as unknown (existence-hidden, no leak) |
| codex | POST `/api/codex/hooks` | bridge | ➖ codex CLI / bridge ingestion, not a user surface |
| codex | POST `/api/codex/imported-evidence` | team | ✅ stamps `actor.userId`/`teamId` at creation; team-scoped in `buildPublicState` |
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
- **Not-found body standardization (existence-hiding).** `denyForeignProject`
  now takes a `notFound` body and each resource route passes its own not-found
  string, so the "exists but foreign" 404 is byte-identical to that route's
  "missing" 404 — the two are indistinguishable. Applied to the resource-scoped
  guards: invocations (`invocation_not_found`), automations run + PATCH/DELETE
  (`automation_not_found`), all project sub-routes (`project_not_found`), codex
  approval-broker (`codex_approval_request_not_found`). Body-supplied-projectId
  guards (invocations/budgets create, m3 ai-usage) keep the generic body — no
  sibling resource-not-found to mirror. A drift-guard test asserts
  foreign-body === missing-body (`control-plane-tenancy.test.mjs`).
- **codex imported-evidence read leak (found + fixed).** Imported-evidence rows
  carry no `invocationId`, so `invVisible` treated them as globally visible and
  team A's rows (summary, repoPath) leaked into team B's public state — both
  directly (`codexImportedEvidenceRecords`) and via two aggregated read models
  (`evidenceCenterRecords`, `codexApprovalQueue`) that were built from raw state
  and re-exposed invocation-linked evidence too, bypassing `byInvocation`. Now
  imported rows are stamped with an owning `teamId` at creation and scoped by it;
  the evidence center and approval queue re-apply scoping (invocation rows by
  `invVisible`, imported by team). Covered by `public-state-codex-scope.test.mjs`.
- **Unknown/dangling projectId now denied.** `denyForeignProject` treats a
  provided-but-unknown projectId the same as a foreign one (404), so a route can
  scope a write on the guard alone without a paired existence check. A null
  projectId stays a no-op (legit fallbacks) and a null actor is a pass-through
  (never dereferenced). Pinned by `tenancy.test.mjs`.
- **compare-runs / worktree-name-suggestion reviewed — no hole.** compare-run
  child invocations inherit the creator's current project (own team) and reads
  are scoped `byCompareRun`; agents are device-level, not team-partitioned.
  worktree-name-suggestion only slugifies `body.description` and reads no state.

## Resolved: identity pass (attribution)

`actor` is now threaded into the service layer so who-did-it fields record the
acting user (`actor?.userId`), falling back to `usr_local` only for non-route
callers (scheduler, self-check, seed, device-unlink bulk cleanup):

- **invocations** — `requestedBy` on create/compare/troubleshoot, `decidedBy`/
  `approver` on approve/deny, cancel `requestedBy`. `createInvocation` also honors
  `options.requestedBy`, so the scheduler's `automation.createdBy` (previously
  dropped) now sticks.
- **m3** — `recordAiUsage` userId/teamId, `createQuotaPolicy` subjectId, lifecycle
  recipe/audit `requestedBy`, `decideLifecycleLocalApproval` decidedBy; internal
  lifecycle/rollback actions inherit `recipe`/`rollback.requestedBy`; the
  invocation ledger entry uses `invocation.requestedBy`.
- **codex** — managed session userId, change-review reviewedBy; a foreign-team
  evidence record is now rejected with the same `400` as a missing one, closing
  the change-reviews **400-vs-404 status leak**.
- **integrations** — discovery/artifact `requestedBy`; probe runs inherit the
  artifact's.
- **agents** — registration stamps `ownerUserId` from the actor.

Verified via self-check + `smoke:local` + the tenancy unit suite (all green).

**Left by decision (not actor bugs):** `costOwner` across agents/integrations is
an economics "who pays" default, distinct from "who acted", and stays economics-
configured. **Remaining tail (2 sites, deeper plumbing):** terminal session
`userId` (device-scoped; needs `actor` threaded through http-server) and the
agent lifecycle-operation `requestedBy` (multi-layer through enable/disable/
update). Both fall back to `usr_local` today.

## Remaining order

1. **Real auth + web login** (the last mile for product multi-tenancy): a web
   login UI that stores + sends a bearer token, credential verification on
   `/api/session` (replace login-as-anyone), and RBAC on team/user provisioning.
   The server APIs and guards are done and validated; this is the client + auth.
2. Team-level cost allocation → **spend rollup landed** (`teamBudgetStatuses`
   aggregates per-project ledger spend by owning team, team-scoped in public
   state). Follow-ups: team budget *limits* (pool cap + over) and revisiting the
   m3 operator-level objects + agent-skills tenancy.

Done since the audit: GAP-1 + the 403→404/existence-hiding policy, codex/m3/
automation write guards, the codex read-leak fix, the unknown-projectId guard,
the full identity pass (incl. the terminal/lifecycle-op tail), server-side
multi-user plumbing, and unit + end-to-end integration coverage.
