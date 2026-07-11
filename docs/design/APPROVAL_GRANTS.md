# Approval Grants — a real issuance flow for approvalToken (one page)

Status: DRAFT for review · 2026-07-11 · replaces the intent-marker token (the follow-up the code
has promised itself since the applications slice: "a real approval-issuance flow is follow-up")

## Problem

Every side-effecting application action (lifecycle, generate, wrapper commands, autonomy config,
approval-gated recovery) is "gated" by `approvalToken` — but the check is `token non-empty` (or
`startsWith("operator-approved")` for recovery). The web console hard-codes
`console-operator-confirmed`. Consequences: any API caller inside the tenancy boundary passes the
gate with any string (no deliberate-intent proof); one leaked/guessed string approves everything
forever (no scoping, no expiry, no single-use); and the audit trail records that a token was
present, not that a specific human approved a specific action.

## Design: server-issued, single-use, action-scoped grants

A new `approvalGrants` store + one endpoint + one validation helper. **Not cryptography** —
tenancy/session remain the authorization boundary (unchanged claim); grants add what the marker
never had: intent-binding, single-use, expiry, and a decision record.

1. **Issue**: `POST /api/approvals/grants { action, targetId }` → `{ grantId, token, expiresAt }`.
   The token is a random 128-bit id, stored server-side as
   `{ id, tokenHash, action, targetId, issuedBy (actor), teamId, issuedAt, expiresAt, consumedAt: null, consumedBy: null }`.
   TTL **10 minutes**: a grant is a confirm-click artifact, not a work queue (the Approvals-queue
   requests keep their own 24h window — different object, different job).
2. **Consume**: the existing `approvalToken` request field now carries the grant token. The
   validation helper looks it up (hash match) and requires: not expired, not consumed,
   `action` matches the endpoint's action, `targetId` matches the resource, and the consuming
   actor's team matches the issuing team. On success the grant is stamped
   `consumedAt/consumedBy` — **single-use** — and the action's audit event links `grantId`.
3. **UI**: `ConfirmModal`'s confirm handler becomes two calls — issue a grant for
   `(action, targetId)`, then invoke the action with the returned token. Same two-click UX;
   the modal click IS the approval, now recorded as one.
4. **Broker decisions mint grants** (closes the internal magic string): when a parked recovery
   approval is approved in the Approvals queue, the resolution mints a grant bound to that
   decision (`sourceDecisionId`), and `executeApprovedApplicationRecoveryAction` consumes it —
   replacing the hard-coded `"operator-approved-application-recovery"`. One audit chain:
   broker request → human decision → grant → execution.
5. **System actors never mint free grants.** Auto-recovery/health-probe remain unable to cross
   an approval gate: grant issuance requires a human actor (or an explicit broker decision as
   in 4). The issuance endpoint rejects system attribution.

## Migration (two phases, breakage-free)

- **Phase 1 (this slice)**: dual-accept. The validator first tries grant lookup; a legacy
  free-text token still passes but the audit event is stamped `approval: "legacy_token"` and a
  `governance` counter tracks legacy usage (the same honesty pattern as DORA's "not recorded").
  Web console + internal callers switch to issued grants immediately; tools/tests migrate via a
  test helper that mints grants through the real endpoint.
- **Phase 2 (separate slice, after legacy usage reads zero)**: `autoRunSettings.requireIssuedApprovals`
  flips strict — legacy tokens get 409 `approval_required` with a pointer to the issuance
  endpoint. Off by default until the counter says it's safe.

## Non-goals

- Cryptographic signatures, external IdP, or per-user permission tiers — tenancy stays the
  authz boundary; this slice is about intent, replay, and audit.
- Changing the Approvals-queue (broker) machinery — it already records real decisions; grants
  make its decisions *executable* without magic strings.
- Multi-approval / quorum policies (possible later on the same store: `requiredGrants: 2`).

## Test/verify plan

Issue→consume happy path (single-use: second consume 409s); expiry 409s; wrong action / wrong
target / cross-team 409; system-actor issuance rejected; legacy token passes in phase 1 with the
`legacy_token` audit stamp + counter increment; broker-approve mints a decision-linked grant and
recovery execution consumes it (no magic string left); web modal flow drives issue+consume over
real HTTP. Live drive: enable strict mode, replay a captured token → 409.
