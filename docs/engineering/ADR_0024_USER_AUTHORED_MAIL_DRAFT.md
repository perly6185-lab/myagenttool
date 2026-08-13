# ADR 0024: User-authored mail is a revision-bound server draft before it can cross the send gate

Status: accepted · 2026-08-13

Date: 2026-08-13

Related issue: [#1662](https://github.com/perly6185-lab/myagenttool/issues/1662)

## Context

ADR 0014 originally limited outbound mail to a reviewed reply draft derived
from an imported message. A normal mailbox also needs a human user to write a
new message from scratch, save it, edit it, and send it later. Passing the form
fields directly to the send capability would weaken the stored-artifact rule
and would allow approved content to change after review.

The product also needs incomplete drafts to be recoverable while preserving the
existing tenant, credential, approval, and provider-receipt boundaries.

## Decision

**A human-authored outbound email becomes a tenant-scoped, revisioned,
server-side draft before it can be reviewed or sent.**

1. The mailbox draft API accepts bounded plain-text fields and may persist an
   incomplete draft. It stamps the authenticated actor's team and never stores
   provider credentials.
2. Editing a draft increments its revision. The single-use approval target is
   `(mail.send, draftId@revision)`, so any edit after review invalidates the old
   approval.
3. The send route still accepts only a draft id and approval token. Recipient,
   subject, threading fields, and body are resolved from the stored draft; no
   outbound free text crosses that route.
4. The send service rejects incomplete, foreign-team, non-draft, disabled, or
   uncredentialed attempts before dispatch. Read and send credentials remain
   separate Applications under ADR 0014.
5. The ordinary-user UI displays the exact recipient, subject, and full body
   immediately before approval. When send permission is unavailable, saving is
   allowed but the review/send action is disabled with a plain-language next
   step.
6. AI and unattended runs do not gain a direct send path. They may prepare a
   draft, but a human must perform the revision-bound review and approval.

## Consequences

- Users can compose and recover ordinary drafts without learning the internal
  approval model.
- Approval is coupled to what the user actually reviewed, not just the identity
  of an editable record.
- Drafts become persisted user data and therefore require tenant isolation,
  retention policy, bounded storage, and deletion support.
- Rich text and attachments need their own content-safety and storage decision;
  this first slice remains plain text.
- Legacy reviewed reply drafts without a revision keep their historical
  `draftId` approval target for compatibility.
