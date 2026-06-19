# Acceptance Criteria

This document turns the roadmap into testable milestone outcomes.

Each milestone should be considered complete only when the product can satisfy
the relevant user-visible flows, audit requirements, and safety boundaries.

## M0: Remote Invocation Loop

M0 proves that a signed-in user can invoke one registered local or HTTP agent and
see what happened.

Acceptance criteria:

- A user can sign in to one developer-run control plane.
- A non-professional user can complete first-run setup without reading protocol
  documentation.
- A user can start from a plain-language task or idea, not only from an agent
  configuration screen.
- A Desktop Bridge can link one user-owned device.
- The Web Console shows the device online and later offline.
- The user can manually register one CLI agent.
- The user can manually register one HTTP agent.
- The user can invoke a registered agent from the Web Console.
- The invocation form uses plain-language labels for task, device, agent, risk,
  cost, and data handling.
- Before execution, the user sees a short plan explaining what will run, where
  it will run, what it may access, whether cost is known, and how cancellation
  works.
- The bridge receives the invocation through an outbound realtime connection.
- The bridge invokes the selected local CLI or HTTP adapter.
- Status, logs, and final result stream back to the Web Console.
- The server records invocation, event, trace, span, and audit records.
- The user can create an invocation while the device is offline.
- The server queues offline invocations.
- The bridge reconnects and receives pending work.
- Delivery acknowledgement follows the durable or lease-protected rule in
  [STATE_MACHINE.md](STATE_MACHINE.md).
- Duplicate delivery of the same invocation id does not run the task twice.
- The user can cancel a queued invocation before execution.
- The user can request cancellation for a running invocation.
- CLI cancellation attempts to stop the local process or process tree when
  supported.
- HTTP cancellation aborts in-flight requests when supported.
- Cancellation success or failure is visible in status and audit records.
- Success, failure, timeout, cancellation, offline, and queued states are
  understandable without knowing internal state names.
- Device unlink blocks future dispatch immediately.
- Device unlink cancels pending queued invocations.
- Agent economics metadata exists and defaults to `unknown`.
- Minimal permission check verifies that the requester owns the device and
  agent.

M0 is not accepted if:

- A local agent can run twice from one invocation id.
- A queued invocation runs after device unlink.
- Cancellation failures are hidden.
- The cloud requires inbound access to the user's machine.
- M0 requires automated install, uninstall, generated code, SaaS billing, or
  multi-team RBAC.

## M1: Local Agent Management

M1 makes local agent operations visible and manageable without adding silent
installation.

Acceptance criteria:

- The bridge can conservatively discover candidate local agents.
- Discovery results are explained in user-facing language.
- The product can suggest candidate agents based on the user's intended task,
  agent capability, and device availability.
- Discovery uses known commands, user-provided paths, local endpoints, MCP
  configs, or bridge-managed config files.
- The user can register a discovered agent after review.
- The user can enable and disable a managed agent.
- Disabling an agent blocks new invocations.
- Disable actions are audited.
- The bridge can run health checks for managed agents.
- Health failures include a suggested next action when possible.
- Agents can declare capability risk tags.
- High-risk invocations can require local approval.
- The product supports owner, admin, operator, and viewer roles.
- Trace and span visualization is useful for a failed invocation.
- BYOK AI provider configuration is available for platform helper features.
- AI usage records are created for platform helper model calls.
- Usage counts are visible by agent and invocation.
- Agents can have cost owner metadata.
- The invocation troubleshooting platform agent can summarize failed
  invocations without bypassing permissions.
- Self-hosted deployment guidance includes environment variables, migration
  path, and basic backup notes.
- Device unlink offers data handling choices.
- Basic export exists for invocation and audit records.
- A CLI supports local development and debugging flows such as login, link,
  register, invoke, cancel, and tail logs.
- Basic health, failed invocation, and device offline alerts exist.

M1 is not accepted if:

- Discovery scans the whole operating system aggressively.
- Enable or disable bypasses audit.
- Local approval decisions are not recorded.
- BYOK credentials are uploaded or logged unnecessarily.
- Everyday users must understand adapter, policy, or trace terminology to use
  the default flows.

## M2: Integration Builder and Governance

M2 helps users connect unsupported agents through reviewable artifacts.

Acceptance criteria:

- A user can describe an unsupported CLI or HTTP agent.
- A user can describe an intended outcome even when they do not know which agent
  or adapter is needed.
- The builder can ask follow-up questions when required.
- The builder can translate a plain-language agent description into a proposed
  connection plan.
- The product can explain whether it found an existing agent, needs a new
  connection, or needs more information from the user.
