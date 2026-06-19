# Agent Protocol

This document defines the first internal protocol concepts for myagenttool.

The protocol is not meant to replace MCP, A2A, or individual agent APIs. It is
the internal management protocol used by the control plane and adapters.

Protocol namespace:

```text
com.myagenttool
```

TypeScript package namespace:

```text
@myagenttool/protocol
```

Canonical state vocabulary is defined in [STATE_MACHINE.md](STATE_MACHINE.md).
Economic roll-up and ledger semantics are defined in
[ECONOMIC_LEDGER.md](ECONOMIC_LEDGER.md).
Idea-to-outcome flow is defined in [IDEA_TO_OUTCOME.md](IDEA_TO_OUTCOME.md).

## Main Entities

### Team

A team groups users, devices, agents, policies, usage, and audit records.

```json
{
  "id": "team_123",
  "name": "Personal Lab",
  "ownerUserId": "usr_123",
  "createdAt": "2026-06-19T00:00:00Z"
}
```

### Membership

A membership grants a user a role in a team.

```json
{
  "id": "mem_123",
  "teamId": "team_123",
  "userId": "usr_456",
  "role": "operator",
  "createdAt": "2026-06-19T00:00:00Z"
}
```

### Policy Binding

A policy binding connects a subject to permissions over a resource.

```json
{
  "id": "pol_123",
  "subjectType": "team_role",
  "subjectId": "team_123:operator",
  "resourceType": "agent",
  "resourceId": "agt_123",
  "permissions": ["invoke"],
  "createdAt": "2026-06-19T00:00:00Z"
}
```

### Device

A device represents a machine that can host local agents through a desktop
bridge.

```json
{
  "id": "dev_123",
  "ownerUserId": "usr_123",
  "name": "Workstation",
  "platform": "windows",
  "architecture": "x64",
  "defaultShell": "powershell",
  "pathFormat": "windows",
  "bridgeVersion": "0.1.0",
  "status": "online",
  "unlinkState": "linked",
  "lastSeenAt": "2026-06-19T00:00:00Z"
}
```

Supported platform values:

```text
macos
windows
linux
```

Supported architecture values should start with:

```text
x64
arm64
```

### Agent

An agent is an external managed capability.

```json
{
  "id": "agt_123",
  "name": "Local Codex",
  "description": "Local coding agent exposed through CLI.",
  "ownerUserId": "usr_123",
  "location": {
    "type": "local_device",
    "deviceId": "dev_123"
  },
  "adapter": {
    "type": "cli",
    "command": "codex",
    "args": ["{{payloadJson}}"],
    "workingDirectoryPolicy": "explicit",
    "environmentPolicy": "inherit_safe",
    "timeoutSeconds": 600,
    "cancellation": "supported"
  },
  "lifecycle": {
    "state": "enabled",
    "installState": "installed",
    "version": "0.1.0",
    "managedBy": "bridge"
  },
  "economics": {
    "model": "unknown",
    "pricingDimensions": [],
    "currency": "USD",
    "costOwner": "usr_123",
    "budgetPoolId": null
  },
  "capabilities": [
    {
      "name": "code_edit",
      "description": "Can inspect and edit code in an approved workspace.",
      "riskLevel": "high",
      "riskTags": ["read_local", "write_local", "shell_exec"]
    }
  ],
  "status": "available"
}
```

Agent location may also point to a platform-owned agent:

```json
{
  "id": "agt_platform_troubleshooter",
  "name": "Invocation Troubleshooter",
  "ownerUserId": "system",
  "location": {
    "type": "platform_agent"
  },
  "adapter": {
    "type": "platform"
  },
  "capabilities": [
    {
      "name": "troubleshoot_invocation",
      "description": "Summarizes failed invocations and suggests fixes."
    }
  ],
  "status": "available"
}
```

### Agent Lifecycle Operation

A lifecycle operation is a request to discover, install, enable, disable,
update, or uninstall an agent.

```json
{
  "id": "lco_123",
  "agentId": "agt_123",
  "deviceId": "dev_123",
  "requestedBy": "usr_123",
  "operation": "disable",
  "status": "queued",
  "reason": "Temporarily block remote invocation.",
  "createdAt": "2026-06-19T00:00:00Z"
}
```

### Integration Artifact

An integration artifact is generated or authored configuration/code for
connecting an unsupported or custom agent.

