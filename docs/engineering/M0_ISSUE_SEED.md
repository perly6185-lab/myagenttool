# M0 Issue Seed

This document contains copy-ready issue drafts for GitHub.

Use the issue forms in `.github/ISSUE_TEMPLATE` and fill the GitHub Project
fields from the metadata below.

## 1. Initiative: M0 Remote Invocation Loop

Title:

```text
[Initiative]: M0 Remote Invocation Loop
```

Labels:

```text
type/initiative, status/backlog, area/cross-cutting, risk/high, acceptance/defined
```

Project fields:

```text
Milestone: M0
Area: cross-cutting
Type: initiative
Status: backlog
Risk: high
Acceptance: defined
Platform: all
Agent Target: all
Source Doc: docs/vision/ROADMAP.md
```

Outcome:

```text
A non-professional user can start from a plain-language task, review the
proposed device, agent, risk, cost, data handling, and cancellation behavior,
run one manually registered CLI or HTTP agent through the Desktop Bridge, watch
status and logs, receive the result, cancel queued or running work where
supported, and inspect plain-language audit and trace summaries.
```

Acceptance:

- [ ] User can sign in to one developer-run control plane.
- [ ] Desktop Bridge can link one user-owned device.
- [ ] User can manually register one CLI agent.
- [ ] User can manually register one HTTP agent.
- [ ] User can start from a plain-language task or idea.
- [ ] User sees a pre-run review of device, agent, risk, cost, data handling,
      and cancellation behavior.
- [ ] Invocation runs through the Desktop Bridge.
- [ ] Status, logs, trace data, and final result return to the Web Console.
- [ ] Offline queued invocation dispatches after reconnect.
- [ ] Cancellation succeeds or fails visibly and is audited.
- [ ] Device unlink blocks future dispatch and cancels pending queued work.
- [ ] Audit and trace summaries are understandable without internal terminology.

## 2. Epic: M0 Device Registration

Title:

```text
[Epic]: M0 Device Registration
```

Labels:

```text
type/epic, status/backlog, area/desktop, risk/high, acceptance/defined, agent/none
```

Project fields:

```text
Milestone: M0
Area: desktop
Type: epic
Status: backlog
Risk: high
Acceptance: defined
Platform: all
Agent Target: none
Source Doc: docs/vision/ARCHITECTURE.md
```

Problem:

```text
The platform cannot route work to local agents until a user-owned device can be
linked, authenticated, and shown as online or offline.
```

Acceptance:

- [ ] Desktop Bridge can link one user-owned device.
- [ ] Server records device id, owner, name, platform, architecture, bridge
      version, status, unlink state, and last seen time.
- [ ] Device uses outbound connection only.
- [ ] Web Console can show online and offline state.
- [ ] Device credentials can be revoked on unlink.

## 3. Epic: M0 Manual CLI Agent Registration

Title:

```text
[Epic]: M0 Manual CLI Agent Registration
```

Labels:

```text
type/epic, status/backlog, area/desktop, risk/high, acceptance/defined, agent/cli
```

Project fields:

```text
Milestone: M0
Area: desktop
Type: epic
Status: backlog
Risk: high
Acceptance: defined
Platform: all
Agent Target: cli
Source Doc: docs/vision/AGENT_PROTOCOL.md
```

Problem:

```text
Users need to register an existing local CLI agent without learning adapter
internals.
```

Acceptance:

- [ ] User can register a command as a CLI agent.
- [ ] Registration captures command, arguments, working directory policy,
      environment policy, and timeout.
- [ ] Command execution uses structured argv, not shell strings.
- [ ] User sees plain-language risk, data, cost, and cancellation notes.
- [ ] Bridge streams stdout and stderr as invocation events.
- [ ] Exit code maps to success or failure.

## 4. Epic: M0 Manual HTTP Agent Registration

Title:

```text
[Epic]: M0 Manual HTTP Agent Registration
```

Labels:

```text
type/epic, status/backlog, area/server, risk/medium, acceptance/defined, agent/http
```

Project fields:

```text
Milestone: M0
Area: server
Type: epic
Status: backlog
Risk: medium
Acceptance: defined
Platform: server
Agent Target: http
Source Doc: docs/vision/AGENT_PROTOCOL.md
```

Acceptance:

- [ ] User can register one HTTP endpoint as an agent.
- [ ] Registration captures base URL, auth mode, request payload shape, timeout,
      and streaming support when available.
- [ ] HTTP errors map to clear invocation failure messages.
- [ ] Cancellation behavior is shown as supported, unsupported, or unknown.

## 5. Epic: M0 Idea-to-Outcome Task Entry

Title:

```text
[Epic]: M0 Idea-to-Outcome Task Entry
```

Labels:

```text
type/epic, status/backlog, area/web, risk/high, acceptance/defined, agent/all
```

Project fields:

```text
Milestone: M0
Area: web
Type: epic
Status: backlog
Risk: high
Acceptance: defined
Platform: web
Agent Target: all
Source Doc: docs/vision/IDEA_TO_OUTCOME.md
```

Acceptance:

