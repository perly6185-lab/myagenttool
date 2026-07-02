# Near-term backlog plan (2026-07)

Execution plan for the backlog opened after the tenancy + identity workstream
(#209–#213). Ordered by dependency × value × risk. CI (#213) is deferred on
runner cost, so local tests are the only gate — tests come before features.

```
#212 broaden tests  →  #209 real auth (3 phases)  →  #211 adapters  →  #210 team cost allocation
        └─ #213 CI slots in the moment runner cost is approved (small, high-leverage)
```

## M1 — Foundations (in progress)

- **#212 Broaden hermetic unit tests** — worktree naming/normalization
  (`apps/server/test/worktree-naming.test.mjs`) and the loop-engine's
  sanitization/id primitives (`tools/ai/test/routine-utils.test.mjs`) are done;
  next, cover worktree lifecycle (create/teardown/diff) and loop promotion-gate
  decisions. Zero decisions, low risk, locks behavior before feature work.
- **#213 Activate CI** — `ci.yml` add a `pull_request` trigger + flip
  `ENABLE_GITHUB_HOSTED_RUNNERS` + branch protection. ~30 min once cost approved.

## M2 — Make tenancy engage (#209, the capstone)

The tenancy guards are validated but dormant (auth off + login-as-anyone). Three
phases:

- **9A server credential verification (S–M, backend).** Add a credential
  (`passwordHash` / dev token) to users; `/api/session` verifies before minting a
  token (replaces login-as-anyone); seed the local user with a dev credential.
  Extend `multi-user-plumbing.test.mjs` to log in with real credentials.
- **9B web login + token (M, frontend).** A login screen → `/api/session` → store
  the bearer token → inject `Authorization` at the single choke point
  (`apps/web/src/lib/api-client.ts`); 401 → login. Then tenant isolation is
  visible in the UI.
- **9C provisioning RBAC (S, backend).** Role checks on `POST /api/teams|users`
  (owner/admin only) + minimal team/user management in the web.

## M3 — Ecosystem adapters (#211, parallelizable with M2)

- **11A MCP bridge live client (M–L, desktop).** A live client in `apps/desktop`:
  open the stdio/http transport, `tools/list`, send `tools/call` via the existing
  `packages/adapters/src/mcp.mjs` descriptor, stream MCP notifications into the
  invocation event model, map cancellation to `$/cancelRequest`. Register an MCP
  server as an agent end-to-end.
- **11B A2A + container contract slices (S–M each).** Same declarative shape as
  the MCP slice (contract + config normalization + descriptor + unit tests) in
  `packages/adapters`; bridge-side clients follow.

## M4 — Team-level cost allocation (#210, after #209)

Only meaningful once real teams exist. Extend budgets from project-level to team
pools (`budgetPoolId` already exists on projects/ledger): aggregate spend by
team, team budget status, team chargeback; revisit the m3 operator-level objects'
team ownership. Extend `apps/server/test/economics.test.mjs`.

## Suggested start

M1 #212 (no decisions, locks behavior), while the CI cost decision is made; then
M2 #209 — the payoff that makes the whole tenancy line real.
