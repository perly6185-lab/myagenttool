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
