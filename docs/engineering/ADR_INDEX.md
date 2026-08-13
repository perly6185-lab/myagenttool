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
- [ADR 0014: A write-credential Application is a reviewed exception class, never a widened read credential](ADR_0014_WRITE_CREDENTIAL_APPLICATION.md)
- [ADR 0015: Linux install elevation is a per-action polkit broker, never an ambient privilege](ADR_0015_LINUX_ELEVATION_BROKER.md)
- [ADR 0016: A run's terminal grade is a derived read-model field first; a stored `finalStatus` is additive, never a replacement for `status`](ADR_0016_TERMINAL_GRADE.md)
- [ADR 0017: Trace export is a zero-dependency, opt-in OTLP/HTTP JSON exporter over the existing span model, never an OpenTelemetry SDK rewrite](ADR_0017_OTLP_TRACE_EXPORT.md)
- [ADR 0018: Per-subject deletion erases observability content through the retention chokepoint, but shielded evidence is retained-of-record and only PII-redacted](ADR_0018_OBSERVABILITY_DATA_DELETION.md)
- [ADR 0019: Durable observability history is an indexed SQLite table outside the state mirror, with the JSONL archive as the memory-backing/degraded fallback](ADR_0019_OBSERVABILITY_HISTORY_TABLE.md)
- [ADR 0023: Claude Agent SDK is an opt-in local runtime behind the existing governance plane](ADR_0023_CLAUDE_AGENT_SDK_RUNTIME.md)
- [ADR 0024: User-authored mail is a revision-bound server draft before it can cross the send gate](ADR_0024_USER_AUTHORED_MAIL_DRAFT.md)

## Proposed

- [ADR 0020: The invocation plane and the loop plane are two deliberately separate governed-run planes over one shared governance vocabulary](ADR_0020_TWO_GOVERNED_RUN_PLANES.md) — raised during the 2026-07 architecture governance review; awaiting ratification.
- [ADR 0021: Local access and enterprise sign-in share one server-enforced identity boundary](ADR_0021_PROVIDER_NEUTRAL_ENTERPRISE_IDENTITY.md) — provider-neutral China-friendly identity entry; awaiting security and product review.
- [ADR 0022: User-selected local assets use an explicit Bridge selection boundary](ADR_0022_USER_SELECTED_LOCAL_ASSET_BOUNDARY.md) — excludes registered Project/Worktree roots; awaiting protocol, security, and product review.

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

## Observability Decision Summary

Accepted 2026-07-17 (AI-agent observability gap closure):

- Terminal grade: a run's grade is a DERIVED read-model field; a stored
  `finalStatus` is an additive, reconciled column, never a replacement for the
  lifecycle `status` (ADR 0016).
- Trace export: a zero-dependency, opt-in OTLP/HTTP JSON exporter over the
  existing span model — not an OpenTelemetry SDK adoption (ADR 0017).
- Per-subject deletion: erase observability CONTENT through the retention
  chokepoint, scoped to the actor's team; shielded billing/audit evidence is
  retained-of-record with its subject PII scrubbed (ADR 0018). Remaining
  follow-up is non-code: a legal sign-off on the erasure-vs-retention policy.

## Open Decision Rules

Create a new ADR when implementation would otherwise make a durable decision
about runtime, transport, storage, security boundary, lifecycle packaging,
billing, or integration distribution.
