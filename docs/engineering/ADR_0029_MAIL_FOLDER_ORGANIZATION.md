# ADR 0029: Provider folder organization is a separately consented, revision-bound write operation

Status: accepted, M5C/M5D addendum accepted · 2026-08-17

## Context

M5A can recommend a provider folder and persist a bounded, read-only preview. Creating a folder or moving mail changes the authoritative provider mailbox. Reusing the read Application or treating a preview as authorization would silently widen credentials and make stale classification results actionable.

## Decision

Provider folder organization uses a distinct write-credential Application with scope `imap.organize`. Its only capability is `mail_organize_batch`; it is high risk, approval-gated, not directly invokable, and dark unless `MYAGENTTOOL_MAIL_ORGANIZE_ENABLED=1`.

Manual execution follows these gates, in order:

1. The feature flag is enabled and the distinct organize credential is authorized.
2. The tenant-owned M5A preview exists, is unexpired, and is still `previewed`.
3. The server re-derives the suggestion from current mail state. Rule revision, destination, selected message keys, count, and fingerprint must still match the preview.
4. A human obtains a single-use approval grant bound to `mail.organize` and the preview revision/fingerprint target.
5. The provider receives only the server-stored destination and at most 50 server-selected message identifiers. The client cannot submit messages, source folders, or a free-form destination.

The provider tool may create one bounded root folder (`Subscriptions` or `Notifications`) when the preview proposed a new destination. System folders, control characters, traversal-like names, cross-account destinations, and moves to the current source are rejected.

The manual execution is single-use. A complete provider receipt marks it succeeded. A known refusal before change is failed and may be attempted only from a fresh preview and grant. A timeout, cancellation, missing receipt, or partial result is `unconfirmed`; the system never retries automatically and instructs the user to sync the mailbox before reviewing a new preview.

M5C adds a narrower standing authorization. It does not turn a classification rule into authority. The user must separately review an automatic preview and approve action `mail.organize.auto`; the server then persists a revision-bound automation record rather than retaining or replaying the approval token. Automatic execution is allowed only while both the local classification quality gate (at least 50 classified messages) and folder-operation quality gate (at least 10 completed batches with no more than 5% unconfirmed) are healthy. It runs only after a successful mailbox import, considers at most ten active rules, and moves at most ten currently eligible messages per rule and sync. Protected, manually corrected, important, action-required, and account-security mail remains excluded by the same server-side re-derivation used for manual previews. The user can pause or revoke the rule at any time.

M5D makes provider ambiguity explicit. Each job stores a bounded per-message outcome (`pending`, `moved`, `missing`, `conflict`, or `unknown`) using identifiers and source paths, without subject or body snapshots. Any partial receipt, ambiguous identifier, destination/rule revision conflict, provider failure, timeout, cancellation, or restart pauses the related automation and prevents automatic retry. After a fresh sync, reconciliation distinguishes messages already at the destination, messages still at their original source, messages moved elsewhere, and messages not visible locally. Only messages confirmed still at the original source may enter a new recovery preview; recovery remains a fresh, single-use `mail.organize` confirmation. Failure- or quality-paused automation requires a new explicit automatic authorization rather than a simple resume.

Audit records contain job, preview, rule, account, counts, destination, grant and invocation identifiers, but no subject or body snapshot. Jobs and previews are tenant-scoped and bounded by retention caps.

## Consequences

- Read and send continue working when organize permission is absent or revoked.
- A stale or replayed preview cannot move current mail.
- Manual result sets advance in explicit batches of at most 50; every batch needs a fresh preview and confirmation.
- Explicitly enabled, stable automatic rules process at most 10 messages after a sync and fail closed on any uncertainty.
- The last 50 jobs and their bounded per-message outcomes support an ordinary-user operation history and post-sync recovery without claiming an unsafe automatic retry.
- “Undo” is not claimed: moving back is another provider write and remains out of scope until it has its own reviewed design.
