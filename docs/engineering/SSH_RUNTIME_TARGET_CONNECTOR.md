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

The report may be `blocked`, `needs_review`, or `ready_for_manual_test`.
This phase does not perform a live SSH handshake.

## Risk Notes

- Unknown host trust must not be auto-accepted.
- Agent forwarding can expose signing capability to a remote host and should
  require explicit administrator review.
- Default SSH agent key selection may be ambiguous; explicit key references are
  preferred for governed targets.
