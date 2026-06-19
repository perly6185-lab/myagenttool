# Architecture

myagenttool separates the cloud control plane from local execution.

The cloud owns identity, registry, routing, policy, and audit. The local desktop
bridge owns local agent access and final execution on macOS, Windows, and Linux
machines.

The architecture includes long-term components. M0 should implement only the
remote invocation loop: account, device, registry, gateway, bridge dispatch,
events, traces, and audit.
M0 also includes queued delivery for offline devices and cancellation
propagation to the bridge and local process.

The same logical architecture should support SaaS, self-hosted, and private
deployment models. See [DEPLOYMENT.md](DEPLOYMENT.md).

## High-Level Diagram

```text
User / API Client / Web Console
        |
        v
Cloud Agent Gateway
        |
        +--> Account and Permission Service
        +--> Agent Registry
        +--> Idea Session Service
        +--> Agent Lifecycle Service
        +--> Agent Integration Builder
        +--> Platform Agent Runtime
        +--> Device Registry
        +--> AI Provider Gateway
        +--> Usage Metering and Billing
        +--> Agent Economics Service
        +--> Policy and Risk Engine
        +--> Developer API
        +--> Extension Catalog
        +--> Alerting Service
        +--> Invocation Orchestrator
        +--> Invocation Queue
        +--> Audit Log
        |
        v
Realtime Channel
        |
        v
Desktop Local Agent Bridge
        |
        +--> CLI Adapter
        +--> HTTP Adapter
        +--> MCP Adapter
        +--> Lifecycle Manager
        +--> Future A2A Adapter
        |
        v
External Agents
```

## Deployment View

```text
SaaS:         myagenttool operates Control Plane; users run Desktop Bridges.
Self-hosted:  user/team operates Control Plane and Desktop Bridges.
Private:      customer operates Control Plane in controlled infrastructure.
```

The Desktop Local Agent Bridge uses outbound connections in all deployment
models.

## Core Components

### Web Console

The web console is the management surface for:

- Account sign-in.
- Device list and online status.
- Agent list and capabilities.
- Invocation creation.
- Invocation status, logs, artifacts, and audit history.
- Idea-to-outcome planning, pre-run review, and result explanation.
- Trace and span views for the platform-controlled invocation path.
- Agent discovery, installation, enable, disable, update, and uninstall actions
  in later milestones.
- Unsupported-agent integration builder and review workflow in later milestones.
- Platform-agent entry points for guided onboarding, troubleshooting, audit, and
  cost analysis in later milestones.
- AI provider configuration, quota, usage, and billing views in later
  milestones.
- Developer API keys, webhooks, extension catalog, and alert settings in later
  milestones.

### Server

The server is the cloud control plane:

- Authenticates users and devices.
- Stores registered agents and device ownership.
- Accepts invocation requests.
- Stores idea sessions that group intent, plans, approvals, invocations,
  artifacts, and results when the idea-to-outcome flow is enabled.
- Applies permission checks.
- Queues invocations when target devices are offline.
- Routes requests to online desktop bridges or remote HTTP agents.
- Dispatches queued invocations when desktop bridges reconnect.
- Propagates cancellation to the bridge and records cancellation outcomes.
- Records traces, spans, invocation events, and final results.
- Stores lifecycle state for managed agents in later milestones.
- Generates and stores reviewable integration artifacts for unsupported agents
  in later milestones.
- Runs governed platform agents through the same gateway, permission, metering,
  and audit model used for external agents in later milestones.
- Routes platform-managed AI calls through an AI Provider Gateway when needed in
  later milestones.
- Records AI usage, quota decisions, and billing events in later milestones.
- Records agent economic metadata, cost, revenue, chargeback, and settlement
  events in later milestones.
- Evaluates capability risk and policy decisions in later milestones.
- Serves developer APIs, webhooks, extension catalog, and alerting in later
  milestones.

### Desktop Local Agent Bridge

The bridge runs on the user's machine:

