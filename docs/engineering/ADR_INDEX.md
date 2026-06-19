# Architecture Decision Records

This index lists accepted engineering decisions that guide implementation.

## Accepted

- [ADR 0001: Local Development Stack and Monorepo Tooling](ADR_0001_LOCAL_DEV_STACK.md)
- [ADR 0002: M0 Realtime Transport](ADR_0002_M0_REALTIME_TRANSPORT.md)
- [ADR 0003: M0 Desktop Bridge Runtime](ADR_0003_M0_DESKTOP_BRIDGE_RUNTIME.md)
- [ADR 0004: M0 Server Runtime, Storage, and Queue](ADR_0004_M0_SERVER_STORAGE_QUEUE.md)
- [ADR 0005: M0 Web Console App Shell](ADR_0005_M0_WEB_CONSOLE_APP_SHELL.md)

## M0 Decision Summary

- Realtime transport: WebSocket from Desktop Bridge to server.
- Desktop Bridge runtime: Node.js CLI/service-style bridge with isolated
  platform services.
- Server/storage/queue: Node.js server with relational persistence boundary and
  database-backed queue records.
- Web shell: focused M0 invocation shell with plain-language task entry,
  pre-run review, status/logs/result, and expandable technical details.

## Open Decision Rules

Create a new ADR when implementation would otherwise make a durable decision
about runtime, transport, storage, security boundary, lifecycle packaging,
billing, or integration distribution.