```json
{
  "id": "itg_123",
  "requestedBy": "usr_123",
  "targetType": "cli",
  "artifactType": "adapter_config",
  "reviewState": "needs_review",
  "generatedByAi": true,
  "summary": "CLI adapter config for research-agent.",
  "createdAt": "2026-06-19T00:00:00Z"
}
```

### Idea Session

An idea session groups a user's plain-language intent, clarification, proposed
plan, selected device or agent, approvals, invocations, artifacts, and result.

M0 may start without a durable `IdeaSession` table, but the protocol should keep
space for this concept so the product can evolve from direct invocation forms to
idea-to-outcome workflows.

```json
{
  "id": "ids_123",
  "workspaceId": "team_123",
  "createdBy": "usr_123",
  "title": "Summarize this repository",
  "originalIntent": "Summarize the current repository on my desktop.",
  "clarifiedIntent": "Summarize D:\\github\\perly6185-lab\\myagenttool with the local coding agent.",
  "status": "planned",
  "selectedDeviceId": "dev_123",
  "selectedAgentId": "agt_123",
  "planSummary": "Run Local Codex on Workstation against the selected repository.",
  "riskSummary": "May read local files. No file edits requested.",
  "costSummary": "Agent cost is unknown.",
  "dataSummary": "Status, logs, trace, and final output will be stored.",
  "invocationIds": [],
  "artifactIds": [],
  "approvalIds": [],
  "createdAt": "2026-06-19T00:00:00Z",
  "updatedAt": "2026-06-19T00:00:00Z"
}
```

### Invocation

An invocation is one request to one agent.

```json
{
  "id": "inv_123",
  "ideaSessionId": "ids_123",
  "agentId": "agt_123",
  "requestedBy": "usr_123",
  "status": "queued",
  "traceId": "trc_123",
  "rootSpanId": "spn_001",
  "delivery": {
    "deviceId": "dev_123",
    "state": "queued",
    "idempotencyKey": "idem_123",
    "leaseExpiresAt": null,
    "dispatchAttempts": 0,
    "lastDispatchAt": null,
    "acknowledgedAt": null,
    "expiresAt": "2026-06-19T01:00:00Z"
  },
  "cancellation": {
    "state": "none",
    "requestedBy": null,
    "requestedAt": null,
    "reason": null
  },
  "input": {
    "task": "Summarize the current repository."
  },
  "options": {
    "timeoutSeconds": 600
  },
  "createdAt": "2026-06-19T00:00:00Z"
}
```

### AI Provider

An AI provider describes model access managed by the platform.

```json
{
  "id": "aip_123",
  "ownerUserId": "usr_123",
  "provider": "openai",
  "mode": "byok",
  "allowedModels": ["gpt-5"],
  "status": "enabled",
  "createdAt": "2026-06-19T00:00:00Z"
}
```

### AI Usage Record

An AI usage record attributes model usage to a user, agent, invocation, and
provider.

```json
{
  "id": "aiu_123",
  "userId": "usr_123",
  "agentId": "agt_123",
  "invocationId": "inv_123",
  "deviceId": "dev_123",
  "provider": "openai",
  "model": "gpt-5",
  "providerMode": "byok",
  "inputTokens": 1200,
  "outputTokens": 300,
  "cachedTokens": 0,
  "reasoningTokens": 0,
  "estimatedCost": "0.0000",
  "ledgerEntryIds": [],
  "status": "succeeded",
  "createdAt": "2026-06-19T00:00:30Z"
}
```

### Ledger Entry

A ledger entry is the normalized economic fact for cost, revenue, chargeback,
settlement, credits, and billing.

```json
{
  "id": "led_123",
  "workspaceId": "team_123",
  "userId": "usr_123",
  "teamId": null,
  "agentId": "agt_123",
  "invocationId": "inv_123",
  "deviceId": "dev_123",
  "sourceType": "agent_invocation",
  "sourceRecordId": "inv_123",
  "entryType": "cost",
  "economicModel": "external_billed",
  "meterName": "per_invocation",
  "quantity": 1,
  "unitPrice": "0.0200",
  "currency": "USD",
  "amount": "0.0200",
  "amountDirection": "payable",
  "costOwner": "usr_123",
  "revenueOwner": null,
  "budgetPoolId": null,
  "counterparty": "example_provider",
  "provider": "example_provider",
  "billable": false,
  "status": "estimated",
  "createdAt": "2026-06-19T00:00:30Z",
  "finalizedAt": null
}
```

