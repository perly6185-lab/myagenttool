# ADR 0010: An external Application's authorization is readiness, not a capability

Status: accepted · 2026-07-14

Date: 2026-07-14

Related issue: [#974](https://github.com/perly6185-lab/myagenttool/issues/974)

## Context

Mail intake (an inbox transcribed into issues, issue outcomes drafted back into
replies) introduces the first Application whose execution depends on an
**external credential** — a Gmail OAuth refresh token — rather than on a local
binary. Every executable Application so far (git, ccusage, claude) needs nothing
but a program on the device's PATH.

Two facts frame the decision:

1. **The MCP path carries no secrets, by construction.**
   `normalizeMcpAdapterConfig` (`packages/adapters/src/mcp.mjs`) admits only
   `transport`, `command`, `args`, `allowedTools`, and `timeoutMs` — **no `env`**
   — and the bridge's `buildMcpChildEnv` (`apps/desktop/src/mcp-client.mjs`)
   injects only the non-secret `SAFE_MCP_ENV_KEYS`. CLI agents *do* accept an
   `env` (`environmentPolicy: explicit_only`); the MCP adapter deliberately does
   not. There is today no path by which a credential reaches an MCP server
   through registration.
2. **ADR 0009 makes descriptors immutable.** A credential carried *in* the
   descriptor would make every token rotation a re-registration, and would place
   the secret in the registry, in persisted state, and beside every audit record
   the capability produces.

The question this ADR settles: is *authorizing* a credentialed Application —
obtaining the OAuth token — **a capability the control plane invokes**, or **a
precondition the control plane observes**?

## Decision

**An external Application's authorization is readiness, not a capability. The
control plane never mints, transports, stores, or reads an external credential.**

Four rules follow.

**The secret lives with the process that uses it.** The credential is held by the
MCP server, in the device's OS credential store, established out of band by the
user (a one-time browser consent). The registration payload contains no secret,
and the server-side descriptor holds none. The `env` gap in the MCP adapter
config is a property to preserve, **not** a gap to close.

**Authorization is probed and refused precisely, never performed.** This is the
same shape #802 gave a missing binary: the device resolves `git` the way `spawn`
would and refuses with `binary_unavailable` instead of an opaque exit 127. An
absent or revoked token refuses with `not_authorized` and the exact next action
("run the login flow on device `<id>`") — the platform explains the missing
precondition; it does not satisfy it.

**The descriptor pins the credential's authority, not the credential.** The OAuth
scope (`gmail.readonly`) is part of the immutable contract. **Widening scope is a
re-registration; rotating the secret is not.** Permission change is reviewed;
key rotation is free. Those are different events and this splits them cleanly.

**Read authority and write authority never share a credential.** Sending mail
later means a *second*, separately consented credential under its own scope
(`gmail.send`) — never a widened one. This mirrors the two-allowlist invariant:
the moment it feels convenient to collapse them into one token is exactly the
failure mode the split exists to prevent.

Under ADR 0008 the resulting `app_gmail` is a **non-executable, `manual`-source
Application**: it projects no `bridge_wrapper`, spawns no binary, and needs no
device-allowlist entry. It is therefore user-registerable.

## Consequences

- Authorization failures become first-class lifecycle states. A token revoked in
  the Google account fails the probe, the Application health-degrades to
  `offline`, and recovery names the device and the command to run — the
  convergence path in `docs/design/APPLICATION_RECOVERY_CONVERGENCE.md`, with no
  new machinery.
- The audit trail cannot leak a credential it never held.
- Rotating a token requires no control-plane change and no re-registration.
- myagenttool ships credentialed Applications **without** a secret store. If one
  is ever introduced, it must not become a path for the control plane to read a
  credential it does not need.
- Bootstrap (Google Cloud project, consent screen, OAuth client, one `--login`
  run) stays outside the product. Accepted: it is a one-time, human-at-browser
  action, and it is the only moment a credential comes into existence. Keeping it
  outside is the property, not a shortfall.
- Cost: the console cannot offer a one-click "Connect Gmail" button. Accepted.

### Known limit

`gmail.readonly` grants read access to the **whole mailbox**; Gmail's OAuth
scopes have no per-label granularity. Restricting intake to an
`myagenttool/intake` label is **discipline inside the MCP server, not a boundary
Google enforces**. A hard boundary requires a dedicated intake mailbox that the
user's filters forward into, whose token can only read that mailbox. Recorded
here so the label filter is never mistaken for a security control.

### Not settled here

Application capabilities today execute as `tool_facade` (delegating to a governed
Tool) or `bridge_wrapper` (spawning a binary). An Application capability backed
by a registered **Agent** has no execution mode yet. That gap is general — it
blocks any MCP agent from being adopted by an Application, not just mail — and is
tracked separately.

## Alternatives considered

- **`authorize` as an Application capability (option B):** the console runs the
  OAuth flow and stores the resulting token. Rejected. It puts the control plane
  on the credential-minting path: the invocation record, result import, and
  evidence ledger would all sit adjacent to a live token, making "just return it"
  or "just cache it" a structural temptation rather than a discipline held by a
  rule. It is also inherently interactive — a human consenting in a browser —
  which the fire-and-forget invocation model does not fit.
- **Credential in the descriptor, via `env` passthrough on the MCP adapter
  (option C):** rejected. Secrets would enter the registry, persisted state, and
  audit records, and under ADR 0009 every rotation would become a
  re-registration.
- **A Gmail App Password over IMAP instead of OAuth (option D):** rejected as the
  default. An App Password grants IMAP **and** SMTP — it is full account access,
  so "read-only" would rest on our promise not to call send. `gmail.readonly`
  cannot send at all. The scope, not our restraint, is the boundary.