- The builder generates adapter configuration.
- The builder generates input and output schema suggestions.
- The builder generates health check definitions.
- The builder generates redaction rules.
- The builder generates test cases.
- The builder captures economic model, cost owner, budget, or revenue
  assumptions.
- Generated artifacts are marked as generated.
- Generated artifacts have version history.
- Generated artifacts require review before enablement.
- The bridge can run a local probe or sandbox-style test before enablement.
- Probe results are visible in the Web Console.
- Generated config, tests, risk, cost, and retention choices have
  plain-language summaries.
- Basic quota enforcement exists for AI or platform operations.
- Estimated ledger entries exist for agent cost and revenue.
- Usage, cost, and revenue reporting views exist.
- Retention settings exist for logs, artifacts, prompts, and responses.
- A local test harness can validate adapter config, schema, health check,
  cancellation, redaction, events, and traces.
- Quota and usage alerts exist.
- Integration builder and policy review platform agents use normal registry,
  gateway, permission, metering, and audit paths.
- SaaS readiness covers multi-user and team operation basics.

M2 is not accepted if:

- Generated code executes without review.
- Generated install recipes run silently.
- Economic assumptions are hidden from the user.
- Integration artifacts cannot be rolled back or audited.
- The user cannot understand what the generated integration will run before
  enabling it.

## M3: Lifecycle Automation and Billing

M3 adds commercial and lifecycle automation while preserving local control.

Acceptance criteria:

- Install, update, and uninstall use explicit approved recipes.
- Lifecycle actions show recipe source, signature status, risk, rollback
  availability, and local approval requirement in plain language.
- Lifecycle operations require policy checks and local approval where required.
- Uninstall is limited to bridge-managed agents unless the user explicitly
  approves another behavior.
- Rollback metadata exists when supported by the agent or recipe.
- Platform-managed AI provider mode can enforce quotas and create billable
  ledger entries.
- Credits, usage caps, invoices, or payment integration exists for SaaS billing.
- Team-level cost allocation exists.
- Internal chargeback export exists.
- Revenue-share records exist.
- Private deployment packaging exists.
- Audit export exists for private deployments.
- Immutable audit storage options exist.
- Private extension catalog exists.
- Signed extension bundles can be verified before broad use.
- Stable public API and versioned SDKs exist.
- Private deployment alert sinks and SIEM export exist.
- MCP, A2A, and container adapters can be enabled as governed adapters.
- Cost analyst and lifecycle advisor platform agents operate through the normal
  control-plane path.
- Users can save or repeat approved task patterns without rebuilding the plan
  from scratch.

M3 is not accepted if:

- Lifecycle recipes can install or remove arbitrary software silently.
- Platform-managed billing can create untraceable charges.
- Private deployments cannot export audit records.
- Platform agents can bypass policy, quota, metering, or audit.
- Billing, chargeback, or lifecycle automation requires professional knowledge
  for the default user-facing flow.

## M4: Marketplace and Ecosystem

M4 extends adapter, recipe, and extension distribution beyond private/team use
while preserving review, signing, policy, and local control.

Acceptance criteria:

- Public extension marketplace concepts are documented and separated from
  private catalogs.
- Public adapter publishing requires review state, author identity, source,
  version, compatibility range, checksum, and signature metadata.
- Marketplace listings can show supported platforms, adapter type, capability
  risk tags, lifecycle support, and known cost or revenue model.
- Public adapter compatibility badges exist for CLI, HTTP, MCP, A2A, container,
  and platform adapters where applicable.
- Marketplace payouts and settlement records are modeled through the economic
  ledger.
- Advanced pricing rules can be represented without bypassing ledger audit.
- Users can distinguish official, private, community, generated, and local-only
  extensions.
- Installing or enabling marketplace content still requires policy checks and
  local approval when risk requires it.
- Vulnerability or abuse reports can mark extensions as warned, blocked, or
  deprecated.
- Existing self-hosted and private deployments can disable public marketplace
  access.

M4 is not accepted if:

- Public extensions can execute without review or signature verification.
- Marketplace payouts bypass ledger, audit, or settlement records.
- Marketplace features silently install or update local software.
- Public marketplace policy overrides private deployment policy.

## Cross-milestone Gates

Every milestone should preserve these gates:

- Cloud requests work; the local bridge owns local execution.
- Non-professional users can complete the primary happy path without learning
  protocol, queue, adapter, ledger, or policy terminology.
- Users can begin with intent, receive a proposed path, run safely, and
  understand the result and next step.
- Local credentials stay local when possible.
- User data ownership and device unlink decisions remain explicit.
- Every user-visible action has an audit trail.
- Every invocation is attributable, observable, cancellable where possible, and
  idempotent.
- Unknown cost, unknown revenue, unknown risk, and unknown lifecycle state are
  visible to the user.
