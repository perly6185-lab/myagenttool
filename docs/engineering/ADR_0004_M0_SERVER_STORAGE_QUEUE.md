# ADR 0004: M0 Server Runtime, Storage, and Queue

Status: accepted

Date: 2026-06-20

Related issue: [#14](https://github.com/perly6185-lab/myagenttool/issues/14)

## Context

M0 needs a control plane that can store devices, agents, invocations, queue
records, events, traces, audit records, and cancellation state. The first
implementation must support offline invocation creation and reconnect dispatch
without adding production operations complexity too early.

The local demo currently uses an in-memory Node server. That is useful for smoke
tests but not enough for durable delivery semantics.

## Decision

Use a Node.js server for M0 with a relational persistence boundary and a
database-backed queue table.

Implementation can start with a repository-owned storage interface and a local
SQLite-compatible adapter. The domain model must not depend on SQLite-specific
behavior. Later hosted/SaaS deployments can move the same logical schema to
Postgres without changing protocol concepts.

The queue is represented as durable invocation and delivery records, not as an
external broker in M0.

## Rationale

This keeps M0 small while preserving the important guarantees:

- One language and workspace model for server, bridge, web, and protocol.
- Relational records are enough for M0 idempotency, audit, and queue queries.
- A database-backed queue avoids introducing a separate queue service before
  semantics are proven.
- The server can graduate to Postgres later with the same state model.

## Consequences

Positive:

- Durable queue semantics can be tested locally.
- Invocation, delivery, cancellation, trace, and audit data can share one
  transaction boundary in M0.
- The storage layer becomes the seam for later Postgres/SaaS work.

Tradeoffs:

- M0 must introduce schema/migration discipline earlier than a pure in-memory
  demo.
- SQLite locking and concurrency limits are acceptable for local M0 but not the
  final SaaS architecture.
- External queue features such as dead-letter queues and priority scheduling are
  deferred.

## M0 Implementation Constraints

- Keep state transitions append-only in an invocation event log.
- Store resource snapshots for fast API reads, but treat events as reviewable
  evidence.
- Use idempotency keys for invocation dispatch.
- Store delivery attempts, cursor, lease expiration, and acknowledgement time.
- Queue cancellation must be transactional with invocation status updates.
- Device unlink must block new dispatch before cleanup finishes.

## Acceptance Impact

This ADR unblocks:

- Invocation state machine implementation.
- Offline queue and reconnect dispatch.
- Durable delivery acknowledgement mitigation.
- Audit and trace persistence.
