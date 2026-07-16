# Architecture Decision Records

This index lists accepted engineering decisions that guide implementation.

## Accepted

- [ADR 0001: Local Development Stack and Monorepo Tooling](ADR_0001_LOCAL_DEV_STACK.md)
- [ADR 0002: M0 Realtime Transport](ADR_0002_M0_REALTIME_TRANSPORT.md)
- [ADR 0003: M0 Desktop Bridge Runtime](ADR_0003_M0_DESKTOP_BRIDGE_RUNTIME.md)
- [ADR 0004: M0 Server Runtime, Storage, and Queue](ADR_0004_M0_SERVER_STORAGE_QUEUE.md)
- [ADR 0005: M0 Web Console App Shell](ADR_0005_M0_WEB_CONSOLE_APP_SHELL.md)
- [ADR 0006: Codex CLI Sandbox Default and Writable Opt-In](ADR_0006_CODEX_SANDBOX_DEFAULT.md)
- [ADR 0007: Re-home ccusage as an Application](ADR_0007_CCUSAGE_AS_APPLICATION.md)
- [ADR 0008: Executable Applications are platform-shipped, not user-registered](ADR_0008_APPLICATION_REGISTRATION_BOUNDARY.md)
- [ADR 0009: An Application descriptor is immutable — change means re-register](ADR_0009_APPLICATION_DESCRIPTOR_IMMUTABLE.md)
- [ADR 0010: An external Application's authorization is readiness, not a capability](ADR_0010_EXTERNAL_CREDENTIAL_READINESS.md)
- [ADR 0011: Mail intake is untrusted input; send is the exfiltration boundary](ADR_0011_MAIL_UNTRUSTED_INPUT.md)
- [ADR 0012: A Channel is a governed conversation boundary; the gateway is a separate public listener](ADR_0012_CHANNEL_BOUNDARY.md)
- [ADR 0013: Channel providers are pluggable; the governed core is provider-agnostic](ADR_0013_CHANNEL_PROVIDERS_PLUGGABLE.md)

## M0 Decision Summary

- Realtime transport: WebSocket from Desktop Bridge to server.
- Desktop Bridge runtime: Node.js CLI/service-style bridge with isolated
  platform services.
- Server/storage/queue: Node.js server with relational persistence boundary and
  database-backed queue records.
- Web shell: focused M0 invocation shell with plain-language task entry,
  pre-run review, status/logs/result, and expandable technical details.

## M1 Decision Summary

- Codex sandbox: `read-only` default; writable execution is an explicit opt-in
  and always passes the local approval gate.

## Open Decision Rules

Create a new ADR when implementation would otherwise make a durable decision
about runtime, transport, storage, security boundary, lifecycle packaging,
billing, or integration distribution.
