# M2 Issue Plan

This document plans the M2 Integration Builder and Governance issue tree and
recommended development order.

## M2 Goal

Users can describe unsupported CLI or HTTP agents and generate reviewable
adapter configs, schemas, tests, redaction rules, economics prompts, and local
probe flows before enabling the integration.

## Issue Tree

| Order | Issue | Scope | First-batch? |
| --- | --- | --- | --- |
| 1 | #91 M2 Integration Builder and Governance | Initiative for the milestone outcome | No |
| 2 | #90 Discovery User-Provided Agent Path Entry | Complete conservative discovery input UX for explicit CLI/path entries | Yes |
| 3 | #92 Integration Intent Intake | Capture unsupported-agent intent in plain language and structured fields | Yes |
| 4 | #93 Generated Adapter Config Artifacts | Generate reviewable CLI/HTTP adapter config artifacts | Yes |
| 5 | #94 Integration Review Workflow | Review, approve, reject, and archive generated artifacts | Yes |
| 6 | #95 Local Probe Test Harness | Run restricted local probe tests before enabling an integration | No |
| 7 | #96 Generated Schema, Redaction, And Test Artifacts | Generate basic schema, redaction, and test-case artifacts | No |
| 8 | #97 Integration Economics Prompts | Capture economic model, cost owner, budget, and unknown-cost policy | No |
| 9 | #98 Quota And Usage Reporting Hooks | Add basic quota policy placeholder and cost/revenue reporting views | No |
| 10 | #99 Retention Settings For Integration Data | Configure retention for logs, prompts, responses, and generated artifacts | No |
| 11 | #100 Integration Builder Platform Agent | Register platform agent that drafts integration plans without enabling them | No |
| 12 | #101 M2 Acceptance Closeout | Close the M2 initiative with verification evidence and residual risks | No |

## Recommended Development Order

### Stage 1: Discovery UX And Intent Intake

Complete the front door for unsupported agents:

- User-provided CLI command/path and HTTP endpoint fields in Discovery.
- Conservative discovery remains limited to explicit user input and known
  sources.
- Intent intake view for unsupported agents with plain-language description and
  adapter selection guidance.

Accepted implementation scope:

- #90 is completed without changing M1 safety boundaries.
- Web Console can capture an unsupported-agent description.
- Server records an integration artifact in `draft` or `generated` state.
- No generated code or local probe executes in this stage.

### Stage 2: Reviewable Adapter Config

Generate the smallest useful integration artifact set:

- CLI adapter config.
- HTTP adapter config.
- Health check metadata.
- Basic risk, data, cost, and cancellation notes.
- Review workflow states.

Accepted implementation scope:

- Generated adapter config artifacts are stored with `generatedByAi` metadata.
- Artifacts can be approved, rejected, archived, or returned to review.
- Approved artifacts do not automatically register or enable agents.
- Smoke or self-check coverage proves artifact creation and review state
  transitions.

### Stage 3: Local Probe And Safety Artifacts

Add validation before registration:

- Restricted local probe test for CLI and HTTP adapter configs.
- Basic input/output schema artifact.
- Redaction policy artifact.
- Test-case artifact.
- Plain-language test result summary.

Accepted implementation scope:

- Probe runs only after explicit user action.
- CLI probes use existing Desktop Bridge paths and do not run arbitrary install
  scripts.
- Passing probe can mark an artifact `tested`.
- Registration from a tested artifact remains explicit and creates a disabled
  agent.

### Stage 4: Governance, Economics, And Closeout

Add governance surfaces and close the milestone:

- Economic model and cost-owner prompts.
- Estimated cost/revenue reporting views without production billing automation.
- Basic quota hook placeholder.
- Retention settings for generated integration data.
- Integration Builder platform agent that drafts plans only.
- M2 acceptance closeout.

Accepted implementation scope:

- Unknown cost remains visible when not configured.
- Quota hooks record decisions but do not introduce enterprise policy engines.
- Platform agent suggestions are advisory and cannot enable integrations.
- M2 closeout maps all acceptance criteria to PRs, checks, and remaining
  follow-up.

## M2 Non-Goals

- Fully autonomous adapter plugin deployment.
- Unattended installs, updates, or uninstalls.
- Complex interactive terminal agents.
- MCP, A2A, or container adapters.
- Marketplace publishing.
- Platform-managed billing.
- Organization-wide rollout automation.

## Verification Baseline

Every M2 stage should run:

```text
pnpm docs:check
pnpm repo:check
pnpm typecheck
pnpm test
pnpm smoke:local
git diff --check
```

Desktop/local execution changes must also preserve the CI `desktop-smoke`
matrix on Ubuntu, macOS, and Windows.
