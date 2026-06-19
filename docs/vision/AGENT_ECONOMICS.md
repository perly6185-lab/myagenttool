# Agent Economics

Different agents may create cost, revenue, credits, or settlement obligations.

myagenttool should let users and teams declare an agent's economic model during
registration or integration, then attribute cost and revenue to invocations.

This is broader than AI provider billing. It covers external APIs, paid tools,
human services, revenue-generating agents, marketplace agents, and internal
chargeback.

## Economic Model Types

```text
free
external_billed
platform_billed
internal_chargeback
revenue_generating
rev_share
unknown
```

### free

The agent has no known direct cost or revenue.

### external_billed

The user or team pays an external provider directly. myagenttool records usage
and estimated cost for governance.

### platform_billed

myagenttool bills the user or team for agent usage.

### internal_chargeback

Usage is charged to an internal team, project, cost center, or budget pool.

### revenue_generating

The agent may generate revenue, such as completing paid work or triggering a
customer-facing billable action.

### rev_share

Revenue is split among the platform, agent provider, team, or other parties.

### unknown

The model is not configured. The platform should still track invocation counts
and mark cost or revenue as unknown.

## Pricing Dimensions

Agents may declare pricing dimensions such as:

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

## Cost and Revenue Records

Each cost or revenue record should include:

- Record id.
- Agent id.
- Invocation id when applicable.
- User id.
- Team id when applicable.
- Device id when applicable.
- Economic model.
- Meter name.
- Quantity.
- Unit price.
- Currency.
- Cost amount.
- Revenue amount.
- Provider or counterparty.
- Status.
- Created time.

## Registration and Integration

During manual registration or Integration Builder flow, the user should be able
to declare:

- Whether the agent is free, externally billed, platform billed, internal
  chargeback, revenue generating, rev-share, or unknown.
- Pricing dimensions.
- Cost owner.
- Budget pool.
- Currency.
- Provider.
- Revenue share rules when applicable.
- Whether usage records are estimates or authoritative.

If this is unknown, the platform should default to `unknown` rather than hiding
the economic uncertainty.

## Policy and Quota

Economics should feed policy decisions.

Examples:

- Block invocation if budget is exhausted.
- Require approval above an estimated cost threshold.
- Warn if cost is unknown.
- Route to a cheaper agent when multiple agents provide similar capabilities.
- Track revenue-producing invocations separately from cost-only invocations.

## Settlement

Settlement can be added in later milestones.

Possible settlement targets:

- User invoice.
- Team invoice.
- Internal chargeback export.
- Agent provider payout.
- Marketplace payout.
- Revenue-share report.

## Audit

Economic audit records should answer:

- Who invoked the agent?
- Which economic model applied?
- Was cost estimated or authoritative?
- Who pays?
- Who receives revenue?
- Which budget or cost center was used?
- Did policy allow, warn, or block the invocation?

## Milestone Boundary

M0 should support:

- Agent economics as optional metadata with default `unknown`.

M1 should support:

- Usage count by agent and invocation.
- Cost owner metadata.

M2 should support:

- Estimated cost and revenue records.
- Budget and quota policy hooks.
- Integration Builder prompts for economics.

M3 should support:

- Platform billing integration.
- Internal chargeback export.
- Revenue-share records.

M4 or later can support:

- Marketplace payouts.
- Automated provider settlement.
- Advanced pricing rules.
