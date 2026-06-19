# ADR Seed

This document contains copy-ready architecture decision records for M0.

Use the `ADR` issue form first. After the decision is made, the accepted result
can later be copied into a dedicated ADR document if needed.

## ADR: Realtime Transport

Title:

```text
[ADR]: Realtime Transport for Desktop Bridge Dispatch
```

Labels:

```text
type/adr, status/backlog, area/protocol, risk/high, acceptance/not-defined
```

Project fields:

```text
Milestone: M0
Area: protocol
Type: adr
Status: backlog
Risk: high
Acceptance: not defined
Platform: all
Agent Target: all
Source Doc: docs/vision/INVOCATION_DELIVERY.md
```

Context:

```text
The server must dispatch invocations to the Desktop Bridge over an outbound
connection. The bridge must reconnect, announce its device id and cursor, and
receive queued work.
```

Options:

- WebSocket.
- Server-Sent Events plus command polling.
- Long polling.

Decision criteria:

- Works with outbound-only local bridge networking.
- Supports bidirectional dispatch and event streaming.
- Handles reconnect and cursor resume.
- Simple enough for M0.
- Can later support SaaS scale or be replaced.

Proposed decision:

```text
Use WebSocket for M0 unless implementation constraints make SSE plus command
polling significantly simpler.
```

Consequences:

- Need heartbeat and reconnect handling.
- Need server-side queue and idempotency regardless of transport.
- Need a clear fallback story for restricted networks later.

## ADR: Desktop Bridge Runtime

Title:

```text
[ADR]: Desktop Bridge Runtime and Packaging Path
```

Labels:

```text
type/adr, status/backlog, area/desktop, risk/high, acceptance/not-defined
```

Project fields:

```text
Milestone: M0
Area: desktop
Type: adr
Status: backlog
Risk: high
Acceptance: not defined
Platform: all
Agent Target: cli
Source Doc: docs/vision/PLATFORM_SUPPORT.md
```

Context:

```text
The Desktop Bridge must run on macOS, Windows, and Linux, invoke local CLI/HTTP
agents, manage credentials, stream events, and propagate cancellation.
```

Options:

- Node.js CLI/service.
- Tauri desktop app.
- Electron desktop app.
- Native per-platform bridge.

Decision criteria:

- Fastest M0 implementation.
- Structured process execution.
- Process-tree cancellation support.
- Platform credential storage path.
- Future tray/local approval UI.
- Packaging and auto-start complexity.

Proposed decision:

```text
Start with a Node.js CLI/service-style bridge for M0, while keeping platform
services isolated so a Tauri/Electron shell can be added later for tray and
approval UX.
```

Consequences:

- M0 can focus on protocol and execution.
- Native credential and notification integration may be limited at first.
- Need explicit platform abstraction layer early.

## ADR: Server Runtime, Storage, and Queue

Title:

```text
[ADR]: Server Runtime, Storage, and Queue for M0
```

Labels:

```text
type/adr, status/backlog, area/server, risk/high, acceptance/not-defined
```

Project fields:

```text
Milestone: M0
Area: server
Type: adr
Status: backlog
Risk: high
Acceptance: not defined
Platform: server
Agent Target: all
Source Doc: docs/vision/ARCHITECTURE.md
```

Context:

```text
M0 needs account/device/agent records, invocation queue records, events, traces,
audit records, and reconnect dispatch. The server should remain simple but not
paint the project into a corner.
```

Options:

- Node.js/TypeScript server with SQLite for local M0.
- Node.js/TypeScript server with Postgres.
- Python server with SQLite or Postgres.
- JVM server with Postgres.

Decision criteria:

- Fast local development.
- Clear schema evolution.
- Good realtime support.
- Easy future hosted deployment.
- Low operational burden for M0.

Proposed decision:

```text
Use a single server process with a relational database and a simple durable
queue table for M0. Prefer a stack that can move from local development to
self-hosted/SaaS without rewriting protocol concepts.
```

Consequences:

- M0 queue can be database-backed.
- Later SaaS scale may introduce a dedicated queue.
- Schema migrations should be introduced early.

## ADR: Web Console App Shell

Title:

```text
[ADR]: Web Console App Shell for M0
```

Labels:

```text
type/adr, status/backlog, area/web, risk/medium, acceptance/not-defined
```

Project fields:

```text
Milestone: M0
Area: web
Type: adr
Status: backlog
Risk: medium
Acceptance: not defined
Platform: web
Agent Target: all
Source Doc: docs/vision/USER_EXPERIENCE.md
```

Context:

```text
M0 needs a web console for sign-in, device status, agent registration,
plain-language task entry, pre-run review, invocation status, logs, result, and
audit summary.
```

Options:

- Single-page React app.
- Server-rendered app.
- Minimal static frontend plus API.

Decision criteria:

- Fast M0 iteration.
- Good realtime status UI.
- Clear routing for device, agent, invocation, and audit views.
- Low design complexity.

Proposed decision:

```text
Use a simple app shell optimized for the M0 happy path. Avoid admin-console
complexity until after the first remote invocation loop works.
```

Consequences:

- UX can stay focused on idea-to-outcome.
- Advanced protocol details can live behind expandable sections.
