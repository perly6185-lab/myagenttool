# Roadmap

This roadmap separates the product vision from buildable milestones.

The long-term vision is broad: myagenttool can manage existing agents, govern
AI usage, generate integrations, expose platform capabilities as agents, and
operate across macOS, Windows, and Linux. It should support SaaS, self-hosted,
and private deployment models. It should be understandable for non-professional
users first, then progressively expose expert controls. Users should be able to
start from an idea, not from agent configuration. The early milestones should
stay much smaller.

## M0: Remote Invocation Loop

M0 proves the core product loop.

Goal:

```text
User signs in -> Desktop Bridge is online -> user registers an agent ->
user invokes it from Web Console -> local agent runs -> logs and result return
```

Scope:

- User sign-in.
- One simple developer-run control plane.
- One user-owned device.
- Desktop Bridge registration.
- Manual CLI agent registration.
- Manual HTTP agent registration.
- Agent list and device online status.
- Web invocation form.
- Plain-language task intent field.
- Plain-language first-run and invocation experience for non-professional users.
- Pre-run plan review that explains device, agent, risk, cost, data handling,
  and cancellation.
- Server-to-bridge realtime dispatch.
- Server-side queued invocations for offline devices.
- Automatic dispatch when the Desktop Bridge reconnects.
- Cancellation propagation from server to bridge and local adapter/process.
- Bridge-to-server event streaming.
- Invocation status, logs, and final result.
- Basic audit record.
- Clear data ownership statement.
- Device unlink blocks future dispatch and cancels pending queued work.
- Basic trace/span model for the platform-controlled path.
- Minimal permission check: requester owns the device and agent.
- Minimal API for device, agent, invocation, events, and cancellation.
- Agent economics metadata defaults to `unknown`.
- Basic console status for device, invocation, and cancellation failure.
- Advanced ids, logs, and state details can live behind an expandable detail
  view.

Non-scope:

- Production SaaS deployment.
- Private deployment packaging.
- Agent installation and uninstall.
- Generated integration code.
- Platform-managed billing.
- Multi-team RBAC.
- Visual workflow builder.
- Autonomous platform agents.
- Full MCP/A2A compatibility.

Success criteria:

1. Start server and web console.
2. Start one Desktop Bridge.
3. Register one CLI or HTTP agent manually.
4. Start from a plain-language task or idea.
5. Review proposed device, agent, risk, cost, data handling, and cancellation
   behavior.
6. Invoke the agent from the web console.
7. See realtime status and logs.
8. Receive final output.
9. Cancel queued or running work where supported.
10. Create an invocation while the device is offline and have it dispatch after
    reconnect.
11. Unlink the device and verify future dispatch is blocked and pending queued
    work is cancelled.
12. Inspect plain-language audit and trace summaries.

## M1: Local Agent Management

M1 makes local agent operations manageable.

Scope:

- Conservative local discovery.
- Agent enable and disable.
- Health checks.
- Local approval prompts for high-risk invocations.
- Guided discovery results and plain-language health status.
- Suggested agents based on task, capability, and device availability.
- Basic role model: owner, admin, operator, viewer.
- Capability risk tags for agents.
- More complete trace/span visualization.
- BYOK AI provider configuration for platform helper features.
- AI usage records without billing automation.
- Usage counts by agent and invocation.
- Cost owner metadata for agents.
- First platform agent: invocation troubleshooter.
- Clearer self-hosted deployment guidance.
- Device unlink data handling options.
- Basic export for invocation and audit records.
- CLI for local development and debugging.
- Basic health and device offline alerts.

Non-scope:

- Unattended installs.
- Uninstall automation.
- Platform-managed billing.
- Organization-wide generated integration rollout.

## M2: Integration Builder and Governance

M2 helps users connect unsupported agents.

Scope:

- Intent-to-configuration for CLI and HTTP agents.
- Idea-to-integration flow when no suitable agent exists.
- Generated adapter config.
- Generated schema, health check, redaction rules, and test cases.
- Review workflow for generated artifacts.
- Local probe test before enabling.
- Basic quota enforcement.
- Usage and cost reporting.
- Estimated cost and revenue records.
- Integration Builder prompts for agent economic model.
- Plain-language generated integration review and test-result explanation.
- Retention settings for logs, artifacts, prompts, and responses.
- Local test harness for adapter configs.
- Generated artifact version history and review state.
- Quota and usage alerts.
- Integration builder platform agent.
- Intent clarification platform agent.
- Policy review platform agent.
- SaaS readiness for multi-user operation.

Non-scope:

- Fully autonomous adapter plugin deployment.
- Marketplace publishing.
- Complex interactive terminal agents.

## M3: Lifecycle Automation and Billing

M3 adds advanced lifecycle and commercial operations.

Scope:

- Install, update, and uninstall from approved recipes.
- Rollback metadata where supported.
- Platform-managed AI provider mode.
- Credits, usage caps, invoices, or payment integration.
- Guided billing, lifecycle, and rollback explanations.
- Team-level policy and cost allocation.
- Internal chargeback export.
- Revenue-share records.
- SaaS billing model.
- Private deployment packaging.
- Audit export for private deployments.
- Immutable audit storage options.
- Private extension catalog and signed extension bundles.
- Stable public API and versioned SDKs.
- Private deployment alert sinks and SIEM export.
- MCP adapter.
- A2A adapter.
- Container adapter.
- Cost analyst platform agent.
- Lifecycle advisor platform agent.
- Repeatable task templates and organization-approved workflows.

Non-scope:

- Hidden local machine control.
- Silent generated code execution.
- Business-agent implementation inside this repository.

## M4: Marketplace and Ecosystem

M4 extends the platform beyond private/team use into broader ecosystem
distribution.

Scope:

- Public extension marketplace.
- Public adapter publishing workflow.
- Marketplace payouts.
- Automated provider settlement.
- Advanced pricing rules.
- Agent author profiles and trust history.
- Public compatibility badges for adapters and recipes.
- Community review and vulnerability reporting for extensions.

Non-scope:

- Unreviewed executable code distribution.
- Silent local installation.
- Bypassing local bridge policy or user approval.

## Standing Principles

- Cloud requests work; the local bridge owns local execution.
- Do not implement business agents in this repository.
- Design for non-professional users first; expert controls should be
  progressively disclosed.
- Start from user intent and guide toward outcome; do not require users to know
  agent engineering concepts before they can make progress.
- Prefer declarative integration artifacts over executable generated code.
- Every invocation should be attributable, cancellable, observable, and
  auditable.
- Platform agents must use the same registry, gateway, permission, metering, and
  audit path as external agents.
- Invocation delivery must be queued, idempotent, cancellable, and auditable.
- User data belongs to the user; device unlinking data cleanup is user-directed.
- Capability risk should drive permission, approval, audit, and UI warnings.
- Agent economics should be explicit; unknown cost or revenue should be visible.
- Extensions should be reviewable, versioned, and signed before broad use.
