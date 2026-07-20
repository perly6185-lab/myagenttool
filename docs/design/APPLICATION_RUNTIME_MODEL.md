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

## Delivery Stages

1. Split Application and Runtime catalogs and add the compatibility field.
2. Persist local execution scope and Runtime requirements.
3. Derive one local, user-facing readiness state.
4. Complete local add, install, login, and registration setup.
5. Keep broken Applications visible and route repair through governed setup.
6. Add the built-in Markdown Application without an external Runtime.
7. Move new clients to Runtime install routes and retain explicit legacy aliases.