- [ ] User can start from a plain-language task field.
- [ ] Product proposes one registered device and agent.
- [ ] User sees a pre-run review of risk, cost, data handling, and cancellation.
- [ ] Advanced ids, adapter names, and state details are hidden by default.
- [ ] Result view explains success, failure, cancellation, offline, or queued
      status in plain language.

## 6. Epic: M0 Invocation Delivery State Machine

Title:

```text
[Epic]: M0 Invocation Delivery State Machine
```

Labels:

```text
type/epic, status/backlog, area/protocol, risk/critical, acceptance/defined, agent/all
```

Project fields:

```text
Milestone: M0
Area: protocol
Type: epic
Status: backlog
Risk: critical
Acceptance: defined
Platform: all
Agent Target: all
Source Doc: docs/vision/STATE_MACHINE.md
```

Acceptance:

- [ ] Invocation status follows `STATE_MACHINE.md`.
- [ ] Delivery state follows `STATE_MACHINE.md`.
- [ ] Cancellation state follows `STATE_MACHINE.md`.
- [ ] Device unlink state follows `STATE_MACHINE.md`.
- [ ] State transitions emit append-only events.
- [ ] Duplicate delivery of one invocation id does not run twice.

## 7. Epic: M0 Offline Queue and Reconnect Dispatch

Title:

```text
[Epic]: M0 Offline Queue and Reconnect Dispatch
```

Labels:

```text
type/epic, status/backlog, area/server, risk/critical, acceptance/defined, agent/all
```

Project fields:

```text
Milestone: M0
Area: server
Type: epic
Status: backlog
Risk: critical
Acceptance: defined
Platform: server
Agent Target: all
Source Doc: docs/vision/INVOCATION_DELIVERY.md
```

Acceptance:

- [ ] User can create an invocation while a target device is offline.
- [ ] Server stores queued invocation with idempotency key, timeout, dispatch
      attempts, and cancellation state.
- [ ] Bridge reconnect announces device id and last acknowledged cursor.
- [ ] Server dispatches pending work after reconnect.
- [ ] Delivery acknowledgement is durable or lease-protected.
- [ ] Expired queued work does not run automatically.

## 8. Epic: M0 Cancellation Propagation

Title:

```text
[Epic]: M0 Cancellation Propagation
```

Labels:

```text
type/epic, status/backlog, area/desktop, risk/high, acceptance/defined, agent/cli
```

Project fields:

```text
Milestone: M0
Area: desktop
Type: epic
Status: backlog
Risk: high
Acceptance: defined
Platform: all
Agent Target: cli
Source Doc: docs/vision/STATE_MACHINE.md
```

Acceptance:

- [ ] User can cancel queued work before execution.
- [ ] User can request cancellation for running work.
- [ ] Bridge forwards cancellation to adapter.
- [ ] CLI adapter attempts process or process-tree cancellation.
- [ ] HTTP adapter aborts in-flight request when supported.
- [ ] Cancellation success or failure is visible and audited.

## 9. Epic: M0 Device Unlink Behavior

Title:

```text
[Epic]: M0 Device Unlink Behavior
```

Labels:

```text
type/epic, status/backlog, area/security, risk/critical, acceptance/defined, agent/none
```

Project fields:

```text
Milestone: M0
Area: security
Type: epic
Status: backlog
Risk: critical
Acceptance: defined
Platform: all
Agent Target: none
Source Doc: docs/vision/DATA_GOVERNANCE.md
```

Acceptance:

- [ ] Device unlink blocks future dispatch immediately.
- [ ] Pending queued invocations are cancelled.
- [ ] Running invocations receive cancellation when the bridge is reachable.
- [ ] Device credentials are revoked or rotated.
- [ ] Audit records unlink decision and queue cleanup result.

## 10. Epic: M0 Basic Audit and Trace

Title:

```text
[Epic]: M0 Basic Audit and Trace
```

Labels:

```text
type/epic, status/backlog, area/server, risk/high, acceptance/defined, agent/all
```

Project fields:

```text
Milestone: M0
Area: server
Type: epic
Status: backlog
Risk: high
Acceptance: defined
Platform: server
Agent Target: all
Source Doc: docs/vision/SECURITY.md
```

Acceptance:

- [ ] Each invocation records requester, agent, device, timestamps, permission
      decisions, status transitions, trace/span ids, logs, errors, and final
      result summary.
- [ ] Web Console shows plain-language audit summary.
- [ ] Trace records show platform-controlled path.
- [ ] Audit records are retained for M0.

## 11. Epic: M0 Agent Economics Metadata

Title:

```text
[Epic]: M0 Agent Economics Metadata
```

Labels:

```text
type/epic, status/backlog, area/billing, risk/medium, acceptance/defined, agent/all
```

Project fields:

```text
Milestone: M0
Area: billing
Type: epic
Status: backlog
Risk: medium
Acceptance: defined
Platform: server
Agent Target: all
Source Doc: docs/vision/ECONOMIC_LEDGER.md
```

Acceptance:

- [ ] Agent economics metadata exists.
- [ ] Default economic model is `unknown`.
- [ ] Unknown cost or revenue is visible before invocation.
- [ ] No platform billing automation is required.
