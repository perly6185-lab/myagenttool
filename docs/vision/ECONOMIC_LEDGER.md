# Economic Ledger

This document defines the unified ledger model for AI usage, agent cost,
revenue, chargeback, settlement, and billing records.

Agent economics are broader than AI provider billing. A managed agent may call a
paid API, consume model tokens, trigger a billable workflow, generate revenue,
or require internal chargeback.

## Principles

- Usage records describe what happened.
- Ledger entries describe economic impact.
- A billable amount should have one authoritative ledger entry.
- Estimates should be marked as estimates and finalized later when possible.
- Finalized ledger entries should not be silently mutated; corrections should be
  represented as adjustment entries.
- BYOK provider usage can be metered without becoming platform-billed usage.
- Unknown cost or revenue should be visible instead of silently treated as free.

## Record Types

```text
AIUsageRecord
AgentEconomicRecord
LedgerEntry
BudgetReservation
SettlementRecord
InvoiceRecord
ChargebackExport
```

M0 does not need all of these records. The vocabulary exists so later billing
and reporting can grow without changing the product meaning.

## Ledger Entry

`LedgerEntry` is the normalized economic fact.

Recommended fields:

```text
id
workspaceId
userId
teamId
agentId
invocationId
deviceId
sourceType
sourceRecordId
entryType
economicModel
meterName
quantity
unitPrice
currency
amount
amountDirection
costOwner
revenueOwner
budgetPoolId
counterparty
provider
billable
status
createdAt
finalizedAt
```

Supported `sourceType` values:

```text
ai_usage
agent_invocation
external_provider
manual_adjustment
subscription
marketplace
settlement
```

Supported `entryType` values:

```text
usage
cost
revenue
chargeback
credit
debit
reservation
release
settlement
adjustment
tax
```

Supported `amountDirection` values:

```text
payable
receivable
internal
informational
```

Supported `status` values:

```text
estimated
reserved
finalized
voided
adjusted
exported
settled
```

## AI Usage and Ledger Roll-up

`AIUsageRecord` stores model usage facts:

```text
provider
model
providerMode
inputTokens
outputTokens
cachedTokens
reasoningTokens
requestCount
estimatedCost
```

AI usage becomes ledger impact only when policy says it should.

Examples:

- BYOK mode: create an `AIUsageRecord`; optionally create an informational
  estimated cost ledger entry with `billable=false`.
- Platform-managed mode: create an `AIUsageRecord` and a billable cost ledger
  entry with `sourceType=ai_usage`.
- Local model mode: create an `AIUsageRecord`; mark cost as local or unknown
  unless configured.

Roll-up rule:

```text
Invocation total cost = sum finalized or estimated cost ledger entries linked
to the invocation.

Invocation total revenue = sum finalized or estimated revenue ledger entries
linked to the invocation.
```

The same AI usage should not also be counted as agent cost unless the agent cost
entry references the AI usage as its source or explicitly includes it as a
rolled-up component.

## Agent Economic Record

`AgentEconomicRecord` is the agent-facing view of ledger impact.

It should answer:

```text
Which agent created cost, revenue, chargeback, or settlement impact, and why?
```

It may be implemented as a view over ledger entries or as a separate record that
links to ledger entries.

Recommended fields:

```text
id
agentId
invocationId
economicModel
ledgerEntryIds
costAmount
revenueAmount
chargebackAmount
currency
status
createdAt
```

## Budget Reservations

Before execution, the policy engine may create a budget reservation.

Recommended flow:

```text
estimate cost -> reserve budget -> run invocation -> finalize usage -> release
unused reservation -> record final cost
```

Reservations should expire if the invocation expires, is cancelled before
execution, or fails before consuming the reserved resource.

## Revenue and Settlement

Revenue-producing agents should record revenue separately from cost.

Settlement records should be used when money, credits, or obligations move
between parties:

```text
platform
agent_author
workspace_owner
external_provider
customer
```

Revenue-share records should include:

```text
grossRevenue
platformFee
agentAuthorShare
workspaceShare
currency
settlementStatus
```

Marketplace payouts and automated settlement can remain future work.

## Registration-time Economic Metadata

Manual registration and Integration Builder should ask for:

- Economic model: free, external billed, platform billed, internal chargeback,
  revenue generating, rev-share, or unknown.
- Pricing dimensions.
- Whether cost is estimated or authoritative.
- Cost owner.
- Budget pool.
- Revenue owner when applicable.
- Provider or counterparty.
- Currency.
- Whether platform billing is allowed.
- Whether unknown cost should warn, require approval, or block execution.

## Policy Integration

Policy can use ledger metadata to:

- Warn when an agent has unknown cost or revenue.
- Require approval above estimated cost thresholds.
- Block invocations when budget is exhausted.
- Require review for revenue-share or payout-impacting agents.
- Limit platform-managed AI usage by user, team, agent, provider, or model.
- Export chargeback data for private or self-hosted deployments.

## Reporting Views

Useful views:

- Cost by user.
- Cost by team.
- Cost by device.
- Cost by agent.
- Cost by invocation.
- AI provider usage by model.
- External provider estimated spend.
- Revenue by agent.
- Chargeback by cost center.
- Settlement by counterparty.

## Retention and Audit

Raw prompts, logs, and outputs can follow configurable retention policies.
Finalized economic records need stronger retention because they may support
billing, chargeback, tax, settlement, or dispute review.

Ledger audit should record:

- Who or what created the entry.
- Source record and source type.
- Pricing version or estimation rule.
- Whether the entry is estimated or finalized.
- Any adjustment relationship.
- Export, invoice, or settlement references.

## Milestone Boundary

M0 should support:

- Agent economics metadata with default `unknown`.
- No platform billing automation.
- No finalized ledger requirement.

M1 should support:

- Usage counts by agent and invocation.
- Cost owner metadata.
- AI usage records for platform helper features.

M2 should support:

- Estimated ledger entries for cost and revenue.
- Budget and quota policy hooks.
- Integration Builder economic prompts.
- Cost and revenue reporting views.

M3 should support:

- Platform-managed AI billing.
- Credits, usage caps, invoices, or payment integration.
- Team cost allocation.
- Internal chargeback export.
- Revenue-share records.

Future milestones can support:

- Marketplace payouts.
- Automated provider settlement.
- Advanced pricing rules.
- Tax-aware invoicing.
