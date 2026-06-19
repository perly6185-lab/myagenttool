# Invocation Delivery

M0 must support reliable invocation delivery across temporary Desktop Bridge
disconnects.

Users may create invocations while a target device is offline. The server queues
the invocation and dispatches it automatically when the Desktop Bridge
reconnects.

## Core Rules

- Users can create invocations for offline devices.
- Offline invocations are stored in the server queue.
- The Desktop Bridge uses an outbound realtime connection.
- On reconnect, the bridge announces its device id and last acknowledged
  delivery cursor.
- The server dispatches pending invocations for that device.
- The bridge acknowledges received invocations only after durable local
  acceptance, or the server protects dispatch with a lease and redelivery rule.
- Cancellation must be delivered to the bridge.
- If a local process is already running, cancellation must be propagated to the
  adapter and local process when supported.
- All delivery, acknowledgement, start, cancel, and completion events are
  recorded for audit and trace.

## Queue Semantics

The server owns the authoritative invocation queue.

Queued invocations should include:

- Invocation id.
- Device id.
- Agent id.
- Requested user id.
- Status.
- Idempotency key.
- Created time.
- Dispatch attempts.
- Last dispatch time.
- Timeout policy.
- Cancellation state.

The bridge may keep a local cache for resilience, but it is not the source of
truth.

## Delivery States

Canonical delivery, invocation, cancellation, and unlink states are defined in
[STATE_MACHINE.md](STATE_MACHINE.md).

This document describes delivery behavior, but it should not define a separate
state enum.

## Offline Flow

```text
1. User creates invocation for an offline device.
2. Server validates permission.
3. Server stores invocation as queued.
4. Web Console shows queued and device offline.
5. Desktop Bridge reconnects.
6. Bridge sends device identity and last acknowledged cursor.
7. Server dispatches pending invocations.
8. Bridge durably accepts the invocation and acknowledges delivery.
9. Bridge applies local policy and invokes the agent.
10. Bridge streams events and final result.
```

## Cancellation Flow

```text
1. User cancels an invocation.
2. Server marks cancellation requested.
3. If invocation is queued, server marks it cancelled.
4. If invocation was dispatched, server sends cancel to bridge.
5. Bridge forwards cancel to adapter.
6. Adapter cancels HTTP request or local process when supported.
7. Bridge reports cancelled or cancel_failed.
8. Server records final status and audit event.
```

## Local Process Cancellation

CLI adapters must support cancellation as a first-class operation.

Platform-specific behavior should be isolated in the bridge:

- macOS/Linux: signal process group when possible.
- Windows: terminate process tree when possible.
- PTY-backed agents may need adapter-specific cancellation.

If graceful cancellation fails, the bridge may escalate to forced termination
according to local policy.

## Idempotency

Every invocation should have an idempotency key.

The bridge should treat duplicate delivery of the same invocation id as a retry,
not as a new task. If the invocation is already running or finished, the bridge
should report the current known state.

## Expiration and Timeout

Queued invocations should support:

- Queue expiration.
- Execution timeout.
- Dispatch retry limit.

If an invocation expires before the device reconnects, it should move to
`expired` and should not run automatically.

## Device Unlinking

If a device is unlinked:

- Pending queued invocations for that device must be cancelled.
- Future dispatch to that device must be blocked.
- If the bridge is reachable, running invocations should receive cancellation.
- Audit should record the unlink decision and queue cleanup result.

See [DATA_GOVERNANCE.md](DATA_GOVERNANCE.md) for device-related data handling.

## M0 Boundary

M0 should implement:

- Server-side queued invocations.
- Offline device invocation creation.
- Reconnect dispatch.
- Delivery acknowledgement.
- Invocation cancellation before execution.
- Best-effort cancellation of running CLI and HTTP invocations.
- Idempotent delivery by invocation id.

Later milestones can add:

- Priority queues.
- Concurrency limits per device.
- Retry policies per agent.
- Dead-letter queues.
- Human approval queues.
- Distributed queue infrastructure for SaaS scale.
