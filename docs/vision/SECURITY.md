# Security Model

myagenttool controls access to powerful agents. The security model should be
designed before broad capability is added.

## Core Principle

The cloud may request work. The local bridge decides whether local work is
allowed.

The server should not have unrestricted shell, file system, browser, or desktop
control of a user's machine.

## Trust Boundaries

```text
Cloud Control Plane
  - Identity
  - Registry
  - Permission policy
  - Audit
  - Routing

Local Desktop Bridge
  - Device identity
  - Local agent configs
  - Local approval
  - Local credentials
  - Local execution
  - Platform-specific process, path, and credential handling

External Agents
  - Native agent behavior
  - Tool usage
  - Side effects
```

## Permission Layers

### Account Permission

Checks whether a user can see or invoke an agent.

### Team Role Permission

Checks whether a team member's role allows an action. The initial role model is
owner, admin, operator, and viewer.

### Device Permission

Checks whether a user can route work to a device.

### Agent Permission

Checks whether an agent can be invoked and what capabilities are enabled.

### Risk Permission

Checks whether the requested action's capability risk level is allowed,
requires approval, or must be denied.

### Lifecycle Permission

Checks whether a user can discover, install, enable, disable, update, or
uninstall an agent on a device.

### AI Usage Permission

Checks whether a user, team, agent, or platform feature can use a provider,
model, key mode, and quota pool.

### Agent Economics Permission

Checks whether a user, team, or agent can consume budget, create chargeback,
record revenue, or participate in settlement.

### Integration Generation Permission

Checks whether a user can generate, review, approve, test, or enable a custom
agent integration.

### Platform Agent Permission

Checks whether a user can invoke platform-owned agents and which control-plane
resources those agents may inspect or modify.

### Local Permission

The desktop bridge applies final local policy before execution.

Examples:

- Ask before every invocation.
- Ask before installing, updating, disabling, or uninstalling a local agent.
- Allow this user to invoke this agent without prompt.
- Allow only specific working directories.
- Deny commands outside an allowlist.
- Block secret-looking output from being uploaded without approval.
- Deny AI calls to providers or models that are not allowed by policy.
- Warn or require approval when an agent's cost or revenue model is unknown.
- Require approval for high-risk capability tags.
- Require review before enabling AI-generated integration artifacts.
- Require approval before platform agents perform high-risk control-plane
  actions.

## Invocation Approval

High-risk invocations should support local approval:

```text
cloud request -> local bridge -> user approval -> execution
```

M0 can begin with a simple policy:

- Low-risk read-only calls may run automatically if pre-approved.
- CLI calls require explicit local approval unless the agent is trusted.
- M0 can start with a single-owner policy: the requester must own the device and
  agent. Team roles can be added in M1.

Lifecycle operations are outside M0 except manual registration. In later
milestones, agent installation, update, uninstall, enable, and disable require
explicit policy checks, audit, and local approval when risk requires it.

## Credential Handling

- Store local credentials on the local machine when possible.
- Avoid uploading third-party agent tokens to the cloud unless necessary.
- Use scoped tokens for desktop bridge authentication.
- Rotate device credentials after unlinking or suspected compromise.
- Never log raw secrets.
- Use platform-native secret storage where possible: macOS Keychain, Windows
  Credential Manager or DPAPI-backed storage, and Linux Secret Service.
- Store AI provider credentials with explicit ownership, scope, rotation, and
  revocation metadata.
- Separate BYOK credentials from platform-managed provider credentials.

## Audit Requirements

Each invocation should record:

- User who requested it.
- Agent that was invoked.
- Device or endpoint used.
- Time created, started, and completed.
- Permission decisions.
- Capability risk tags and risk decision.
- Status transitions.
- Trace and span ids.
- Logs and errors.
- Artifacts created.
- Final result summary.

Each lifecycle operation should record:

- User who requested it.
- Device where it was performed.
- Agent affected.
- Operation type.
- Local approval result.
- Status transitions.
- Logs and errors.
- Final lifecycle state.

Each platform-managed AI call should record:

- User or team responsible for the call.
- Agent, invocation, and device when applicable.
- Provider, model, and provider mode.
- Quota decision.
- Token counts or equivalent usage metrics when available.
- Estimated cost.
- Status and error code.
- Prompt and response retention decision.

Each economic record should record:

- Agent and invocation.
- User or team responsible.
- Economic model.
- Cost owner or budget pool.
- Cost and revenue amounts when available.
- Whether the value is estimated or authoritative.
- Settlement or chargeback status when applicable.

Each generated integration should record:

- User who requested it.
- AI provider and model used when applicable.
- Generated artifact type.
- Review state.
- Reviewer and approval decision.
- Local probe or test result.
- Final enabled or rejected state.

Each platform-agent invocation should record:

