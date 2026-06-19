# Platform Agents

Some myagenttool modules can become agents themselves.

These are platform-owned agents: they automate control-plane workflows such as
onboarding, troubleshooting, policy review, audit analysis, usage analysis, and
integration generation.

They are different from business agents. Their job is to help operate the agent
control plane.

## Examples

```text
agent_onboarding_agent
integration_builder_agent
invocation_troubleshooter_agent
policy_review_agent
audit_analyst_agent
cost_analyst_agent
lifecycle_advisor_agent
```

## Design Principle

Platform agents must not bypass governance.

They should use the same system path as external agents:

```text
Agent Registry
Agent Gateway
Permission checks
AI usage metering
Quota checks
Invocation events
Trace and audit records
```

## Allowed Behaviors

Platform agents may:

- Explain system state.
- Summarize logs and traces.
- Recommend permissions.
- Generate integration configs.
- Draft lifecycle operations.
- Estimate usage and cost.
- Produce reviewable plans.

Platform agents should not directly perform high-risk actions without approval.

## High-Risk Actions

These require explicit policy checks and approval:

- Installing an agent.
- Uninstalling an agent.
- Disabling an agent used by other users.
- Changing permission policies.
- Spending platform-managed AI budget.
- Uploading sensitive local artifacts.
- Enabling generated adapter code.

## Invocation Flow

```text
1. User invokes a platform agent from the Web Console.
2. Agent Gateway checks permission and quota.
3. Platform agent reads allowed control-plane context.
4. Platform agent produces explanation, recommendation, plan, or artifact.
5. User reviews the proposed action.
6. If approved, the normal lifecycle, integration, or invocation workflow runs.
7. All events are recorded in audit and trace history.
```

## Milestone Boundary

For M0, platform agents can remain a documented vision.

For M1, a useful first platform agent is:

- Invocation troubleshooting agent: summarize failed invocations, logs, bridge
  status, adapter errors, and suggested fixes.

For M2, platform agents can expand to:

- Integration builder agent.
- Policy review agent.
- Usage and cost analyst.
- Lifecycle advisor.
