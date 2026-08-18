# ADR 0027: Fetched mail is an immutable, account-scoped RFC 822 archive on the local device

- Status: Proposed
- Date: 2026-08-14
- Issue: [#1686](https://github.com/perly6185-lab/myagenttool/issues/1686)
- Extends: [ADR 0026](ADR_0026_LOCAL_CONTENT_LIBRARY.md)

## Context

The mail read path already downloads an entire RFC 822 message when a user opens it, parses bounded text and safe-preview HTML, and then discards the original bytes. Attachment metadata is retained, but each preview, download, inline image, or task copy downloads and parses the provider message again. This makes a previously read message incomplete offline and makes provider availability look like local attachment availability.

Background mailbox sync intentionally retrieves only headers. Archiving every message during that sync would turn a bounded metadata operation into an unbounded content download, surprise users with storage growth, and widen the external-data intake boundary.

## Decision

### 1. Explicit message fetch is the archive boundary

When a user opens a message and `mail_fetch` retrieves its IMAP `source`, the mail runtime atomically preserves those exact bytes as `message.eml`. Header-only folder sync remains header-only. Existing cached messages are archived once when opened again; a failed archive does not discard the already parsed body and exposes an explicit unavailable reason.

The RFC 822 file is the one authoritative mail original. Attachments remain MIME parts inside it and are not copied into separate files merely for indexing. Preview, download, inline-CID display, and task-copy parse the verified local original first. Legacy messages with no archive reference retain the provider-backed path.

### 2. References are opaque and account-scoped

The archive root is the private application-data mail directory. Its physical shape is:

```text
mail/archive/
  <account-sha256-prefix>/
    mailarc_<account-key>_<message-key>/
      manifest.json
      message.eml
```

Both directory keys are SHA-256 derivations over bounded identity fields. They contain no mailbox address, folder name, Message-ID, subject, or attachment filename. The server and renderer receive only the opaque `mailarc_...` reference, version, SHA-256, byte size, timestamp, attachment count, and availability. Absolute paths and raw RFC 822 bytes never enter server state.

### 3. Writes are immutable and atomic; reads verify integrity

The runtime writes private files in a sibling temporary directory and renames the complete record into place. Re-fetching identical bytes is idempotent. If the same identity resolves to different bytes, or if the existing file size/hash no longer matches its manifest, access fails closed as an integrity error; the runtime does not overwrite the evidence or hide the mismatch with a provider fallback.

Every directory and file below the managed root must be a regular non-symlink object. All paths are derived from validated references and confined below the resolved archive root. Files use owner-private modes where the operating system supports them.

### 4. Capacity is conservative and retention is non-destructive by default

- One RFC 822 original is limited to 50 MiB.
- The managed archive is limited to 2 GiB by default.
- Crossing either limit leaves existing archives untouched and records an explicit unavailable state for the new message.
- There is no age-based or account-removal deletion in this slice. Removing credentials or rebuilding/deleting the search index does not remove originals.
- A future cleanup flow must first produce a stable preview naming the exact archive references, count, bytes, and reason, then require an explicit confirmation bound to that preview before deletion.

Archive data is user-sensitive and must be included only in backups that the user treats as mailbox data. This slice relies on the current OS user/profile and volume protections, just as the other managed application data does; it does not claim application-layer encryption. Introducing encryption, key rotation, cloud backup, or automatic retention requires a follow-up security decision and migration plan.

### 5. Parsed state and the derived catalog remain bounded

The server continues to store bounded parsed text/HTML and attachment metadata as untrusted data. An available archive changes the local-content mail record from `state_record`/partial to `managed`/ready with MIME type `message/rfc822`; the derived catalog still does not contain original bytes or expose content hashes as ordinary UI fields. Deleting or rebuilding the catalog cannot delete an archive.

Remote images remain blocked by default, HTML remains sanitized and sandboxed, executable attachment types remain non-previewable, and mail text is never interpreted as an instruction.

## Consequences

### Positive

- Opened mail and its MIME attachments remain usable when the provider is offline.
- A single verified original supports body reconstruction and every attachment operation without duplicate attachment storage.
- Availability is explicit from the archive receipt rather than guessed from attachment metadata.
- Existing header sync, provider read-state behavior, and outbound authorization remain unchanged.

### Tradeoffs

- Only explicitly fetched messages become offline originals; headers alone are not offline-complete.
- MIME parsing still happens for each local attachment operation, trading CPU for simple immutable storage and no duplicate bytes.
- The fixed quota can leave a fetched body available while its original is unavailable until the user addresses capacity.
- Application-layer encryption and cleanup UX remain required follow-up work before broader multi-account or managed-backup rollout.

## Rejected alternatives

- **Archive every message during folder sync:** rejected because it makes a bounded background action download unbounded hostile content.
- **Store each attachment as a second authoritative file:** rejected because it duplicates bytes and introduces consistency/deletion ambiguity.
- **Place archive paths in server state:** rejected because the control plane and renderer do not own unrestricted device paths.
- **Silently replace a hash-mismatched original:** rejected because corruption or Message-ID collision must remain visible and recoverable.
