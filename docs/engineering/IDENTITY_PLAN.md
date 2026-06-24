# Identity / Auth / Tenancy Plan

Date: 2026-06-24

Scope: introduce a real actor (user + team) behind every request, invocation,
ledger entry, approval, and audit record, replacing the ~27 hardcoded
`usr_local` literals in `apps/server/src/index.mjs`.

This is the #1 architectural gap from `BACKEND_ARCHITECTURE_REVIEW.md`: without
identity the governance and economics value props are "architecturally
undecidable" — audit can't attribute, budgets/chargeback can't isolate tenants,
and any caller of `/api/approvals/:id/approve` "is" `usr_local`. It is also the
foundation the project layer + budgets/chargeback (this branch) silently depend
on: per-project chargeback currently attributes all spend to one constant user.

## Current state

- No auth anywhere: the server has no `Authorization` parsing, no token, no
  session. Any request to `:3001` is treated as `usr_local`.
- `UserId`/`TeamId`/`MembershipId` types exist (`packages/protocol/src/common.ts`)
  but there are no `User`/`Team`/`Membership` entities in server state.
- The Bridge establishes a device↔user relationship at `POST /api/bridge/register`
  but issues no credential.
- The web `request()` (`apps/web/src/lib/api-client.ts`) sends no auth header.
- 27 `usr_local` literals: seed config (device/agents `ownerUserId`,
  `economics.costOwner`), invocation `requestedBy`, approval `decidedBy`, audit
  requester, cancellation/unlink `requestedBy`.

## Design: one resolution point

Collapse identity to a single choke point so the token *source* can change later
without touching call sites.

```js
function resolveActor(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const rec = token && state.tokens.find((t) => t.token === token && t.expiresAt > Date.now());
  // Phase 1: fall back to the seeded user when there is no token (behaviour-
  // preserving). Phase 2: return null here and the route answers 401.
  const user = rec ? findUser(rec.userId) : findUser("usr_local");
  return { userId: user.id, teamId: user.teamId };
}
```

### Model additions (server `state`)

```js
users:  [{ id: "usr_local", name: "Local User", teamId: "team_local" }]
teams:  [{ id: "team_local", name: "Local Team" }]
tokens: []   // { token, userId, expiresAt } — populated in Phase 2
```

`Project.ownerTeamId` already exists, so cost attribution binds naturally to the
project's team.

## The 27 `usr_local` sites

| Category | Example sites | Replace with |
|---|---|---|
| Seed config | device / agents `ownerUserId`; `economics.costOwner` defaults | keep `usr_local` seed (it *is* the seeded user) |
| Invocation start | `requestedBy: "usr_local"` (createInvocation + platform-agent paths) | `actor.userId` (threaded via options) |
| Cost owner | ledger / agent `costOwner` | `project.ownerTeamId` first, else `actor.teamId` |
| Approval / audit | approval `decidedBy`, audit requester | `actor.userId` |
| Cancellation / unlink | `requestedBy: "usr_local"` | `actor.userId` |

Mechanical change: each mutating route starts with `const actor = resolveActor(req);`
and threads `actor` into `createInvocation` / approval / ledger helpers.

## Web side

- `request()` adds `Authorization: Bearer <token>` from a stored token
  (localStorage), no-op when absent.
- Token source (Phase 2): `POST /api/session` (local dev login returning the
  seeded user's token) or reuse a token issued at Bridge registration.

## Phasing

### Phase 1 — make identity flow (high value, zero behaviour change)
- Add `users`/`teams` seed + `resolveActor` (no-token fallback to seed) + `findUser`.
- Replace the ~21 "action" `usr_local` literals with `actor.userId` / `actor.teamId`.
- **`costOwner` derives from the project's `ownerTeamId`** → per-project budgets
  and chargeback become per-team, with the data model finally correct.
- Risk: near-zero. Single-user output is identical; attribution underneath is now
  real.

### Phase 2 — authentication
- Issue tokens at Bridge register / `POST /api/session`; `resolveActor` requires a
  valid token (else 401); the web sends it.
- Requests are now authenticated.

### Phase 3 — tenancy / authorization
- Scope `/api/state`, projects, budgets, approvals by `actor.teamId`; approvals
  verify the actor is allowed to approve.
- Multi-tenant isolation is now real.

## Why Phase 1 first

It turns the already-built project/budget/chargeback work from "demo" into
"attributable per team" with essentially no regression risk, and leaves Phases
2–3 (the security hardening) as additive, well-bounded follow-ups.

## Out of scope (for now)

Real OIDC/SSO, password storage, RBAC roles, per-route permission matrices — all
slot in behind `resolveActor` later. Bridge trust-boundary enforcement
(architecture review gap #3) is tracked separately.
