# Application and Runtime Model

Tracked by #1342.

## Decision

MyAgentTool presents user-facing Applications. An Application belongs to the
current desktop instance only; it is not a cross-machine or fleet object. A
Runtime is an internal, local executable or environment required by that
Application.

- Codex and Claude are Applications backed by Agent CLI runtimes.
- Git and ccusage are Applications backed by tool runtimes.
- Markdown is a built-in Application and requires no external runtime.
- Git Bash and WSL are shell runtimes. They are not Applications.

Users install, add, open, and repair Applications. Runtime identifiers,
executable selection, and shell implementation details remain internal except
in advanced diagnostics.

## Lifecycle

Application registration and Runtime installation are independent. Removing an
Application does not uninstall its Runtime. A registered Application remains
visible when its Runtime is absent, unauthenticated, stale, or unavailable on a
selected device.

There is no preferred-device binding, remote Application installation, or
cross-device failover. Existing device collections are infrastructure
compatibility and do not define Application identity.

For an Application backed by a Runtime, setup follows this sequence:

1. Select the Application for this computer.
2. Prefer an existing supported system Runtime.
3. Use or install an approved bundled fallback when needed.
4. Complete local authentication when required.
5. Verify readiness and register or enable the Application.

## Compatibility

`Device.runtimeReadiness` is canonical. During migration, Desktop Bridge and
the server also publish `applicationBinaryReadiness` with the same sanitized
rows so older clients continue to work. New clients read the canonical field
first and fall back to the legacy alias.

Readiness reports contain normalized status, version, and authentication method
only. Tokens, account identifiers, raw command output, and executable paths are
not part of the public device state.

## Setup state machine (Stage 4)

Adding a runtime-backed Application walks a single local state machine, derived
from the Stage 3 readiness by the pure `setupNextStep(application, device)`
(`services/application-readiness.mjs`). It names the ONE next step toward a ready
+ registered Application:

| Next step | When | Action |
|---|---|---|
| `start_bridge` | the local Desktop Bridge is offline | start the bridge |
| `install` | a required runtime is absent (never installed) | approve a governed install plan |
| `login` | the runtime is installed but not signed in | run the server-owned `loginCommand`, then re-check |
| `repair` | the runtime is stale (installed but broken) | repair |
| `register` | the runtime is ready (or none needed) and the app is not yet registered | register / enable |
| `ready` | ready and already registered | done |

Properties:

- **Server-authoritative, local only.** Steps derive from the current device's
  readiness — no remote install, no cross-device failover. The `loginCommand` is
  owned by the Runtime Catalog, never hardcoded in the client.
- **Resumable, never stuck.** `login`, `install`, `repair`, and `start_bridge` are
  steps with a remediation action and a re-check, not terminal failures. The
  machine is a pure re-derivation over readiness, so re-checking after any local
  change (sign-in, install, bridge start) simply advances it; a mid-flow bridge
  drop re-derives to `start_bridge` rather than a stuck state.
- **Install → register auto-advances.** A succeeded governed install run
  re-detects readiness and, when ready, registers without a manual retry.

## Delivery Stages

1. Split Application and Runtime catalogs and add the compatibility field.
2. Persist local execution scope and Runtime requirements.
3. Derive one local, user-facing readiness state.
4. Complete local add, install, login, and registration setup.
5. Keep broken Applications visible and route repair through governed setup.
6. Add the built-in Markdown Application without an external Runtime.
7. Move new clients to Runtime install routes and retain explicit legacy aliases.
