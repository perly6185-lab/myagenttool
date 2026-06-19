# M0 Desktop Bridge And Agent Registration

This document records the executable M0 bridge and manual agent registration
behavior.

## Scope

M0 bridge behavior covers:

- One outbound Desktop Bridge device registration.
- Server-side manual CLI agent registration.
- Server-side manual HTTP agent registration.
- Structured argv execution for CLI agents.
- Stdout and stderr streaming as invocation events.
- HTTP success and failure result mapping.
- Running CLI cancellation propagation through the bridge.
- HTTP cancellation through server-side request aborts.
- Device unlink with credential revocation and queued-work cancellation.

## Current Implementation Boundary

The current bridge is a local demo process. It keeps the same M0 protocol shape
that later durable bridge implementations should preserve, but it does not yet
store device credentials in OS credential stores or run as a native service.

The default `demo-agent` command is a safe built-in target for smoke tests.
Manually registered CLI agents still execute through structured argv and do not
use shell strings.

## Required Semantics

- Device registration records bridge version, capabilities, online status, and
  last-seen time.
- Device unlink marks the device unlinked, records credential revocation, blocks
  new dispatch, and cancels queued local invocations.
- CLI registration captures command, arguments, working directory policy,
  environment policy, timeout, risk, data, cost, and cancellation notes.
- HTTP registration captures base URL, request path, auth mode, timeout,
  payload shape, streaming support, and cancellation notes.
- CLI invocation streams stdout and stderr as events and maps exit code to
  terminal invocation status.
- Cancellation requested for a running CLI invocation is forwarded to the local
  process tree where the platform supports it.
- HTTP invocation maps non-2xx responses to failed invocations.

## Verification

The following checks cover this stage:

```text
pnpm --filter @myagenttool/protocol typecheck
pnpm --filter @myagenttool/adapters test
pnpm --filter @myagenttool/server test
pnpm --filter @myagenttool/desktop test
pnpm smoke:local
pnpm docs:check
pnpm repo:check
pnpm typecheck
pnpm test
git diff --check
```

`pnpm smoke:local` covers offline reconnect dispatch, manual CLI registration,
manual HTTP registration, HTTP success/failure mapping, and running CLI
cancellation.

## Cross-Platform Boundary

The Desktop Bridge isolates process-tree cancellation by platform:

- Windows uses `taskkill /pid <pid> /t /f`.
- macOS and Linux use a detached process group and `SIGTERM`.

The CI workflow includes a dedicated `desktop-smoke` matrix for Ubuntu, macOS,
and Windows so cancellation behavior has platform-specific evidence.