### Agent Economic Record

An agent economic record attributes cost, revenue, or chargeback to an agent
and optionally to a specific invocation. It should be treated as an agent-facing
view over ledger entries, not as a separate source of billing truth.

```json
{
  "id": "eco_123",
  "agentId": "agt_123",
  "invocationId": "inv_123",
  "userId": "usr_123",
  "teamId": null,
  "deviceId": "dev_123",
  "economicModel": "external_billed",
  "ledgerEntryIds": ["led_123"],
  "sourceType": "agent_invocation",
  "sourceRecordId": "inv_123",
  "meterName": "per_invocation",
  "quantity": 1,
  "unitPrice": "0.0200",
  "currency": "USD",
  "costAmount": "0.0200",
  "revenueAmount": "0.0000",
  "provider": "example_provider",
  "billable": false,
  "status": "estimated",
  "finalizedAt": null,
  "createdAt": "2026-06-19T00:00:30Z"
}
```

### Quota Decision

A quota decision records whether an AI or platform operation was allowed before
execution.

```json
{
  "id": "qtd_123",
  "subjectType": "user",
  "subjectId": "usr_123",
  "resourceType": "ai_model",
  "resourceId": "openai:gpt-5",
  "decision": "allowed",
  "reason": "within_monthly_token_limit",
  "createdAt": "2026-06-19T00:00:29Z"
}
```

### Invocation Event

Events make invocation execution observable and auditable.

```json
{
  "id": "evt_123",
  "invocationId": "inv_123",
  "type": "log",
  "level": "info",
  "message": "Agent started.",
  "createdAt": "2026-06-19T00:00:10Z"
}
```

### Trace

A trace represents the observable path of one invocation or lifecycle operation.

```json
{
  "id": "trc_123",
  "subjectType": "invocation",
  "subjectId": "inv_123",
  "rootSpanId": "spn_001",
  "createdAt": "2026-06-19T00:00:00Z"
}
```

### Span

A span represents one timed step in a trace.

```json
{
  "id": "spn_001",
  "traceId": "trc_123",
  "parentSpanId": null,
  "name": "gateway.dispatch_to_bridge",
  "status": "succeeded",
  "startedAt": "2026-06-19T00:00:01Z",
  "endedAt": "2026-06-19T00:00:02Z",
  "attributes": {
    "deviceId": "dev_123",
    "agentId": "agt_123"
  }
}
```

### Artifact

Artifacts are files, structured outputs, or links produced by an invocation.

```json
{
  "id": "art_123",
  "invocationId": "inv_123",
  "kind": "text",
  "name": "summary.md",
  "storageRef": "artifact://inv_123/summary.md",
  "createdAt": "2026-06-19T00:01:00Z"
}
```

## State Vocabulary

Invocation status, delivery state, cancellation state, and device unlink state
are canonical in [STATE_MACHINE.md](STATE_MACHINE.md).

Protocol implementations should not maintain a second enum list in this
document. Resource schemas may use these fields:

```text
Invocation.status
Invocation.delivery.state
Invocation.cancellation.state
Device.unlinkState
```

State changes should also produce append-only invocation events and audit
records.

## Team Roles

```text
owner
admin
operator
viewer
```

Suggested defaults:

- owner: manage team, devices, agents, policies, providers, and billing.
- admin: manage devices, agents, and policies.
- operator: invoke approved agents and inspect own invocation results.
- viewer: inspect allowed devices, agents, logs, traces, and audit records.

## Risk Levels

```text
low
medium
high
critical
```

## Capability Risk Tags

```text
read_only
read_local
write_local
network_access
credential_access
shell_exec
browser_control
desktop_control
destructive
budget_spending
policy_change
generated_code
secret_exposure
external_data_transfer
```

## AI Provider Modes

```text
byok
platform_managed
local_model
disabled
```

## Agent Economic Models

```text
free
external_billed
platform_billed
internal_chargeback
revenue_generating
rev_share
unknown
```

## Pricing Dimensions

```text
per_invocation
per_minute
per_token
per_request
per_success
per_artifact
per_seat
per_external_unit
fixed_monthly
custom_meter
```

## Agent Location Types

