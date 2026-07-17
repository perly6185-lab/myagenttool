# ADR 0017: Trace export is a zero-dependency, opt-in OTLP/HTTP JSON exporter over the existing span model, never an OpenTelemetry SDK rewrite

Status: accepted · 2026-07-17

Date: 2026-07-17

Decision: Accepted, including the hand-rolled-exporter-over-SDK trade-off. Shipped
(#1188), hardened (#1199). The serializer tracks the stable OTLP/HTTP JSON schema;
a breaking OTLP change updates that one serializer rather than adding a dependency.

Related issue: [#1182](https://github.com/perly6185-lab/myagenttool/issues/1182)

## Context

The server already builds a real trace tree: one trace + root span per
invocation (`createTrace` in `apps/server/src/services/invocations/creation.mjs`),
one child span per model round with true per-step timing
(`apps/server/src/services/round-telemetry.mjs`), held in bounded in-memory
collections (`state.traces` / `state.spans`). Phase 1 (#1183) added the
OpenTelemetry **GenAI semantic-convention** attribute aliases
(`gen_ai.system`, `gen_ai.request.model`, `gen_ai.operation.name`,
`gen_ai.usage.*`) alongside the existing custom keys, so a span is already
OTLP-shape-ready.

What is missing is export: the trace tree is only queryable through this
server's own read models. The observability assessment (#1179) flagged the
"don't create a silo" concern — a team running an existing observability stack
(Tempo/Jaeger/Honeycomb/Grafana) cannot see these traces. The project **has no
`@opentelemetry/*` dependency, by design** — the runtime is deliberately lean and
best-effort in its outbound integrations (the SLO-alert webhook in
`apps/server/src/services/auto-run-alerts.mjs` is the template: operator-set URL,
http(s)-only, timeout-bounded, never throws, no-op when unconfigured).

## Decision

**Export is a hand-rolled, zero-dependency OTLP/HTTP JSON exporter that
serializes the existing spans and best-effort POSTs them to an operator-set OTLP
endpoint. No OpenTelemetry SDK is added; the internal span model is not
replaced.** Six invariants:

1. **No `@opentelemetry/*` dependency.** The exporter maps `state.spans` to the
   OTLP `ExportTraceServiceRequest` JSON shape by hand. Reason: the SDK pulls a
   large transitive tree and an instrumentation model this runtime does not need
   — a single serialize-and-POST is a few dozen lines and matches the project's
   best-effort-integration ethos.

2. **OTLP/HTTP with JSON encoding, to `OTEL_EXPORTER_OTLP_ENDPOINT`.** The
   standard env var and wire format, so any OTLP-compatible collector ingests it
   with no custom receiver. Protobuf encoding is out of scope (JSON is a
   conformant OTLP encoding and needs no codegen).

3. **Opt-in and best-effort, exactly like the alert webhook.** No endpoint
   configured → no-op. Export never throws, is timeout-bounded, and never blocks
   or slows an invocation; a failed export drops that batch and is retried on the
   next flush, never backpressures the run.

4. **Redaction and PII posture is unchanged and re-asserted at the boundary.**
   Span attributes carry model/provider names and token counts only; span names
   are `m0.remote_invocation` / `round.N`. Digests are NOT span attributes and
   are never exported. The exporter asserts (does not assume) that no attribute
   value matches the digest-redaction patterns before sending.

5. **The internal model stays authoritative; export is a downstream mirror.**
   `state.traces` / `state.spans` remain the source of truth for this server's
   read models. Export is a fire-and-forget projection — removing the endpoint
   removes the mirror, nothing else. Trace/span ids (`trc_`/`spn_`) are mapped to
   OTLP's 16-/8-byte id shape deterministically at export.

6. **Sampling is head-based and operator-set, defaulting to all.** A bounded
   in-memory span store already caps volume; an optional sample rate lets a
   high-volume deployment throttle export without affecting local retention.

## Consequences

- A team plugs these agent traces into an existing OTLP stack with one env var,
  closing the silo — without this runtime taking on the OpenTelemetry SDK or its
  upgrade surface.
- The Phase-1 `gen_ai.*` aliases mean the export map is mechanical: the attribute
  keys are already the conventional ones.
- The hand-rolled exporter is our code to maintain against the (stable) OTLP JSON
  schema; if OTLP evolves incompatibly, we update one serializer. Accepted over
  the SDK's dependency and instrumentation weight.
- No local behavior changes when unconfigured — the default state ships inert.

## Testable rules

- With no `OTEL_EXPORTER_OTLP_ENDPOINT`, the exporter is a no-op (no network
  call) and invocations behave identically.
- A completed round span serializes to a valid OTLP `ResourceSpans` JSON object:
  16-byte trace id, 8-byte span id, parent link preserved, `gen_ai.*` attributes
  present, start/end nanos set.
- No exported attribute value matches the digest-redaction patterns
  (`round-telemetry.mjs` `SECRET_PATTERNS` + CN-PII); a span carrying a
  would-be-secret attribute is refused, not sent.
- Export failure (unreachable endpoint, timeout, non-2xx) drops the batch and
  never throws into the invocation path.
