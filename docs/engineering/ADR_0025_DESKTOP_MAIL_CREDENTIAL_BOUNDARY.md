# ADR 0025: Mail credentials cross only a narrow desktop IPC boundary and are verified before local persistence

Status: accepted · 2026-08-13

Date: 2026-08-13

Related issue: [#1665](https://github.com/perly6185-lab/myagenttool/issues/1665)

## Context

The ordinary-user mailbox needs an in-product connection assistant. Existing
163 Mail setup was secure but required a PowerShell command, while moving its
authorization code through the Web API would expose a provider credential to
the renderer, control plane, request logs, and persisted server state.

The application registry may also contain a successor revision of the original
mail application. Reconnection must report readiness for the active revision
instead of creating a duplicate registration.

## Decision

**Mailbox authorization material crosses only a provider-specific Electron
preload IPC method and is never sent to the control-plane API.**

1. The renderer receives provider availability and non-secret account metadata
   only. It submits the 163 address and authorization code through a narrow,
   context-isolated preload method.
2. Electron validates bounded input and performs a real read-only IMAP login
   before persisting anything. A failed test writes neither credential nor
   readiness sidecar.
3. On Windows, the authorization code is encrypted for the current OS user via
   DPAPI. Plaintext is supplied to PowerShell over stdin, never argv, the
   environment, registration bodies, or logs.
4. The control plane receives only the agent/application descriptor. The
   Desktop Bridge receives only a non-secret readiness sidecar under ADR 0010.
5. Reconnection discovers the current provider application from the
   provider-neutral mailbox model and writes readiness for that exact revision.
6. Receive and send readiness are separate. The product cannot display receive
   as connected without an authorized device report, and cannot imply sending
   is available before its separate credential and test exist.

## Consequences

- Ordinary Windows users can connect 163 Mail without commands or protocol
  fields while retaining the existing local credential boundary.
- Browser-only sessions can explain the desktop requirement but cannot handle
  or inspect the authorization code.
- Gmail OAuth and outbound SMTP remain separate provider work; the UI labels
  them unavailable instead of presenting a false successful connection.
- Packaging must include the mail MCP runtime and its IMAP/parser dependencies.
- Other operating systems require an equivalent OS credential-store adapter
  before this assistant can be enabled there.
