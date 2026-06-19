# Developer Experience

myagenttool should be useful through both the Web Console and developer-facing
interfaces.

## Surfaces

```text
Web Console
REST API
Realtime API
CLI
SDK
Webhooks
Adapter development kit
Local test harness
```

## API Goals

The API should support:

- Device registration.
- Agent registration.
- Invocation creation.
- Invocation cancellation.
- Status and event streaming.
- Trace and audit retrieval.
- Agent lifecycle operations.
- Integration artifact review.
- AI usage and quota views.

## CLI Goals

The CLI should support:

- Login.
- Device link and unlink.
- Agent register.
- Agent list.
- Invoke.
- Cancel.
- Tail invocation logs.
- Export audit or trace data.
- Run adapter probes.

## SDK Goals

SDKs should help developers:

- Register agents.
- Build adapters.
- Stream invocation events.
- Emit traces and spans.
- Report artifacts.
- Implement cancellation.
- Validate schemas.

## Webhooks

Webhook events can notify external systems about:

- Device online/offline.
- Invocation completed or failed.
- Agent disabled.
- Quota threshold reached.
- Suspicious invocation.
- Integration artifact approved.

## Local Test Harness

The test harness should let developers validate:

- Adapter config.
- Input/output schema.
- Health check.
- Cancellation.
- Redaction.
- Event streaming.
- Trace generation.

## Milestone Boundary

M0 should support:

- Minimal API for device, agent, invocation, events, and cancellation.

M1 should support:

- CLI for local development and debugging.
- Basic webhook design.

M2 should support:

- Adapter authoring guide.
- Local test harness.
- SDK for integration builder outputs.

M3 should support:

- Stable public API.
- Versioned SDKs.
- Enterprise webhook management.
