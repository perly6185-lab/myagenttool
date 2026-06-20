# Milestones

GitHub Milestones should mirror the product roadmap.

The detailed scope remains in `docs/vision/ROADMAP.md`. Acceptance gates remain
in `docs/vision/ACCEPTANCE_CRITERIA.md`.

## M0: Remote Invocation Loop

Goal:

```text
User signs in -> Desktop Bridge links device -> user starts from plain-language
intent -> manually registered agent runs locally -> status, logs, trace, result,
audit, cancellation, and offline delivery are visible.
```

Primary source docs:

- `docs/vision/ROADMAP.md`
- `docs/vision/ACCEPTANCE_CRITERIA.md`
- `docs/vision/STATE_MACHINE.md`
- `docs/vision/INVOCATION_DELIVERY.md`
- `docs/vision/IDEA_TO_OUTCOME.md`
- `docs/engineering/ADR_INDEX.md`
- `docs/engineering/M0_CORE_PROTOCOL_SERVICE.md`
- `docs/engineering/M0_DESKTOP_AGENT_BRIDGE.md`
- `docs/engineering/M0_WEB_CONSOLE_LOOP.md`
- `docs/engineering/M0_ACCEPTANCE_CLOSEOUT.md`
- `docs/engineering/M0_MANUAL_ACCEPTANCE.md`
- `docs/engineering/M0_GOVERNANCE_CLOSEOUT.md`
- `docs/engineering/OPEN_DESIGN_WORKFLOW.md`

Accepted M0 architecture decisions:

- Realtime transport: WebSocket bridge channel.
- Desktop Bridge runtime: Node.js CLI/service-style process.
- Server/storage/queue: Node.js server with relational persistence boundary and
  database-backed queue records.
- Web shell: focused plain-language invocation flow with expandable technical
  details.

## M1: Local Agent Management

Goal:

```text
Users can discover, enable, disable, and health-check local agents with
plain-language guidance and local approval for high-risk actions.
```

Primary source docs:

- `docs/vision/AGENT_LIFECYCLE.md`
- `docs/vision/POLICY_AND_RISK.md`
- `docs/vision/USER_EXPERIENCE.md`

## M2: Integration Builder and Governance

Goal:

```text
Users can describe unsupported agents and generate reviewable adapter configs,
schemas, tests, redaction rules, economics prompts, and local probe flows.
```

Primary source docs:

- `docs/vision/INTEGRATION_BUILDER.md`
- `docs/vision/AGENT_ADAPTER_MATRIX.md`
- `docs/vision/ECONOMIC_LEDGER.md`

## M3: Lifecycle Automation and Billing

Goal:

```text
Approved recipes, platform-managed AI billing, chargeback, private packaging,
signed extensions, and advanced adapters become governed product capabilities.
```

Primary source docs:

- `docs/vision/AGENT_LIFECYCLE.md`
- `docs/vision/AI_BILLING_AUDIT.md`
- `docs/vision/DEPLOYMENT.md`
- `docs/vision/EXTENSION_DISTRIBUTION.md`

## M4: Marketplace and Ecosystem

Goal:

```text
Public extension marketplace, adapter publishing, payouts, settlement,
compatibility badges, and ecosystem trust workflows become possible.
```

Primary source docs:

- `docs/vision/ROADMAP.md`
- `docs/vision/AGENT_ADAPTER_MATRIX.md`
- `docs/vision/ECONOMIC_LEDGER.md`
- `docs/vision/EXTENSION_DISTRIBUTION.md`
