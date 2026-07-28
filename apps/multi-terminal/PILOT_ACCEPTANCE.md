# Multi-terminal pilot acceptance

Scope: one user, two independent terminal services, observation and
owner-proxied operations only.

## Acceptance evidence

| Capability | Evidence | Result |
| --- | --- | --- |
| Pairing | Two isolated HTTP terminal processes with independent state paths and observer tokens | Pass |
| Token rotation | One owner rejects the old observer token, stays offline without migration, then recovers after composition restart with the new token | Pass |
| Owner operations | Cancel, retry, replay, and maintenance map only to existing owner APIs; idempotency, retry, redaction, audit, and circuit tests | Pass |
| User experience | Desktop/mobile layout, keyboard focus, bilingual labels, filters, diagnostics, deletion, audit, SLO, Trace deep links | Pass |
| Monitoring | SSE reconnect, stale cache, 7/30/90-day recovery history, availability/recovery/operation SLO, transition webhook | Pass |
| Release | Docker image plus versioned install, upgrade, rollback state and persistent-data preservation | Pass |

## Explicit non-capabilities

The pilot has no task target selector, global queue, cross-terminal scheduler,
migration, failover, pooled concurrency, remote filesystem, Bridge access, or
credential display.

## Go/no-go

Go for local single-user pilot use after the operator provisions distinct
observer/operator/admin tokens and runs the fault drill in `OPERATIONS.md`.
No-go for shared or internet-facing use without an authenticating TLS reverse
proxy and host-level secret management.
