# Application and Runtime Model

Tracked by #1342.

## Decision

MyAgentTool presents user-facing Applications. A Runtime is an internal,
device-local executable or environment required by an Application.

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

For an Application backed by a Runtime, setup follows this sequence:

1. Select the Application and target device.
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
