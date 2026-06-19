# Backlog Seed

This document provides the first issues to create in GitHub.

Do not create all possible work at once. Seed M0 first, then add M1/M2/M3 as the
project learns.

## M0 Initiatives and Epics

### Initiative: M0 Remote Invocation Loop

Type: initiative
Milestone: M0
Area: cross-cutting
Risk: high
Source doc: `docs/vision/ROADMAP.md`

Outcome:

```text
A non-professional user can start from a plain-language task, review the
proposed plan, run a manually registered local or HTTP agent, observe status,
cancel work where supported, handle offline delivery, and inspect audit/trace
summaries.
```

### Epic: M0 Device Registration

Type: epic
Milestone: M0
Area: desktop
Agent Target: none
Source doc: `docs/vision/ARCHITECTURE.md`

Acceptance:

- A Desktop Bridge can link one user-owned device.
- The server records device identity, platform, bridge version, and last seen
  time.
- The Web Console can show online and offline state.

### Epic: M0 Manual CLI Agent Registration

Type: epic
Milestone: M0
Area: desktop
Agent Target: cli
Source doc: `docs/vision/AGENT_PROTOCOL.md`

Acceptance:

- A user can register one CLI command as an agent.
- The command uses structured argv execution.
- The user sees plain-language risk, data, and cancellation notes.
- The bridge streams stdout and stderr as invocation events.

### Epic: M0 Manual HTTP Agent Registration

Type: epic
Milestone: M0
Area: server
Agent Target: http
Source doc: `docs/vision/AGENT_PROTOCOL.md`

Acceptance:

- A user can register one HTTP endpoint as an agent.
- The endpoint has a request schema or simple task payload.
- Timeout and cancellation behavior are visible to the user.
- HTTP errors map to clear invocation failure messages.

### Epic: M0 Idea-to-Outcome Task Entry

Type: epic
Milestone: M0
Area: web
Agent Target: all
Source doc: `docs/vision/IDEA_TO_OUTCOME.md`

Acceptance:

- A user can start from a plain-language task field.
- The product shows a proposed device, agent, risk, cost, data handling, and
  cancellation behavior before execution.
- Advanced protocol details are hidden by default.

### Epic: M0 Invocation Delivery State Machine

Type: epic
Milestone: M0
Area: protocol
Agent Target: all
Source doc: `docs/vision/STATE_MACHINE.md`

Acceptance:

- Invocation status, delivery state, cancellation state, and device unlink state
  follow the canonical state machine.
- State changes are append-only events.
- Duplicate delivery of one invocation id does not run twice.

### Epic: M0 Offline Queue and Reconnect Dispatch

Type: epic
Milestone: M0
Area: server
Agent Target: cli
Source doc: `docs/vision/INVOCATION_DELIVERY.md`

Acceptance:

- Users can create invocations while a device is offline.
- Server queues offline invocations.
- Bridge reconnect dispatches pending work.
- Delivery acknowledgement is durable or lease-protected.

### Epic: M0 Cancellation Propagation

Type: epic
Milestone: M0
Area: desktop
Agent Target: cli
Source doc: `docs/vision/STATE_MACHINE.md`

Acceptance:

- Users can cancel queued work before execution.
- Users can request cancellation for running work.
- CLI adapters attempt process or process-tree cancellation.
- Cancellation success or failure is visible and audited.

### Epic: M0 Device Unlink Behavior

Type: epic
Milestone: M0
Area: security
Agent Target: none
Source doc: `docs/vision/DATA_GOVERNANCE.md`

Acceptance:

- Device unlink blocks future dispatch immediately.
- Pending queued invocations are cancelled.
- Running invocations receive cancellation when the bridge is reachable.
- Audit records the unlink decision and queue cleanup result.

### Epic: M0 Basic Audit and Trace

Type: epic
Milestone: M0
Area: server
Agent Target: all
Source doc: `docs/vision/SECURITY.md`

Acceptance:

- Each invocation records requester, agent, device, status transitions,
  permission decisions, trace/span ids, logs, errors, and final result summary.
- The Web Console shows a plain-language audit and trace summary.

### Epic: M0 Agent Economics Metadata

Type: epic
Milestone: M0
Area: billing
Agent Target: all
Source doc: `docs/vision/ECONOMIC_LEDGER.md`

Acceptance:

- Agent economics metadata exists.
- Default economic model is `unknown`.
- Unknown cost or revenue is visible to the user.
- No platform billing automation is required.

## Initial ADRs

### ADR: Realtime Transport

Type: adr
Milestone: M0
Area: protocol

Decision needed:

```text
Choose the initial server-to-bridge outbound realtime transport.
```

Options to compare:

- WebSocket.
- Server-Sent Events plus command polling.
- Long polling.

### ADR: Desktop Bridge Runtime

Type: adr
Milestone: M0
Area: desktop

Decision needed:

```text
Choose the initial cross-platform Desktop Bridge runtime and packaging path.
```

Options to compare:

- Node.js CLI/service.
- Tauri desktop app.
- Electron desktop app.
- Native per-platform bridge.

### ADR: Server Runtime and Storage

Type: adr
Milestone: M0
Area: server

Decision needed:

```text
Choose initial backend runtime, database, event storage, and queue approach.
```

## Initial Risks

### Risk: Durable Delivery Acknowledgement

Type: risk
Milestone: M0
Area: protocol
Risk: critical

Scenario:

```text
The bridge acknowledges an invocation before durably accepting it, then crashes
before execution.
```

Mitigation:

- Use durable local acceptance before ack, or a server-side lease and redelivery
  rule.
- Add idempotency by invocation id.

### Risk: Cross-platform Process Cancellation

Type: risk
Milestone: M0
Area: desktop
Risk: high

Scenario:

```text
Cancellation succeeds on one platform but leaves child processes running on
another.
```

Mitigation:

- Isolate process-tree cancellation behind platform services.
- Record `cancel_failed` when cancellation cannot be guaranteed.

### Risk: Non-professional User Confusion

Type: risk
Milestone: M0
Area: web
Risk: high

Scenario:

```text
The UI exposes protocol, adapter, queue, and ledger terminology before the user
can complete the happy path.
```

Mitigation:

- Start from plain-language task intent.
- Keep advanced details collapsed.
- Add pre-run review and plain-language result summaries.
