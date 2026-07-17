# ADR 0018: Per-subject deletion of observability data erases CONTENT through the retention chokepoint, but shielded evidence is retained-of-record and only PII-redacted

Status: accepted · 2026-07-17

Date: 2026-07-17

Decision: Accepted, including the erasure-vs-retention policy (invariant 4):
observability CONTENT is erasable, shielded billing/compliance evidence is
retained-of-record. The engine, tenancy guard, route, and UI shipped
(#1192/#1193/#1195/#1197) and were hardened against cross-tenant deletion
(#1199). Follow-up (a) — PII-redaction of the shielded rows themselves — is now
BUILT: a subject deletion scrubs the subject's PII from its retained refusal
free text (summary / evidence / remedy) in place, keeping the record and its
taxonomy (invariant 4). One accepted follow-up remains NON-CODE: (b) a recorded
compliance/legal sign-off against invariant 4 before this backs a formal
Right-to-Erasure response. Scope note: ledger and audit-summary rows are
id/amount-keyed (no free-text subject PII), so refusals are the only shielded
carrier scrubbed today.

Related issue: [#1182](https://github.com/perly6185-lab/myagenttool/issues/1182)

## Context

`docs/vision/DATA_GOVERNANCE.md` envisions a three-tier subject deletion
(`delete_operational_data` / `delete_all_possible` / per-device cleanup), but
nothing implements it. `unlinkDevice`
(`apps/server/src/runtime/service-composer.mjs`) revokes credentials, offlines
the agent, and cancels in-flight invocations — it does **not** delete or redact
that device's historical observability data. The assessment (#1179) flagged this
gap.

The building blocks already exist:

- **Retention is a single chokepoint** (`apps/server/src/services/retention.mjs`)
  that reaps CONTENT in place past a window while keeping the skeleton, and
  explicitly SHIELDS evidence — the spend ledger, critical lifecycle audit,
  refusals, and audit summaries are never aged out (they carry their own count
  caps + shields).
- **Redaction is a single chokepoint** (`round-telemetry.mjs`) that scrubs
  secret- and PII-shaped tokens from digests at ingestion.
- **Tenancy scoping** already selects a subject's rows by `teamId` in the read
  models (`apps/server/src/read-models/state.mjs`).

Deletion is irreversible and compliance-sensitive: an erasure request (GDPR Art.
17) collides with the duty to retain financial/billing and security-audit records
(the very rows retention shields). This ADR ratifies that policy collision before
any delete code is written — there is no safe partial to ship first.

## Decision

**Per-subject deletion is a targeted, on-demand extension of the retention
chokepoint. It erases CONTENT for the subject; it does not delete shielded
evidence — instead it PII-redacts those records in place, keeping them
retained-of-record.** Seven invariants:

1. **One deletion path, reusing the retention primitives.** Deletion is
   "retention, scoped to a subject, run now" — the same reap-in-place that
   empties digests/prompts/responses/transcripts/rounds/tool records while
   keeping the skeleton. No second, divergent deletion engine.

2. **Scope is explicit: `team | user | device`, resolved through the existing
   tenancy scoping.** A deletion names its subject and tier; it never operates
   on "all rows" implicitly.

3. **Two tiers. `operational` erases content (digests, prompts, responses,
   transcripts, tool inputs/outputs, round/tool records' payload). `full`
   additionally removes the subject's events/traces/spans, leaving a tombstone
   count.** Neither tier touches the shielded set.

4. **Shielded evidence is retained-of-record, PII-redacted — never deleted.**
   The spend ledger, lifecycle audit, refusals, and audit summaries persist
   (billing/compliance duty). If they carry subject PII, deletion REDACTS that
   PII in place and stamps a redaction marker; the record and its bindings
   (hashes, ids, amounts) survive. This is the crux the ADR ratifies: erasure of
   *content and telemetry*, retention-of-record of *evidence*.

5. **Deletion is itself auditable.** Every run emits an
   `observability_data_deleted { scope, subjectId, tier, counts }` audit event —
   deletion must be provable, and that audit event is itself in the shielded set
   (a deletion cannot erase the proof that it happened).

6. **Owner-gated and idempotent.** Only an owner/admin (the existing control-plane
   RBAC) may invoke it; re-running for the same subject is a safe no-op on
   already-erased rows. It is bounded and best-effort — it never throws into a
   live request path.

7. **`unlinkDevice` does not auto-delete; deletion is a separate, deliberate
   action.** Offlining a device and erasing its observability history are
   distinct decisions with distinct authorization — unlinking stays reversible,
   deletion is explicit.

## Consequences

- A tenant/subject-erasure request is satisfiable for the content and telemetry
  that constitute personal data, while the billing and security-audit records the
  business must keep survive in PII-redacted form — the defensible middle between
  "delete everything" (breaks compliance retention) and "delete nothing" (breaks
  erasure rights).
- Reusing the retention + redaction chokepoints means deletion inherits their
  shield list and their tests; a new shielded collection is protected everywhere
  at once.
- The policy is legible: what is erasable vs retained-of-record is a single
  documented list, not scattered per-call decisions.
- Cost: implementing tier-`full` traversal + PII-redaction of shielded rows is
  the real work (~compliance-grade tests, audit proof). Deferred behind this ADR
  by design.

## Testable rules

- `operational` deletion for a subject empties that subject's digests/transcripts
  and keeps the skeleton; the shielded set (ledger/audit/refusals/audit
  summaries) is byte-unchanged except for PII redaction markers.
- `full` deletion additionally removes the subject's events/traces/spans and
  leaves a tombstone count; still no shielded row deleted.
- Every deletion emits exactly one `observability_data_deleted` audit event whose
  counts equal the rows changed; the event survives a subsequent deletion for the
  same subject.
- A non-owner caller is refused; a repeated deletion is a no-op (idempotent).
- No deletion path removes a spend-ledger, lifecycle-audit, refusal, or
  audit-summary row.
