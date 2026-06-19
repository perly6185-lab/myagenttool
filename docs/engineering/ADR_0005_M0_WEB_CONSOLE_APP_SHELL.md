# ADR 0005: M0 Web Console App Shell

Status: accepted

Date: 2026-06-20

Related issue: [#15](https://github.com/perly6185-lab/myagenttool/issues/15)

## Context

M0 needs a Web Console that lets a non-professional user start from a plain
language task, see device and agent readiness, review risk/cost/data/cancellation
impact, run the invocation, watch status/logs, and understand the result.

The UI must avoid exposing protocol, queue, adapter, and ledger terminology
before the user can complete the happy path.

## Decision

Use a simple web app shell focused on the M0 remote invocation loop.

The first shell should have these work areas:

```text
Task entry
Pre-run review
Device and agent readiness
Invocation status and logs
Result summary
Audit and trace summary
Expandable technical details
```

Keep advanced admin, lifecycle, billing, marketplace, and integration-builder
surfaces out of the first viewport for M0.

## Rationale

This matches the product principle that users should start from intent, not
agent configuration. A small shell also keeps implementation tied to the current
M0 server and bridge capabilities.

The current static web scaffold can continue as the M0 shell while the project
decides whether to introduce a richer framework later.

## Consequences

Positive:

- The UI stays centered on the end-to-end invocation loop.
- Non-professional language remains the default.
- Technical state can still be visible behind expandable details for debugging.

Tradeoffs:

- Complex navigation and settings pages are deferred.
- Rich component libraries or dashboard frameworks are unnecessary until the
  product surface grows.
- M0 visual QA should focus on task flow, not admin completeness.

## M0 Implementation Constraints

- The first screen must be the usable invocation experience, not a landing page.
- Show risk, cost, data handling, target device/agent, and cancellation behavior
  before running work.
- Use plain-language status labels for queued, running, cancelled, failed, and
  succeeded states.
- Keep audit and trace summaries readable without protocol knowledge.
- Keep advanced ids, event payloads, and delivery cursors behind details.

## Acceptance Impact

This ADR unblocks:

- Idea-to-outcome task entry.
- Non-professional user confusion mitigation.
- Web Console M0 design workflow.
- Visual QA expectations for the M0 happy path.
