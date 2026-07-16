# ADR 0014: A write-credential Application is a reviewed exception class, never a widened read credential

Status: proposed · 2026-07-16

Date: 2026-07-16

Related issue: [#1146](https://github.com/perly6185-lab/myagenttool/issues/1146)

## Context

The outbound-mail flow (#979, Phase 4) stops — by design — at an inert draft.
`mail-reply-draft.mjs` produces a review-confirmed draftbox row whose
`send.available` is `false`, and its header says why: *"sending itself is the
exfiltration boundary and is NOT built: it needs a second, separately consented
gmail.send credential (ADR 0010) plus approval (ADR 0011)."*

The registry currently makes that impossible on purpose.
`normalizeCredentialRequirement` (`services/applications.mjs`) refuses every
credential scope that is not read-only:

> Read-only by construction. A registration may not declare a write-capable
> scope: read and write authority never share a credential (ADR 0010), so a
> future send capability is a SECOND, separately consented credential — never a
> widening of this one.

So the promise exists ("a second credential") but the mechanism does not: there
is no way to register the Application that would hold it. Building `mail.send`
(#1147) therefore needs this decision first.

Three prior decisions frame the shape:

1. **ADR 0009** — descriptors are immutable; changing authority is a reviewed
   re-registration, never an edit.
2. **ADR 0010** — authorization is readiness, not a capability; secrets never
   enter the registry, state, or audit records.
3. **ADR 0011, rule 4** — send is the exfiltration boundary: approval-gated,
   human-reviewed with the source beside the draft, never automated.

## Decision

**A write-capable credential may be declared only by a distinct
write-credential Application, which is a reviewed exception class with four
structural invariants.** The read-only gate stays the default for every other
registration.

1. **Explicit class, explicit justification.** A registration declares the
   class with `credential.write: true` and a non-empty
   `credential.justification` string. Absent the flag, the existing read-only
   scope gate applies unchanged; present, the registration is refused unless
   every other invariant below holds (`application_write_credential_invalid`).

2. **Every capability approval-gated, by construction.** A write-credential
   registration is refused unless **all** of its capability facades declare
   `requiresApproval: true`. There is no such thing as a freely invokable
   capability holding write authority. (Refusal:
   `application_write_capability_unapproved`.)

3. **A separate Application, never a widening.** A write-credential Application
   must not share a credential `(provider, scope)` — nor its Application id —
   with any read Application. For mail: `app_gmail_send`
   (`google/gmail.send`) is a second registration beside `app_gmail`
   (`google/gmail.readonly`): two credentials, two consents, two lifecycle
   rows. Revoking send authority never degrades read intake, and vice versa.
   The descriptor-immutability rule (ADR 0009) already makes "widening" a
   re-registration; this rule says the re-registration may not even be the
   vehicle — the write authority lives in its own row.

4. **Dark until the operator lights it.** Capabilities of a write-credential
   Application are excluded from invocation while their feature flag is unset
   (`mail.send`: `MYAGENTTOOL_MAIL_SEND_ENABLED`, default OFF — the same
   posture as Claude apply and Codex exec). Discovery may show the capability
   with `readiness: disabled_by_flag`, so the surface is explainable without
   being invokable.

Consequences for `mail.send` specifically (contract sketch for #1147; the
implementing issue owns the details):

- Input is a **draftbox draft id only** — recipient, subject, threading headers
  and body are resolved server-side from the review-confirmed draft row
  (`confirmReplyDraft`). Free-form outbound content is structurally impossible,
  mirroring how the Claude apply gate accepts only a server-stored proposal
  artifact.
- Gates in order, all before dispatch: feature flag → draft exists and is
  `confirmed` and unsent (single-use) → single-use approval grant bound to
  `(mail.send, draftId)` → credential readiness on the send credential.
- The approval surface renders the fenced original mail **beside** the outgoing
  draft (ADR 0011 rule 4) — the reviewer sees what the reply answers.
- A dispatch that dies after the grant burned resolves loudly to
  `send_unconfirmed` (the apply-verify "unverified" posture): never silently
  sent, never silently lost.

## Consequences

- `normalizeCredentialRequirement` grows a reviewed branch instead of a
  loophole: the read-only refusal text stops being a dead end and points at
  this class.
- The Application review's "no approval-gated capability among the wired apps"
  observation inverts for this class: approval is the *floor*, not the
  exception.
- Channel providers are unaffected: they are transport (ADR 0012/0013), not
  Applications, and their outbound sends are governed by the channel delivery
  lifecycle, not by this class.
- Testable rules: refusal codes `application_write_credential_invalid`,
  `application_write_capability_unapproved`, credential-pair uniqueness
  refusal, and flag-dark discovery are all unit-assertable at registration
  time, before any runtime surface exists.