- User who invoked it.
- Platform agent that ran.
- Control-plane resources inspected.
- AI provider and model used when applicable.
- Recommended actions.
- Approved or rejected follow-up actions.
- Usage, quota, and cost metadata.

## Transport Security

- Use TLS for all cloud communication.
- Prefer outbound bridge connections from local device to cloud.
- Authenticate device connections with device-bound credentials.
- Sign or otherwise authenticate server-to-bridge invocation messages.
- Include invocation idempotency keys to prevent replay confusion.
- Sign or authenticate cancellation messages sent to the bridge.

## Local Execution Safety

For CLI adapters:

- Use command allowlists.
- Use install and uninstall recipe allowlists.
- Avoid arbitrary shell string execution.
- Pass arguments as structured argv values.
- Apply timeouts.
- Capture and limit logs.
- Restrict working directories.
- Provide cancellation.
- Propagate cancellation to the local process or process tree when supported.
- Isolate platform-specific executable lookup, path validation, environment
  handling, and process-tree cancellation in the local bridge.

For HTTP adapters:

- Use explicit endpoint configuration.
- Restrict outbound targets for local HTTP agents.
- Apply request and response size limits.
- Redact configured sensitive fields.
- Abort in-flight HTTP requests when cancellation is requested and supported.

For lifecycle operations:

- Require explicit recipes for install, update, and uninstall.
- Avoid arbitrary script execution from the cloud.
- Require local approval for destructive operations.
- Separate "disable in registry" from "delete local software".
- Keep lifecycle logs separate from agent task logs while linking both to audit.

For AI usage:

- Enforce provider and model allowlists.
- Check quota before model calls.
- Attribute every platform-managed model call.
- Redact secrets before storing prompts, responses, or logs.
- Allow raw prompt and response retention to be disabled.
- Keep billing records immutable after finalization.

For agent economics:

- Make unknown cost or revenue visible.
- Check budget or quota before expensive invocations when configured.
- Keep finalized cost, revenue, billing, chargeback, and settlement records
  immutable.
- Do not hide externally billed costs just because the platform does not collect
  payment.

For generated integrations:

- Prefer declarative configuration over generated executable code.
- Do not execute generated code without review and local approval.
- Run generated probes and tests with restricted inputs.
- Version generated artifacts.
- Record generated, reviewed, tested, approved, and enabled events.
- Keep install recipes allowlisted and platform-scoped.

For extensions:

- Verify checksum and signature before broad distribution.
- Track version, author, source, compatibility, and risk tags.
- Require review before enabling executable plugins.

For alerting:

- Treat suspicious invocation alerts as security-relevant events.
- Avoid leaking secrets in alert payloads.
- Allow private deployments to export alerts to customer-controlled sinks.

For platform agents:

- Apply the same gateway, permission, quota, and audit checks as external agents.
- Use least-privilege access to control-plane data.
- Treat recommendations separately from approved actions.
- Require explicit approval for policy changes, lifecycle changes, installs,
  uninstalls, budget use, and generated code enablement.

## Data Minimization

Upload only what is needed for management and review.

Data belongs to the user in personal workspaces and to the owning team or
organization in team workspaces. See [DATA_GOVERNANCE.md](DATA_GOVERNANCE.md).

Good defaults:

- Store status and concise logs.
- Store final output.
- Upload artifacts only when requested or configured.
- Let users redact or exclude local paths, environment values, and secrets.
- Let users decide how to handle device-related data when a device is unlinked.

## Initial Threats

- A compromised cloud account invokes a powerful local agent.
- A malicious agent leaks local secrets through logs.
- A misconfigured CLI adapter executes unintended commands.
- A stale device credential remains active after a machine is lost.
- An invocation is replayed or duplicated.
- An offline queued invocation runs later after it is no longer wanted.
- A cancellation request fails to stop a local process.
- A device is unlinked but queued work still runs later.
- Device-related data is retained or deleted contrary to user intent.
- A malicious lifecycle recipe installs or removes unintended software.
- A remote user disables an important local agent without accountability.
- An agent consumes excessive model quota or cost.
- An externally billed agent creates unexpected cost.
- A revenue-generating agent records incorrect revenue attribution.
- Chargeback or settlement records are modified after finalization.
- A user routes sensitive local context to an unapproved AI provider.
- AI provider credentials leak through logs or audit records.
- AI-generated integration code executes unintended local actions.
- A generated adapter leaks secrets through logs or outputs.
- A platform agent changes policy, spends budget, or triggers lifecycle actions
  without sufficient approval.
- An extension is tampered with or installed from an untrusted source.
- A high-risk capability is invoked without appropriate approval.
- Alert payloads leak sensitive data.

The early milestones should address these with clear device unlinking, local approval,
command allowlists, quota checks, audit logs, and idempotent invocation
handling.
