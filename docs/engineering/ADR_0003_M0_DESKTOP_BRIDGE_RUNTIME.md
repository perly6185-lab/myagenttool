# ADR 0003: M0 Desktop Bridge Runtime

Status: accepted

Date: 2026-06-20

Related issue: [#13](https://github.com/perly6185-lab/myagenttool/issues/13)

## Context

The Desktop Bridge must run on macOS, Windows, and Linux, maintain an outbound
connection to the control plane, invoke local CLI and HTTP agents, stream
events, and attempt cancellation. Later milestones can add tray UI, native
credential storage, install/update flows, and richer local approval UX.

M0 needs a fast, testable bridge path more than final desktop packaging.

## Decision

Use a Node.js CLI/service-style Desktop Bridge for M0.

Keep platform-specific behavior behind small bridge service boundaries:

```text
process execution
process cancellation
local persistence
credential storage
filesystem paths
environment resolution
local approval prompts
```

M0 can use local file persistence and explicit development commands. Native
packaging, tray UX, auto-start, keychain integration, and signed installers are
deferred until later milestones.

## Rationale

Node.js is the best M0 bridge runtime because:

- The repo already uses a TypeScript/Node monorepo.
- Protocol types can be shared with server and web.
- Structured argv execution is available without shell strings.
- The current local demo bridge already runs as a Node process.
- It keeps the first remote invocation loop small enough to finish.

Tauri, Electron, or native implementations may become useful for tray,
notifications, approval dialogs, and packaging, but they would slow the first
reliable invocation loop.

## Consequences

Positive:

- Fast implementation path for CLI/HTTP agent invocation.
- Easy local smoke testing across server, web, and bridge.
- Shared protocol package remains the contract.

Tradeoffs:

- Cross-platform process-tree cancellation needs careful wrappers.
- Credential storage is not production-grade in the first M0 slice.
- User-facing local approval prompts may start as terminal prompts or explicit
  local configuration before native UI exists.

## M0 Implementation Constraints

- Execute CLI agents with structured argv, not shell command strings.
- Keep process cancellation behind a platform service.
- Persist bridge identity and delivery cursor through an abstraction, even if
  M0 storage is a local JSON file.
- Redact local env and command details from logs unless explicitly safe.
- Report cancellation failure as an auditable outcome.

## Acceptance Impact

This ADR unblocks:

- Device registration.
- Manual CLI agent registration.
- Desktop Bridge reconnect and cursor resume.
- Local process execution and cancellation testing.
