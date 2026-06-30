# AI Context

This is the entry context for AI agents working on this repository.

Before starting non-trivial work, an AI agent should read this file and then
open the referenced source documents needed for the task.

## Project Identity

`myagenttool` is a personal and small-team Agent Control Plane.

It manages other agents. It does not implement business agents inside this
repository.

Core capabilities:

- Register existing agents.
- Invoke agents through a unified gateway.
- Bridge cloud control to local machines through a Desktop Bridge.
- Manage permissions, cancellation, audit, trace, cost, and lifecycle.
- Help non-professional users turn intent into safe outcomes.

## Product Boundary

In scope:

- Web console.
- Server control plane.
- Desktop Bridge for macOS, Windows, and Linux.
- Agent registry, gateway, adapter metadata, invocation protocol, and audit.
- AI usage governance and economic ledger.
- Integration Builder that generates reviewable adapter artifacts.

Out of scope:

- Building domain-specific business agents in this repository.
- Silent local execution without explicit user control.
- Production marketplace before lifecycle, signing, billing, and review models
  are ready.

## Default User

Design for non-professional users first.

The user may know what outcome they want, but they should not need to understand
agent protocols, adapter internals, queues, ledgers, or state machines.

Expert controls may exist, but they should be progressively disclosed.

## M0 Goal

M0 proves the remote invocation loop:

```text
User signs in -> Desktop Bridge links device -> user starts from plain-language
intent -> manually registered CLI or HTTP agent runs locally or through a
registered endpoint -> status/logs/result/audit return to the Web Console.
```

M0 must also cover:

- Offline queue and reconnect dispatch.
- Cancellation propagation.
- Device unlink behavior.
- Basic audit and trace.
- Agent economics metadata with unknown cost made visible.

## Source Documents

Product and roadmap:

- `DESIGN.md`
- `docs/vision/PRODUCT.md`
- `docs/vision/ROADMAP.md`
- `docs/vision/ACCEPTANCE_CRITERIA.md`

Architecture and protocol:

- `docs/vision/ARCHITECTURE.md`
- `docs/vision/AGENT_PROTOCOL.md`
- `docs/vision/STATE_MACHINE.md`
- `docs/vision/INVOCATION_DELIVERY.md`
- `docs/vision/AGENT_ADAPTER_MATRIX.md`

Safety, data, and economics:

- `docs/vision/SECURITY.md`
- `docs/vision/DATA_GOVERNANCE.md`
- `docs/vision/AI_BILLING_AUDIT.md`
- `docs/vision/AGENT_ECONOMICS.md`
- `docs/vision/ECONOMIC_LEDGER.md`
- `docs/vision/POLICY_AND_RISK.md`

User and platform experience:

- `docs/vision/USER_EXPERIENCE.md`
- `docs/design/MYAGENTTOOL_DESIGN.md`
- `docs/vision/IDEA_TO_OUTCOME.md`
- `docs/vision/PLATFORM_SUPPORT.md`
- `docs/vision/AGENT_LIFECYCLE.md`

Engineering management:

- `docs/engineering/PROJECT_MANAGEMENT.md`
- `docs/engineering/AI_DEVELOPMENT_WORKFLOW.md`
- `docs/engineering/DEFINITION_OF_DONE.md`
- `docs/engineering/TEST_STRATEGY.md`

## Engineering Rules

- Prefer the smallest issue-aligned change.
- Read existing docs before editing.
- Do not undo user changes.
- Add or update tests when behavior changes.
- Keep user-facing language plain.
- For product-facing Web Console changes, read `DESIGN.md` before editing and
  preserve its visual, copy, state, and responsive layout rules.
- Record risky assumptions as ADRs or risk issues.
- Do not hide cost, data access, or cancellation limitations.

## Security Defaults

- Local execution must be explicitly authorized.
- The cloud control plane requests local work; the Desktop Bridge owns final
  local execution.
- Use outbound bridge connections.
- Treat credentials, local files, process execution, and billing as sensitive.
- Prefer structured command execution over shell strings.
- Record audit evidence for invocation and permission decisions.

## Cost Defaults

- Every AI or external agent call should be attributable.
- Unknown cost must be visible before invocation.
- Usage should connect to an issue, invocation, user, workspace, model, agent,
  or ledger entry where possible.

## Completion Rule

A change is not complete just because code was written.

For non-trivial AI-assisted implementation, first confirm an existing GitHub
issue or create one before changing code. If the work expands into a new
feature surface, tool, validation mechanism, or governance behavior, update the
current issue scope or create and sync a new issue before continuing.

It is complete when:

- Acceptance criteria are met.
- Tests or evidence exist.
- Docs are updated when behavior changes.
- Risks are filed or resolved.
- The GitHub issue and Project fields reflect the true state.
- The final handoff names the tracking issue IDs and Project sync result.