- Signs in as a user-owned device.
- Runs on macOS, Windows, and Linux.
- Maintains an outbound realtime connection to the server.
- Announces device identity and last acknowledged delivery cursor on reconnect.
- Registers local agents.
- Discovers, installs, enables, disables, updates, and uninstalls approved local
  agents in later milestones.
- Receives invocation requests.
- Acknowledges delivery only after durable local acceptance, or participates in
  server-side lease and redelivery handling.
- Applies local permission checks.
- Calls local agents through adapters.
- Propagates cancellation to adapters and local processes when supported.
- Streams logs and results back to the server.

The bridge should connect outward to the server. The server should not require
inbound network access to the user's machine.

Platform-specific behavior should be isolated behind bridge services for process
execution, file paths, environment variables, shell discovery, keychain access,
service management, and notification prompts.

### Agent Registry

The registry stores managed agent metadata:

- Agent identity.
- Owning user or team.
- Runtime location: local device, cloud endpoint, container, or external service.
- Adapter type: CLI, HTTP, MCP, or future A2A.
- Capabilities and input schema.
- Required permissions.
- Status and version metadata.
- Lifecycle state.

### Idea Session Service

The idea session service groups a user's intent, clarification, proposed plan,
selected device or agent, approvals, invocations, artifacts, results, and next
steps.

M0 can start with a simple task field and pre-run review. Later milestones can
persist full idea sessions.

See [IDEA_TO_OUTCOME.md](IDEA_TO_OUTCOME.md).

### Agent Lifecycle Service

The lifecycle service manages non-invocation operations for local agents:

- Discovery.
- Installation.
- Configuration.
- Enable and disable.
- Update.
- Uninstall.
- Health check.

The server records requested lifecycle operations and policy decisions. The
desktop bridge performs local actions after applying local permission rules.

### Agent Integration Builder

The integration builder converts user intent into integration artifacts:

- Adapter configuration.
- Install recipe.
- Health check.
- Input and output schema.
- Redaction policy.
- Permission policy suggestion.
- Test cases.
- Adapter plugin code when declarative config is not enough.

Generated artifacts must be reviewed, tested, approved, and enabled before real
invocations. The desktop bridge performs local probes and sandbox-style tests.

### Platform Agent Runtime

Some myagenttool capabilities can be exposed as internal platform agents.

Examples:

- Agent onboarding assistant.
- Integration builder agent.
- Invocation troubleshooting agent.
- Permission and policy review agent.
- Audit analysis agent.
- Usage and cost analysis agent.

Platform agents should be registered, invoked, metered, and audited like any
other managed agent. They may propose actions, generate plans, and prepare
artifacts, but high-risk actions still require policy checks and approval.

### Agent Gateway

The gateway provides a single invocation interface:

```text
invoke(agent_id, input, options) -> invocation_id
```

The gateway hides the transport details of each target agent. It decides whether
the call goes directly to an HTTP service, to a local bridge, or to another
adapter.

### AI Provider Gateway

The AI Provider Gateway is used when myagenttool itself needs model calls for
platform features or when a managed agent elects to use platform-managed model
access.

It should support:

- Provider configuration.
- Bring-your-own-key or platform-managed credentials.
- Model allowlists.
- Request attribution to user, device, agent, and invocation.
- Quota checks before calls.
- Usage records after calls.
- Redaction and retention policy.

It should not turn this repository into a business-agent implementation space.

### Usage Metering and Billing

Usage metering records AI and platform resource usage:

- Model provider and model.
- Input, output, cached, and reasoning token counts when available.
- Request count.
- Latency and error status.
- Estimated cost.
- User, team, agent, and invocation attribution.

Billing can start as internal usage reporting and later become invoices,
subscriptions, credits, or prepaid quota.

### Agent Economics Service

The economics service tracks economic metadata and usage records for agents that
may incur cost, create revenue, require chargeback, or participate in settlement.

