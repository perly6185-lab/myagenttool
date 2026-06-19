# Agent Integration Builder

The Agent Integration Builder helps users connect agents that myagenttool does
not support yet.

Users describe the agent they want to connect. The platform turns that intent
into an integration plan, adapter configuration, install recipe, tests, and
reviewable code or metadata when needed.

This capability extends the control plane. It should not move business-agent
implementation into this repository.

## User Intent

The user can express intent in natural language or structured fields.

Examples:

```text
I have a local CLI agent named research-agent. It runs with:
research-agent run --task "<task>"

It needs WORKSPACE_DIR and API_TOKEN environment variables.
It writes JSON lines to stdout and returns exit code 0 on success.
```

```text
I have an internal HTTP agent at https://agent.internal/run.
It accepts POST JSON with task and context fields.
It streams events as server-sent events.
```

## Generated Outputs

The builder may generate:

- Agent registration metadata.
- CLI adapter configuration.
- HTTP adapter configuration.
- MCP server configuration.
- Install or update recipe.
- Health check definition.
- Input and output schema.
- Redaction rules.
- Permission policy suggestions.
- Agent economic model metadata.
- Cost, revenue, budget, or chargeback prompts.
- Test cases.
- Adapter plugin code when configuration is not enough.

## Integration Flow

```text
1. User describes the agent and desired connection.
2. Builder asks follow-up questions when required.
3. Builder proposes an integration plan.
4. Builder captures economic model, cost owner, budget, or revenue assumptions
   when applicable.
5. Builder generates adapter config, recipe, tests, or code.
6. User reviews the generated integration.
7. Desktop Bridge runs a local probe or sandbox test.
8. Platform records the integration artifact and audit trail.
9. User enables the integration for real invocations.
```

## Artifact Types

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

## Safety Requirements

Generated integrations must be reviewable before use.

Required controls:

- No silent execution of generated code.
- No arbitrary shell script execution from the cloud.
- Prefer declarative adapter config over generated code.
- Require local approval before installing or running generated integrations.
- Run probes and tests with restricted inputs.
- Store generated artifacts with version history.
- Record who generated, reviewed, approved, and enabled each integration.
- Mark AI-generated artifacts as generated.

## Milestone Boundary

M2 should support intent-to-configuration for:

- CLI agents.
- HTTP agents.
- Health checks.
- Basic input and output schemas.
- Basic redaction rules.
- Basic economics prompts with default `unknown`.
- Probe tests.

Deferred until M3 or later:

- Fully autonomous adapter code deployment.
- Unattended installation.
- Complex interactive terminal agents.
- Marketplace publishing.
- Organization-wide rollout automation.

## Review States

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
