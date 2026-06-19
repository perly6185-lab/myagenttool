# Test Strategy

This document defines the testing strategy for the project.

Testing should focus on trust-critical behavior first: invocation state,
delivery, cancellation, unlink, audit, cost visibility, and user comprehension.

## Test Pyramid

### Unit Tests

Use for:

- State machine transitions.
- Permission checks.
- Cost calculations.
- Schema validation.
- Adapter metadata parsing.
- Redaction rules.

### Contract Tests

Use for:

- Agent protocol messages.
- Bridge-server events.
- CLI adapter behavior.
- HTTP adapter behavior.
- MCP and A2A compatibility later.

### Integration Tests

Use for:

- Queue dispatch.
- Offline reconnect.
- Duplicate delivery idempotency.
- Cancellation propagation.
- Device unlink cleanup.
- Audit and trace persistence.

### End-to-End Tests

Use for:

- User signs in.
- Device links.
- Agent registers.
- User starts from plain-language task.
- Pre-run review appears.
- Invocation executes.
- Logs and result return.
- Cancellation and offline behavior are visible.

## M0 Required Tests

M0 should have tests for:

- Invocation state machine.
- Delivery state machine.
- Cancellation state machine.
- Device unlink state machine.
- CLI adapter success.
- CLI adapter failure.
- CLI adapter cancellation.
- HTTP adapter success.
- HTTP adapter failure.
- Offline queued invocation dispatch after reconnect.
- Duplicate invocation id does not run twice.
- Audit record is created.
- Unknown cost is visible before run.

## Cross-Platform Tests

For Desktop Bridge:

- Windows process execution.
- Windows process cancellation.
- macOS process execution.
- macOS process cancellation.
- Linux process execution.
- Linux process cancellation.
- Path and environment handling.

## UX Tests

User-facing workflows should be tested for:

- Plain-language task entry.
- Pre-run risk, cost, data, and cancellation review.
- Result explanation.
- Error explanation.
- Advanced details hidden by default.

## Security Tests

Security-focused tests should cover:

- Unauthorized device access denied.
- Revoked device cannot receive work.
- Unlinked device cannot receive new dispatch.
- Credentials are not included in logs.
- Dangerous command registration requires explicit approval or is blocked.

## Billing and Ledger Tests

Economic tests should cover:

- AI usage attribution.
- External agent cost metadata.
- Unknown cost warning.
- Chargeback fields where applicable.
- Settlement fields where applicable.

## Generated Integration Tests

For Integration Builder:

- Generated adapter config validates against schema.
- Generated tests are reviewable.
- Generated code is not executed silently.
- High-risk permissions require user approval.
- Redaction rules are generated when sensitive fields are detected.

## Testing Skills Workflow

AI-assisted changes should choose testing guidance deliberately instead of
treating tests as a generic final step.

Use:

```text
pnpm ai:testing-plan -- --change docs|web|server|desktop|protocol|security|release|adapter --risk low|medium|high|critical
pnpm ai:testing-plan -- --changes "server,security,release" --risk high
```

The command produces required evidence, recommended commands, manual evidence,
and skill guidance for the PR. It is deterministic repository policy. External
Testing skills are reference material only; generated tests remain
repository-owned, reviewable, and subject to normal checks.

`ai:work-runner` infers every matching route from planned files and merges the
requirements. For example, a server file plus security documentation must carry
both server integration evidence and security review evidence; a release tool
plus docs update must carry both release/deploy and documentation evidence.

Change type mapping:

| Change type | Expected evidence |
| --- | --- |
| docs | Markdown links, source doc consistency, repo health |
| web | Unit/smoke checks plus visual QA evidence for desktop and mobile viewports |
| server | Integration evidence for API, queue, audit, persistence, or cost behavior |
| desktop | Cross-platform process execution and cancellation evidence |
| protocol | State-machine, schema, and compatibility evidence |
| security | Security review evidence for auth, credentials, data, and local execution |
| release | Release, rollback, and deploy preflight evidence |
| adapter | Adapter contract evidence for success, failure, and cancellation paths |

Risk mapping:

| Risk | Minimum evidence |
| --- | --- |
| low | Relevant docs/repo checks or focused unit coverage |
| medium | Standard automated checks plus manual verification notes when behavior changes |
| high | Standard checks, issue hygiene, residual risk notes, and explicit missing-test gaps |
| critical | High-risk evidence plus human gate notes before merge or release |

Specific paths:

- Visual UI work follows [VISUAL_QA.md](VISUAL_QA.md).
- Desktop and local execution work must cover process execution and
  cancellation on Windows, macOS, and Linux, or record the platform gap.
- Protocol work should exercise invocation, delivery, cancellation, unlink, and
  audit state-machine behavior.
- Adapter work should cover success, failure, cancellation, and redaction.
- Release work should include release notes, rollback notes, and deploy
  preflight evidence.
- All non-doc behavior changes should keep `pnpm smoke:local` in the evidence
  set unless the PR explains why it is not relevant.

## Manual Verification

Manual verification is acceptable for early M0 demos, but it must be recorded in
the issue or PR.

Manual notes should include:

- Date.
- Platform.
- Commands run.
- Expected result.
- Actual result.
- Screenshots or logs when useful.

## Test Evidence

PRs should list:

- Automated tests run.
- Manual verification performed.
- Tests not run and why.
- Known gaps.
