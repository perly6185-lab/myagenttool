# User Experience

myagenttool should be usable by non-professional users first, and professional
users second.

This does not mean removing advanced capability. It means the default product
experience should not require users to understand agent protocols, adapter
types, queues, policy engines, ledgers, or lifecycle terminology before they can
get value.

## Primary UX Principle

```text
The user should be able to describe what they want to do, choose from safe
recommendations, and understand what will happen before it happens.
```

Expert controls should exist, but they should be progressively disclosed.

The product should optimize for idea-to-outcome work:

```text
I know what I want -> help me clarify it -> pick or connect the right agent ->
run safely -> show me the result and what to do next
```

See [IDEA_TO_OUTCOME.md](IDEA_TO_OUTCOME.md) for the full flow.

## User Types

### Everyday User

An everyday user may know what outcome they want, but not how agents, bridges,
protocols, policies, queues, or billing records work.

They should be able to:

- Sign in.
- See their devices.
- See whether a device is online.
- Choose an available agent by task or capability.
- Ask the product to do something in plain language.
- Understand cost, risk, and data impact in simple terms.
- Approve or cancel work safely.
- See the final result and a plain-language summary of what happened.

### Power User

A power user understands agents and local tools but may not want to manage every
protocol detail.

They should be able to:

- Register CLI, HTTP, MCP, or other agents with guided forms.
- Review generated adapter configs.
- Adjust permissions, paths, environment variables, and redaction settings.
- Inspect logs, traces, and audit records.
- Configure BYOK providers and basic cost controls.

### Professional Operator

A professional operator needs deeper control.

They should be able to:

- Edit schemas, policies, adapter definitions, and lifecycle recipes.
- Use APIs, CLI, SDKs, and webhooks.
- Manage roles, quotas, billing, chargeback, and deployment settings.
- Export audit and operational data.

## Progressive Disclosure

The product should organize capability into layers:

```text
Simple task view -> Guided details -> Advanced configuration -> Raw protocol/API
```

Default screens should answer:

- What can I do?
- Which device or agent will do it?
- Is it safe?
- Will it cost money?
- What data may be read, written, uploaded, or retained?
- How do I stop it?
- Where can I see the result?

Advanced screens can show:

- Adapter type.
- Invocation id.
- Delivery state.
- Trace and span ids.
- Raw logs.
- Policy decision ids.
- Ledger entry ids.
- Retry and queue details.

## Natural Language Intent

Users should be able to express intent without knowing the target agent or
adapter.

Examples:

```text
Summarize this repository on my desktop.
Run my coding agent on the laptop.
Find which agents are available on this machine.
Connect my local research-agent command.
Stop the task that is currently running.
Explain why this invocation failed.
```

The product should translate intent into a proposed action:

- Target device.
- Target agent.
- Input.
- Required permissions.
- Risk summary.
- Estimated cost or unknown-cost warning.
- Data handling summary.
- Approval requirement.

The user should confirm high-risk actions before execution.

## Idea-to-Outcome Guidance

The default experience should begin with the user's intended outcome, not with
agent configuration.

The product should help the user:

- Clarify the goal.
- Identify missing context.
- Recommend an existing agent when possible.
- Offer to connect or configure an agent when needed.
- Explain the proposed plan in ordinary language.
- Run the work with visible progress.
- Turn the result into a next action, retry, saved task, or audit summary.

The user should not need to remember which feature handles discovery,
registration, invocation, cancellation, tracing, billing, or retention. The
product should route the user to the right capability based on intent.

## Guided Setup

First-run setup should be wizard-driven:

1. Create or sign in to an account.
2. Link this computer as a device.
3. Confirm what the Desktop Bridge can and cannot do.
4. Add or discover the first agent.
5. Run a safe test invocation.
6. Show result, audit summary, and how to stop future work.

The setup flow should avoid protocol-first language. For example:

- Prefer "Add an agent" over "Create adapter config".
- Prefer "This may edit files" over "Capability risk tag: write_local".
- Prefer "This task may cost money" over "Economic model is unknown".
- Prefer "This computer is offline" over "Bridge session disconnected".

## Safety Communication

Every risky action should explain:

- What will run.
- Where it will run.
- What data it may access.
- What it may change.
- Whether it may spend money or create revenue.
- Whether output, logs, prompts, or artifacts will be uploaded or retained.
- How cancellation works and whether cancellation is best-effort.

The product should avoid false certainty. If cancellation, cost, or data access
is unknown, the UI should say so clearly.

## Common User Journeys

### Turn an Idea Into a Result

```text
Describe outcome -> answer short questions -> review proposed plan -> run ->
watch progress -> inspect result -> choose next step
```

### Run an Existing Agent

```text
Choose task -> choose device/agent suggestion -> review risk/cost -> run ->
watch status -> get result -> inspect plain-language audit summary
```

### Add an Unsupported Agent

```text
Describe agent -> answer follow-up questions -> review generated connection ->
run local test -> enable -> run first task
```

### Stop Work

```text
Open active task -> click cancel -> see cancellation attempt -> see whether the
local process stopped, ignored cancellation, or already finished
```

### Understand a Failure

```text
Open failed invocation -> see plain-language explanation -> inspect logs if
needed -> retry, edit config, or ask troubleshooting platform agent
```

### Unlink a Device

```text
Choose device -> unlink -> choose what happens to device-related data -> confirm
queue cancellation and credential revocation -> see audit summary
```

## M0 UX Boundary

M0 should still be simple enough for a non-professional user to understand:

- One visible onboarding path.
- One device.
- Manual agent registration with guided labels.
- Plain-language invocation form.
- Visible online/offline status.
- Visible cancel button.
- Plain-language success, failure, timeout, and cancel states.
- Plain-language audit summary.

M0 can expose raw ids, logs, and state names in an advanced details section, but
they should not be required to complete the first successful invocation.

## M1 UX Boundary

M1 should add:

- Guided discovery results.
- Enable and disable actions with clear consequences.
- Health status that explains what failed.
- Local approval prompts written for a normal user.
- Role labels that explain what each role can do.
- First troubleshooting platform agent for failure explanation.

## M2 UX Boundary

M2 should add:

- Intent-to-integration flow.
- Reviewable generated configuration with plain-language diff summaries.
- Safe local probe results.
- Cost, revenue, quota, and retention explanations.
- Guided remediation when generated integration tests fail.

## M3 UX Boundary

M3 should add:

- Guided install, update, uninstall, and rollback flows.
- Clear recipe provenance and signature status.
- Billing and chargeback explanations.
- Private deployment controls that separate operator settings from everyday
  user tasks.

## UX Acceptance Gates

Every milestone should satisfy these gates:

- A non-professional user can complete the main happy path without reading
  protocol documentation.
- Dangerous actions require understandable confirmation.
- Expert details exist but do not dominate the default screen.
- Empty states explain the next useful action.
- Errors explain what happened and what the user can try next.
- Unknown cost, unknown risk, unknown data access, and best-effort cancellation
  are visible in plain language.
- Product terminology should map to user outcomes before internal architecture.
