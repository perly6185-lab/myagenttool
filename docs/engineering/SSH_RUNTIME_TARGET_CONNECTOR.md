# SSH Runtime Target Connector

Phase G defines the SSH target layer before remote PTY relay work.

## Product Boundary

- Owner surface: Setup / Runtime management.
- Primary roles: team administrator and advanced developer.
- Remote relay PTY is not enabled in this phase.
- SSH targets are not managed terminal evidence until a later relay registration
  phase binds runtime events to the terminal registry.

## Target Schema

An SSH target records:

- `host`
- `port`
- `user`
- `authMethod`: `ssh_agent`, `private_key_ref`, `password_ref`, or
  `managed_identity`
- `credentialRef`: external secret or SSH agent reference only
- `knownHostPolicy`: `strict`, `pinned_fingerprint`, or `manual_review`
- `knownHostFingerprint`
- `workspaceRoot`
- `platformHint`
- `agentForwarding`
- `keySelection`

## Credential And Redaction Rules

- MyAgentTool stores credential references, not plaintext private keys or
  passwords.
- `credentialStorage` is `external_reference_only`.
- Logs and UI may show host, port, user, auth method, and credential reference.
- Logs and UI must not show private key material, password values, or raw
  secret payloads.

## Connection Test Report

`POST /api/ssh-targets/:id/test` creates a preflight report covering:

- host and port shape
- credential reference availability
- host verification and fingerprint policy
- workspace root
- platform hints
- agent forwarding risk
- key selection risk
- remote relay disabled state

The report may be `blocked`, `needs_review`, or `ready_for_manual_test`. This
legacy runtime-target report remains static for compatibility and does not
perform a live SSH handshake.

The reviewed file-transfer connector is exposed separately through
`/api/hosts`. Its flow is:

1. `POST /api/hosts/:id/observe-fingerprint` performs an unauthenticated SSH
   handshake and returns the observed host fingerprint.
2. `POST /api/hosts/:id/confirm-fingerprint` requires the exact just-observed
   fingerprint and the current target revision.
3. `POST /api/hosts/:id/verify` resolves the process-local credential, enforces
   the pinned fingerprint, authenticates, and probes SFTP capabilities.

This governed connection does not enable a shell, arbitrary SSH arguments,
agent forwarding, or remote PTY relay.

## Governed File Ranges

Verified file-transfer hosts may expose one or more governed ranges through
`/api/hosts/:id/file-scopes`. A range is accepted only after each root component
passes remote `lstat`, the final `realpath` exactly matches the requested
dedicated directory, and the host remains pinned and SFTP-ready.

`GET /api/host-file-scopes/:id/entries?path=...` accepts relative paths only,
rechecks the root and every child component on each request, and returns bounded
metadata. Symbolic links and special files are visible as inaccessible entries;
they are never followed.

Administrators can independently grant `upload` and `download` on a range.
Every transfer requires an explicit confirmed request and is recorded as
team-owned metadata without retaining file bytes. Uploads are capped at 10 MB,
written to a mode-`0600` same-directory staging file, and renamed only after a
complete write. The default conflict policy keeps both files; replacement also
requires an explicit overwrite confirmation and advertised atomic rename support.
Downloads are capped at 25 MB, regular-file-only, returned as `attachment` with
`nosniff`, and block common credential/key filenames. Both directions retain a
SHA-256 receipt, progress, attempt linkage, and sanitized failure code. Remote
deletion and shell execution remain disabled.

## Risk Notes

- Unknown host trust must not be auto-accepted.
- Agent forwarding can expose signing capability to a remote host and should
  require explicit administrator review.
- Default SSH agent key selection may be ambiguous; explicit key references are
  preferred for governed targets.