```text
local_device
remote_http
cloud_service
container
platform_agent
external
```

## Quota Decisions

```text
allowed
blocked_quota_exceeded
blocked_model_not_allowed
blocked_provider_disabled
blocked_missing_credential
```

## Agent Lifecycle States

```text
discovered
installing
installed
enabled
disabled
updating
uninstalling
uninstalled
failed
unknown
```

## Integration Artifact Types

```text
adapter_config
install_recipe
health_check
schema
redaction_policy
permission_policy
test_case
adapter_plugin
```

## Integration Review States

```text
draft
generated
needs_review
approved
tested
enabled
rejected
archived
```

## Idea Session States

Canonical `IdeaSession` states are defined in
[IDEA_TO_OUTCOME.md](IDEA_TO_OUTCOME.md).

```text
draft
clarifying
planned
needs_agent
needs_approval
running
completed
failed
cancelled
archived
```

## Agent Lifecycle Operations

```text
discover
install
configure
enable
disable
update
uninstall
health_check
```

## Event Types

```text
invocation_created
invocation_authorized
invocation_rejected
invocation_started
invocation_succeeded
invocation_failed
invocation_timed_out
invocation_expired
status_changed
log
agent_output
artifact_created
trace_created
span_started
span_completed
delivery_queued
delivery_dispatched
delivery_acknowledged
delivery_redelivered
cancel_requested
cancel_dispatched
cancel_acknowledged
cancel_applied
cancel_failed
permission_requested
permission_granted
permission_denied
local_approval_requested
local_approval_granted
local_approval_denied
policy_decision_recorded
risk_evaluated
alert_triggered
webhook_delivered
device_unlink_requested
device_dispatch_blocked
device_queue_cancelled
device_unlinked
error
heartbeat
lifecycle_requested
lifecycle_started
lifecycle_completed
lifecycle_failed
integration_generated
integration_reviewed
integration_tested
integration_enabled
platform_agent_started
platform_agent_recommended
platform_agent_action_requested
ai_usage_recorded
agent_economics_recorded
ledger_entry_recorded
budget_checked
settlement_recorded
quota_checked
billing_recorded
```

## Adapter Contract

Every adapter should implement the same conceptual contract:

```text
probe(config) -> AgentProbeResult
invoke(agent, input, options, eventSink, cancellationToken) -> InvocationResult
cancel(invocationId) -> CancelResult
```

The adapter is responsible for translating the internal invocation into the
target agent's native transport.

Adapters should implement `cancel` as a real operation when possible. CLI
adapters should propagate cancellation to the local process or process tree.
HTTP adapters should abort in-flight requests when supported.

Lifecycle-capable adapters may also implement:

```text
discover(discoveryConfig) -> AgentDiscoveryResult[]
install(agentPackage, options, eventSink) -> AgentLifecycleResult
enable(agentId, eventSink) -> AgentLifecycleResult
disable(agentId, eventSink) -> AgentLifecycleResult
update(agentId, version, eventSink) -> AgentLifecycleResult
uninstall(agentId, eventSink) -> AgentLifecycleResult
healthCheck(agentId) -> AgentHealthResult
```

## First Supported Adapters

### CLI Adapter

The CLI adapter invokes a local command.

It should support:

- Command allowlist.
- Structured argv execution across macOS, Windows, and Linux.
- Argument template.
- Working directory policy.
- Environment variable policy.
- Timeout.
- Stdout and stderr event streaming.
- Exit code mapping.
- Optional install, enable, disable, update, and uninstall commands when the
  agent is managed by this bridge.

### HTTP Adapter

The HTTP adapter invokes an HTTP endpoint.

It should support:

- Base URL.
- Auth configuration.
- Request schema.
- Timeout.
- Streaming response when available.
- Structured error mapping.
- Optional health check endpoint.

### Platform Adapter

The platform adapter invokes platform-owned agents. It should still produce
normal invocation events, AI usage records, quota checks, and audit records.

## Lifecycle Safety

Lifecycle operations should be explicit, auditable, and locally authorized. The
cloud can request installation or disabling, but the desktop bridge performs the
action and may require local approval.

## Future Protocol Compatibility

MCP and A2A should be treated as adapter targets:

- MCP for tools, resources, prompts, and local capability exposure.
- A2A for agent-to-agent messaging, task delegation, and interoperability.
