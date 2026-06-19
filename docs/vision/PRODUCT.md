# Product Scope

myagenttool is a personal and small-team Agent Control Plane.

It manages agents that already exist. It does not define, train, or implement
domain-specific business agents inside this repository.

## Positioning

```text
Register agents, route calls, enforce permission, observe execution, and audit
what happened.
```

myagenttool is for people and small teams that use multiple agents across local
machines, cloud services, internal tools, and third-party systems.

## Target Users

- Individual developers using multiple local or cloud agents.
- Small teams that need shared access to internal automation agents.
- Builders who want a light control plane before adopting a heavy enterprise
  agent platform.
- Users who want remote access to agents on their own machines while keeping
  local execution under local control.
- Non-professional users who know what outcome they want but do not want to
  learn agent protocols, adapter types, queue semantics, or billing internals.
- Users who have an idea or task and need the product to guide them from intent
  to result without requiring professional agent-operations knowledge.
- Users and teams working across macOS, Windows, and Linux machines.

## Product Pillars

### Agent Registry

Register managed agents, their locations, adapters, capabilities, lifecycle
state, and required permissions.

### User Experience

Default to guided, plain-language workflows for non-professional users. Expose
advanced configuration, protocol details, raw logs, and API controls only when
users need them.

### Idea to Outcome

Help users start from what they want to accomplish, clarify the goal, select or
connect the right agent, review risk/cost/data impact, run safely, and understand
the result.

### Agent Gateway

Provide one invocation surface for local, cloud, HTTP, CLI, MCP, A2A, platform,
and third-party agents.

### Local Agent Bridge

Run on macOS, Windows, and Linux machines. The bridge owns local execution,
local approval, local credentials, local agent access, and local lifecycle
actions.

### Observability and Audit

Record invocation state, logs, events, artifacts, traces, spans, permission
decisions, lifecycle operations, generated integrations, and AI usage.

### Data Governance

Treat user data as user-owned. Make data location, retention, export, deletion,
and device unlinking behavior explicit.

### Policy and Risk

Classify agent capabilities by risk so approval, audit, UI warnings, and
automation use the same vocabulary.

### Agent Lifecycle

Discover, enable, disable, health-check, install, update, and uninstall approved
local agents through explicit bridge actions. Early versions should start with
manual registration, enable/disable, and health checks.

### Integration Builder

Let users describe unsupported or custom agents. Generate reviewable adapter
configs, schemas, health checks, recipes, tests, and custom integration
artifacts when needed.

### AI Usage Governance

Route necessary platform AI calls, support BYOK and later platform-managed
provider modes, meter usage, enforce quotas, support billing, and audit model
access.

### Agent Economics

Model cost, revenue, chargeback, budget, and settlement metadata for managed
agents, including external agents that are billed outside the platform.

### Deployment Flexibility

Support SaaS, self-hosted, and private deployment models while keeping the same
local bridge architecture and local execution boundary.

### Developer Experience

Provide APIs, CLI, SDKs, webhooks, adapter authoring guidance, and local testing
tools for developers and operators.

### Extension Distribution

Support safe versioning, review, signing, and distribution of adapters, recipes,
platform agents, and integration artifacts over time.

### Operations and Alerting

Surface device, queue, invocation, health, quota, budget, and suspicious activity
signals through console views, notifications, webhooks, and private deployment
exports.

### Platform Agents

Expose selected control-plane capabilities as governed internal agents, such as
onboarding, troubleshooting, policy review, audit analysis, integration
generation, and cost analysis.

## What This Project Does

- Registers agents and their capabilities.
- Exposes a unified gateway for invoking registered agents.
- Bridges cloud requests to local agents through a desktop bridge.
- Supports macOS, Windows, and Linux terminals through a common bridge model.
- Supports SaaS, self-hosted, and private deployment models.
- Tracks devices, sessions, permissions, invocations, logs, traces, artifacts,
  lifecycle operations, generated integrations, AI usage, and audit records.
- Provides explicit data ownership, retention, export, deletion, and device
  unlinking controls.
- Classifies capability risk and ties risk to permission, approval, and audit.
- Tracks agent-level economic metadata, usage, cost, revenue, and budget impact
  over time.
- Provides developer-facing APIs and extension points over time.
- Provides operational status, alerting, and export paths over time.
- Provides a management console for account, device, agent, invocation,
  observability, governance, and audit views.
- Provides guided workflows that let non-professional users run, stop, connect,
  and understand agents without memorizing internal product concepts.
- Helps users turn an idea into an actionable plan, agent selection, execution,
  result summary, and next step.

## What This Project Does Not Do

- It does not implement specific business agents.
- It does not replace existing agent frameworks.
- It does not give the cloud unrestricted control of a local machine.
- It does not require all agents to use the same runtime.
- It does not silently install, disable, or remove arbitrary local software.
- It does not silently deploy AI-generated integration code.
- It does not allow platform-owned agents to bypass normal permission, quota, or
  audit controls.
- It does not become a business-agent implementation repository just because it
  can route or meter AI model calls.

## Example Managed Agents

- Local CLI agents such as coding assistants or automation scripts.
- HTTP-based agent services.
- MCP servers exposing tools and resources.
- Workflow systems such as self-hosted automation platforms.
- Internal company agents deployed as containers or services.
- Future A2A-compatible agents.
- Platform-owned agents for control-plane operations.

## Milestones

See [ROADMAP.md](ROADMAP.md) for the milestone plan.
See [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) for milestone acceptance
criteria.
See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment models and commercial
boundaries.
See [AGENT_ECONOMICS.md](AGENT_ECONOMICS.md) for agent cost and revenue models.
See [ECONOMIC_LEDGER.md](ECONOMIC_LEDGER.md) for cost, revenue, AI usage,
chargeback, and settlement roll-up.
See [STATE_MACHINE.md](STATE_MACHINE.md) for invocation, delivery,
cancellation, and unlinking states.
See [DATA_GOVERNANCE.md](DATA_GOVERNANCE.md) for data ownership and retention.
See [USER_EXPERIENCE.md](USER_EXPERIENCE.md) for non-professional-user-first
product principles.
See [IDEA_TO_OUTCOME.md](IDEA_TO_OUTCOME.md) for turning user intent into safe
agent execution.
See [AGENT_ADAPTER_MATRIX.md](AGENT_ADAPTER_MATRIX.md) for example agent
families and adapter paths.
See [POLICY_AND_RISK.md](POLICY_AND_RISK.md) for risk classification.
See [DEVELOPER_EXPERIENCE.md](DEVELOPER_EXPERIENCE.md) for APIs and tooling.
See [EXTENSION_DISTRIBUTION.md](EXTENSION_DISTRIBUTION.md) for extension safety.
See [OPERATIONS_ALERTING.md](OPERATIONS_ALERTING.md) for operational signals.

Short version:

- M0: remote invocation loop.
- M1: local agent management.
- M2: integration builder and governance.
- M3: lifecycle automation and billing.
- M4: marketplace and ecosystem.

## M0 Success Criteria

M0 is successful when a non-professional user can start from a plain-language
task, review the proposed device, agent, risk, cost, data handling, and
cancellation behavior, run one manually registered CLI or HTTP agent through the
Desktop Bridge, watch status and logs, receive the result, cancel queued or
running work where supported, and inspect plain-language audit and trace
summaries.

Detailed milestone acceptance criteria are defined in
[ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md).