See [AGENT_ECONOMICS.md](AGENT_ECONOMICS.md).
See [ECONOMIC_LEDGER.md](ECONOMIC_LEDGER.md) for normalized ledger entries and
AI usage roll-up.

### Policy and Risk Engine

The policy and risk engine maps roles, resources, actions, risk tags, and
approval requirements into policy decisions.

See [POLICY_AND_RISK.md](POLICY_AND_RISK.md).

### Developer API

The developer API exposes device, agent, invocation, trace, audit, lifecycle,
and integration operations to CLIs, SDKs, and external systems.

See [DEVELOPER_EXPERIENCE.md](DEVELOPER_EXPERIENCE.md).

### Extension Catalog

The extension catalog stores reviewed adapter configs, adapter plugins, install
recipes, health checks, schemas, and generated integration artifacts.

See [EXTENSION_DISTRIBUTION.md](EXTENSION_DISTRIBUTION.md).

### Alerting Service

The alerting service detects operational and security-relevant signals such as
device offline, queue backlog, failed invocations, quota thresholds, and
suspicious activity.

See [OPERATIONS_ALERTING.md](OPERATIONS_ALERTING.md).

### Invocation Orchestrator

The orchestrator tracks invocation lifecycle using the canonical state model in
[STATE_MACHINE.md](STATE_MACHINE.md).

### Invocation Queue

The invocation queue stores work for online and offline devices.

It should support:

- Creating invocations for offline devices.
- Dispatching pending work when a bridge reconnects.
- Delivery acknowledgement.
- Idempotent redelivery by invocation id.
- Queue expiration.
- Cancellation before execution.
- Cancellation propagation for dispatched or running work.

See [INVOCATION_DELIVERY.md](INVOCATION_DELIVERY.md).

## Recommended Initial Repository Shape

```text
apps/
  web/
  server/
  desktop/

packages/
  protocol/
  adapters/
  shared/
```

## First Data Flow

```text
1. User creates invocation in Web Console.
2. Server validates account and permission.
3. Server creates Invocation, Trace, Span, and InvocationEvent records.
4. Server queues the invocation if the device is offline, or dispatches it if
   the bridge is online.
5. Bridge acknowledges delivery.
6. Bridge validates local policy.
7. Bridge invokes the target local agent through an adapter.
8. Bridge streams logs and status events.
9. Server stores events and forwards them to the Web Console.
10. Bridge sends final result.
11. Server marks invocation complete and records audit details.
```

## Adapter Strategy

Adapters convert heterogeneous agent runtimes into one internal protocol.

Initial adapters:

- CLI: spawn a local command with controlled arguments and environment.
- HTTP: call an agent service with a configured endpoint and auth method.

Later adapters:

- MCP: connect to MCP servers and expose tools/resources as agent capabilities.
- A2A: call agents that support agent-to-agent interoperability.
- Container: run local or remote containerized agents.

## State Model

The server should store authoritative cloud state:

- Users.
- Teams.
- Devices.
- Agents.
- Agent capabilities.
- Permission policies.
- Policy decisions.
- Risk classifications.
- Invocations.
- Idea sessions.
- Invocation queue records.
- Traces and spans.
- Invocation events.
- Artifacts.
- Audit records.
- Agent lifecycle operations.
- AI providers.
- AI usage records.
- Quota and billing records.
- Agent economics records.
- Ledger entries.
- Cost and revenue records.
- Integration artifacts.
- Integration review records.
- Platform agent definitions.
- Developer API keys.
- Webhook subscriptions.
- Extension catalog entries.
- Alert rules and alert events.

The desktop bridge should store local state:

- Device identity and key material.
- Local agent configs.
- Local agent installation metadata.
- Enabled and disabled state.
- Local permission preferences.
- Local cache of pending invocations.
- Temporary logs and artifacts before upload.

## Platform Support

See [PLATFORM_SUPPORT.md](PLATFORM_SUPPORT.md) for macOS, Windows, and Linux
bridge requirements.
