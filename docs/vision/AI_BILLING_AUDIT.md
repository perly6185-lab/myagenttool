# AI Usage, Billing, and Audit

myagenttool may use AI capabilities as part of the platform, but it should not
become a repository for business-specific agent implementation.

AI usage must be governed like any other powerful capability: attributable,
metered, quota-aware, billable, and auditable.

Agent-level cost and revenue are broader than AI provider billing. See
[AGENT_ECONOMICS.md](AGENT_ECONOMICS.md).

## AI Capability Scope

Platform-managed AI can be used for:

- Agent metadata summarization.
- Invocation result summarization.
- Log summarization.
- Agent recommendation or routing assistance.
- Policy explanation.
- Optional model access for managed agents that choose to use the platform AI
  gateway.

Platform-managed AI should not be used to hide business-agent logic inside this
repository.

## Provider Modes

```text
byok
platform_managed
local_model
disabled
```

### Bring Your Own Key

Users or teams provide their own provider credentials.

Recommended behavior:

- Store credentials securely.
- Attribute usage to the user or team.
- Meter usage for audit and quota even if the provider bills the user directly.

### Platform Managed

The platform owns provider credentials and bills users or teams through
myagenttool.

Recommended behavior:

- Enforce quotas before requests.
- Estimate cost after requests.
- Store billing records.
- Support credits, plans, or invoices later.

### Local Model

The bridge can call local model providers when configured.

Recommended behavior:

- Keep provider endpoint and credentials local when possible.
- Still record usage attribution and audit metadata.
- Mark cost as local or unknown unless configured.

## Usage Metering

Every platform-managed AI call should create an AI usage record.

Minimum fields:

- Usage id.
- User id.
- Team id when applicable.
- Agent id when applicable.
- Invocation id when applicable.
- Device id when applicable.
- Provider.
- Model.
- Provider mode.
- Input token count when available.
- Output token count when available.
- Cached token count when available.
- Reasoning token count when available.
- Request count.
- Latency.
- Status.
- Error code when failed.
- Estimated cost.
- Created time.

## Quotas

Initial quota dimensions:

- Per user.
- Per team.
- Per provider.
- Per model.
- Per agent.
- Per time window.

Quota decisions should be recorded before model calls.

Example decisions:

```text
allowed
blocked_quota_exceeded
blocked_model_not_allowed
blocked_provider_disabled
blocked_missing_credential
```

## Billing

Billing can evolve in phases.

### Phase 1: Usage Reporting

- Store usage records.
- Show estimated cost in the console.
- Export usage by user, team, agent, and invocation.
- Link AI usage records to agent economics when an agent has cost, revenue,
  chargeback, or settlement metadata.

### Phase 2: Credits and Limits

- Team or user credit balance.
- Monthly usage caps.
- Hard and soft limits.
- Low-balance notifications.

### Phase 3: Paid Plans

- Subscription plans.
- Invoice generation.
- Payment provider integration.
- Tax and compliance handling.

## Audit

AI audit records should answer:

- Who used AI?
- Which agent or platform feature used it?
- Which provider and model were used?
- Which invocation caused it?
- Which device was involved?
- Was the request allowed by policy?
- How much usage and estimated cost were recorded?
- Was sensitive data redacted or retained?

## Data Retention

Retention should be configurable.

Recommended defaults:

- Store metadata, usage, and cost.
- Store prompts and responses only when explicitly enabled or required for audit.
- Redact configured secrets and local paths.
- Allow shorter retention for raw model inputs and outputs.

AI data ownership follows the workspace that caused the AI call. See
[DATA_GOVERNANCE.md](DATA_GOVERNANCE.md).

## Milestone Boundary

M1 should support:

- AI provider configuration.
- BYOK mode.
- Usage records.

M2 should support:

- Basic quotas.
- Audit linkage to invocation, agent, user, and device.
- Platform-managed mode as a schema and policy concept.

M3 can add:

- Payment integration.
- Invoice generation.
- Complex enterprise chargeback.
- Fine-grained prompt retention policies.
- Model hosting.
