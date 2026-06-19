# Policy and Risk

myagenttool should classify agent capabilities by risk so permissions, approval,
UI warnings, audit, and automation can use the same language.

## Risk Levels

```text
low
medium
high
critical
```

Suggested interpretation:

- low: read-only metadata or status.
- medium: reads local or remote content but does not modify state.
- high: changes files, calls external networks, or uses credentials.
- critical: shell execution, destructive actions, budget spending, policy
  changes, generated code enablement, or browser/desktop control.

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

Agents and platform agents should declare capability risk tags.

## Approval Policy

Approval should depend on:

- User role.
- Device trust.
- Agent trust.
- Capability risk tags.
- Workspace policy.
- Invocation context.
- Data sensitivity.
- Budget impact.
- Agent economic model.
- Estimated cost or revenue.

Default posture:

- low: allow if user can invoke the agent.
- medium: allow with audit and optional local prompt.
- high: require policy approval or local confirmation.
- critical: require explicit approval and durable audit.

Economic policy examples:

- Warn when agent cost is unknown.
- Require approval above a cost threshold.
- Block when a budget pool is exhausted.
- Require review for revenue-share or payout-impacting agents.

## Policy Decision Records

Each policy decision should record:

- Subject.
- Resource.
- Action.
- Risk level.
- Capability tags.
- Decision.
- Reason.
- Approver when required.
- Created time.

## Milestone Boundary

M0 should support:

- Minimal ownership check.
- Basic action names such as `invoke`, `cancel`, and `view`.

M1 should support:

- Role-aware checks.
- Capability risk tags for agents.
- Local approval for high-risk invocations.

M2 should support:

- Policy review platform agent.
- Quota-aware policy decisions.
- Generated integration risk review.

M3 should support:

- Workspace policy templates.
- Enterprise approval workflows.
- Policy export and audit reporting.
