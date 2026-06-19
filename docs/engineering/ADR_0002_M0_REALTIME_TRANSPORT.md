# ADR 0002: M0 Realtime Transport

Status: accepted

Date: 2026-06-20

Related issue: [#12](https://github.com/perly6185-lab/myagenttool/issues/12)

## Context

M0 needs reliable outbound dispatch from the server to a Desktop Bridge. The
bridge must reconnect, announce its device id and last acknowledged delivery
cursor, receive queued invocations, stream events, and receive cancellation
requests.

The transport must support the M0 remote invocation loop without requiring
inbound access to a user's local machine.

## Decision

Use WebSocket as the M0 server-to-Desktop Bridge realtime transport.

The server owns authoritative state and queue records. The WebSocket channel is
only a delivery and event stream. On reconnect, the bridge sends:

```text
deviceId
bridgeVersion
lastAcknowledgedDeliveryCursor
supportedProtocolVersion
```

The server responds with pending dispatches for that device. Every dispatched
invocation uses an idempotency key and a delivery cursor. Delivery is considered
acknowledged only after the bridge durably accepts the invocation, or after the
server records a lease-protected dispatch path when durable local acceptance is
not available.

## Rationale

WebSocket is the best M0 default because it:

- Uses one outbound connection from bridge to server.
- Supports server-to-bridge dispatch and bridge-to-server events on one channel.
- Keeps cancellation delivery simple.
- Matches the current local demo shape.
- Can be replaced or supplemented later without changing the invocation state
  vocabulary.

Server-Sent Events plus polling would work, but it splits dispatch and event
paths earlier than M0 needs. Long polling is simpler at the network edge but
adds more retry and latency handling.

## Consequences

Positive:

- The Desktop Bridge can keep one durable outbound realtime session.
- Reconnect and cursor resume are first-class M0 behavior.
- WebSocket messages can carry typed protocol envelopes from
  `packages/protocol`.

Tradeoffs:

- The server must implement heartbeat and stale connection cleanup.
- Restricted networks may need SSE/polling fallback in a later milestone.
- M0 tests must cover reconnect and duplicate delivery behavior, not only a
  live happy path.

## M0 Implementation Constraints

- No inbound Desktop Bridge networking is required.
- The server queue remains authoritative.
- Duplicate delivery of one invocation id must not create another local run.
- Heartbeat timeout must mark the device offline without losing queued work.
- Cancellation messages use the same connection when the bridge is online.
- When offline, cancellation updates server queue state and is visible to the
  user.

## Acceptance Impact

This ADR unblocks:

- Invocation delivery state machine implementation.
- Offline queue and reconnect dispatch.
- Cancellation propagation over the bridge channel.
- Desktop Bridge reconnect tests.
