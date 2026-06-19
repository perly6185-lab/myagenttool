# M0 Core Protocol And Service Loop

This document records the executable M0 core behavior implemented after the
architecture ADR baseline.

## Scope

M0 core service behavior covers:

- Shared protocol vocabulary for M0 invocation, delivery, cancellation, and
  required event states.
- Invocation creation from a plain-language task.
- Server-owned queued delivery for offline devices.
- Reconnect dispatch to the Desktop Bridge.
- Dispatch lease and redelivery semantics.
- Delivery acknowledgement after bridge acceptance.
- Cancellation for queued and running invocations.
- Invocation event log.
- Trace and root span creation.
- Audit summary creation.

## Current Implementation Boundary

The current server implementation is an in-memory local M0 loop. It is enough to
validate protocol semantics and local smoke behavior, but it is not the final
durable persistence adapter.

The accepted storage direction is defined in
[ADR 0004](ADR_0004_M0_SERVER_STORAGE_QUEUE.md): a Node.js server with a
relational persistence boundary and database-backed queue records.

## Required Semantics

- Creating an invocation stores it as `queued` with delivery state `queued`.
- The Desktop Bridge can reconnect after an invocation was created offline.
- Dispatch increments `dispatchAttempts`, records `lastDispatchAt`, and sets a
  lease expiration.
- If a dispatch lease expires before acknowledgement, the invocation returns to
  the queue as `redelivering`.
- Acknowledgement moves delivery to `acknowledged`, clears the lease, and starts
  the invocation.
- Repeated acknowledgement is idempotent.
- Terminal completion creates an audit summary and completes the root span.
- Queued cancellation marks the invocation `cancelled` and records
  `queued_cancelled`.

## Verification

The following checks cover this stage:

```text
pnpm --filter @myagenttool/protocol test
pnpm --filter @myagenttool/server test
pnpm smoke:local
pnpm docs:check
pnpm repo:check
pnpm typecheck
pnpm test
git diff --check
```

`pnpm smoke:local` now creates an invocation before the Desktop Bridge starts,
then verifies it dispatches after bridge registration.

## Follow-up Boundary

Later implementation work should replace in-memory state with the persistence
boundary from ADR 0004 while preserving the same external API and state
semantics.
