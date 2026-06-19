# State Machine

This document is the canonical state vocabulary for invocation delivery,
cancellation, and device unlinking.

The goal is to avoid mixing business state, transport state, cancellation state,
and data-governance state in one field.

## State Ownership

### Invocation Status

`Invocation.status` describes the user-visible lifecycle of one request to one
agent.

It answers:

```text
What is the overall result of this invocation?
```

### Delivery State

`Invocation.delivery.state` describes transport to a target bridge, endpoint, or
adapter.

It answers:

```text
Has the target received this work reliably?
```

### Cancellation State

`Invocation.cancellation.state` describes a cancellation request and its
outcome.

It answers:

```text
Was cancellation requested, delivered, and applied?
```

### Device Unlink State

`Device.unlinkState` describes whether a device can receive new work and how its
related data is being handled.

It answers:

```text
Can this device still receive dispatch, and what cleanup is in progress?
```

## Invocation Statuses

```text
created
authorized
rejected
queued
dispatching
waiting_for_local_approval
running
cancelling
succeeded
failed
cancelled
timed_out
expired
```

Suggested transitions:

```text
created -> authorized
created -> rejected

authorized -> queued
authorized -> dispatching

queued -> dispatching
queued -> cancelling
queued -> cancelled
queued -> expired

dispatching -> waiting_for_local_approval
dispatching -> running
dispatching -> failed
dispatching -> cancelling

waiting_for_local_approval -> running
waiting_for_local_approval -> rejected
waiting_for_local_approval -> cancelling

running -> succeeded
running -> failed
running -> timed_out
running -> cancelling

cancelling -> cancelled
cancelling -> failed
```

Terminal invocation statuses:

```text
rejected
succeeded
failed
cancelled
timed_out
expired
```

## Delivery States

```text
not_required
queued
dispatching
delivered
acknowledged
redelivering
delivery_failed
expired
```

`not_required` applies when the gateway invokes a direct remote endpoint and no
local bridge delivery is needed.

Suggested transitions:

```text
not_required -> not_required

queued -> dispatching
queued -> expired

dispatching -> delivered
dispatching -> delivery_failed
dispatching -> redelivering

delivered -> acknowledged
delivered -> redelivering

acknowledged -> acknowledged

redelivering -> dispatching
redelivering -> delivery_failed
```

## Delivery Acknowledgement

`acknowledged` must mean:

```text
The Desktop Bridge has durably accepted the invocation and can recover or report
its state after a local restart.
```

If the bridge cannot persist local receipt, it should not acknowledge delivery
before execution. In that mode the server should rely on a dispatch lease and
redeliver if no later event arrives.

Recommended delivery fields:

```text
deliveryId
deviceId
state
idempotencyKey
leaseExpiresAt
dispatchAttempts
lastDispatchAt
acknowledgedAt
bridgeCursor
```

## Cancellation States

```text
none
requested
queued_cancelled
dispatched
acknowledged
applied
failed
not_supported
```

Suggested transitions:

```text
none -> requested

requested -> queued_cancelled
requested -> dispatched
requested -> not_supported

dispatched -> acknowledged
dispatched -> failed

acknowledged -> applied
acknowledged -> failed
```

Cancellation behavior:

- If the invocation is still queued, cancellation should move it to
  `cancelled` without dispatching it.
- If the invocation was delivered or is running, the server sends cancellation
  to the bridge or adapter.
- If the adapter supports cancellation, it should cancel the HTTP request,
  subprocess, process group, or process tree when possible.
- If cancellation fails, the final invocation status may become `failed` or may
  continue until the underlying agent reports a terminal state.
- Every cancellation attempt should produce audit and trace events.

## Device Unlink States

```text
linked
unlink_requested
unlinking
unlinked
archived
deletion_requested
deleted
unlink_failed
```

Suggested transitions:

```text
linked -> unlink_requested
unlink_requested -> unlinking
unlinking -> unlinked
unlinking -> archived
unlinking -> deletion_requested
deletion_requested -> deleted
unlinking -> unlink_failed
```

Immediate effects of `unlink_requested`:

- Block new dispatch to the device.
- Cancel pending queued invocations for the device.
- Attempt cancellation of running invocations if the bridge is reachable.
- Revoke or rotate device credentials.
- Record the user's data handling decision.

Device unlink data handling choices are defined in
[DATA_GOVERNANCE.md](DATA_GOVERNANCE.md).

## Device Unlink Operation

The control plane should store a device unlink operation instead of only storing
the final device state.

Recommended fields:

```text
operationId
deviceId
requestedBy
dataDisposition
localBridgeDisposition
queuedInvocationCount
queuedCancellationResult
runningCancellationResult
credentialRevocationResult
auditRetentionReason
status
createdAt
completedAt
```

Supported `dataDisposition` values:

```text
keep_history
archive_history
delete_operational_data
delete_all_possible
```

## Required Events

The event stream should be able to represent:

```text
invocation_created
invocation_authorized
invocation_rejected
delivery_queued
delivery_dispatched
delivery_acknowledged
delivery_redelivered
local_approval_requested
local_approval_granted
local_approval_denied
invocation_started
invocation_succeeded
invocation_failed
invocation_timed_out
invocation_expired
cancel_requested
cancel_dispatched
cancel_acknowledged
cancel_applied
cancel_failed
device_unlink_requested
device_dispatch_blocked
device_queue_cancelled
device_unlinked
```

## M0 Required Subset

M0 should implement the minimum reliable subset:

- Invocation statuses: `created`, `authorized`, `queued`, `dispatching`,
  `running`, `succeeded`, `failed`, `cancelled`, `timed_out`, `expired`.
- Delivery states: `queued`, `dispatching`, `acknowledged`, `redelivering`,
  `delivery_failed`, `expired`.
- Cancellation states: `none`, `requested`, `queued_cancelled`, `dispatched`,
  `applied`, `failed`, `not_supported`.
- Device unlink states: `linked`, `unlink_requested`, `unlinking`, `unlinked`,
  `unlink_failed`.

M0 does not need enterprise approval queues, priority queues, dead-letter queues,
or complex retry policies.

## Invariants

- Terminal invocations must not run again.
- Duplicate delivery of the same invocation id must not create a second local
  execution.
- Device unlinking blocks new dispatch immediately, before data cleanup
  finishes.
- Cancellation must be auditable even when it fails.
- Delivery acknowledgement must either be durable or protected by a server-side
  lease and redelivery rule.
- State transitions should be append-only in the event log even if resource
  snapshots are updated in place.
